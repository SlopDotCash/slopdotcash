import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  actor,
  base,
  commit,
  makeOriginal,
  repository,
} from "../../tests/value-promotion-fixture";
import { collectValueEvidence } from "./value-evidence";
import { NATIVE_MERGE_CONTEXT } from "./value-native-merge";
import { loadValuePolicy, verifyCurrentValueSource } from "./value-publication";
import { valueSourceDigest } from "./value-review";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { verifyCurrentWorkUnitSource } from "./value-work-unit-publication";

async function fixture() {
  const source = makeOriginal(),
    head = "1".repeat(40),
    later = "4".repeat(40),
    merged = "5".repeat(40),
    root = `/repos/${repository.id}`;
  const one = commit(head),
    two = commit(later);
  two.parents = [{ sha: head }];
  const added = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: null,
  };
  const changed = {
    ...added,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch:
      "@@ -1 +1 @@\n-export const fixed = true;\n+export const fixed = true; // reviewed",
  };
  source.evidence.pull.head.sha = head;
  source.evidence.pull.merge_commit_sha = merged;
  source.evidence.files = [added];
  source.evidence.commits = [one];
  source.evidence.commitAttribution = [
    {
      sha: head,
      actorNodeIds: [actor.node_id],
      changedPaths: ["fix.ts"],
      files: [added],
      limitations: [],
    },
  ];
  source.evidence.mergeCommitEvidence = {
    sha: merged,
    html_url: `https://github.com/${repository.id}/commit/${merged}`,
    parents: [{ sha: base }, { sha: later }],
    stats: { additions: 1, deletions: 0, total: 1 },
    files: [
      {
        ...added,
        patch: "@@ -0,0 +1 @@\n+export const fixed = true; // reviewed",
      },
    ],
  };
  const carrier = structuredClone(source);
  carrier.evidence.pull.node_id = "PR_carrier";
  carrier.evidence.pull.number = 2;
  carrier.evidence.pull.html_url = `https://github.com/${repository.id}/pull/2`;
  carrier.evidence.pull.head.sha = later;
  carrier.evidence.pull.commits = 2;
  carrier.evidence.files = structuredClone(
    source.evidence.mergeCommitEvidence.files,
  );
  carrier.evidence.commits = [one, two];
  carrier.evidence.commitAttribution.push({
    sha: later,
    actorNodeIds: [actor.node_id],
    changedPaths: ["fix.ts"],
    files: [changed],
    limitations: [],
  });
  const values = new Map<string, unknown>();
  const hash = (kind: string, bytes: Buffer) =>
    createHash("sha1")
      .update(`${kind} ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
  for (const [ref, text] of [
    [head, "export const fixed = true;\n"],
    [merged, "export const fixed = true; // reviewed\n"],
  ] as const) {
    const blob = hash("blob", Buffer.from(text)),
      tree = hash(
        "tree",
        Buffer.concat([
          Buffer.from("100644 fix.ts\0"),
          Buffer.from(blob, "hex"),
        ]),
      );
    values.set(`${root}/git/commits/${ref}`, { sha: ref, tree: { sha: tree } });
    values.set(`${root}/git/trees/${tree}?recursive=1`, {
      sha: tree,
      truncated: false,
      tree: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blob }],
    });
    values.set(`${root}/contents/fix.ts?ref=${ref}`, {
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(text),
      sha: blob,
      content: Buffer.from(text).toString("base64"),
    });
  }
  values.set(root, {
    id: 42,
    node_id: repository.expectedNodeId,
    private: false,
  });
  values.set(`${root}/compare/${head}...${later}?per_page=100&page=1`, {
    status: "ahead",
    merge_base_commit: { sha: head },
    total_commits: 1,
    commits: [two],
  });
  values.set(`${root}/compare/${head}...${merged}?per_page=1`, {
    status: "ahead",
    merge_base_commit: { sha: head },
    files: [changed],
  });
  for (const s of [source, carrier]) {
    const e = s.evidence,
      n = e.pull.number;
    values.set(`${root}/pulls/${n}`, e.pull);
    values.set(`${root}/pulls/${n}/files?per_page=100&page=1`, e.files);
    values.set(`${root}/pulls/${n}/commits?per_page=100&page=1`, e.commits);
    for (const route of [
      `pulls/${n}/reviews`,
      `pulls/${n}/comments`,
      `issues/${n}/comments`,
    ])
      values.set(`${root}/${route}?per_page=100&page=1`, []);
  }
  for (const [c, files] of [
    [one, [added]],
    [two, [changed]],
  ] as const)
    values.set(`${root}/commits/${c.sha}?per_page=100&page=1`, {
      ...c,
      stats: {
        additions: 1,
        deletions: c.sha === later ? 1 : 0,
        total: c.sha === later ? 2 : 1,
      },
      files,
    });
  values.set(
    `${root}/commits/${merged}?per_page=100&page=1`,
    source.evidence.mergeCommitEvidence,
  );
  const client = {
    async get<T>(path: string): Promise<T | null> {
      return structuredClone(values.get(path) ?? null) as T | null;
    },
    async graphql<T>(_query: string, variables: Record<string, unknown>) {
      return {
        repository: {
          pullRequest: {
            id:
              variables.number === 2
                ? "PR_carrier"
                : source.evidence.pull.node_id,
            timelineItems: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    async fileText() {
      return { text: "Approved fixture policy", truncated: false };
    },
  };
  const sources = [];
  for (const n of [1, 2]) {
    const evidence = await collectValueEvidence(
      client,
      repository.id,
      n,
      repository,
    );
    sources.push({
      evidence,
      policy: await loadValuePolicy(
        client,
        repository.owner,
        repository.name,
        evidence.pull.base.sha,
      ),
    });
  }
  return { client, sources, values, root };
}

test("normal joint publication verifies native ancestor context against its complete carrier", async () => {
  const f = await fixture();
  expect(f.sources[0].evidence.limitations).toEqual([NATIVE_MERGE_CONTEXT]);
  const group = await prepareWorkUnitEvidence(f.sources, [repository]);
  expect(group.limitations).toEqual([]);
  const result = await verifyCurrentWorkUnitSource(
    f.client,
    group,
    { sourceDigest: group.sourceDigest },
    [repository],
  );
  expect(result.claims).toEqual(group.claims);
});
for (const fault of [
  "standalone",
  "missing carrier",
  "forged carrier",
  "additional limitation",
] as const)
  test(`native publication refuses ${fault}`, async () => {
    const f = await fixture();
    const original = f.sources[0];
    const group = await prepareWorkUnitEvidence(f.sources, [repository]);
    if (fault === "standalone") {
      await expect(
        verifyCurrentValueSource(
          f.client,
          original.evidence,
          {
            policySha: original.policy.sha,
            sourceDigest: await valueSourceDigest(
              original.evidence,
              original.policy,
            ),
          },
          [repository],
        ),
      ).rejects.toThrow();
      return;
    }
    if (fault === "missing carrier") {
      await expect(
        verifyCurrentWorkUnitSource(
          f.client,
          { ...group, sources: [original] },
          { sourceDigest: group.sourceDigest },
          [repository],
        ),
      ).rejects.toThrow();
      return;
    }
    if (fault === "forged carrier") {
      const changed = structuredClone(group);
      changed.sources[1].evidence.commits[0].author = {
        ...actor,
        node_id: "U_foreign",
      };
      await expect(
        verifyCurrentWorkUnitSource(
          f.client,
          changed,
          { sourceDigest: group.sourceDigest },
          [repository],
        ),
      ).rejects.toThrow();
      return;
    }
    (f.values.get(`${f.root}/pulls/1`) as { comments: number }).comments = 1;
    await expect(
      verifyCurrentWorkUnitSource(
        f.client,
        group,
        { sourceDigest: group.sourceDigest },
        [repository],
      ),
    ).rejects.toThrow();
  });
