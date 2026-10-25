import { defineConfig } from "drizzle-kit";

/** drizzle-kit configuration, used by `pnpm db:generate` to write the SQL migrations. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
