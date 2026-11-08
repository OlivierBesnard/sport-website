import { parseSupervisorConfig, SupervisorConfigError } from "./config.js";
import { SupervisorProxy } from "./proxy.js";
import { Supervisor } from "./supervisor.js";

/** Rhythm of the loop: the back-office's requests are picked up within this delay. */
const TICK_MS = 5000;

/** Entry point of the supervisor (the Docker image's, E14). */
async function main(): Promise<void> {
  let config: ReturnType<typeof parseSupervisorConfig>;
  try {
    config = parseSupervisorConfig(process.env);
  } catch (error) {
    if (error instanceof SupervisorConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const proxy = new SupervisorProxy({ behindProxy: config.behindProxy });
  const supervisor = new Supervisor({
    dataDir: config.dataDir,
    appPort: config.appPort,
    manifestUrl: config.manifestUrl,
    trustedKeys: config.trustedKeys,
    appEnv: config.appEnv,
    proxy,
    ...(config.bundledApp === undefined ? {} : { bundledApp: config.bundledApp }),
  });

  const server = proxy.createServer();
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Le port ${config.port} est déjà utilisé : choisissez-en un autre avec PORT.`
        : error,
    );
    void supervisor.stop();
    process.exitCode = 1;
  });
  // Listening first: while the application starts, visitors get the « mise à jour » page.
  server.listen(config.port, () => {
    console.info(`Superviseur : port ${config.port}, application sur le port ${config.appPort}`);
  });

  await supervisor.start();
  const timer = setInterval(() => {
    void supervisor.tick();
  }, TICK_MS);

  const stop = () => {
    clearInterval(timer);
    server.close();
    void supervisor.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

await main();
