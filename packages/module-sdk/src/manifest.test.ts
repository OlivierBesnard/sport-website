import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineBlock } from "./index.js";
import { checkModuleDefinition, parseModuleManifest } from "./manifest.js";

const validManifest = {
  id: "resultats-ffhb",
  name: "Résultats FFHB",
  version: "1.2.0",
  engines: { cms: "^0.1.0" },
};

function issuesOf(result: { success: boolean; issues?: readonly string[] }): readonly string[] {
  return result.success ? [] : (result.issues ?? []);
}

describe("parseModuleManifest", () => {
  it("accepts a minimal manifest and fills the defaults", () => {
    const result = parseModuleManifest(validManifest);
    expect(result).toEqual({
      success: true,
      value: { ...validManifest, permissions: [], dataProcessing: [] },
    });
  });

  it("keeps the permissions and the GDPR declaration, and ignores unknown keys", () => {
    const result = parseModuleManifest({
      ...validManifest,
      futureKey: true,
      permissions: ["members:write", "payments.read"],
      dataProcessing: [{ purpose: "Adhésions", data: ["identité", "email"], retention: "3 ans" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).not.toHaveProperty("futureKey");
      expect(result.value.permissions).toEqual(["members:write", "payments.read"]);
      expect(result.value.dataProcessing).toHaveLength(1);
    }
  });

  it.each([
    ["an id with capitals", { ...validManifest, id: "HelloAsso" }, "id :"],
    ["an id with a dot", { ...validManifest, id: "hello.asso" }, "id :"],
    ["a version outside semver", { ...validManifest, version: "1.0" }, "version :"],
    ["no engines", { ...validManifest, engines: undefined }, "engines"],
    ["an empty name", { ...validManifest, name: "  " }, "name :"],
    ["a malformed permission", { ...validManifest, permissions: ["tout"] }, "permissions.0 :"],
    [
      "a repeated permission",
      { ...validManifest, permissions: ["a.b", "a.b"] },
      "Une permission est demandée deux fois.",
    ],
    [
      "a processing without data",
      { ...validManifest, dataProcessing: [{ purpose: "x", data: [], retention: "1 an" }] },
      "dataProcessing.0.data :",
    ],
  ])("refuses %s, with a French message", (_name, manifest, expected) => {
    const result = parseModuleManifest(manifest);
    expect(result.success).toBe(false);
    expect(issuesOf(result).join("\n")).toContain(expected);
  });

  it("refuses what is not an object", () => {
    expect(parseModuleManifest("exemple").success).toBe(false);
    expect(parseModuleManifest(null).success).toBe(false);
  });
});

const quote = defineBlock<{ text: string }>({
  type: "demo.quote",
  label: "Citation",
  fields: { text: { type: "text" } },
  defaultProps: { text: "" },
  render: ({ text }) => text,
});

const validDefinition = {
  id: "demo",
  name: "Démo",
  version: "1.0.0",
  settings: z.object({ enabled: z.boolean().default(true) }),
  credentials: z.object({ apiKey: z.string() }),
  blocks: [quote],
  lifecycle: { onEnable: () => {} },
};

describe("checkModuleDefinition", () => {
  it("accepts a definition and returns it as is", () => {
    const result = checkModuleDefinition(validDefinition);
    expect(result.success).toBe(true);
    expect(result.success && result.value).toBe(validDefinition);
  });

  it("does not require engines, unlike manifest.json", () => {
    expect(checkModuleDefinition({ id: "a", name: "A", version: "0.1.0" }).success).toBe(true);
  });

  it.each([
    ["something that is not an object", 42, "defineModule"],
    [
      "a block type without the module prefix",
      { ...validDefinition, blocks: [{ ...quote, type: "quote" }] },
      "doit commencer par « demo. »",
    ],
    [
      "a block type that is only the prefix",
      { ...validDefinition, blocks: [{ ...quote, type: "demo." }] },
      "doit commencer par « demo. »",
    ],
    ["a block declared twice", { ...validDefinition, blocks: [quote, quote] }, "déclaré deux fois"],
    [
      "a block without render",
      { ...validDefinition, blocks: [{ ...quote, render: "x" }] },
      "blocks.0.render :",
    ],
    [
      "a field of an unknown type",
      { ...validDefinition, blocks: [{ ...quote, fields: { text: { type: "color" } } }] },
      "blocks.0.fields.text.type :",
    ],
    [
      "a block type surrounded by spaces (stored as written in page data)",
      { ...validDefinition, blocks: [{ ...quote, type: " demo.quote " }] },
      "aucune espace",
    ],
    [
      "a block type with a space inside",
      { ...validDefinition, blocks: [{ ...quote, type: "demo.ma citation" }] },
      "aucune espace",
    ],
    ["settings that are not a zod schema", { ...validDefinition, settings: {} }, "settings :"],
    [
      "a lifecycle hook that is not a function",
      { ...validDefinition, lifecycle: { onEnable: true } },
      "lifecycle.onEnable",
    ],
  ])("refuses %s", (_name, definition, expected) => {
    const result = checkModuleDefinition(definition);
    expect(result.success).toBe(false);
    expect(issuesOf(result).join("\n")).toContain(expected);
  });
});

describe("messages", () => {
  it("are French even for issues without a message of their own", () => {
    const result = parseModuleManifest({ ...validManifest, dataProcessing: "aucun" });
    expect(result.success).toBe(false);
    expect(issuesOf(result).join(" ")).not.toMatch(/expected|Invalid/);
  });
});

describe("events, jobs and webhooks of a module", () => {
  const base = { id: "club", name: "Club", version: "1.0.0" };
  const noop = () => undefined;

  function issues(extra: Record<string, unknown>): readonly string[] {
    const result = checkModuleDefinition({ ...base, ...extra });
    return result.success ? [] : result.issues;
  }

  it("accepts subscriptions, emitted events, jobs and webhooks", () => {
    expect(
      issues({
        emits: ["club.member_joined"],
        on: { "payment.received": noop, "page.published@1": noop },
        jobs: [{ id: "sync-orders", schedule: "*/30 * * * *", run: noop }],
        webhooks: { notifications: noop },
      }),
    ).toEqual([]);
  });

  it("refuses invalid event types and subscriptions, in French", () => {
    expect(issues({ emits: ["Paiement"] })).toEqual([
      "emits.0 : Un événement émis s'écrit en mots séparés par des points (ex. « payment.received »).",
    ]);
    expect(issues({ on: { "payment.received@v2": noop } }).join(" ")).toContain(
      "Un abonnement (on) porte sur un type d'événement",
    );
    expect(issues({ on: { "payment.received": "noop" } })).toEqual([
      "on.payment.received : Un abonnement (on) doit être une fonction.",
    ]);
  });

  it("refuses an invalid job: identifier, schedule, run, duplicate", () => {
    expect(issues({ jobs: [{ id: "Sync", schedule: "* * *", run: "x" }] })).toEqual([
      "jobs.0.id : L'identifiant de la tâche s'écrit en minuscules, chiffres et tirets.",
      "jobs.0.schedule : La planification « * * * » doit compter 5 champs (minute heure jour mois jour-de-la-semaine).",
      "jobs.0.run : L'exécution de la tâche (run) doit être une fonction.",
    ]);
    const job = { id: "sync", schedule: "0 3 * * *", run: noop };
    expect(issues({ jobs: [job, job] })).toEqual(["jobs : Une tâche est déclarée deux fois."]);
  });

  it("refuses an invalid webhook name and a block dependency that is not an event type", () => {
    expect(issues({ webhooks: { Notifs: noop } }).join(" ")).toContain(
      "Le nom d'un webhook s'écrit en minuscules",
    );
    const block = {
      type: "club.score",
      label: "Score",
      fields: {},
      defaultProps: {},
      render: noop,
      dependsOn: ["matchs"],
    };
    expect(issues({ blocks: [block] })).toEqual([
      "blocks.0.dependsOn.0 : Une dépendance du bloc doit être un type d'événement (ex. « match.updated »).",
    ]);
  });
});
