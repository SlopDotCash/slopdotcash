import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFORMED_HTML_BYTES,
  onRequest,
  publicSocialMetadata,
  renderSocialMetadata,
} from "./index";

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

  it("does not treat arbitrary slop.tech subdomains as public authorities", () => {
    expect(publicSocialMetadata("attacker.slop.tech")).toEqual({
      domain: "slop.cash",
      origin: "https://slop.cash",
      imageUrl: "https://slop.cash/og-shipping-slop.png",
    });
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
    expect(response.headers.get("cache-control")).toBe("no-transform");
  });

  it("prevents edge transformations without changing slop.cash HTML", async () => {
    const response = await onRequest({
      request: new Request("https://slop.cash/projects/eliza"),
      next: async () =>
        new Response(indexHtml, {
          headers: {
            "cache-control": "public, max-age=0, must-revalidate",
            "content-type": "text/html; charset=utf-8",
          },
        }),
    });

    expect(await response.text()).toBe(indexHtml);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate, no-transform",
    );
    expect(response.headers.get("vary")).toBeNull();
  });

  it("does not alter non-HTML responses", async () => {
    const original = new Response('{"ok":true}', {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "application/json",
      },
    });
    const response = await onRequest({
      request: new Request("https://slop.cash/data/leaderboard.json"),
      next: async () => original,
    });

    expect(response).toBe(original);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("does not parse or rewrite HTML error responses", async () => {
    const original = new Response("<h1>Not found</h1>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const response = await onRequest({
      request: new Request("https://slop.tech/missing"),
      next: async () => original,
    });

    expect(response).toBe(original);
    expect(await response.text()).toBe("<h1>Not found</h1>");
  });

  it("cancels oversized transformed HTML without buffering the full body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_TRANSFORMED_HTML_BYTES / 2 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      onRequest({
        request: new Request("https://slop.tech/"),
        next: async () =>
          new Response(body, {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      }),
    ).rejects.toThrow(/transform limit/u);
    expect(cancelled).toBe(true);
  });
});
