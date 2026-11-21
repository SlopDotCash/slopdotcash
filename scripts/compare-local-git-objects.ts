/**
 * Manual exactness check for `local-git-objects.ts`: reads Git trees and
 * commits from both GitHub and a local bare clone and compares them.
 *
 *   GITHUB_TOKEN=... bun scripts/compare-local-git-objects.ts \
 *     <root> <owner/repo> [commits=40] [walkCommits=3]
 *
 * <root> holds `<owner>/<repo>.git`. Commits are sampled from the clone's
 * history and pull request heads. For each one it compares the commit, the
 * recursive root tree and every tree in a non-recursive walk of the root.
 * Trees must match byte for byte after JSON parsing; commits must match on
 * every field except `node_id` and `verification`, which the local reader
 * omits. It exits non-zero on any mismatch.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { localGitObjectsFromDirectory } from "./local-git-objects";

const [root, repository, commitArg = "40", walkArg = "3"] =
  process.argv.slice(2);
if (!root || !repository) {
  console.error("usage: compare-local-git-objects.ts <root> <owner/repo>");
  process.exit(2);
}
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");
const gitDir = join(root, `${repository}.git`);
const local = localGitObjectsFromDirectory(root);
const api = "https://api.github.com";

async function remote(path: string) {
  const response = await fetch(`${api}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function localRead(path: string) {
  const bytes = await local.read(new URL(`${api}${path}`));
  return bytes
    ? (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)
    : null;
}

const results = { same: 0, declined: 0, different: 0 };
const timing = { apiMs: 0, localMs: 0, apiReads: 0, localReads: 0 };

async function compare(path: string, omit: string[] = []) {
  let started = performance.now();
  const theirs = await remote(path);
  timing.apiMs += performance.now() - started;
  timing.apiReads += 1;
  started = performance.now();
  const ours = await localRead(path);
  timing.localMs += performance.now() - started;
  timing.localReads += 1;
  if (!ours) {
    results.declined += 1;
    console.log(`declined ${path}`);
    return theirs;
  }
  for (const key of omit) delete theirs[key];
  if (JSON.stringify(theirs) === JSON.stringify(ours)) results.same += 1;
  else {
    results.different += 1;
    console.log(`DIFFERENT ${path}`);
    console.log(`  github ${JSON.stringify(theirs).slice(0, 400)}`);
    console.log(`  local  ${JSON.stringify(ours).slice(0, 400)}`);
  }
  return theirs;
}

const git = (...args: string[]) =>
  execFileSync("git", ["--git-dir", gitDir, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
const all = git("rev-list", "--all").trim().split("\n");
const count = Number(commitArg);
const step = Math.max(1, Math.floor(all.length / count));
const commits = all.filter((_, index) => index % step === 0).slice(0, count);
for (const sha of commits) {
  await compare(`/repos/${repository}/git/commits/${sha}`, [
    "node_id",
    "verification",
  ]);
}

// Full non-recursive walks, the shape that took an hour on 19 November.
for (const sha of commits.slice(0, Number(walkArg))) {
  const tree = git("rev-parse", `${sha}^{tree}`).trim();
  await compare(`/repos/${repository}/git/trees/${tree}?recursive=1`);
  const queue = [tree];
  const seen = new Set<string>();
  while (queue.length) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    const body = await compare(`/repos/${repository}/git/trees/${next}`);
    for (const entry of body.tree as { type: string; sha: string }[])
      if (entry.type === "tree") queue.push(entry.sha);
  }
}

console.log(JSON.stringify({ results, timing, stats: local.stats }));
process.exit(results.different ? 1 : 0);
