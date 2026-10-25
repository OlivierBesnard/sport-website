import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type Database,
  type JsonObject,
  navigation,
  pages,
  pageVersions,
} from "./index.js";

const DRAFT: JsonObject = {
  root: { props: { title: "Accueil" } },
  content: [
    { type: "Heading", props: { id: "Heading-1", text: "Bienvenue à l'US Exemple", level: 1 } },
    { type: "Text", props: { id: "Text-1", html: "<p>Équipes : U9 → Séniors 🏉</p>" } },
  ],
  zones: {},
};

let db: Database;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  db.$client.close();
  vi.useRealTimers();
});

function insertPage(path: string, title = "Page") {
  return db.insert(pages).values({ path, title, draftData: DRAFT }).returning().get();
}

describe("pages CRUD", () => {
  it("creates a page with its defaults", () => {
    const page = insertPage("/");
    expect(page).toMatchObject({
      path: "/",
      title: "Page",
      seo: {},
      draftData: DRAFT,
      publishedData: null,
      status: "draft",
      publishedAt: null,
    });
    expect(page.id).toBeGreaterThan(0);
    expect(page.createdAt).toBeInstanceOf(Date);
  });

  it("reads a page by its path", () => {
    insertPage("/");
    const created = insertPage("/equipes/u13", "U13");
    const found = db.select().from(pages).where(eq(pages.path, "/equipes/u13")).get();
    expect(found).toEqual(created);
    expect(db.select().from(pages).where(eq(pages.path, "/inconnu")).get()).toBeUndefined();
  });

  it("lists pages", () => {
    insertPage("/b");
    insertPage("/a");
    const paths = db.select({ path: pages.path }).from(pages).orderBy(asc(pages.path)).all();
    expect(paths).toEqual([{ path: "/a" }, { path: "/b" }]);
  });

  it("updates the draft and bumps updated_at only", () => {
    const page = insertPage("/");
    const later = new Date(page.updatedAt.getTime() + 60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(later);

    const draft = { ...DRAFT, content: [] };
    const updated = db
      .update(pages)
      .set({ title: "Accueil", draftData: draft, seo: { description: "Le club" } })
      .where(eq(pages.id, page.id))
      .returning()
      .get();

    expect(updated).toMatchObject({
      title: "Accueil",
      draftData: draft,
      seo: { description: "Le club" },
      publishedData: null,
      status: "draft",
    });
    expect(updated?.updatedAt).toEqual(later);
    expect(updated?.createdAt).toEqual(page.createdAt);
  });

  it("publishes a copy of the draft, kept apart from later draft changes", () => {
    const page = insertPage("/");
    const publishedAt = new Date("2026-10-01T08:00:00.000Z");
    db.update(pages)
      .set({ publishedData: page.draftData, status: "published", publishedAt })
      .where(eq(pages.id, page.id))
      .run();
    db.update(pages)
      .set({ draftData: { root: {}, content: [] } })
      .where(eq(pages.id, page.id))
      .run();

    const stored = db.select().from(pages).where(eq(pages.id, page.id)).get();
    expect(stored).toMatchObject({
      status: "published",
      publishedAt,
      publishedData: DRAFT,
      draftData: { root: {}, content: [] },
    });
  });

  it("deletes a page", () => {
    const page = insertPage("/a-supprimer");
    const deleted = db.delete(pages).where(eq(pages.id, page.id)).returning().all();
    expect(deleted).toHaveLength(1);
    expect(db.select().from(pages).all()).toEqual([]);
  });

  it("never reuses the id of a deleted page", () => {
    const first = insertPage("/premiere");
    db.delete(pages).where(eq(pages.id, first.id)).run();
    const second = insertPage("/seconde");
    expect(second.id).toBeGreaterThan(first.id);
  });

  it("round-trips JSON exactly", () => {
    const tricky: JsonObject = {
      text: "guillemets \" apostrophe ' antislash \\ retour\nligne",
      emoji: "⚽🏀",
      numbers: [0, -1, 3.14, 1e21],
      nested: { empty: {}, list: [[], [null, true, false]] },
    };
    const page = db
      .insert(pages)
      .values({ path: "/", title: "Accueil", draftData: tricky })
      .returning()
      .get();
    expect(db.select().from(pages).where(eq(pages.id, page.id)).get()?.draftData).toEqual(tricky);
  });
});

describe("pages constraints", () => {
  it("refuses two pages with the same path", () => {
    insertPage("/club");
    expect(() => insertPage("/club")).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" }),
    );
    expect(db.select().from(pages).all()).toHaveLength(1);
  });

  it("refuses to move a page onto the path of another one", () => {
    insertPage("/club");
    const other = insertPage("/histoire");
    expect(() =>
      db.update(pages).set({ path: "/club" }).where(eq(pages.id, other.id)).run(),
    ).toThrow(expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" }));
  });

  it("compares paths case-sensitively", () => {
    insertPage("/club");
    expect(() => insertPage("/Club")).not.toThrow();
  });

  it("requires a path, a title and a draft", () => {
    const insert = db.$client.prepare(
      "INSERT INTO pages (path, title, draft_data) VALUES (?, ?, ?)",
    );
    expect(() => insert.run(null, "Titre", "{}")).toThrow(/NOT NULL constraint failed: pages.path/);
    expect(() => insert.run("/", null, "{}")).toThrow(/NOT NULL constraint failed: pages.title/);
    expect(() => insert.run("/", "Titre", null)).toThrow(
      /NOT NULL constraint failed: pages.draft_data/,
    );
  });
});

describe("page versions", () => {
  function insertVersion(pageId: number, version: number) {
    return db
      .insert(pageVersions)
      .values({ pageId, version, title: "Accueil", seo: {}, data: DRAFT })
      .returning()
      .get();
  }

  it("stores numbered snapshots of a page", () => {
    const page = insertPage("/");
    insertVersion(page.id, 1);
    insertVersion(page.id, 2);
    const versions = db
      .select({ version: pageVersions.version, data: pageVersions.data })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, page.id))
      .orderBy(asc(pageVersions.version))
      .all();
    expect(versions).toEqual([
      { version: 1, data: DRAFT },
      { version: 2, data: DRAFT },
    ]);
  });

  it("refuses a version for a page that does not exist", () => {
    expect(() => insertVersion(999, 1)).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" }),
    );
  });

  it("refuses the same version number twice for a page, not across pages", () => {
    const first = insertPage("/a");
    const second = insertPage("/b");
    insertVersion(first.id, 1);
    expect(() => insertVersion(first.id, 1)).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" }),
    );
    expect(() => insertVersion(second.id, 1)).not.toThrow();
  });

  it("are deleted with their page", () => {
    const page = insertPage("/");
    const other = insertPage("/autre");
    insertVersion(page.id, 1);
    insertVersion(other.id, 1);
    db.delete(pages).where(eq(pages.id, page.id)).run();
    const remaining = db.select({ pageId: pageVersions.pageId }).from(pageVersions).all();
    expect(remaining).toEqual([{ pageId: other.id }]);
  });
});

describe("navigation", () => {
  function insertItem(values: typeof navigation.$inferInsert) {
    return db.insert(navigation).values(values).returning().get();
  }

  it("unlinks the items of a deleted page but keeps them and their children", () => {
    const page = insertPage("/club");
    const parent = insertItem({ label: "Le club", pageId: page.id });
    const child = insertItem({
      label: "Contact",
      parentId: parent.id,
      url: "mailto:club@exemple.fr",
    });

    db.delete(pages).where(eq(pages.id, page.id)).run();

    const items = db.select().from(navigation).orderBy(asc(navigation.id)).all();
    expect(items).toMatchObject([
      { id: parent.id, label: "Le club", pageId: null, menu: "main", position: 0 },
      { id: child.id, parentId: parent.id, url: "mailto:club@exemple.fr" },
    ]);
  });

  it("deletes the children of a deleted item", () => {
    const parent = insertItem({ label: "Équipes" });
    const child = insertItem({ label: "U13", parentId: parent.id });
    insertItem({ label: "U15", parentId: child.id });
    insertItem({ label: "Contact", menu: "footer" });

    db.delete(navigation).where(eq(navigation.id, parent.id)).run();

    expect(db.select({ label: navigation.label }).from(navigation).all()).toEqual([
      { label: "Contact" },
    ]);
  });

  it("refuses links to missing pages or parents", () => {
    expect(() => insertItem({ label: "Fantôme", pageId: 999 })).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" }),
    );
    expect(() => insertItem({ label: "Orphelin", parentId: 999 })).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" }),
    );
  });
});
