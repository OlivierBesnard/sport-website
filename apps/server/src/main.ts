import { serve } from "@hono/node-server";
import { RuntimeConfigError } from "@sport-cms/core/config";
import { adminBuildDirectory, adminRoutes } from "./admin.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth/create-auth.js";
import { authRoutes } from "./auth/routes.js";
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
  if (config.secretKey === undefined) {
    // The auth API needs it to sign the session cookies; without it, an instance could not
    // keep its sessions across a restart, so it refuses to start instead.
    console.error(
      "La variable SECRET_KEY est requise : une clé de 256 bits en base64, à générer par " +
        "exemple avec « openssl rand -base64 32 ». Elle protège les sessions et les secrets " +
        "de l'instance.",
    );
    db.$client.close();
    process.exitCode = 1;
    return;
  }

  const auth = createAuth({ db, baseUrl: config.baseUrl, secretKey: config.secretKey });
  // The back-office (`apps/admin` build) is served under /admin; a 503 page replaces it when
  // the build is absent (development without `pnpm build`), without stopping the server.
  const adminDirectory = adminBuildDirectory();
  const app = createApp({
    db,
    baseUrl: config.baseUrl,
    secretKey: config.secretKey,
    routes: (routes) => {
      adminRoutes({ directory: adminDirectory })(routes);
      authRoutes({ auth, db })(routes);
    },
  });
  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.info(`Site public : ${config.baseUrl} (port ${config.port})`);
    console.info(`Back-office : ${config.baseUrl}/admin`);
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
