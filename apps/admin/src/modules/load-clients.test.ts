import { defineBlock } from "@sport-cms/blocks";
import { defineModuleClient } from "@sport-cms/module-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientModuleEntry } from "../api/modules";
import { canSeePage, loadModuleClients } from "./load-clients";

function badge(type: string) {
  return defineBlock<{ text: string }>({
    type,
    label: "Badge",
    fields: { text: { type: "text", label: "Texte" } },
    defaultProps: { text: "" },
    render: ({ text }) => text,
  });
}

function Page() {
  return null;
}

function entry(overrides: Partial<ClientModuleEntry> = {}): ClientModuleEntry {
  return {
    id: "club",
    name: "Club",
    version: "1.0.0",
    blocks: ["club.badge"],
    client: "/admin/_modules/club/1.0.0/client.js",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadModuleClients", () => {
  it("takes the blocks and pages of each enabled module", async () => {
    const block = badge("club.badge");
    const importer = vi.fn(async () => ({
      default: defineModuleClient({
        id: "club",
        blocks: [block],
        adminPages: [{ path: "journal", title: "Journal", component: Page }],
      }),
    }));
    const clients = await loadModuleClients([entry()], importer);
    expect(importer).toHaveBeenCalledWith("/admin/_modules/club/1.0.0/client.js");
    expect(clients.blocks).toEqual([block]);
    expect(clients.pages).toEqual([
      {
        path: "journal",
        title: "Journal",
        component: Page,
        module: { id: "club", name: "Club", version: "1.0.0" },
      },
    ]);
    expect(clients.problems).toEqual([]);
  });

  it("leaves out a module whose client fails to load, keeping the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const block = badge("autre.badge");
    const clients = await loadModuleClients(
      [
        entry(),
        entry({ id: "autre", name: "Autre", blocks: ["autre.badge"], client: "/autre.js" }),
      ],
      async (url) => {
        if (url === "/autre.js") {
          return { default: defineModuleClient({ id: "autre", blocks: [block] }) };
        }
        throw new TypeError("Failed to fetch dynamically imported module");
      },
    );
    expect(clients.blocks).toEqual([block]);
    expect(clients.problems).toEqual([
      {
        id: "club",
        name: "Club",
        message: "Le module n'a pas pu être chargé dans le back-office.",
      },
    ]);
    expect(JSON.stringify(clients.problems)).not.toContain("Failed");
  });

  it("refuses an invalid client, in French", async () => {
    const clients = await loadModuleClients([entry()], async () => ({
      default: defineModuleClient({ id: "autre" }),
    }));
    expect(clients.blocks).toEqual([]);
    expect(clients.problems).toEqual([
      {
        id: "club",
        name: "Club",
        message:
          "Client du module invalide : Le client déclare le module « autre » au lieu de « club ».",
      },
    ]);
  });

  it("keeps only the blocks the server renders, and says which ones are missing", async () => {
    const clients = await loadModuleClients(
      [entry({ blocks: ["club.badge", "club.score"] })],
      async () => ({
        default: defineModuleClient({
          id: "club",
          blocks: [badge("club.badge"), badge("club.extra")],
        }),
      }),
    );
    expect(clients.blocks.map((block) => block.type)).toEqual(["club.badge"]);
    expect(clients.problems.map((problem) => problem.message)).toEqual([
      "Le bloc « club.extra » n'est pas déclaré par le serveur : il est ignoré.",
      "Le bloc « club.score » est rendu sur le site, mais son client ne le déclare pas : il ne peut pas être ajouté depuis l'éditeur.",
    ]);
  });

  it("imports nothing for a module without client, and warns only when it has blocks", async () => {
    const importer = vi.fn();
    const clients = await loadModuleClients(
      [entry({ client: null }), entry({ id: "vide", client: null, blocks: [] })],
      importer,
    );
    expect(importer).not.toHaveBeenCalled();
    expect(clients.problems.map((problem) => problem.id)).toEqual(["club"]);
  });
});

describe("canSeePage", () => {
  const page = {
    path: "journal",
    title: "Journal",
    component: Page,
    module: { id: "club", name: "Club", version: "1.0.0" },
  };
  const user = (role: string) => ({ id: "u", name: "U", email: "u@club.example", role });

  it("shows a page without permission to everyone, one with a permission to its holders", () => {
    expect(canSeePage(user("member"), page)).toBe(true);
    const guarded = { ...page, permission: "finance.manage" };
    expect(canSeePage(user("treasurer"), guarded)).toBe(true);
    expect(canSeePage(user("editor"), guarded)).toBe(false);
    expect(canSeePage(user("owner"), guarded)).toBe(true);
    expect(canSeePage(user("inconnu"), guarded)).toBe(false);
  });
});
