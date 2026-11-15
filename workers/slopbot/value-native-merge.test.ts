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
import type { Commit, FileChange } from "./value-evidence-types";
import {
  collectNativeMergeAcceptance,
  NATIVE_MERGE_CONTEXT,
  nativeMergeCarrierMatches,
} from "./value-native-merge";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { consumeWorkUnitHistory } from "./value-work-unit-consumption";

const head = "1".repeat(40),
  later = "4".repeat(40),
  merged = "5".repeat(40);
const hash = (kind: string, bytes: Buffer) =>
  createHash("sha1")
    .update(`${kind} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
function fixture() {
  const source = makeOriginal();
  source.evidence.pull.merge_commit_sha = merged;
  source.evidence.pull.head.sha = head;
  const one = commit(head),
    two = commit(later);
  two.parents = [{ sha: head }];
  two.commit.message = "Follow up the accepted fix";
  const added: FileChange = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: null,
  };
  const changed: FileChange = {
    ...added,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch:
      "@@ -1 +1 @@\n-export const fixed = true;\n+export const fixed = true; // reviewed",
  };
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
  carrier.evidence.commits = structuredClone([one, two]);
  carrier.evidence.commitAttribution.push({
    sha: later,
    actorNodeIds: [actor.node_id],
    changedPaths: ["fix.ts"],
    files: [changed],
    limitations: [],
  });
  const values = new Map<string, unknown>();
  function bind(ref: string, text: string) {
    const blob = hash("blob", Buffer.from(text));
    const bytes = Buffer.concat([
      Buffer.from("100644 fix.ts\0"),
      Buffer.from(blob, "hex"),
    ]);
    const tree = hash("tree", bytes);
    values.set(`/repos/${repository.id}/git/commits/${ref}`, {
      sha: ref,
      tree: { sha: tree },
    });
    values.set(`/repos/${repository.id}/git/trees/${tree}?recursive=1`, {
      sha: tree,
      truncated: false,
      tree: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blob }],
    });
    values.set(`/repos/${repository.id}/contents/fix.ts?ref=${ref}`, {
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(text),
      sha: blob,
      content: Buffer.from(text).toString("base64"),
    });
  }
  bind(head, "export const fixed = true;\n");
  bind(merged, "export const fixed = true; // reviewed\n");
  values.set(
    `/repos/${repository.id}/compare/${head}...${later}?per_page=100&page=1`,
    {
      status: "ahead",
      merge_base_commit: { sha: head },
      total_commits: 1,
      commits: [two],
    },
  );
  values.set(`/repos/${repository.id}/compare/${head}...${merged}?per_page=1`, {
    status: "ahead",
    merge_base_commit: { sha: head },
    files: [changed],
  });
  const client = {
    async get<T>(path: string): Promise<T | null> {
      return structuredClone(values.get(path) ?? null) as T | null;
    },
  };
  return { source, carrier, client, values, one, two };
}
async function prepared() {
  const f = fixture();
  const proof = await collectNativeMergeAcceptance(
    f.client,
    repository.id,
    f.source.evidence,
  );
  if (!proof) throw Error("Missing proof");
  f.source.evidence.nativeMergeAcceptance = proof;
  f.source.evidence.limitations = [NATIVE_MERGE_CONTEXT];
  return { ...f, proof };
}

test("complete ancestor graph and retained files admit the original with its native carrier", async () => {
  const { source, carrier } = await prepared();
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
  ).toBe(true);
  const group = await prepareWorkUnitEvidence([source, carrier], [repository]);
  expect(group.limitations).toEqual([]);
  expect(group.claims).toHaveLength(2);
  expect(
    group.claims.find((c) => c.commitSha === head)?.creditPullRequestId,
  ).toBe(source.evidence.pull.node_id);
  expect(
    group.claims.every(
      (c) =>
        c.implementationActorNodeIds.length === 1 &&
        c.implementationActorNodeIds[0] === actor.node_id,
    ),
  ).toBe(true);
});
for (const mutation of [
  "parent",
  "path",
  "text",
  "missing-change",
  "author",
  "unknown-parent",
  "cycle",
] as const) {
  test(`ancestor proof rejects ${mutation}`, async () => {
    const { source, carrier, proof: p } = await prepared();
    if (mutation === "parent") p.parentSha = "8".repeat(40);
    if (mutation === "path") p.retainedFiles[0].acceptedPath = "other.ts";
    if (mutation === "text") {
      const accepted = p.retainedFiles[0].accepted;
      if (!accepted) throw Error("Missing accepted file");
      accepted.text = "forged\n";
    }
    if (mutation === "missing-change") carrier.evidence.commitAttribution = [];
    if (mutation === "author")
      carrier.evidence.commits[0].author = { ...actor, node_id: "U_other" };
    if (mutation === "unknown-parent")
      p.ancestry[0].parents = [{ sha: "9".repeat(40) }];
    if (mutation === "cycle") {
      p.ancestry[0].parents = [{ sha: later }];
      carrier.evidence.commits[1].parents = [{ sha: later }];
    }
    expect(
      await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
    ).toBe(false);
    if (mutation === "author")
      await expect(
        prepareWorkUnitEvidence([source, carrier], [repository]),
      ).rejects.toThrow("immutable commit");
    else
      expect(
        (await prepareWorkUnitEvidence([source, carrier], [repository]))
          .limitations.length,
      ).toBeGreaterThan(0);
  });
}
test("missing carrier keeps the ancestor held", async () => {
  const { source } = await prepared();
  expect(await nativeMergeCarrierMatches(source.evidence, [source])).toBe(
    false,
  );
  expect(
    (await prepareWorkUnitEvidence([source], [repository])).limitations.length,
  ).toBeGreaterThan(0);
});
test("collector retains the ancestor proof and joint deferral", async () => {
  const f = fixture();
  const root = `/repos/${repository.id}`;
  const changes = (c: Commit, files: FileChange[]) => ({
    sha: c.sha,
    html_url: c.html_url,
    parents: c.parents,
    stats: { additions: 1, deletions: 0, total: 1 },
    files,
    author: c.author,
    committer: c.committer,
    commit: c.commit,
  });
  f.values.set(root, { id: 42, node_id: repository.expectedNodeId });
  f.values.set(`${root}/pulls/1`, f.source.evidence.pull);
  f.values.set(
    `${root}/pulls/1/files?per_page=100&page=1`,
    f.source.evidence.files,
  );
  f.values.set(
    `${root}/pulls/1/commits?per_page=100&page=1`,
    f.source.evidence.commits,
  );
  f.values.set(
    `${root}/commits/${head}?per_page=100&page=1`,
    changes(f.one, f.source.evidence.files),
  );
  f.values.set(
    `${root}/commits/${merged}?per_page=100&page=1`,
    f.source.evidence.mergeCommitEvidence,
  );
  for (const path of [
    "pulls/1/reviews",
    "pulls/1/comments",
    "issues/1/comments",
  ])
    f.values.set(`${root}/${path}?per_page=100&page=1`, []);
  const e = await collectValueEvidence(
    {
      ...f.client,
      async graphql<T>(): Promise<T> {
        return {
          repository: {
            pullRequest: {
              id: f.source.evidence.pull.node_id,
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        } as T;
      },
    },
    repository.id,
    1,
    repository,
  );
  expect(e.limitations).toEqual([NATIVE_MERGE_CONTEXT]);
  expect(e.nativeMergeAcceptance?.ancestry.map((c) => c.sha)).toEqual([later]);
});

test("native ancestry accepts non-topological pages and already accepted base ancestry", async () => {
  const { source, carrier } = await prepared();
  const prior = commit("9".repeat(40));
  prior.parents = [];
  const baseCommit = commit(base);
  baseCommit.parents = [{ sha: prior.sha }];
  source.evidence.commits.unshift(prior, baseCommit);
  source.evidence.pull.commits += 2;
  // GitHub pages may list a child before its parent, including the head first.
  carrier.evidence.commits.reverse();
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
  ).toBe(true);
  prior.parents = [{ sha: base }];
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
  ).toBe(false);
});

test("a missing original commit is not assumed to be already on the base", async () => {
  const { source, carrier } = await prepared();
  const unknown = commit("9".repeat(40));
  source.evidence.commits.unshift(unknown);
  source.evidence.pull.commits++;
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
  ).toBe(false);
});

test("retained file tree and submitted postimage tampering refuses", async () => {
  const { source, carrier, proof } = await prepared();
  proof.trees[0].entries[0].mode = "100755";
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier]),
  ).toBe(false);
  const fresh = await prepared();
  fresh.source.evidence.files[0].patch = "@@ -0,0 +1 @@\n+wrong";
  expect(
    await nativeMergeCarrierMatches(fresh.source.evidence, [
      fresh.source,
      fresh.carrier,
    ]),
  ).toBe(false);
});

test("collector rejects an unrelated comparison head", async () => {
  const f = fixture();
  const key = `/repos/${repository.id}/compare/${head}...${later}?per_page=100&page=1`;
  const response = f.values.get(key) as { merge_base_commit: { sha: string } };
  response.merge_base_commit.sha = base;
  expect(
    await collectNativeMergeAcceptance(
      f.client,
      repository.id,
      f.source.evidence,
    ),
  ).toBeNull();
});

test("collector rejects a cyclic parent witness", async () => {
  const f = fixture();
  const key = `/repos/${repository.id}/compare/${head}...${later}?per_page=100&page=1`;
  const response = f.values.get(key) as { commits: Commit[] };
  response.commits[0].parents = [{ sha: later }, { sha: head }];
  expect(
    await collectNativeMergeAcceptance(
      f.client,
      repository.id,
      f.source.evidence,
    ),
  ).toBeNull();
});

test("the joint history consumer refuses a tampered native proof before valuation", async () => {
  const { source, carrier, proof } = await prepared();
  proof.parentSha = "9".repeat(40);
  const result = await consumeWorkUnitHistory(
    {
      history: [],
      throughSequence: 1,
      current: { row: { record_digest: "a".repeat(64) }, record: {} },
    } as never,
    [source, carrier],
    new Map(),
    [repository],
  );
  expect(result.status).toBe("incomplete");
});

test("an incomplete sibling cannot supply an already-accepted base edge", async () => {
  const { source, carrier } = await prepared();
  const earlier = commit("8".repeat(40));
  earlier.parents = [];
  source.evidence.commits.unshift(earlier);
  source.evidence.pull.commits++;
  const bridge = structuredClone(carrier);
  bridge.evidence.pull.node_id = "PR_bridge";
  bridge.evidence.pull.head.sha = "7".repeat(40);
  bridge.evidence.mergeCommitEvidence = {
    sha: base,
    html_url: "https://example.invalid/commit",
    parents: [{ sha: earlier.sha }, { sha: bridge.evidence.pull.head.sha }],
    stats: { additions: 0, deletions: 0, total: 0 },
    files: [],
  };
  bridge.evidence.pull.merge_commit_sha = base;
  bridge.evidence.commits = [earlier, commit(bridge.evidence.pull.head.sha)];
  bridge.evidence.commits[1].parents = [{ sha: earlier.sha }];
  bridge.evidence.pull.commits = 2;
  bridge.evidence.limitations = ["Missing source"];
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier, bridge]),
  ).toBe(false);
  bridge.evidence.limitations = [];
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier, bridge]),
  ).toBe(true);
  bridge.evidence.mergeCommitEvidence.parents[1].sha = "6".repeat(40);
  expect(
    await nativeMergeCarrierMatches(source.evidence, [source, carrier, bridge]),
  ).toBe(false);
});
