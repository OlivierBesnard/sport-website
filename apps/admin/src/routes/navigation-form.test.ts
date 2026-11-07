import { describe, expect, it } from "vitest";
import {
  CHOOSE_PAGE_MESSAGE,
  ORPHAN_MESSAGE,
  toDraft,
  toInput,
  validateDrafts,
} from "./NavigationPage";

describe("form of the navigation", () => {
  it("flags an entry whose page was deleted as an orphan page entry", () => {
    const draft = toDraft({ id: 1, label: "Le club", pageId: null, path: null, url: null });
    expect(draft).toMatchObject({ kind: "page", pageId: "", orphan: true });
    expect(ORPHAN_MESSAGE).toContain("supprimée");
    // An orphan cannot be saved as it is: the page must be chosen again.
    expect(validateDrafts([draft])).toEqual({ "items.0.pageId": CHOOSE_PAGE_MESSAGE });
  });

  it("keeps an external link and a page entry as they are", () => {
    expect(
      toDraft({ id: 2, label: "FFR", pageId: null, path: null, url: "https://ffr.example" }),
    ).toMatchObject({ kind: "url", url: "https://ffr.example" });
    const page = toDraft({ id: 3, label: "Contact", pageId: 7, path: "/contact", url: null });
    expect(page).toMatchObject({ kind: "page", pageId: "7" });
    expect(page.orphan).toBeUndefined();
    expect(toInput(page)).toEqual({ label: "Contact", pageId: 7 });
  });

  it("asks for a page before sending an entry without one", () => {
    const fields = validateDrafts([
      { label: "A", kind: "page", pageId: "4", url: "" },
      { label: "B", kind: "page", pageId: "", url: "" },
      { label: "C", kind: "url", pageId: "", url: "/contact" },
    ]);
    expect(fields).toEqual({ "items.1.pageId": "Choisissez une page." });
  });
});
