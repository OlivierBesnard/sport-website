import { defineModuleClient } from "@sport-cms/module-sdk";
import { AboutPage } from "./about-page.js";
import { quoteBlock } from "./quote-block.js";

/**
 * Client entry of the module (`dist/client.js`), loaded by the back-office when the module is
 * enabled: the block for the editor (the very definition the server renders) and a page of the
 * back-office. It imports neither zod nor Node.js: only what the browser runs.
 */
export default defineModuleClient({
  id: "exemple",
  blocks: [quoteBlock],
  adminPages: [{ path: "a-propos", title: "À propos", component: AboutPage }],
});
