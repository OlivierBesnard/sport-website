import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { ReleaseError, run } from "./exec.js";
import { createKeyFile, defaultKeyPath, loadSigningKey } from "./keys.js";
import { changeRollout, finishPublication, publish, testRelease, withdraw } from "./publish.js";

/**
 * `pnpm release` — publication of the releases, run by a maintainer on their machine (no CI,
 * PLAN §6.8). See `pnpm release help`.
 */

const HELP = `Publication des releases du CMS

  pnpm release <version> [options]      publie une version (ex. 1.4.0, 1.5.0-beta.1)
      --notes <texte> | --notes-file <fichier>   notes de version
      --urgent                           correctif de sécurité : installé sans attendre
      --rollout <0-100>                  part des instances qui l'installent (défaut 100)
      --min-from <version>               version la plus ancienne qui y passe directement
      --key <fichier>                    clé de signature (défaut : RELEASE_SIGNING_KEY,
                                         sinon ~/.sport-cms/release-signing-key.pem)
  pnpm release resume <version>         termine une publication interrompue après l'envoi du tag
  pnpm release rollout <version> <0-100>  change le pourcentage de déploiement
  pnpm release withdraw <version>       retire une version du manifeste
  pnpm release keygen [--key <fichier>] crée la clé de signature (hors du dépôt)
  pnpm release test [options]           release de test, signée par une clé éphémère, sans rien publier
      --out <dossier>                    dossier de sortie (vide ou absent)
      --version <version>                défaut : version actuelle + 1 (correctif)
      --platform <plateforme>            défaut : celle de cette machine ; répétable
      --base-url <url>                   URL des paquets (défaut : relatives au manifeste)

La phrase de passe de la clé est demandée au clavier (ou lue dans RELEASE_KEY_PASSPHRASE).`;

const log = (message: string) => {
  console.log(`» ${message}`);
};

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new ReleaseError(
        "La phrase de passe se saisit dans un terminal (ou par RELEASE_KEY_PASSPHRASE).",
      ),
    );
  }
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolvePromise) => {
    readline.question(question, (answer) => {
      readline.close();
      process.stdout.write("\n");
      resolvePromise(answer);
    });
    muted = true;
  });
}

async function passphrase(confirm: boolean): Promise<string> {
  const fromEnvironment = process.env.RELEASE_KEY_PASSPHRASE;
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return fromEnvironment;
  }
  const first = await askHidden("Phrase de passe de la clé de signature : ");
  if (confirm && (await askHidden("Confirmez la phrase de passe : ")) !== first) {
    throw new ReleaseError("Les deux phrases de passe diffèrent.");
  }
  return first;
}

function keyFile(option: string | undefined): string {
  return resolve(option ?? process.env.RELEASE_SIGNING_KEY ?? defaultKeyPath());
}

function percentage(value: string | undefined): number {
  const number = Number(value);
  if (value === undefined || !/^\d{1,3}$/.test(value) || number > 100) {
    throw new ReleaseError("Le pourcentage de déploiement est un entier de 0 à 100.");
  }
  return number;
}

function needVersion(value: string | undefined): string {
  if (value === undefined) {
    throw new ReleaseError("Numéro de version manquant (pnpm release help).");
  }
  return value;
}

async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      notes: { type: "string" },
      "notes-file": { type: "string" },
      urgent: { type: "boolean", default: false },
      rollout: { type: "string" },
      "min-from": { type: "string" },
      key: { type: "string" },
      out: { type: "string" },
      version: { type: "string" },
      platform: { type: "string", multiple: true },
      "base-url": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined || command === "help") {
    console.log(HELP);
    return;
  }
  const repository = await run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
  switch (command) {
    case "keygen": {
      const file = keyFile(values.key);
      const publicKey = await createKeyFile(file, await passphrase(true), repository);
      console.log(`Clé de signature créée : ${file}
Gardez-la hors du dépôt, sauvegardée, avec sa phrase de passe.

Clé publique, à ajouter à TRUSTED_RELEASE_KEYS (apps/supervisor/src/signature.ts) :
${publicKey}`);
      return;
    }
    case "resume":
      await finishPublication(repository, needVersion(rest[0]), log);
      return;
    case "rollout":
      await changeRollout(repository, needVersion(rest[0]), percentage(rest[1]), log);
      return;
    case "withdraw":
      await withdraw(repository, needVersion(rest[0]), log);
      return;
    case "test": {
      if (values.out === undefined) {
        throw new ReleaseError("Dossier de sortie manquant : --out <dossier>.");
      }
      const output = resolve(values.out);
      const publicKey = await testRelease({
        repository,
        version: values.version,
        platforms: values.platform ?? [`${process.platform}-${process.arch}`],
        output,
        baseUrl: values["base-url"],
        log,
      });
      console.log(`Release de test prête dans ${output}
Servez ce dossier en http://127.0.0.1:<port>/ puis lancez le superviseur avec
  UPDATE_MANIFEST_URL=http://127.0.0.1:<port>/manifest.json
  UPDATE_PUBLIC_KEY=${publicKey}`);
      return;
    }
    default: {
      if (rest.length > 0) {
        throw new ReleaseError(`Argument inattendu : ${rest[0]} (pnpm release help).`);
      }
      if (values.notes !== undefined && values["notes-file"] !== undefined) {
        throw new ReleaseError("--notes et --notes-file s'excluent.");
      }
      const notes =
        values["notes-file"] === undefined
          ? (values.notes ?? "")
          : await readFile(resolve(values["notes-file"]), "utf8");
      const file = keyFile(values.key);
      await publish({
        repository,
        version: command,
        notes: notes.trim(),
        urgent: values.urgent,
        rollout: values.rollout === undefined ? 100 : percentage(values.rollout),
        minFrom: values["min-from"],
        loadKey: async () => loadSigningKey(file, await passphrase(false)),
        log,
      });
    }
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (
    error instanceof ReleaseError ||
    (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
  ) {
    const message =
      error instanceof ReleaseError
        ? error.message
        : "Option inconnue ou valeur manquante (pnpm release help).";
    console.error(`\nErreur : ${message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
