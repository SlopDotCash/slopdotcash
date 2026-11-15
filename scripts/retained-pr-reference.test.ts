import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  integrated,
  makeOriginal,
  repository,
} from "../tests/value-promotion-fixture";
import { retainedCopyBindings } from "../workers/slopbot/value-retained-copy";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import { collectRetainedMergeReferences } from "../workers/slopbot/value-retained-reference";
import { retainedCommitCreditSources } from "./retained-commit-credit";

function sources() {
  const original = makeOriginal();
  original.evidence.pull.merged_at = null;
  original.evidence.pull.merge_commit_sha = null;
  original.evidence.pull.merged_by = null;
  original.evidence.mergeCommitEvidence = null;
  original.evidence.commits[0].author = null;
  original.evidence.commitAttribution[0].actorNodeIds = [];
  const copy = structuredClone(original);
  const maintainer = {
    node_id: "U_maintainer",
    login: "maintainer",
    type: "User",
  };
  Object.assign(copy.evidence.pull, {
    node_id: "PR_copy",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    user: maintainer,
    merged_by: maintainer,
    merged_at: "2026-10-02T10:00:00Z",
    closed_at: "2026-10-02T10:00:00Z",
    merge_commit_sha: integrated,
  });

  original.evidence.relatedPullRequests = [
    {
      id: copy.evidence.pull.node_id,
      number: copy.evidence.pull.number,
      url: copy.evidence.pull.html_url,
      repository: repository.id,
    },
  ];
  const comment = {
    node_id: "IC_retained",
    html_url: `https://github.com/${repository.id}/pull/1#issuecomment-1`,
    body: "Your commits are carried over unchanged, with authorship, in #2.",
    user: maintainer,
    created_at: "2026-10-02T11:00:00Z",
    updated_at: "2026-10-02T11:00:00Z",
  };
  original.evidence.comments.push(comment);
  return { original, copy, comment };
}

function nativeSources() {
  const { original, copy } = sources();
  original.evidence.comments = [];
  original.evidence.commits[0].author = original.evidence.pull.user;
  original.evidence.commitAttribution[0].actorNodeIds = [
    original.evidence.pull.user.node_id,
  ];
  copy.evidence.commits = structuredClone(original.evidence.commits);
  copy.evidence.commitAttribution = structuredClone(
    original.evidence.commitAttribution,
  );
  return { original, copy };
}

test("a complete native original needs no copied-edit acknowledgement", async () => {
  const { original, copy } = nativeSources();
  const evidence = await prepareWorkUnitEvidence(
    [original, copy],
    [repository],
  );
  expect(evidence.limitations).toEqual([]);
  expect(evidence.claims).toHaveLength(1);
  expect(evidence.claims[0].retainedCopy).toBeUndefined();
});

test("a native commit outside the accepted range cannot create a claim", async () => {
  const { original, copy } = nativeSources();
  copy.evidence.acceptedRange = {
    headSha: copy.evidence.pull.head.sha,
    mergeSha: copy.evidence.pull.merge_commit_sha!,
    parentSha: copy.evidence.commits[0].sha,
    files: [{ path: "fix.ts", blobSha: "a".repeat(40), alreadyPresent: true }],
  };
  const evidence = await prepareWorkUnitEvidence(
    [original, copy],
    [repository],
  );
  expect(evidence.claims).toEqual([]);
  expect(evidence.limitations.length).toBeGreaterThan(0);
});

for (const invalid of [
  "parent",
  "author",
  "paths",
  "incomplete",
  "later-source",
]) {
  test(`native original refuses mismatched ${invalid}`, async () => {
    const { original, copy } = nativeSources();
    if (invalid === "parent")
      copy.evidence.commits[0].parents = [{ sha: "9".repeat(40) }];
    if (invalid === "author") copy.evidence.commits[0].author = null;
    if (invalid === "paths")
      copy.evidence.commitAttribution[0].changedPaths = [];
    if (invalid === "incomplete")
      original.evidence.limitations = ["Missing source evidence"];
    if (invalid === "later-source") original.evidence.pull.number = 3;
    const evidence = await prepareWorkUnitEvidence(
      [original, copy],
      [repository],
    );
    expect(evidence.limitations.length).toBeGreaterThan(0);
  });
}

function withUnacceptedFinalPath() {
  const pair = sources();
  const evidence = pair.original.evidence;
  const commit = structuredClone(evidence.commits[0]);
  commit.sha = "9".repeat(40);
  commit.parents = [{ sha: evidence.commits[0].sha }];
  evidence.commits.push(commit);
  evidence.pull.head.sha = commit.sha;
  evidence.pull.commits = evidence.commits.length;
  const extra = {
    ...structuredClone(evidence.commitAttribution[0].files![0]),
    filename: "unaccepted-test.ts",
    patch: "@@ -0,0 +1 @@\n+unaccepted",
  };
  evidence.files.push(extra);
  evidence.commitAttribution.push({
    sha: commit.sha,
    actorNodeIds: [],
    changedPaths: [extra.filename],
    files: [extra],
    limitations: [],
  });
  return pair;
}

test("joint preparation credits the exact retained subset of a complete original", async () => {
  const { original, copy } = withUnacceptedFinalPath();
  const evidence = await prepareWorkUnitEvidence(
    [original, copy],
    [repository],
  );
  expect(evidence.limitations).toEqual([]);
  expect(evidence.claims.map((claim) => claim.path)).toEqual(["fix.ts"]);
  expect(
    evidence.sources.find(
      (source) => source.evidence.pull.node_id === "PR_original",
    )?.evidence.commits.length,
  ).toBe(2);
  const ordinary = await retainedCopyBindings([original, copy]);
  expect(ordinary.limitations).toContain(
    `PR_original: retained ${"9".repeat(40)}:unaccepted-test.ts has 0 exact copy bindings`,
  );
});

test("accepted subset still requires at least one exact retained anchor", async () => {
  const { original, copy } = withUnacceptedFinalPath();
  copy.evidence.commitAttribution[0].files![0].patch += "\n+different";
  const evidence = await prepareWorkUnitEvidence(
    [original, copy],
    [repository],
  );
  expect(
    evidence.limitations.some((reason) =>
      reason.includes("0 exact copy bindings"),
    ),
  ).toBe(true);
});

test("accepted subset retains incomplete-source and wrong-author holds", async () => {
  const { original, copy } = withUnacceptedFinalPath();
  copy.evidence.commits[0].author = {
    node_id: "U_other",
    login: "other",
    type: "User",
  };
  let evidence = await prepareWorkUnitEvidence([original, copy], [repository]);
  expect(evidence.limitations).toContain(
    "PR_original: retained primary author identity differs between commits",
  );
  original.evidence.limitations.push("Missing source evidence");
  evidence = await prepareWorkUnitEvidence([original, copy], [repository]);
  expect(evidence.limitations).toContain(
    "PR_original: Missing source evidence",
  );
});

test("accepted subset refuses two matching accepted copies", async () => {
  const { original, copy, comment } = withUnacceptedFinalPath();
  const second = structuredClone(copy);
  Object.assign(second.evidence.pull, {
    node_id: "PR_other_copy",
    number: 3,
    html_url: `https://github.com/${repository.id}/pull/3`,
  });
  original.evidence.relatedPullRequests.push({
    id: second.evidence.pull.node_id,
    number: 3,
    url: second.evidence.pull.html_url,
    repository: repository.id,
  });
  comment.body = "Your commits are retained in #2 and #3.";
  const evidence = await prepareWorkUnitEvidence(
    [original, copy, second],
    [repository],
  );
  expect(
    evidence.limitations.some((reason) =>
      reason.includes("2 exact copy bindings"),
    ),
  ).toBe(true);
});

for (const reference of [
  "#2",
  `${repository.id}#2`,
  `https://github.com/${repository.id}/pull/2`,
])
  test(`verified merger retained-work acknowledgement binds ${reference}`, async () => {
    const { original, copy, comment } = sources();
    comment.body = `Your commits are carried over unchanged, with authorship, in ${reference}.`;
    const result = await retainedCommitCreditSources(copy, [original, copy]);
    expect([...result.values()]).toEqual([
      {
        actorNodeId: original.evidence.pull.user.node_id,
        originalPullRequestId: original.evidence.pull.node_id,
        originalPullRequestUrl: original.evidence.pull.html_url,
        originalCommitSha: original.evidence.commits[0].sha,
      },
    ]);
  });

for (const kind of [
  "forged",
  "early",
  "wrong-repo",
  "foreign-url-query",
  "foreign-ftp-query",
  "nondefault-port",
  "negated",
  "unrelated-sentence",
  "misleading-label",
  "punctuated-label",
  "unresolved-label",
  "unresolved-node",
  "no-retained-work",
] as const)
  test(`${kind} acknowledgement cannot attribute copied work`, async () => {
    const { original, copy, comment } = sources();
    if (kind === "forged")
      comment.user = { node_id: "U_other", login: "other", type: "User" };
    if (kind === "early") comment.created_at = "2026-10-02T09:00:00Z";
    if (kind === "wrong-repo")
      comment.body = "Your commits are retained in other/repository#2.";
    if (kind === "foreign-url-query")
      comment.body =
        "Your commits are retained in https://github.com/other/repository/pull/4?target=#2.";
    if (kind === "foreign-ftp-query")
      comment.body =
        "Your commits are retained in ftp://other.example/?target=#2.";
    if (kind === "nondefault-port")
      comment.body = `Your commits are retained in https://github.com:444/${repository.id}/pull/2.`;
    if (kind === "negated")
      comment.body = "Your commits were not retained in #2.";
    if (kind === "unrelated-sentence")
      comment.body = "Your work was retained in #3. See #2 for unrelated work.";
    if (kind === "misleading-label")
      comment.body =
        "Your commits are retained in [#2](https://github.com/other/repository/pull/2).";
    if (kind === "punctuated-label")
      comment.body =
        "Your commits are retained in [#2. release](https://github.com/other/repository/pull/2).";
    if (kind === "unresolved-label")
      comment.body =
        "Your commits are retained in [#2][remote].\n[remote]: https://github.com/other/repository/pull/2";
    if (kind === "unresolved-node") original.evidence.relatedPullRequests = [];
    if (kind === "no-retained-work") comment.body = "Thanks, see #2.";
    if (kind === "unresolved-node") {
      expect(
        (await retainedCommitCreditSources(copy, [original, copy])).size,
      ).toBe(0);
      return;
    }
    await expect(
      retainedCommitCreditSources(copy, [original, copy]),
    ).rejects.toThrow("authenticated retention acknowledgement");
  });

test("October exact copies can bind through two linked commit authors without a merger comment", async () => {
  const { original, copy } = sources();
  original.evidence.comments = [];
  copy.evidence.relatedPullRequests = [
    {
      id: original.evidence.pull.node_id,
      number: original.evidence.pull.number,
      url: original.evidence.pull.html_url,
      repository: repository.id,
    },
  ];
  original.evidence.commits[0].author = original.evidence.pull.user;
  copy.evidence.commits[0].author = original.evidence.pull.user;
  const options = { ordinaryCommitsOnly: true, octoberOriginalCredit: true };
  const retained = await retainedCopyBindings([original, copy], options);
  expect(retained.bindings.size).toBe(1);
  expect(retained.limitations).toEqual([]);
  expect((await retainedCopyBindings([original, copy])).bindings.size).toBe(0);
  copy.evidence.pull.merged_at = "2026-11-02T10:00:00Z";
  expect(
    (await retainedCopyBindings([original, copy], options)).bindings.size,
  ).toBe(0);
  copy.evidence.pull.merged_at = "2026-10-02T10:00:00Z";
  copy.evidence.commits[0].author = null;
  expect(
    (await retainedCopyBindings([original, copy], options)).bindings.size,
  ).toBe(0);
});

test("October unlinked copies still require the eventual merger's exact rebase acknowledgement", async () => {
  const { original, copy, comment } = sources();
  original.evidence.commits[0].author = original.evidence.pull.user;
  original.evidence.pull.closed_at = "2026-10-02T09:30:00Z";
  comment.body = "We rebased your commits with your authorship in #2.";
  comment.created_at = "2026-10-02T09:29:59Z";
  comment.updated_at = comment.created_at;
  const options = { ordinaryCommitsOnly: true, octoberOriginalCredit: true };
  expect(
    (await retainedCopyBindings([original, copy], options)).bindings.size,
  ).toBe(1);
  expect((await retainedCopyBindings([original, copy])).bindings.size).toBe(0);
  comment.updated_at = "2026-10-02T11:00:00Z";
  expect(
    (await retainedCopyBindings([original, copy], options)).bindings.size,
  ).toBe(0);
  comment.updated_at = comment.created_at;
  comment.user = original.evidence.pull.user;
  expect(
    (await retainedCopyBindings([original, copy], options)).bindings.size,
  ).toBe(0);
});

function fourCommitsWithSourceMerges() {
  const source = sources();
  const originalCommit = source.original.evidence.commits[0];
  const originalFile = source.original.evidence.files[0];
  const originalAttribution = source.original.evidence.commitAttribution[0];
  for (const [entry, start] of [
    [source.original, 1],
    [source.copy, 5],
  ] as const) {
    entry.evidence.commits = [];
    entry.evidence.files = [];
    entry.evidence.commitAttribution = [];
    for (let index = 0; index < 4; index++) {
      const sha = String(start + index).repeat(40);
      const path = `fix-${index}.ts`;
      const file = {
        ...originalFile,
        filename: path,
        patch: `@@ -0,0 +1 @@\n+export const fixed${index} = true;`,
      };
      entry.evidence.commits.push({
        ...originalCommit,
        sha,
        html_url: `https://github.com/${repository.id}/commit/${sha}`,
      });
      entry.evidence.files.push(file);
      entry.evidence.commitAttribution.push({
        ...originalAttribution,
        sha,
        changedPaths: [path],
        files: [file],
      });
    }
    entry.evidence.pull.commits = 4;
    entry.evidence.pull.changed_files = 4;
    entry.evidence.pull.head.sha = entry.evidence.commits[3].sha;
  }
  for (const sha of ["9".repeat(40), "a".repeat(40)])
    source.original.evidence.commits.push({
      ...originalCommit,
      sha,
      html_url: `https://github.com/${repository.id}/commit/${sha}`,
      parents: [{ sha: originalCommit.sha }, { sha: "b".repeat(40) }],
    });
  source.original.evidence.pull.commits = 6;
  source.original.evidence.pull.head.sha =
    source.original.evidence.commits[5].sha;
  return source;
}

test("source sync merges leave all four complete ordinary commit mappings usable", async () => {
  const { original, copy } = fourCommitsWithSourceMerges();
  const result = await retainedCommitCreditSources(copy, [original, copy]);
  expect(result.size).toBe(4);
  expect([...result.values()].map((record) => record.actorNodeId)).toEqual(
    Array(4).fill(original.evidence.pull.user.node_id),
  );
  // The narrowed recipient lookup does not weaken full joint preparation.
  expect(
    (await retainedCopyBindings([original, copy])).limitations,
  ).toHaveLength(2);
});

test("ordinary-only lookup still refuses incomplete ordinary source evidence", async () => {
  const { original, copy } = fourCommitsWithSourceMerges();
  original.evidence.commitAttribution[2].files = undefined;
  await expect(
    retainedCommitCreditSources(copy, [original, copy]),
  ).rejects.toThrow("lacks complete file evidence");
});

test("a copied merge commit receives no ordinary implementation attribution", async () => {
  const { original, copy } = sources();
  copy.evidence.commits[0].parents.push({ sha: "b".repeat(40) });
  await expect(
    retainedCommitCreditSources(copy, [original, copy]),
  ).rejects.toThrow("has 0 exact copy bindings");
});

function asFormalReview(source: ReturnType<typeof sources>) {
  const { original, comment } = source;
  original.evidence.comments = [];
  const review = {
    node_id: "PRR_retained",
    id: 991,
    html_url: `${original.evidence.pull.html_url}#pullrequestreview-991`,
    body: comment.body,
    user: comment.user,
    submitted_at: comment.created_at,
    state: "COMMENTED",
    commit_id: original.evidence.pull.head.sha,
  };
  original.evidence.reviews = [review];
  return review;
}

test("formal merger review acknowledges retained work and replays deterministically", async () => {
  const source = sources();
  asFormalReview(source);
  const first = await retainedCopyBindings([source.original, source.copy]);
  const replay = await retainedCopyBindings([source.original, source.copy]);
  expect(first.limitations).toEqual([]);
  expect([...first.bindings]).toEqual([...replay.bindings]);
  expect(first.bindings.size).toBe(1);
});

for (const invalid of [
  "other-actor",
  "before-merge",
  "missing-time",
  "wrong-reference",
  "bot",
] as const)
  test(`formal review refuses ${invalid} acknowledgement`, async () => {
    const source = sources();
    const review = asFormalReview(source);
    if (invalid === "other-actor")
      review.user = source.original.evidence.pull.user;
    if (invalid === "before-merge")
      review.submitted_at = "2026-10-02T09:00:00Z";
    if (invalid === "missing-time")
      review.submitted_at = null as unknown as string;
    if (invalid === "wrong-reference")
      review.body = "Your work is retained in #3.";
    if (invalid === "bot") review.user = { ...review.user, type: "Bot" };
    const result = await retainedCopyBindings([source.original, source.copy]);
    expect(result.bindings.size).toBe(0);
    expect(result.limitations).toContain(
      `${source.original.evidence.pull.node_id}: matching copied edits require authenticated retention acknowledgement`,
    );
  });

function emptySourceResolutions(
  source: ReturnType<typeof fourCommitsWithSourceMerges>,
) {
  source.original.evidence.mergeResolutions = source.original.evidence.commits
    .filter((commit) => commit.parents.length === 2)
    .map((commit) => ({
      commitSha: commit.sha,
      parents: commit.parents.map((parent) => parent.sha) as [string, string],
      gitVersion: "git version 2.56.0",
      automaticTree: "c".repeat(40),
      resolvedTree: "c".repeat(40),
      hadConflicts: false,
      patch: "",
      patchSha256: createHash("sha256").update("").digest("hex"),
      paths: [],
    }));
}

test("complete canonical empty source resolutions retain only ordinary mappings", async () => {
  const source = fourCommitsWithSourceMerges();
  emptySourceResolutions(source);
  const result = await retainedCopyBindings([source.original, source.copy]);
  expect(result.limitations).toEqual([]);
  expect(result.bindings.size).toBe(4);
  expect(
    [...result.bindings.values()].every((binding) =>
      source.original.evidence.commitAttribution.some(
        (entry) => entry.sha === binding.originalCommitSha,
      ),
    ),
  ).toBe(true);
  expect([...result.bindings]).toEqual([
    ...(await retainedCopyBindings([source.original, source.copy])).bindings,
  ]);
});

for (const invalid of [
  "missing",
  "duplicate",
  "wrong-parent",
  "wrong-hash",
  "wrong-version",
  "resolution-edit",
  "unresolved-conflict",
] as const)
  test(`full retained scope holds a ${invalid} source resolution`, async () => {
    const source = fourCommitsWithSourceMerges();
    emptySourceResolutions(source);
    const resolutions = source.original.evidence.mergeResolutions;
    if (!resolutions) throw new Error("Missing fixture merge resolutions");
    const resolution = resolutions[0];
    if (invalid === "missing") resolutions.shift();
    if (invalid === "duplicate") resolutions.push(structuredClone(resolution));
    if (invalid === "wrong-parent") resolution.parents[0] = "d".repeat(40);
    if (invalid === "wrong-hash") resolution.patchSha256 = "d".repeat(64);
    if (invalid === "wrong-version")
      resolution.gitVersion = "git version 2.50.1";
    if (invalid === "unresolved-conflict") resolution.hadConflicts = true;
    if (invalid === "resolution-edit") {
      resolution.patch = "diff --git a/fix.ts b/fix.ts\n+changed\n";
      resolution.patchSha256 = createHash("sha256")
        .update(resolution.patch)
        .digest("hex");
      resolution.paths = ["fix.ts"];
      resolution.resolvedTree = "d".repeat(40);
    }
    const result = await retainedCopyBindings([source.original, source.copy]);
    expect(result.limitations).toHaveLength(1);
    expect(result.bindings.size).toBe(4);
  });

test("short merge references authenticate the original formal review bytes", async () => {
  const source = sources();
  const review = asFormalReview(source);
  review.body = `The fix was delivered in #2, merged as ${integrated.slice(0, 8)}.`;
  source.copy.evidence.mergeCommitEvidence = {
    sha: integrated,
    html_url: `https://github.com/${repository.id}/commit/${integrated}`,
    parents: [{ sha: "0".repeat(40) }],
    stats: { additions: 1, deletions: 0, total: 1 },
    files: source.copy.evidence.files,
  };
  const client = {
    async get<T>(path: string): Promise<T | null> {
      if (path.endsWith(`/commits/${integrated.slice(0, 8)}`))
        return {
          sha: integrated,
          html_url: `https://github.com/${repository.id}/commit/${integrated}`,
        } as T;
      if (path.endsWith(`/commits/${integrated}/pulls?per_page=100`))
        return [source.copy.evidence.pull] as T;
      if (path.endsWith("/pulls/2")) return source.copy.evidence.pull as T;
      throw new Error(`Unexpected source request ${path}`);
    },
  };
  source.original.evidence.retainedMergeReferences = (
    await collectRetainedMergeReferences(client, source.original.evidence)
  ).references;
  const first = await retainedCopyBindings([source.original, source.copy]);
  expect(first.limitations).toEqual([]);
  expect(first.bindings.size).toBe(1);
  review.commit_id = "e".repeat(40);
  const changed = await retainedCopyBindings([source.original, source.copy]);
  expect(changed.bindings.size).toBe(0);
  expect(changed.limitations).toHaveLength(1);
});

function copiedResolution() {
  const source = sources();
  const origin = source.original.evidence.commits[0];
  const originalMerge = {
    ...origin,
    sha: "a".repeat(40),
    parents: [{ sha: origin.sha }, { sha: "b".repeat(40) }],
  };
  const acceptedMerge = {
    ...structuredClone(originalMerge),
    sha: "c".repeat(40),
    parents: [{ sha: origin.sha }, { sha: "d".repeat(40) }],
  };
  source.original.evidence.commits.push(originalMerge);
  source.copy.evidence.commits.push(acceptedMerge);
  const resolution = (commit: typeof originalMerge) => {
    const patch = `diff --git a/fix.ts b/fix.ts\nindex ${"e".repeat(40)}..${"f".repeat(40)} 100644\n--- a/fix.ts\n+++ b/fix.ts\n@@ -1 +1 @@\n-conflict\n+resolved\n`;
    return {
      commitSha: commit.sha,
      parents: commit.parents.map((parent) => parent.sha) as [string, string],
      gitVersion: "git version 2.56.0",
      automaticTree: "1".repeat(40),
      resolvedTree: "2".repeat(40),
      hadConflicts: true,
      patch,
      patchSha256: createHash("sha256").update(patch).digest("hex"),
      paths: ["fix.ts"],
    };
  };
  source.original.evidence.mergeResolutions = [resolution(originalMerge)];
  source.copy.evidence.mergeResolutions = [resolution(acceptedMerge)];
  return source;
}

test("canonical conflict copies retain one original resolution by path and resolved blob", async () => {
  const { original, copy } = copiedResolution();
  const result = await retainedCopyBindings([original, copy]);
  expect(result.limitations).toEqual([]);
  expect(result.bindings.size).toBe(2);
  const resolution = [...result.bindings.values()].find(
    (binding) => binding.acceptedCommitSha === "c".repeat(40),
  );
  expect(resolution?.originalCommitSha).toBe("a".repeat(40));
  expect(resolution?.mergeResolution).toBe(true);
  expect([...result.bindings]).toEqual([
    ...(await retainedCopyBindings([original, copy])).bindings,
  ]);
});

for (const invalid of [
  "parent",
  "blob",
  "path",
  "hash",
  "identity",
  "ambiguous",
  "short-index",
  "reference",
  "competing-original",
  "missing-antecedent",
  "early-copy",
] as const)
  test(`canonical conflict copy refuses ${invalid} mismatch`, async () => {
    const { original, copy, comment } = copiedResolution();
    const candidate = copy.evidence.mergeResolutions?.[0];
    if (!candidate) throw new Error("Missing copied resolution");
    if (invalid === "missing-antecedent") copy.evidence.commits.shift();
    if (invalid === "early-copy")
      copy.evidence.commits[1].commit.author.date = "2026-09-01T00:00:00Z";
    if (invalid === "parent") {
      copy.evidence.commits[1].parents[0].sha = "3".repeat(40);
      candidate.parents[0] = "3".repeat(40);
    }
    if (invalid === "blob")
      candidate.patch = candidate.patch.replace("f".repeat(40), "4".repeat(40));
    if (invalid === "path") {
      candidate.patch = candidate.patch.replaceAll("fix.ts", "other.ts");
      candidate.paths = ["other.ts"];
    }
    if (invalid === "identity") candidate.commitSha = "5".repeat(40);
    if (invalid === "ambiguous")
      copy.evidence.mergeResolutions?.push(structuredClone(candidate));
    if (invalid === "short-index")
      candidate.patch = candidate.patch.replace("f".repeat(40), "f".repeat(7));
    if (invalid !== "hash")
      candidate.patchSha256 = createHash("sha256")
        .update(candidate.patch)
        .digest("hex");
    else candidate.patchSha256 = "6".repeat(64);
    if (invalid === "reference") comment.user = original.evidence.pull.user;
    const sources = [original, copy];
    if (invalid === "competing-original") {
      const competitor = structuredClone(original);
      competitor.evidence.pull.node_id = "PR_competing";
      sources.push(competitor);
    }
    const result = await retainedCopyBindings(sources);
    expect(result.limitations.length).toBeGreaterThan(0);
    if (invalid !== "competing-original")
      expect(
        [...result.bindings.values()].some(
          (binding) => binding.acceptedCommitSha === "c".repeat(40),
        ),
      ).toBe(false);
  });

for (const body of [
  "The account-preference fix is included in #2.",
  "The payment-ordering fix and the later Solidity formatting correction are included in #2.",
])
  test(`included-fix acknowledgement binds exact accepted copies: ${body}`, async () => {
    const { original, copy, comment } = sources();
    comment.body = body;
    const result = await retainedCommitCreditSources(copy, [original, copy]);
    expect(result.size).toBe(1);
    copy.evidence.commitAttribution[0].files![0].patch += "\n+unrelated";
    await expect(
      retainedCommitCreditSources(copy, [original, copy]),
    ).rejects.toThrow("0 exact copy bindings");
  });

for (const body of [
  "The fix is not included in #2.",
  "The fix will be included in #2.",
  "The fix would be included in #2.",
  "If accepted, the fix is included in #2.",
  "The fixes are included in #3. See #2.",
  "The fixture is included in #2.",
  "The fix is included in other/repository#2.",
  "The fix is included in #3, but see #2.",
])
  test(`included-fix acknowledgement refuses unrelated or prospective text: ${body}`, async () => {
    const { original, copy, comment } = sources();
    comment.body = body;
    await expect(
      retainedCommitCreditSources(copy, [original, copy]),
    ).rejects.toThrow("authenticated retention acknowledgement");
  });

for (const invalid of ["actor", "time", "source-id"])
  test(`included-fix acknowledgement retains ${invalid} binding`, async () => {
    const { original, copy, comment } = sources();
    comment.body = "The fix is included in #2.";
    if (invalid === "actor")
      comment.user = { ...comment.user, node_id: "U_other" };
    if (invalid === "time") comment.created_at = "2026-10-02T09:00:00Z";
    if (invalid === "source-id")
      original.evidence.relatedPullRequests[0].id = "PR_other";
    if (invalid === "source-id") {
      expect(
        (await retainedCommitCreditSources(copy, [original, copy])).size,
      ).toBe(0);
    } else {
      await expect(
        retainedCommitCreditSources(copy, [original, copy]),
      ).rejects.toThrow("authenticated retention acknowledgement");
    }
  });
