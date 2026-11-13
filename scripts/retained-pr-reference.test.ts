import { expect, test } from "bun:test";
import {
  integrated,
  makeOriginal,
  repository,
} from "../tests/value-promotion-fixture";
import { retainedCopyBindings } from "../workers/slopbot/value-retained-copy";
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
  original.evidence.comments.push({
    node_id: "IC_retained",
    html_url: `https://github.com/${repository.id}/pull/1#issuecomment-1`,
    body: "Your commits are carried over unchanged, with authorship, in #2.",
    user: maintainer,
    created_at: "2026-10-02T11:00:00Z",
    updated_at: "2026-10-02T11:00:00Z",
  });
  return { original, copy, comment: original.evidence.comments.at(-1)! };
}

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
