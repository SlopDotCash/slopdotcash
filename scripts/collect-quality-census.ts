/** Read-only repository connection census. Does not rely on GitHub search indexing. */
import { execFile, execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { findProject } from "../src/lib/projects.mjs";

const [projectId, cycleId, output] = process.argv.slice(2);
const project = findProject(projectId);
if (!project || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(cycleId ?? "") || !output)
  throw new Error(
    "Usage: collect-quality-census.ts PROJECT YYYY-MM OUTPUT_PREFIX",
  );
const start = new Date(`${cycleId}-01T00:00:00Z`);
const end = new Date(
  Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
);
if (end.getTime() > Date.now()) throw new Error("Cycle is not complete");
// Creation order and an unfiltered state connection avoid index omissions and
// pagination shifts caused by ordering on mutable updated/closed timestamps.
const query = `query($owner: String!, $name: String!, $cursor: String) { repository(owner:$owner,name:$name) { pullRequests(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}) { pageInfo { hasNextPage endCursor } nodes { id number title url state createdAt updatedAt closedAt mergedAt headRefOid baseRefName author { login ... on User { id } ... on Bot { id } ... on Mannequin { id } } } } } }`;
type Node = {
  id: string;
  number: number;
  url: string;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  baseRefName: string;
};
const nodes: Node[] = [];
const ids = new Set<string>();
const coverage: {
  repository: string;
  pages: number;
  scanned: number;
  complete: boolean;
}[] = [];
for (const repo of project.repositories) {
  const [owner, name] = repo.id.split("/");
  let cursor: string | null = null,
    previousCreation = -Infinity;
  let scanned = 0,
    pages = 0;
  const cursors = new Set<string>();
  for (;;) {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
    ];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const response = JSON.parse(
      execFileSync("gh", args, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
    if (response.errors?.length || !response.data?.repository?.pullRequests)
      throw new Error(`GitHub census failed for ${repo.id}`);
    const data = response.data.repository.pullRequests;
    let reachedEnd = false;
    pages++;
    for (const node of data.nodes as Node[]) {
      const created = Date.parse(node.createdAt);
      if (
        !node?.id ||
        ids.has(node.id) ||
        !node.url.startsWith(`${repo.githubUrl}/pull/`) ||
        !Number.isFinite(created) ||
        created < previousCreation
      )
        throw new Error("Invalid, unsorted or duplicate PR in census");
      ids.add(node.id);
      scanned++;
      previousCreation = created;
      if (created >= end.getTime()) {
        reachedEnd = true;
        break;
      }
      if (
        node.closedAt &&
        Date.parse(node.closedAt) >= start.getTime() &&
        Date.parse(node.closedAt) < end.getTime()
      )
        nodes.push(node);
    }
    if (pages % 10 === 0)
      console.log(
        `${repo.id}: ${pages} pages, ${scanned} PRs scanned, ${nodes.length} cycle closures`,
      );
    if (reachedEnd || !data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor) || !data.nodes.length)
      throw new Error("Missing/repeated cursor or empty intermediate page");
    cursors.add(cursor);
  }
  coverage.push({ repository: repo.id, pages, scanned, complete: true });
}
// Fetch expensive diff statistics only for the target month's accepted PRs.
const merged = nodes.filter((node) => node.mergedAt);
const batches = Array.from(
  { length: Math.ceil(merged.length / 100) },
  (_, index) => merged.slice(index * 100, index * 100 + 100),
);
const details = new Map<string, Record<string, unknown>>();
for (let i = 0; i < batches.length; i += 4) {
  await Promise.all(
    batches.slice(i, i + 4).map(async (batch) => {
      const payload = JSON.stringify({
        query:
          "query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{id headRefOid additions deletions changedFiles}}}",
        variables: { ids: batch.map((node) => node.id) },
      });
      // Structured JSON via stdin avoids shell interpolation and identifier quoting.
      const child = execFile(
        "gh",
        ["api", "graphql", "--input", "-"],
        { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
        () => {},
      );
      const responseText = await new Promise<string>((resolve, reject) => {
        let stdout = "",
          stderr = "";
        child.stdout?.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(stdout)
            : reject(new Error(`GitHub statistics failed: ${stderr}`)),
        );
        child.stdin?.end(payload);
      });
      const response = JSON.parse(responseText);
      if (
        response.errors?.length ||
        response.data?.nodes?.length !== batch.length
      )
        throw new Error("Incomplete PR statistics");
      for (const node of response.data.nodes) {
        const original = batch.find((row) => row.id === node?.id);
        if (
          !original ||
          details.has(node.id) ||
          node.headRefOid !==
            (original as Node & { headRefOid: string }).headRefOid
        )
          throw new Error("PR head changed during census");
        details.set(node.id, node);
      }
    }),
  );
  console.log(
    `Enriched ${Math.min((i + 4) * 100, merged.length)} of ${merged.length} merged PRs`,
  );
}
for (const node of nodes) Object.assign(node, details.get(node.id) ?? {});
await writeFile(
  `${output}-closed.json`,
  `${JSON.stringify({ method: "repository-created-order-v1", projectId, cycleId, observedAt: new Date().toISOString(), coverage, nodes })}\n`,
  { flag: "wx" },
);
await writeFile(
  `${output}-bases.json`,
  `${JSON.stringify(nodes.filter((node) => node.mergedAt).map((node) => ({ id: node.id, baseRefName: node.baseRefName })))}\n`,
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    closures: nodes.length,
    merged: nodes.filter((node) => node.mergedAt).length,
    coverage,
  }),
);
