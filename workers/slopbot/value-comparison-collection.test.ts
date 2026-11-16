import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { collectValueEvidence } from "./value-evidence";
import { valueAdditionCount, valueDeletionCount } from "./value-patch";

for (const corrupt of [false, true]) {
  test(`collection ${corrupt ? "holds invalid" : "recovers verified"} omitted modified-file counts before commit totals`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    const base = source.pull.base.sha;
    const head = source.pull.head.sha;
    const merge = source.pull.merge_commit_sha;
    if (!merge) throw new Error("Missing merge fixture");
    source.files[0] = {
      filename: "fix.ts",
      status: "modified",
      additions: 0,
      deletions: 0,
      blob_url: `https://github.com/${repository.id}/blob/${head}/fix.ts`,
    };
    source.bind(
      base,
      new Map([["fix.ts", new TextEncoder().encode("old\n")]]),
      [],
    );
    const text = "new\nextra\n";
    source.bind(head, new Map([["fix.ts", new TextEncoder().encode(text)]]), [
      base,
    ]);
    source.bind(merge, new Map([["fix.ts", new TextEncoder().encode(text)]]), [
      base,
      head,
    ]);
    const client = {
      ...source.client,
      async get<T>(path: string): Promise<T | null> {
        const result = await source.client.get<T>(path);
        if (!result) return result;
        const row = result as Record<string, unknown>;
        if (path.includes("/commits/") && !path.includes("/git/"))
          row.stats = { additions: 2, deletions: 1, total: 3 };
        if (
          corrupt &&
          path.includes("/contents/fix.ts") &&
          !path.endsWith(base)
        )
          row.content = Buffer.from("forged\n").toString("base64");
        return result;
      },
    };
    const evidence = await collectValueEvidence(
      client,
      repository.id,
      1,
      repository,
    );
    if (corrupt) {
      expect(evidence.limitations).toContain(
        "Incomplete reported merge commit additions",
      );
      expect(evidence.limitations).toContain(
        "Incomplete reported merge commit deletions",
      );
    } else {
      expect(evidence.limitations).toEqual([]);
      const accepted = evidence.mergeCommitEvidence?.files[0];
      if (!accepted) throw new Error("Missing accepted file");
      expect(accepted.additions).toBe(0);
      expect(accepted.deletions).toBe(0);
      expect(valueAdditionCount(accepted)).toBe(2);
      expect(valueDeletionCount(accepted)).toBe(1);
      expect(evidence.commitAttribution[0].changedPaths).toEqual(["fix.ts"]);
    }
  });
}
