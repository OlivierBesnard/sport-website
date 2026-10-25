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
- `pnpm check` : lint + typecheck + tests. Avant chaque commit, lancer `pnpm check` puis `pnpm build` en local : les deux doivent passer.
- `pnpm lint` : Biome en vérification (lint, formatage, ordre des imports) ; `pnpm format` : Biome applique formatage et corrections sûres
- `pnpm typecheck` : `tsc --noEmit` dans chaque paquet (Turborepo) et sur les fichiers TypeScript de la racine
- `pnpm test` : Vitest lancé à la racine, un projet par paquet de `apps/*`, `packages/*`, `modules/*`
- `pnpm build` : Turborepo (`tsc -p tsconfig.build.json` vers `dist/` pour les paquets)
- `pnpm db:generate --name <nom>` : après une modification du schéma (`packages/db/src/schema`), génère la migration SQL (drizzle-kit) dans `packages/db/migrations`, à commiter avec le schéma. Un test échoue si schéma et migrations divergent.

## Conventions

- Identifiants et commentaires du code en anglais ; textes visibles par les utilisateurs en français ; messages de commit en français.
- Chaque fonctionnalité arrive avec ses tests. Ne jamais désactiver un test ou une règle de lint pour faire passer la vérification.
- Pas de dépendance sans nécessité ; `pnpm-lock.yaml` toujours à jour. Les scripts d'installation des dépendances sont déclarés dans `allowBuilds` (`pnpm-workspace.yaml`) et autorisés seulement s'ils sont indispensables (`better-sqlite3` fournit ses binaires précompilés).
- Aucun secret dans le code ni dans les tests : les clés de test sont générées à la volée.
- Développement sous Windows, exécution sous Linux (image Docker) : scripts multiplateformes uniquement (pas de `rm -rf`, de variables d'environnement inline ni de chemins en dur avec `\` ou `/`). Fins de ligne LF partout (normalisées par `.gitattributes` ; Biome les vérifie aussi dans le code, le JSON et le YAML).
- Paquets internes : `tsconfig.json` étend `@sport-cms/config/tsconfig.base.json`, `tsconfig.build.json` étend `@sport-cms/config/tsconfig.build.json`. Dans `package.json`, `exports["."]` déclare en premier la condition `"@sport-cms/source": "./src/index.ts"`, puis `types` et `default` vers `dist/` ; une sous-entrée (ex. `exports["./config"]`) suit le même modèle. L'entrée racine d'un paquet utilisable dans le navigateur n'importe aucun module Node (`node:*`) : le code réservé au serveur passe par une sous-entrée. L'exécution et TypeScript utilisent `dist/`, que Turborepo construit pour les dépendances avant `typecheck` et `build`. Les tests, eux, activent la condition `@sport-cms/source` (`ssr.resolve.conditions` dans `vitest.config.ts`) : ils importent toujours les sources, jamais un `dist/` absent ou périmé.
- Données d'exécution dans `DATA_DIR` (par défaut `./data`, ignoré par Git).
- Configuration d'exécution : `parseRuntimeConfig(env)` de `@sport-cms/core/config` (zod) lit `DATA_DIR`, `PORT`, `BASE_URL` et `SECRET_KEY` dans l'objet reçu (`process.env` en production, un objet littéral dans les tests).
- Base de données (`@sport-cms/db`) : `openDatabase(chemin)` puis `migrate(db)` ; `createTestDatabase()` dans les tests. Dates en entier, millisecondes depuis l'époque Unix (`integer(…, { mode: "timestamp_ms" })`), fixées par Drizzle (`created_at`, `updated_at`) ; JSON en texte (`text(…, { mode: "json" })` typé par `$type`) ; booléens en 0/1. Une migration commitée ne se modifie plus : on en génère une nouvelle, en deux temps (*expand / contract*) pour qu'une version N-1 tourne encore sur la base migrée.

## Processus de développement

Tout se fait sur `main`. Pour chaque étape du backlog : agent `developpeur` (code + tests) → agent `testeur` (vérification indépendante) → agent `relecteur` (revue du diff) → corrections par le développeur → commit + push par l'orchestrateur → étape suivante. Les agents ne commitent pas et ne poussent pas.
