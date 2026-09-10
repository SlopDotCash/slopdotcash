import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("enumerates repository PRs without a search index, preserves old-backlog closures, and stops after cycle creation bounds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slop-quality-census-"));
  try {
    const node = (id: string, createdAt: string, closedAt: string | null) => ({
      id,
      number: Number(id),
      url: `https://github.com/elizaOS/eliza/pull/${id}`,
      createdAt,
      closedAt,
      mergedAt: null,
      baseRefName: "develop",
    });
    const fixture = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: "unused" },
            nodes: [
              node("1", "2024-01-01T00:00:00Z", "2026-08-02T00:00:00Z"),
              node("2", "2026-08-01T00:00:00Z", "2026-08-13T00:00:00Z"),
              node("3", "2026-08-02T00:00:00Z", null),
              node("4", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"),
            ],
          },
        },
      },
    };
    const gh = join(dir, "gh");
    await writeFile(
      gh,
      `#!${process.execPath}\nif (process.argv.join(' ').includes('search(')) process.exit(9);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(fixture))});\n`,
    );
    await chmod(gh, 0o700);
    const prefix = join(dir, "census");
    execFileSync(
      "bun",
      ["scripts/collect-quality-census.ts", "eliza", "2026-08", prefix],
      {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
        stdio: "pipe",
      },
    );
    const result = JSON.parse(await readFile(`${prefix}-closed.json`, "utf8"));
    expect(result.method).toBe("repository-created-order-v1");
    expect(result.nodes.map((row: { id: string }) => row.id)).toEqual([
      "1",
      "2",
    ]);
    expect(result.coverage).toEqual([
      { repository: "elizaOS/eliza", pages: 1, scanned: 4, complete: true },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
