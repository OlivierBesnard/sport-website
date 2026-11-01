import { serve } from "@hono/node-server";
import { RuntimeConfigError } from "@sport-cms/core/config";
import { createApp } from "./app.js";
import { type Instance, openInstance } from "./instance.js";

/** Entry point of the server: `pnpm --filter @sport-cms/server start` (or `dev`). */
function main(): void {
  let instance: Instance;
  try {
    instance = openInstance(process.env);
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { config, db } = instance;
  const app = createApp({ db, baseUrl: config.baseUrl });
  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.info(`Site public : ${config.baseUrl} (port ${config.port})`);
    console.info(`Données : ${config.dataDir}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Le port ${config.port} est déjà utilisé : choisissez-en un autre avec PORT.`
        : error,
    );
    db.$client.close();
    process.exitCode = 1;
  });

  const stop = () => {
    server.close(() => db.$client.close());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main();
