import { describe, expect, it } from "vitest";
import { checkModuleClient, defineModuleClient } from "./client.js";
import { defineBlock } from "./index.js";

const badge = defineBlock<{ text: string }>({
  type: "club.badge",
  label: "Badge",
  fields: { text: { type: "text", label: "Texte" } },
  defaultProps: { text: "" },
  render: ({ text }) => text,
});

function Page() {
  return null;
}

describe("checkModuleClient", () => {
  it("accepts a client entry and defaults its lists", () => {
    const client = defineModuleClient({ id: "club" });
    const result = checkModuleClient(client, "club");
    expect(result).toEqual({ success: true, value: { id: "club", blocks: [], adminPages: [] } });
  });

  it("keeps the very block definitions and pages", () => {
    const page = { path: "journal/ecritures", title: "Écritures", component: Page };
    const result = checkModuleClient(
      defineModuleClient({ id: "club", blocks: [badge], adminPages: [page] }),
      "club",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.blocks[0]).toBe(badge);
      expect(result.value.adminPages[0]).toBe(page);
    }
  });

  it("refuses something that is not a client definition", () => {
    expect(checkModuleClient(undefined, "club")).toEqual({
      success: false,
      issues: ["L'export par défaut doit être le client du module (defineModuleClient)."],
    });
  });

  it("refuses a client of another module", () => {
    const result = checkModuleClient(defineModuleClient({ id: "autre" }), "club");
    expect(result).toEqual({
      success: false,
      issues: ["Le client déclare le module « autre » au lieu de « club »."],
    });
  });

  it("refuses block types outside the module's prefix, or declared twice", () => {
    const foreign = { ...badge, type: "autre.badge" };
    const result = checkModuleClient({ id: "club", blocks: [badge, badge, foreign] }, "club");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        "blocks.1.type : Le type de bloc « club.badge » est déclaré deux fois.",
        "blocks.2.type : Le type du bloc « autre.badge » doit commencer par « club. ».",
      ]);
    }
  });

  it("refuses invalid pages, in French", () => {
    const result = checkModuleClient(
      {
        id: "club",
        adminPages: [
          { path: "Campagnes", title: "Campagnes", component: Page },
          { path: "ok", title: " ", component: "Page" },
        ],
      },
      "club",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        "adminPages.0.path : Le chemin de la page s'écrit en minuscules, chiffres et tirets (ex. « campagnes »).",
        "adminPages.1.title : Le titre de la page est requis.",
        "adminPages.1.component : Le composant de la page (component) doit être une fonction.",
      ]);
    }
  });

  it("refuses a page path declared twice", () => {
    const page = { path: "ok", title: "Page", component: Page };
    expect(checkModuleClient({ id: "club", adminPages: [page, page] }, "club")).toEqual({
      success: false,
      issues: ["adminPages.1.path : La page « ok » est déclarée deux fois."],
    });
  });

  it("speaks French when the issue has no message of its own", () => {
    const result = checkModuleClient({ id: "club", blocks: "badge" }, "club");
    expect(result).toEqual({
      success: false,
      issues: ["blocks : Les blocs (blocks) doivent être une liste."],
    });
    const nested = checkModuleClient({ id: "club", adminPages: [{ path: 3 }] }, "club");
    expect(nested.success).toBe(false);
    if (!nested.success) {
      expect(nested.issues.join(" ")).not.toMatch(/expected|Invalid/);
    }
  });
});
