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

## Organisation

- `apps/` : applications ; `server` sert le site public et le back-office, `admin` est l'interface du back-office (le superviseur est à venir)
- `packages/` : paquets partagés (`config` pour les configurations TypeScript, `core` pour le noyau et la configuration d'exécution, `db` pour la base SQLite et ses migrations, `blocks` pour les blocs de page et leur rendu, `themes` pour les thèmes et les styles du site)
- `modules/` : modules officiels, à venir

## Licence

À définir.
