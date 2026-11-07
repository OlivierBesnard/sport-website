import { checkModuleDefinition } from "@sport-cms/module-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import exemple, { quoteBlock } from "./index.js";

function render(props: Partial<Parameters<typeof quoteBlock.render>[0]> = {}): string {
  return renderToStaticMarkup(quoteBlock.render({ id: "q", ...quoteBlock.defaultProps, ...props }));
}

describe("module exemple", () => {
  it("is a valid module definition, its block prefixed by its id", () => {
    expect(checkModuleDefinition(exemple).success).toBe(true);
    expect(exemple.blocks?.map((block) => block.type)).toEqual(["exemple.citation"]);
  });

  it("renders a quotation with its author, with theme classes only", () => {
    expect(render({ text: "Allez le club !", author: "La présidente", align: "center" })).toBe(
      '<figure class="cms-rich-text cms-text-center"><blockquote><p>Allez le club !</p>' +
        "</blockquote><figcaption>La présidente</figcaption></figure>",
    );
  });

  it("renders nothing without text, and no caption without author", () => {
    expect(render()).toBe("");
    expect(render({ text: "Seule" })).toBe(
      '<figure class="cms-rich-text"><blockquote><p>Seule</p></blockquote></figure>',
    );
  });

  it("validates its settings and credentials", () => {
    expect(exemple.settings?.parse({})).toEqual({ signature: "" });
    expect(exemple.settings?.safeParse({ signature: "x".repeat(101) }).success).toBe(false);
    expect(exemple.credentials?.safeParse({ apiKey: " " }).success).toBe(false);
  });
});

describe("client entry of the module exemple", () => {
  it("declares the same block as the server entry, and a page of the back-office", async () => {
    const { checkModuleClient } = await import("@sport-cms/module-sdk");
    const { default: client } = await import("./client.js");
    const result = checkModuleClient(client, "exemple");
    expect(result.success).toBe(true);
    expect(client.blocks).toEqual(exemple.blocks);
    expect(client.adminPages?.map((page) => page.path)).toEqual(["a-propos"]);
  });

  it("renders its page with the module's identity", async () => {
    const { AboutPage } = await import("./about-page.js");
    const html = renderToStaticMarkup(
      <AboutPage module={{ id: "exemple", name: "Exemple", version: "0.1.0" }} />,
    );
    expect(html).toContain("<h1>À propos du module Exemple</h1>");
    expect(html).toContain("Version 0.1.0.");
  });
});
