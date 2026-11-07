import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { sharedModulesPlugin } from "./vite-shared-modules";

/** Origin of the instance in development (the proxy target): `PORT`'s default value. */
const serverOrigin = "http://localhost:3000";

/**
 * Build of the back-office, a single-page application served by the server under `/admin`
 * (`base: "/admin/"` makes the asset URLs absolute from the instance root). In development the
 * API runs on the server (`pnpm --filter @sport-cms/server dev`), proxied on the same origin:
 * the proxy rewrites `Origin` to the origin of the instance, which Better Auth compares to
 * `baseUrl` on every `POST /api/auth/*` — the dev server's own origin would be refused.
 * The shared dependencies of the modules (React, zod, the SDK) get their own entries and the
 * import map of `index.html` (`vite-shared-modules.ts`).
 */
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss(), sharedModulesPlugin()],
  server: {
    proxy: {
      // Client entries of the modules, served by the instance (a session is required).
      "/admin/_modules": { target: serverOrigin },
      "/api": {
        target: serverOrigin,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyRequest) => {
            proxyRequest.setHeader("origin", serverOrigin);
          });
        },
      },
    },
  },
});
