import { RuntimeConfigError } from "@sport-cms/core/config";
import { seedDemoContent } from "./demo-content.js";
import { openInstance } from "./instance.js";

/**
 * Adds the demonstration pages to the database of `DATA_DIR`:
 * `pnpm --filter @sport-cms/server seed:demo`. Development only; run it by hand.
 */
function main(): void {
  try {
    const { config, db } = openInstance(process.env);
    try {
      const added = seedDemoContent(db);
      console.info(
        added === 0
          ? "Les pages de démonstration sont déjà présentes : rien à ajouter."
          : `${added} page(s) de démonstration ajoutée(s) dans ${config.dataDir}.`,
      );
    } finally {
      db.$client.close();
    }
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main();
