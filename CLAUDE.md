# sport-website — CMS modulaire auto-hébergé pour clubs de sport

Chaque club installe sa propre instance (site public + back-office). Les fonctionnalités s'ajoutent par modules, qui communiquent via des événements du noyau. Les instances se mettent à jour automatiquement à chaque release GitHub.

Le plan complet est dans `docs/PLAN.md` et le découpage en étapes dans `docs/BACKLOG.md`. Ces fichiers sont **locaux** : `/docs` est ignoré par Git et le dépôt est public. Ne jamais les forcer dans un commit.

## Stack (cf. PLAN §6.2)

- Node.js 24, pnpm 10 (workspaces), Turborepo, TypeScript strict, ESM uniquement
- Serveur : Hono (`@hono/node-server`), rendu serveur React 19 des pages
- Back-office : SPA React (Vite), Tailwind, shadcn/ui ; éditeur de pages Puck
- Base : SQLite (`better-sqlite3`) + Drizzle ORM, migrations drizzle-kit
- Auth : Better Auth ; validation : zod
- Lint et format : Biome ; tests : Vitest (+ Playwright pour le bout en bout)

## Structure

- `apps/` : `server` (site public, API, webhooks, tâches), `admin` (back-office + éditeur), `supervisor` (mises à jour automatiques)
- `packages/` : `config`, `core`, `db`, `module-sdk`, `module-loader`, `blocks`, `themes`, `ui`
- `modules/` : modules officiels, inclus dans la distribution
- `deploy/` : Docker, compose, paquets d'installation

## Commandes

- `pnpm install`
- `pnpm check` : lint + typecheck + tests. Doit passer avant tout commit.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

## Conventions

- Identifiants et commentaires du code en anglais ; textes visibles par les utilisateurs en français ; messages de commit en français.
- Chaque fonctionnalité arrive avec ses tests. Ne jamais désactiver un test ou une règle de lint pour faire passer la vérification.
- Pas de dépendance sans nécessité ; `pnpm-lock.yaml` toujours à jour.
- Aucun secret dans le code ni dans les tests : les clés de test sont générées à la volée.
- Développement sous Windows, CI sous Linux : scripts multiplateformes uniquement (pas de `rm -rf`, de variables d'environnement inline ni de chemins en dur avec `\` ou `/`).
- Données d'exécution dans `DATA_DIR` (par défaut `./data`, ignoré par Git).

## Processus de développement

Tout se fait sur `main`. Pour chaque étape du backlog : agent `developpeur` (code + tests) → agent `testeur` (vérification indépendante) → agent `relecteur` (revue du diff) → corrections par le développeur → commit + push par l'orchestrateur → étape suivante. Les agents ne commitent pas et ne poussent pas.
