import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { onRequest, publicSocialMetadata, renderSocialMetadata } from "./index";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(repositoryRoot, "index.html"), "utf8");

describe("hostname-aware social metadata", () => {
  it("keeps slop.cash metadata byte-identical", () => {
    expect(publicSocialMetadata("slop.cash")).toEqual({
      domain: "slop.cash",
      origin: "https://slop.cash",
      imageUrl: "https://slop.cash/og-shipping-slop.png",
    });
    expect(renderSocialMetadata(indexHtml, "slop.cash")).toBe(indexHtml);
  });

  it("publishes a complete slop.tech identity for slop.tech hosts", () => {
    expect(publicSocialMetadata("www.slop.tech")).toEqual({
      domain: "slop.tech",
      origin: "https://slop.tech",
      imageUrl: "https://slop.tech/og-shipping-slop-tech.png",
    });

    const rendered = renderSocialMetadata(indexHtml, "slop.tech");
    expect(rendered).toContain('href="https://slop.tech/"');
    expect(rendered).toContain('content="slop.tech"');
    expect(rendered).toContain('content="https://slop.tech/"');
    expect(
      rendered.match(/https:\/\/slop\.tech\/og-shipping-slop-tech\.png/gu),
    ).toHaveLength(2);
    expect(rendered).not.toContain("https://slop.cash/");
  });

  it("rewrites the crawler-visible HTML response only for slop.tech", async () => {
    const response = await onRequest({
      request: new Request("https://slop.tech/"),
      next: async () =>
        new Response(indexHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });

    expect(await response.text()).toContain(
      'content="https://slop.tech/og-shipping-slop-tech.png"',
    );
    expect(response.headers.get("vary")).toBe("Host");
  });
});
