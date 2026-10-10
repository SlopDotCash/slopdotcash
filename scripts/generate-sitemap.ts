/** Writes public/sitemap.xml from the route list, manifests, and published cycle index. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertCycleIndex } from "../src/lib/cycle-index";
import { SITE_ORIGIN, sitemapPaths } from "../src/lib/site-routes";
import { PUBLIC_CYCLES_ROOT } from "./sync-cycle-index";

const cycleIndex: unknown = JSON.parse(
  readFileSync(join(PUBLIC_CYCLES_ROOT, "index.json"), "utf8"),
);
assertCycleIndex(cycleIndex);
const urls = sitemapPaths(cycleIndex.cycles)
  .map((path) => `  <url>\n    <loc>${SITE_ORIGIN}${path}</loc>\n  </url>`)
  .join("\n");
writeFileSync(
  resolve(import.meta.dir, "../public/sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
