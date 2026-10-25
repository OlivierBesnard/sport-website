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

## Commandes

| Commande                        | Rôle                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `pnpm install`                  | Installe les dépendances de tout le monorepo                  |
| `pnpm lint`                     | Vérifie le lint, le formatage et l'ordre des imports (Biome)  |
| `pnpm format`                   | Applique le formatage et les corrections sûres (Biome)        |
| `pnpm typecheck`                | Vérifie les types TypeScript de chaque paquet (Turborepo)     |
| `pnpm test`                     | Lance les tests (Vitest, un projet par paquet)                |
| `pnpm build`                    | Construit les paquets (Turborepo, avec cache)                 |
| `pnpm check`                    | Lint, typecheck et tests : doit passer avant tout commit      |
| `pnpm db:generate --name <nom>` | Génère la migration SQL après une modification du schéma      |

## Organisation

- `apps/` : applications (serveur, back-office, superviseur), à venir
- `packages/` : paquets partagés (`config` pour les configurations TypeScript, `core` pour le noyau et la configuration d'exécution, `db` pour la base SQLite et ses migrations)
- `modules/` : modules officiels, à venir

## Licence

À définir.
