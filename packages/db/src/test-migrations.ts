import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** First journal timestamp of the folders written by {@link writeMigrations}. */
const FIRST_MIGRATION_MILLIS = 1_700_000_000_000;

/**
 * Test helper, excluded from the build: writes into `folder` a migrations folder in drizzle-kit's
 * format, a journal plus one SQL file per migration, each given as its list of statements.
 * Journal timestamps depend only on the position, so the same first migrations written in two
 * folders count as the same ones.
 */
export function writeMigrations(folder: string, migrations: readonly string[][]): string {
  mkdirSync(join(folder, "meta"), { recursive: true });
  const entries = migrations.map((statements, idx) => {
    const tag = `${String(idx).padStart(4, "0")}_step`;
    writeFileSync(join(folder, `${tag}.sql`), statements.join("\n--> statement-breakpoint\n"));
    return { idx, version: "6", when: FIRST_MIGRATION_MILLIS + idx, tag, breakpoints: true };
  });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }),
  );
  return folder;
}
