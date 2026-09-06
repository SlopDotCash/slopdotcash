/** A scheduled refresh may change data, never application or Pages controls. */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const refreshPaths = new Set([
  "deployment-manifest.json",
  "data/leaderboard.json",
  "data/private-intake-attestation.json",
  "data/funding.json",
  "data/cycles/index.json",
]);

function isSkillManifest(path) {
  return (
    path === "skill-manifest.json" ||
    /^projects\/[a-z0-9-]+\/(?:review-)?skill-manifest\.json$/u.test(path)
  );
}

async function stableSkillManifest(root, path) {
  const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  if (
    !manifest ||
    Array.isArray(manifest) ||
    typeof manifest !== "object" ||
    typeof manifest.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      manifest.generatedAt,
    ) ||
    !Number.isFinite(Date.parse(manifest.generatedAt))
  ) {
    throw new Error(`Invalid skill manifest timestamp: ${path}`);
  }
  delete manifest.generatedAt;
  return JSON.stringify(manifest);
}

async function inventory(root) {
  const files = new Map();
  let directories = 0;
  let total = 0;
  async function visit(path, relative) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error("Refresh bundles cannot contain symlinks");
    if (stat.isDirectory()) {
      if (++directories > 128) throw new Error("Too many bundle directories");
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name), relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile()) {
      total += stat.size;
      if (
        files.size >= 256 ||
        stat.size > 25 * 1024 * 1024 ||
        total > 128 * 1024 * 1024
      ) {
        throw new Error("Refresh bundle exceeds inventory limits");
      }
      files.set(
        relative,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      );
    } else throw new Error("Refresh bundle contains a non-file entry");
  }
  await visit(root, "");
  if (!files.has("index.html") || !files.has("deployment-manifest.json")) {
    throw new Error("Refresh bundle is incomplete");
  }
  return files;
}

export async function assertDataOnlyRefresh(approvedRoot, candidateRoot) {
  const approved = await inventory(approvedRoot);
  const candidate = await inventory(candidateRoot);
  if (
    JSON.stringify([...approved.keys()]) !==
    JSON.stringify([...candidate.keys()])
  ) {
    throw new Error("Scheduled refresh cannot add or remove bundle files");
  }
  const changed = [];
  for (const [path, hash] of candidate) {
    if (approved.get(path) === hash) continue;
    if (
      isSkillManifest(path) &&
      (await stableSkillManifest(approvedRoot, path)) ===
        (await stableSkillManifest(candidateRoot, path))
    ) {
      changed.push(path);
      continue;
    }
    if (!refreshPaths.has(path))
      throw new Error(`Scheduled refresh changes non-data file: ${path}`);
    changed.push(path);
  }
  return changed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw new Error("Usage: check-data-refresh-bundle.mjs APPROVED CANDIDATE");
  console.log(
    JSON.stringify({
      changedDataFiles: await assertDataOnlyRefresh(
        process.argv[2],
        process.argv[3],
      ),
    }),
  );
}
