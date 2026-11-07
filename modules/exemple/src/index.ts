import { defineModule } from "@sport-cms/module-sdk";
import { z } from "zod";
import { quoteBlock } from "./quote-block.js";

export { type QuoteProps, quoteBlock } from "./quote-block.js";

/**
 * Official demonstration module: one block (a quotation), settings and credentials that show how
 * the back-office validates and stores them. It processes no personal data and asks for no
 * permission. A starting point for module authors.
 */
export default defineModule({
  id: "exemple",
  name: "Exemple",
  version: "0.1.0",
  category: "démonstration",
  description: "Module de démonstration : ajoute un bloc « Citation » aux pages.",
  permissions: [],
  dataProcessing: [],
  settings: z.object({
    signature: z
      .string()
      .trim()
      .max(100, "La signature est trop longue (100 caractères maximum).")
      .default("")
      .meta({
        title: "Signature",
        description: "Un exemple de réglage : un texte libre de 100 caractères au plus.",
      }),
  }),
  credentials: z.object({
    apiKey: z
      .string()
      .trim()
      .min(1, "La clé d'API est requise.")
      .meta({ title: "Clé d'API", description: "Un exemple d'identifiant, stocké chiffré." }),
  }),
  blocks: [quoteBlock],
  lifecycle: {
    async onEnable(ctx) {
      // Counts the activations in the module's own storage: an example of `ctx.kv`.
      const count = await ctx.kv.get("activations");
      await ctx.kv.set("activations", typeof count === "number" ? count + 1 : 1);
    },
  },
});
