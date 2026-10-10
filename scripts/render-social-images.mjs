#!/usr/bin/env node
/**
 * Renders the 1200x630 social preview images from the Blackout design source:
 * brand/tokens.json, public/slop-mark.svg and the self-hosted site fonts.
 *
 * Usage: node scripts/render-social-images.mjs
 *
 * Writes public/og-slop-cash.png and public/og-slop-tech.png. Run it after a
 * brand token, mark or hero message change, and rename the files when their
 * content changes so link-preview caches fetch the new image.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(
  readFileSync(join(repositoryRoot, "brand", "tokens.json"), "utf8"),
);
const mark = readFileSync(join(repositoryRoot, "public", "slop-mark.svg"));

function fontDataUrl(path) {
  const bytes = readFileSync(join(repositoryRoot, "node_modules", path));
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

const displayFont = fontDataUrl(
  "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2",
);

const images = [
  { domain: "slop.cash", file: "og-slop-cash.png" },
  { domain: "slop.tech", file: "og-slop-tech.png" },
];

function html(domain) {
  const [name, tld] = domain.split(".");
  const { color, font } = tokens;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Bricolage Grotesque Variable"; font-weight: 200 800; src: url(${displayFont}) format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body {
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 64px 72px 92px; background: ${color.bg}; color: ${color.ink};
  font-family: ${font.display}; font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased; position: relative;
}
body::after { content: ""; position: absolute; inset: auto 0 0; height: 14px; background: ${color.accent}; }
.wordmark { display: flex; align-items: center; gap: 18px; font-size: 38px; font-weight: 800; letter-spacing: -0.03em; }
.wordmark img { width: 60px; height: 60px; }
.dot { color: ${color.accent}; }
h1 { display: flex; flex-direction: column; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
h1 span { display: block; width: max-content; letter-spacing: -0.04em; line-height: 0.86; }
.action { color: ${color.accent}; }
</style></head><body>
<div class="wordmark"><img alt="" src="data:image/svg+xml;base64,${mark.toString("base64")}"><span>${name}<span class="dot">.</span>${tld}</span></div>
<h1><span class="lead">Make money</span><span class="action">Shipping open source.</span></h1>
</body></html>`;
}

// Match the site hero: the orange action line fills the content width and the
// lead line keeps the hero's 1 : 0.78 size ratio.
function fitHeadline() {
  const width = 1200 - 2 * 72;
  const lead = document.querySelector(".lead");
  const action = document.querySelector(".action");
  action.style.fontSize = "100px";
  const actionSize = (100 * width) / action.getBoundingClientRect().width;
  action.style.fontSize = `${actionSize}px`;
  lead.style.fontSize = `${actionSize / 0.78}px`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const { domain, file } of images) {
    await page.setContent(html(domain), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(fitHeadline);
    await page.screenshot({ path: join(repositoryRoot, "public", file) });
    console.log(`Rendered public/${file}`);
  }
} finally {
  await browser.close();
}
