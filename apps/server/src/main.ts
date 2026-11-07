import { serve } from "@hono/node-server";
import { RuntimeConfigError } from "@sport-cms/core/config";
import { type BootedInstance, bootInstance, StartupError } from "./boot.js";

/** Entry point of the server: `pnpm --filter @sport-cms/server start` (or `dev`). */
async function main(): Promise<void> {
  let instance: BootedInstance;
  try {
    instance = await bootInstance(process.env);
  } catch (error) {
    if (error instanceof RuntimeConfigError || error instanceof StartupError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { config, app, modules, runtime, close } = instance;
  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.info(`Site public : ${config.baseUrl} (port ${config.port})`);
    console.info(`Back-office : ${config.baseUrl}/admin`);
    console.info(`Données : ${config.dataDir}`);
    const available = modules.list().filter((module) => module.status === "available");
    console.info(
      `Modules : ${available.length} chargé(s), ${modules.failures().length} refusé(s)` +
        (available.length > 0 ? ` (${available.map((module) => module.id).join(", ")})` : ""),
    );
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Le port ${config.port} est déjà utilisé : choisissez-en un autre avec PORT.`
        : error,
    );
    void runtime.stop().finally(close);
    process.exitCode = 1;
  });

  // Events, scheduled jobs and webhooks run in this process, next to the HTTP server.
  runtime.start();

  const stop = () => {
    // The round in progress ends before the database closes.
    server.close(() => {
      void runtime.stop().finally(close);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

await main();
