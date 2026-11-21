import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { onRequest } from "../functions/index.ts";

// The real app shell: the rewrite depends on its exact head tags, so a change
// to index.html that the function no longer matches fails here.
const shell = await readFile(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);

async function served(url, contents = shell) {
  const response = await onRequest({
    request: new Request(url),
    next: async () =>
      new Response(contents, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
  return response.text();
}

function tag(html, attribute, name) {
  const match = html.match(
    new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="([^"]*)"`, "u"),
  );
  return match === null ? null : match[1];
}

test("a shared sponsor link previews the sponsor offer, not the contributor headline", async () => {
  for (const path of ["/sponsors", "/sponsors/"]) {
    const html = await served(`https://slop.cash${path}`);
    expect(html).toContain("<title>Fund a project · Slop</title>");
    expect(html).not.toContain("MAKE MONEY SHIPPING OPEN SOURCE");
    expect(html).not.toContain("make money shipping open source");
    expect(html).not.toContain("run your best coding agent");
    expect(tag(html, "property", "og:title")).toBe(
      "Fund a project. Pay for accepted work.",
    );
    expect(tag(html, "name", "twitter:title")).toBe(
      "Fund a project. Pay for accepted work.",
    );
    const description = tag(html, "name", "description");
    expect(description).toStartWith("Fund a monthly pool");
    expect(tag(html, "property", "og:description")).toBe(description);
    expect(tag(html, "name", "twitter:description")).toBe(description);
    expect(tag(html, "property", "og:url")).toBe("https://slop.cash/sponsors");
    expect(html).toContain(
      '<link rel="canonical" href="https://slop.cash/sponsors" />',
    );
    expect(tag(html, "property", "og:image")).toBe(
      "https://slop.cash/og-slop-cash-sponsors.png",
    );
    expect(tag(html, "name", "twitter:image")).toBe(
      "https://slop.cash/og-slop-cash-sponsors.png",
    );
  }
});

test("the sponsor card the head names is a published file", async () => {
  const card = await readFile(
    fileURLToPath(
      new URL("../public/og-slop-cash-sponsors.png", import.meta.url),
    ),
  );
  // PNG signature, then the IHDR width and height: 1200 x 630.
  expect(card.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(card.readUInt32BE(16)).toBe(1200);
  expect(card.readUInt32BE(20)).toBe(630);
});

test("other pages and slop.tech keep the shell head", async () => {
  const home = await served("https://slop.cash/");
  expect(home).toContain("<title>Slop: ship and maintain open source</title>");
  expect(tag(home, "property", "og:url")).toBe("https://slop.cash/");

  const project = await served("https://slop.cash/projects/eliza");
  expect(tag(project, "property", "og:title")).toBe(
    "Slop: ship and maintain open source",
  );

  const tech = await served("https://slop.tech/sponsors");
  expect(tag(tech, "property", "og:title")).toBe(
    "Slop: ship and maintain open source",
  );
  expect(tag(tech, "property", "og:url")).toBe("https://slop.tech/");
});

test("a shell the rewrite does not recognise is served unchanged", async () => {
  const drifted = shell.replace(
    "<title>Slop: ship and maintain open source</title>",
    "<title>Slop</title>",
  );
  // staging host: no analytics tag is added, so the bytes must be identical.
  expect(await served("https://staging.slop.cash/sponsors", drifted)).toBe(
    drifted,
  );
});
