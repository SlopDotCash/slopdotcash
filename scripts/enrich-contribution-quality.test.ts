import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function enrich(mode: "complete" | "incomplete" | "stale", duplicate = false) {
  const root = mkdtempSync(join(tmpdir(), "quality-diff-"));
  const events = ["PR_one:merged", "PR_one:merged:U_second"].map((id) => ({
    id,
    kind: "implementation",
    flags: [] as string[],
  }));
  events.push({ id: "unrelated:review", kind: "review", flags: [] });
  const nodes = [{ id: "PR_one", headRefOid: "a".repeat(40) }];
  if (duplicate) {
    events.push({ id: "PR_two:merged", kind: "implementation", flags: [] });
    nodes.push({ id: "PR_two", headRefOid: "a".repeat(40) });
  }
  try {
    writeFileSync(join(root, "quality.json"), JSON.stringify({ events }));
    writeFileSync(join(root, "census.json"), JSON.stringify({ nodes }));
    for (const [index, node] of nodes.entries())
      writeFileSync(
        join(root, `pr-${index + 1}.json`),
        JSON.stringify({
          pr: {
            node_id: node.id,
            head: { sha: (mode === "stale" ? "b" : "a").repeat(40) },
            changed_files: 1,
            additions: 1,
            deletions: 0,
          },
          files:
            mode === "incomplete"
              ? []
              : [
                  {
                    filename: "tests/behavior.test.ts",
                    status: "added",
                    additions: 1,
                    deletions: 0,
                    patch: "@@ -0,0 +1 @@\n+expect(result).toBe(1);",
                  },
                ],
        }),
      );
    const result = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dir, "enrich-contribution-quality.ts"),
        join(root, "quality.json"),
        join(root, "census.json"),
        root,
        join(root, "output.json"),
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return {
      events: JSON.parse(readFileSync(join(root, "output.json"), "utf8"))
        .events as typeof events,
      summary: JSON.parse(result.stdout),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("all merge-credit actors receive diff evidence without a false duplicate group", () => {
  const result = enrich("complete");
  for (const event of result.events.slice(0, 2))
    expect(event.flags).toHaveLength(1);
  expect(result.events[2].flags).toEqual([]);
  expect(result.summary.completeDiffs).toBe(1);
  expect(result.summary.matchingPatchGroups).toBe(0);
});

test("inspection failures remain visible for every merge-credit actor", () => {
  for (const mode of ["incomplete", "stale"] as const) {
    const result = enrich(mode);
    for (const event of result.events.slice(0, 2))
      expect(event.flags).toHaveLength(1);
    expect(result.events[2].flags).toEqual([]);
    expect(result.summary.completeDiffs).toBe(0);
  }
});

test("matching patches on different PRs flag every actor once", () => {
  const result = enrich("complete", true);
  for (const index of [0, 1, 3]) {
    const flags = result.events[index].flags;
    expect(flags).toHaveLength(2);
  }
  expect(result.events[2].flags).toEqual([]);
  expect(result.summary.completeDiffs).toBe(2);
  expect(result.summary.matchingPatchGroups).toBe(1);
});
