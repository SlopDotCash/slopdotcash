/**
 * Manual production release on published data only.
 *
 * A published census taken before a project was activated lacks that
 * project's repository, so the browser check (and the release) refuse it and
 * every profile reads as unavailable. This adds each newly active repository
 * with zero collected pull requests and issues. The next full collection
 * replaces the census with real counts.
 */
import { readFile, writeFile } from "node:fs/promises";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

const [path] = process.argv.slice(2);
if (!path) throw Error("usage: extend-published-profiles.ts <profiles.json>");
const census = JSON.parse(await readFile(path, "utf8"));
const targets = TARGET_REPOSITORIES.map((r: { id: string }) => r.id);
const collected = new Set(
  census.repositories.map((r: { repository: string }) => r.repository),
);
const added: string[] = [];
for (const id of targets) {
  if (collected.has(id)) continue;
  census.repositories.push({ repository: id, count: 0, excluded: 0 });
  added.push(id);
}
if (census.issues?.repositories) {
  const issued = new Set(
    census.issues.repositories.map((r: { repository: string }) => r.repository),
  );
  for (const id of targets)
    if (!issued.has(id))
      census.issues.repositories.push({ repository: id, count: 0 });
}
await writeFile(path, `${JSON.stringify(census)}\n`);
console.log(
  added.length
    ? `Added newly active repositories with zero counts: ${added.join(", ")}`
    : "Published census already covers every active repository",
);
