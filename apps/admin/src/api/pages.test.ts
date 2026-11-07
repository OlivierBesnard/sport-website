import { describe, expect, it } from "vitest";
import { pageUrl } from "./pages";

describe("pageUrl", () => {
  it("puts the action in the URL path and the page in the query", () => {
    expect(pageUrl("page", "/le-club")).toBe("/api/pages/page?path=%2Fle-club");
    expect(pageUrl("publish", "/equipes/u13")).toBe("/api/pages/publish?path=%2Fequipes%2Fu13");
  });

  it("handles the home page and paths that look like actions", () => {
    expect(pageUrl("publish", "/")).toBe("/api/pages/publish?path=%2F");
    expect(pageUrl("versions", "/equipe/versions")).toBe(
      "/api/pages/versions?path=%2Fequipe%2Fversions",
    );
  });

  it("percent-encodes the characters that would break the query", () => {
    const url = new URL(pageUrl("page", "/équipe & co?#+"), "http://localhost");
    expect(url.pathname).toBe("/api/pages/page");
    expect(url.searchParams.get("path")).toBe("/équipe & co?#+");
  });
});
