import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { TargetRepository } from "../../src/lib/repositories.mjs";
import {
  addedBinaryRecovery,
  binarySourceLimitations,
  validAddedBinaryProof,
} from "./value-binary";
import { collectValueEvidence, type FileChange } from "./value-evidence";
import { verifyCurrentValueSource } from "./value-publication";
import { valueSourceDigest } from "./value-review";
import {
  prepareWorkUnitEvidence,
  validateWorkUnitPartition,
} from "./value-work-unit";

const base = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);
const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0xff, 9]);
const binaryPath = "capture.webm";
const repository: TargetRepository = {
  id: "example/binary-proof",
  owner: "example",
  name: "binary-proof",
  aliases: [],
  expectedNodeId: "R_binary",
  displayName: "Binary proof",
  githubUrl: "https://github.com/example/binary-proof",
  description: "Collector boundary fixture",
  integrationBranch: "main",
  projectId: "fixture",
  role: "primary",
};
const author = { node_id: "U_author", login: "author", type: "User" };
const submitter = { node_id: "U_submitter", login: "submitter", type: "User" };
const policy = {
  sha: base,
  text: "CONTRIBUTING.md\nRetain accepted source evidence.",
};
const hash = (type: string, content: Uint8Array) =>
  createHash("sha1")
    .update(`${type} ${content.length}\0`)
    .update(content)
    .digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value is missing");
  return value;
}
function added(filename = binaryPath): FileChange {
  return {
    filename,
    status: "added",
    additions: 0,
    deletions: 0,
    blob_url: `https://github.com/${repository.id}/blob/${head}/${filename}`,
  };
}

/** These are synthetic Git/API bytes, not recorded provider/model output. */
function fixture(
  options: {
    direct?: boolean;
    differentAccepted?: boolean;
    textOnly?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const trees = new Map<string, unknown>();
  const commits = new Map<
    string,
    { sha: string; tree: { sha: string }; parents: { sha: string }[] }
  >();
  const contents = new Map<
    string,
    {
      type: string;
      encoding: string;
      content: string;
      size: number;
      sha: string;
    }
  >();
  const source = new Map<string, Uint8Array>();
  source.set(
    "fix.ts",
    new TextEncoder().encode("export const fixed = true;\n"),
  );
  if (!options.textOnly) source.set(binaryPath, bytes);
  const accepted = new Map(source);
  if (options.differentAccepted)
    accepted.set(binaryPath, new Uint8Array([0, 0xff, 8]));
  function tree(files: Map<string, Uint8Array>, mode = "100644") {
    const entries = [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({
        path,
        mode,
        type: "blob",
        sha: hash("blob", data),
      }));
    const data = Buffer.concat(
      entries.flatMap((entry) => [
        Buffer.from(`${entry.mode} ${entry.path}\0`),
        Buffer.from(entry.sha, "hex"),
      ]),
    );
    const sha = hash("tree", data);
    trees.set(sha, { sha, truncated: false, tree: entries });
    return sha;
  }
  function bind(
    ref: string,
    files: Map<string, Uint8Array>,
    parents: string[],
    mode = "100644",
  ) {
    commits.set(ref, {
      sha: ref,
      tree: { sha: tree(files, mode) },
      parents: parents.map((sha) => ({ sha })),
    });
    for (const [path, data] of files)
      contents.set(`${path}?ref=${ref}`, {
        type: "file",
        encoding: "base64",
        content: Buffer.from(data).toString("base64"),
        size: data.length,
        sha: hash("blob", data),
      });
  }
  bind(base, new Map(), []);
  bind(head, source, [base]);
  bind(merge, accepted, options.direct ? [base, head] : [base]);
  const text: FileChange = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: `https://github.com/${repository.id}/blob/${head}/fix.ts`,
  };
  const files = [text, ...(!options.textOnly ? [added()] : [])];
  const pull = {
    node_id: "PR_binary",
    number: 1,
    html_url: `https://github.com/${repository.id}/pull/1`,
    title: "Retain regression recording",
    body: null,
    user: submitter,
    merged_by: author,
    state: "closed",
    merged_at: "2026-10-15T18:00:00Z",
    closed_at: "2026-10-15T18:00:00Z",
    merge_commit_sha: merge,
    updated_at: "2026-10-15T18:00:00Z",
    head: { sha: head },
    base: { sha: base, ref: "main" },
    changed_files: files.length,
    comments: 0,
    review_comments: 0,
    commits: 1,
  };
  const changes = (sha: string) => ({
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    parents:
      sha === merge && options.direct
        ? [{ sha: base }, { sha: head }]
        : [{ sha: base }],
    stats: { additions: 1, deletions: 0, total: 1 },
    files: clone(files),
  });
  const client = {
    async get<T>(path: string): Promise<T | null> {
      calls.push(path);
      const root = `/repos/${repository.id}`;
      let result: unknown;
      if (path === root)
        result = { id: 42, node_id: repository.expectedNodeId, private: false };
      else if (path === `${root}/pulls/1`) result = pull;
      else if (path === `${root}/pulls/1/files?per_page=100&page=1`)
        result = files;
      else if (path === `${root}/pulls/1/commits?per_page=100&page=1`)
        result = [
          {
            ...changes(head),
            author,
            committer: author,
            commit: {
              message: "Fix behavior and retain recording",
              author: { date: "2026-10-15T17:00:00Z" },
              committer: { date: "2026-10-15T17:00:00Z" },
            },
          },
        ];
      else if (
        [
          `${root}/pulls/1/reviews?per_page=100&page=1`,
          `${root}/pulls/1/comments?per_page=100&page=1`,
          `${root}/issues/1/comments?per_page=100&page=1`,
        ].includes(path)
      )
        result = [];
      else if (path === `${root}/compare/${base}...${head}`)
        result = { merge_base_commit: { sha: base } };
      else if (path.startsWith(`${root}/commits/`))
        result = changes(path.slice(`${root}/commits/`.length).split("?")[0]);
      else if (path.startsWith(`${root}/git/commits/`))
        result = commits.get(path.slice(`${root}/git/commits/`.length)) ?? null;
      else if (path.startsWith(`${root}/git/trees/`))
        result =
          trees.get(path.slice(`${root}/git/trees/`.length).split("?")[0]) ??
          null;
      else if (path.startsWith(`${root}/contents/`))
        result =
          contents.get(
            decodeURIComponent(path.slice(`${root}/contents/`.length)),
          ) ?? null;
      else throw new Error(`Unexpected evidence read: ${path}`);
      return clone(result) as T | null;
    },
    async graphql<T>(): Promise<T> {
      return {
        repository: {
          pullRequest: {
            id: pull.node_id,
            timelineItems: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    async fileText(_owner: string, _repo: string, path: string) {
      return path === "CONTRIBUTING.md"
        ? { path, text: "Retain accepted source evidence.", truncated: false }
        : null;
    },
  };
  return { client, calls, commits, trees, contents, pull, files, bind };
}

async function collect(f = fixture()) {
  return collectValueEvidence(f.client, repository.id, 1, repository);
}

test("single-parent binary acceptance preserves bytes, paths and original actors without patch lines", async () => {
  const f = fixture();
  const source = await collect(f);
  expect(source.limitations).toEqual([]);
  const media = required(
    source.files.find((file) => file.filename === binaryPath),
  );
  expect(media.patch).toBeUndefined();
  expect([media.additions, media.deletions]).toEqual([0, 0]);
  expect(await validAddedBinaryProof(media)).toBe(true);
  expect(
    Buffer.from(required(media.addedBinary).contentBase64, "base64"),
  ).toEqual(Buffer.from(bytes));
  expect(required(media.addedBinary).contentReview).toBe("unviewed");
  expect(f.calls).toContain(`/repos/${repository.id}/git/commits/${head}`);
  expect(f.calls).toContain(
    `/repos/${repository.id}/git/trees/${required(media.addedBinary).headTreeSha}?recursive=1`,
  );
  const prepared = await prepareWorkUnitEvidence(
    [{ evidence: source, policy }],
    [repository],
  );
  expect(prepared.limitations).toEqual([]);
  expect(prepared.claims.map((claim) => claim.path).sort()).toEqual([
    binaryPath,
    "fix.ts",
  ]);
  expect(
    prepared.claims.every(
      (claim) =>
        claim.commitSha === head &&
        claim.implementationActorNodeIds.join() === "U_author,U_submitter",
    ),
  ).toBe(true);
  expect(
    validateWorkUnitPartition(prepared, [
      { claimIds: prepared.claims.map((claim) => claim.id) },
    ]),
  ).toBe(true);
  expect(
    validateWorkUnitPartition(prepared, [
      {
        claimIds: prepared.claims
          .filter((claim) => claim.path !== binaryPath)
          .map((claim) => claim.id),
      },
    ]),
  ).toBe(false);
});

test("direct merge requires unchanged binary bytes as well as submitted-head ancestry", async () => {
  const good = await collect(fixture({ direct: true }));
  expect(good.limitations).toEqual([]);
  const changed = await collect(
    fixture({ direct: true, differentAccepted: true }),
  );
  expect(changed.limitations).toContain(
    `Added binary accepted identity is unavailable: ${binaryPath}`,
  );
});

test("different zero-line binary squash cannot match two absent patches", async () => {
  const source = await collect(fixture({ differentAccepted: true }));
  expect(source.files.at(-1)?.patch).toBeUndefined();
  expect(source.mergeCommitEvidence?.files.at(-1)?.patch).toBeUndefined();
  expect(source.limitations).toContain(
    "Reported merge neither directly integrates this head nor matches its entire diff; reconcile the accepted range and related PRs",
  );
  const prepared = await prepareWorkUnitEvidence(
    [{ evidence: source, policy }],
    [repository],
  );
  expect(
    validateWorkUnitPartition(prepared, [
      { claimIds: prepared.claims.map((claim) => claim.id) },
    ]),
  ).toBe(false);
});

test("fresh publication collection regenerates bytes and refuses a tampered or drifting digest", async () => {
  const f = fixture();
  const source = await collect(f);
  const digest = await valueSourceDigest(source, policy);
  await expect(
    verifyCurrentValueSource(
      f.client,
      source,
      { policySha: base, sourceDigest: digest },
      [repository],
    ),
  ).resolves.toBeDefined();
  const tampered = clone(source);
  required(required(tampered.files.at(-1)).addedBinary).contentBase64 = "AA==";
  const tamperedDigest = await valueSourceDigest(tampered, policy);
  expect(tamperedDigest).not.toBe(digest);
  await expect(
    verifyCurrentValueSource(
      f.client,
      tampered,
      { policySha: base, sourceDigest: tamperedDigest },
      [repository],
    ),
  ).rejects.toThrow();
  const prepared = await prepareWorkUnitEvidence(
    [{ evidence: tampered, policy }],
    [repository],
  );
  expect(prepared.limitations).toContain(
    `PR_binary: Invalid added binary proof: ${binaryPath}`,
  );
  const drift = fixture({ differentAccepted: true });
  await expect(
    verifyCurrentValueSource(
      drift.client,
      source,
      { policySha: base, sourceDigest: digest },
      [repository],
    ),
  ).rejects.toThrow();
  const repeat = await collect(f);
  repeat.collectedAt = "2099-01-01T00:00:00Z";
  expect(await valueSourceDigest(repeat, policy)).toBe(digest);
});

test("old text-only source retains exactly the pre-binary serialization", async () => {
  const f = fixture({ textOnly: true });
  const source = await collect(f);
  expect(source.limitations).toEqual([]);
  expect(f.calls.some((call) => call.includes("/git/trees/"))).toBe(false);
  expect(JSON.stringify(source)).not.toContain("addedBinary");
  // Capture from the unchanged collector at the parent commit in the validation
  // run; collection timestamps are excluded by the canonical digest.
  expect(await valueSourceDigest(source, policy)).toBe(
    "a1688c6bed14f98091f18662afea0c5106a6e56e348e2f125089e4c13c9948d1",
  );
});

test("private preparation rejects corrupt bodies and lost implementation scope", async () => {
  const source = await collect();
  const file = required(
    source.files.find((item) => item.filename === binaryPath),
  );
  for (const change of [
    { contentBase64: "!" },
    { contentBase64: `${required(file.addedBinary).contentBase64}\n` },
    { size: bytes.length - 1 },
    { blobSha: "f".repeat(40) },
    { sha256: "e".repeat(64) },
    { baseSha: head },
    { mode: "100755" },
    { schemaVersion: 2 },
    { contentReview: "viewed" },
    { extra: true },
  ]) {
    const corrupt = clone(file);
    Object.assign(required(corrupt.addedBinary), change);
    expect(await validAddedBinaryProof(corrupt)).toBe(false);
  }
  for (const change of ["lost-path", "wrong-parent", "wrong-head"] as const) {
    const corrupt = clone(source);
    const scope = corrupt.commitAttribution[0];
    const media = required(
      scope.files?.find((item) => item.filename === binaryPath),
    );
    if (change === "lost-path") scope.changedPaths = ["fix.ts"];
    if (change === "wrong-parent")
      required(media.addedBinary).baseSha = "d".repeat(40);
    if (change === "wrong-head")
      required(media.addedBinary).headSha = "d".repeat(40);
    const prepared = await prepareWorkUnitEvidence(
      [{ evidence: corrupt, policy }],
      [repository],
    );
    expect(prepared.limitations.length).toBeGreaterThan(0);
    expect(
      validateWorkUnitPartition(prepared, [
        { claimIds: prepared.claims.map((claim) => claim.id) },
      ]),
    ).toBe(false);
  }
});

test("identity failures preserve missing-diff holds, never a zero-value fallback", async () => {
  for (const failure of [
    "missing-commit",
    "wrong-commit",
    "alias-root",
    "truncated-tree",
    "wrong-tree",
    "mode",
    "already-present",
    "bad-base64",
    "size",
    "blob-hash",
    "oversized",
    "missing-body",
  ] as const) {
    const f = fixture();
    const root = required(f.commits.get(head)).tree.sha;
    const tree = f.trees.get(root) as {
      sha: string;
      truncated: boolean;
      tree: { mode: string }[];
    };
    const content = required(f.contents.get(`${binaryPath}?ref=${head}`));
    if (failure === "missing-commit") f.commits.delete(head);
    if (failure === "wrong-commit") required(f.commits.get(head)).sha = merge;
    if (failure === "alias-root") tree.sha = head;
    if (failure === "truncated-tree") tree.truncated = true;
    if (failure === "wrong-tree") tree.tree.pop();
    if (failure === "mode")
      f.bind(head, new Map([[binaryPath, bytes]]), [base], "100755");
    if (failure === "already-present")
      f.bind(base, new Map([[binaryPath, bytes]]), []);
    if (failure === "bad-base64") content.content = "!";
    if (failure === "size") content.size++;
    if (failure === "blob-hash") content.sha = "d".repeat(40);
    if (failure === "oversized") content.size = 512 * 1024 + 1;
    if (failure === "missing-body")
      f.contents.delete(`${binaryPath}?ref=${head}`);
    const source = await collect(f);
    expect(source.limitations, failure).toContain(
      `Full diff required: ${binaryPath}`,
    );
  }
});

test("binary classification refuses text, LFS, rewrites and non-regular modes", async () => {
  for (const content of [
    new TextEncoder().encode("ordinary text\n"),
    new TextEncoder().encode(
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 77\n",
    ),
    new Uint8Array(),
  ]) {
    const f = fixture();
    f.bind(head, new Map([[binaryPath, content]]), [base]);
    const file = added();
    await addedBinaryRecovery(f.client, repository.id)([file], base, head);
    expect(file.addedBinary).toBeUndefined();
  }
  for (const mode of ["100755", "120000", "160000"]) {
    const f = fixture();
    f.bind(head, new Map([[binaryPath, bytes]]), [base], mode);
    const file = added();
    await addedBinaryRecovery(f.client, repository.id)([file], base, head);
    expect(file.addedBinary).toBeUndefined();
  }
  for (const status of ["modified", "removed", "renamed"]) {
    const f = fixture();
    const file = { ...added(), status };
    await addedBinaryRecovery(f.client, repository.id)([file], base, head);
    expect(file.addedBinary).toBeUndefined();
  }
  const f = fixture();
  for (const ref of ["main", "../main", "".padEnd(40, "g")]) {
    const file = added();
    await addedBinaryRecovery(f.client, repository.id)([file], base, ref);
    expect(file.addedBinary).toBeUndefined();
  }
});

test("a shared binary recovery session keeps decoded-byte and read limits across scopes", async () => {
  const f = fixture();
  const data = new Uint8Array(512 * 1024).fill(255);
  const files = Array.from({ length: 5 }, (_, i) => added(`capture${i}.webm`));
  f.bind(head, new Map(files.map((file) => [file.filename, data])), [base]);
  const recover = addedBinaryRecovery(f.client, repository.id);
  await recover(files.slice(0, 3), base, head);
  await recover(files.slice(3), base, head);
  expect(files.map((file) => !!file.addedBinary)).toEqual([
    true,
    true,
    true,
    true,
    false,
  ]);
  const g = fixture();
  const many = Array.from({ length: 49 }, (_, i) => added(`record${i}.webm`));
  g.bind(head, new Map(many.map((file) => [file.filename, bytes])), [base]);
  await addedBinaryRecovery(g.client, repository.id)(many, base, head);
  expect(many.filter((file) => !!file.addedBinary)).toHaveLength(48);
  expect(g.calls.filter((path) => path.includes("/contents/"))).toHaveLength(
    48,
  );
});

test("binary recovery refuses cumulative tree coverage above the existing bound", async () => {
  const f = fixture();
  const prior = new Map(
    Array.from(
      { length: 10_000 },
      (_, i) => [`prior-${String(i).padStart(5, "0")}`, bytes] as const,
    ),
  );
  f.bind(base, prior, []);
  f.bind(head, new Map([...prior, [binaryPath, bytes]]), [base]);
  const file = added();
  const recover = addedBinaryRecovery(f.client, repository.id);
  await recover([file], base, head);
  expect(file.addedBinary).toBeUndefined();
  expect(f.calls.some((path) => path.includes("/contents/"))).toBe(false);
  const readCount = f.calls.length;
  // New refs after exhaustion must not trigger another recursive tree read.
  await recover([added()], "d".repeat(40), "e".repeat(40));
  await recover([added()], "f".repeat(40), "1".repeat(40));
  expect(f.calls).toHaveLength(readCount);
});

test("retained private proofs cannot exceed the collector's aggregate limits", async () => {
  const source = await collect();
  const media = required(
    source.files.find((file) => file.filename === binaryPath),
  );
  const many = clone(source);
  many.files = Array.from({ length: 49 }, () => clone(media));
  expect(await binarySourceLimitations(many)).toEqual([
    "Added binary evidence exceeds the recovery budget",
  ]);
  const large = clone(source);
  const f = fixture();
  const data = new Uint8Array(512 * 1024).fill(255);
  f.bind(head, new Map([[binaryPath, data]]), [base]);
  const one = added();
  await addedBinaryRecovery(f.client, repository.id)([one], base, head);
  expect(await validAddedBinaryProof(one)).toBe(true);
  large.files = Array.from({ length: 5 }, () => clone(one));
  expect(await binarySourceLimitations(large)).toEqual([
    "Added binary evidence exceeds the recovery budget",
  ]);
});
