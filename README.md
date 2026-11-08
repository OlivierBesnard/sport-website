# sport-website

CMS modulaire et auto-hébergé pour les clubs de sport. Chaque club installe sa propre instance (site public et back-office), enrichie par des modules, et la met à jour automatiquement à chaque nouvelle version.

Le projet est en début de développement : il n'est pas encore utilisable.

## Prérequis

- Node.js 24 ou plus récent (version de référence dans `.node-version`)
- pnpm 10 (version exacte épinglée dans le champ `packageManager` de `package.json`)

## Démarrage

```sh
pnpm install
pnpm check
pnpm build
```

## Lancer le site en local

```sh
pnpm --filter @sport-cms/server seed:demo   # ajoute deux pages de démonstration (une seule fois)
pnpm --filter @sport-cms/server dev         # serveur sur http://localhost:3000, relancé à chaque modification
```

`dev` exécute directement les sources TypeScript (avec `tsx`) : aucun `pnpm build` n'est nécessaire. Pour lancer la version construite, comme en production : `pnpm build`, puis `pnpm --filter @sport-cms/server start`.

Le back-office est servi par le même serveur sous `http://localhost:3000/admin`, d'après le build de `apps/admin` (`pnpm build` ; sans build, une page 503 l'indique). Pour développer le back-office lui-même : `pnpm --filter @sport-cms/admin dev` (interface sur http://localhost:5173/admin/, API mandatée vers le serveur sur le port 3000).

Le serveur lit sa configuration dans les variables d'environnement :

| Variable     | Rôle                                                       | Par défaut               |
| ------------ | ---------------------------------------------------------- | ------------------------ |
| `DATA_DIR`   | Dossier des données (base `database.sqlite`, médias…)      | `./data`                 |
| `PORT`       | Port HTTP                                                  | `3000`                   |
| `BASE_URL`   | Adresse publique du site, sans chemin                      | `http://localhost:PORT`  |
| `SECRET_KEY` | Clé des sessions et des secrets (32 octets en base64), requise : `openssl rand -base64 32` | aucune                   |

`DATA_DIR` est relatif au dossier de lancement : avec `pnpm --filter`, c'est `apps/server`, donc les données vont par défaut dans `apps/server/data` (ignoré par Git). La base y est créée et migrée au démarrage. Les pages de démonstration ne sont jamais ajoutées automatiquement : seule la commande `seed:demo` le fait.

## Commandes

| Commande                                   | Rôle                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| `pnpm install`                             | Installe les dépendances de tout le monorepo                  |
| `pnpm lint`                                | Vérifie le lint, le formatage et l'ordre des imports (Biome)  |
| `pnpm format`                              | Applique le formatage et les corrections sûres (Biome)        |
| `pnpm typecheck`                           | Vérifie les types TypeScript de chaque paquet (Turborepo)     |
| `pnpm test`                                | Lance les tests (Vitest, un projet par paquet)                |
| `pnpm build`                               | Construit les paquets et le serveur (Turborepo, avec cache)   |
| `pnpm test:e2e`                            | Tests de bout en bout Playwright sur le serveur compilé (installe les navigateurs au premier lancement : `pnpm exec playwright install chromium`) |
| `pnpm check`                               | Lint, typecheck et tests : doit passer avant tout commit      |
| `pnpm db:generate --name <nom>`            | Génère la migration SQL après une modification du schéma      |
| `pnpm --filter @sport-cms/server dev`      | Lance le serveur depuis les sources, relancé à chaque modification |
| `pnpm --filter @sport-cms/server start`    | Lance le serveur construit (`pnpm build` d'abord)             |
| `pnpm --filter @sport-cms/server seed:demo` | Ajoute les pages de démonstration dans la base de `DATA_DIR` |
| `pnpm release help`                        | Publication des releases (mainteneurs, voir ci-dessous)       |

## Publier une release (mainteneurs)

Publier une release met à jour toutes les instances. La commande se lance uniquement depuis la machine d'un mainteneur (pas de CI), avec `gh` connecté.

1. Une fois : `pnpm release keygen` crée la clé de signature (Ed25519, chiffrée par une phrase de passe, par défaut `~/.sport-cms/release-signing-key.pem`, jamais dans le dépôt). Sauvegardez-la avec sa phrase de passe. Sa clé publique s'ajoute à `TRUSTED_RELEASE_KEYS` (`apps/supervisor/src/signature.ts`). GitHub Pages doit servir la branche `gh-pages` (Settings → Pages).
2. `pnpm release 1.4.0 --notes-file notes.md` (options : `--urgent`, `--rollout 10`, `--min-from 1.0.0`, `--key <fichier>`). La commande refuse un arbre modifié ou un `main` différent de GitHub, demande la phrase de passe et vérifie que la clé est de confiance. Elle commite la version (`CMS_VERSION`), puis, depuis une copie de travail neuve de ce commit, lance `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build` et `pnpm test:e2e`, et construit les paquets `linux-x64` et `linux-arm64` (`pnpm deploy` : dépendances de production de la plateforme, sans liens), qu'elle signe. En cas d'échec, le commit de version est annulé. Viennent ensuite le tag `v1.4.0`, la release GitHub avec les paquets et le manifeste sur `gh-pages`. Si la publication s'interrompt après l'envoi du tag : `pnpm release resume 1.4.0`.
3. `pnpm release rollout 1.4.0 50` élargit le déploiement progressif ; `pnpm release withdraw 1.4.0` retire une version.

Rotation de la clé : ajouter la nouvelle clé publique à `TRUSTED_RELEASE_KEYS` dans une release signée par l'ancienne ; une fois les instances à jour, signer avec la nouvelle, puis retirer l'ancienne.

`pnpm release test --out <dossier>` produit les mêmes paquets depuis `HEAD` (plateforme de la machine par défaut, `--platform` répétable), signés par une clé éphémère, avec leur manifeste, sans rien publier. Servi en `http://127.0.0.1`, ce dossier permet de tester un superviseur (`UPDATE_MANIFEST_URL`, `UPDATE_PUBLIC_KEY`) sur un vrai build.

## Organisation

- `apps/` : applications ; `server` sert le site public et le back-office, `admin` est l'interface du back-office, `supervisor` reçoit le trafic devant le serveur et installe les mises à jour signées (`pnpm --filter @sport-cms/supervisor start`, variables `PORT`, `APP_PORT`, `BUNDLED_APP`, `UPDATE_MANIFEST_URL`, `UPDATE_PUBLIC_KEY`, `BEHIND_PROXY`)
- `packages/` : paquets partagés (`release` pour la publication des releases, `config` pour les configurations TypeScript, `core` pour le noyau et la configuration d'exécution, `db` pour la base SQLite et ses migrations, `blocks` pour les blocs de page et leur rendu, `themes` pour les thèmes et les styles du site)
- `modules/` : modules officiels, à venir

## Licence

À définir.
