import { serve } from "@hono/node-server";
import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import { RuntimeConfigError } from "@sport-cms/core/config";
import { adminBuildDirectory, adminRoutes } from "./admin.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth/create-auth.js";
import { authRoutes } from "./auth/routes.js";
import { HtmlCache } from "./html-cache.js";
import { type Instance, openInstance } from "./instance.js";
import { navigationApiRoutes } from "./navigation-api.js";
import { pagesApiRoutes } from "./pages-api.js";

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
  // One HTML cache shared by the public site and the admin API: a publication invalidates the
  // exact page the public site would otherwise keep serving.
  const htmlCache = new HtmlCache();
  // The same block definitions are rendered publicly and edited in the back-office; the
  // registry is built once: a new one empties the HTML cache. Modules will add theirs (E07).
  const blockRegistry = createBlockRegistry(coreBlocks);
  const blocks = () => blockRegistry;
  // The back-office (`apps/admin` build) is served under /admin; a 503 page replaces it when
  // the build is absent (development without `pnpm build`), without stopping the server.
  const adminDirectory = adminBuildDirectory();
  const app = createApp({
    db,
    baseUrl: config.baseUrl,
    secretKey: config.secretKey,
    htmlCache,
    blocks,
    routes: (routes) => {
      adminRoutes({ directory: adminDirectory })(routes);
      authRoutes({ auth, db })(routes);
      pagesApiRoutes({ auth, db, blocks, htmlCache })(routes);
      navigationApiRoutes({ auth, db, htmlCache })(routes);
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
