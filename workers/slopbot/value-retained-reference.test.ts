/** PRD 7/11: resolve authenticated retention acknowledgements without changing
 * source attribution. All provider responses here are closed local fixtures;
 * these tests perform no inference, publication or GitHub requests.
 */
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { TargetRepository } from "../../src/lib/repositories.mjs";
import { GitHubError } from "./github";
import { collectValueEvidence } from "./value-evidence";
import { loadValuePolicy, verifyCurrentValueSource } from "./value-publication";
import { retainedCopyBindings } from "./value-retained-copy";
import { valueSourceDigest } from "./value-review";
import {
  prepareWorkUnitEvidence,
  type WorkUnitSource,
} from "./value-work-unit";
import { verifyCurrentWorkUnitSource } from "./value-work-unit-publication";

const repository: TargetRepository = {
  id: "fixture/retention",
  owner: "fixture",
  name: "retention",
  aliases: [],
  expectedNodeId: "R_retention",
  displayName: "Retention",
  githubUrl: "https://github.com/fixture/retention",
  description: "Local fixture",
  integrationBranch: "main",
  projectId: "retention",
  role: "primary",
};
const base = "1".repeat(40),
  originalSha = "2".repeat(40),
  copiedSha = "3".repeat(40);
const merge = `abcdef1234${"5".repeat(30)}`,
  short = merge.slice(0, 10);
const actor = (id: string) => ({ node_id: id, login: id, type: "User" });
const author = actor("U_original"),
  maintainer = actor("U_maintainer");
const file = {
  filename: "src/logger.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1 +1 @@\n-old();\n+fixed();",
  blob_url: null,
};

function fixture() {
  const comment = {
    node_id: "IC_ack",
    html_url: `https://github.com/${repository.id}/pull/1#issuecomment-1`,
    user: maintainer,
    body: `Replacement merged as ${short}.`,
    created_at: "2026-09-05T16:27:10Z",
    updated_at: "2026-09-05T16:27:10Z",
  };
  const pulls = [1, 2].map((number) => ({
    node_id: `PR_${number}`,
    number,
    html_url: `https://github.com/${repository.id}/pull/${number}`,
    title: "Retained logger fix",
    body: "",
    user: number === 1 ? author : maintainer,
    merged_by: number === 1 ? null : maintainer,
    state: "closed",
    merged_at: number === 1 ? null : "2026-09-05T03:28:03Z",
    closed_at: number === 1 ? "2026-09-05T16:27:11Z" : "2026-09-05T03:28:03Z",
    merge_commit_sha: number === 1 ? null : merge,
    updated_at: "2026-09-05T16:28:00Z",
    head: { sha: number === 1 ? originalSha : copiedSha },
    base: { sha: base, ref: "main" },
    changed_files: 1,
    comments: number === 1 ? 1 : 0,
    review_comments: 0,
    commits: 1,
  }));
  const commit = (sha: string) => ({
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    author,
    committer: maintainer,
    parents: [{ sha: base }],
    commit: {
      message: "Fix logger",
      author: { date: "2026-08-25T00:00:00Z" },
      committer: { date: "2026-09-04T00:00:00Z" },
    },
    files: [file],
    stats: { additions: 1, deletions: 1, total: 2 },
  });
  const state = {
    comments: [comment],
    resolution: commit(merge) as ReturnType<typeof commit> | null,
    failure: false,
    calls: [] as string[],
  };
  const client = {
    async get<T>(path: string): Promise<T | null> {
      state.calls.push(path);
      const url = new URL(path, "https://api.github.com");
      const root = `/repos/${repository.id}`;
      let result: unknown;
      if (url.pathname === root)
        result = { id: 42, node_id: repository.expectedNodeId, private: false };
      else if (url.pathname === `${root}/commits/${short}`) {
        if (state.failure)
          throw new GitHubError(422, "Ambiguous local reference");
        result = state.resolution;
      } else if (url.pathname.startsWith(`${root}/commits/`)) {
        const sha = url.pathname.split("/").at(-1);
        if (![originalSha, copiedSha, merge].includes(sha ?? ""))
          throw Error("Unexpected commit");
        result = commit(sha as string);
      } else if (url.pathname === `${root}/issues/1/comments`)
        result = state.comments;
      else if (url.pathname === `${root}/issues/2/comments`) result = [];
      else {
        const match = url.pathname.match(
          /\/pulls\/([12])(?:\/(files|commits|reviews|comments))?$/u,
        );
        if (!match) throw Error(`Unexpected local route: ${url.pathname}`);
        const pull = pulls[Number(match[1]) - 1];
        result =
          match[2] === "files"
            ? [file]
            : match[2] === "commits"
              ? [commit(pull.head.sha)]
              : match[2]
                ? []
                : {
                    ...pull,
                    comments: pull.number === 1 ? state.comments.length : 0,
                  };
      }
      return structuredClone(result) as T | null;
    },
    async graphql<T>(
      _query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      const number = Number(variables.number);
      const other = 3 - number;
      return {
        repository: {
          pullRequest: {
            id: `PR_${number}`,
            timelineItems: {
              nodes: [
                {
                  source: {
                    __typename: "PullRequest",
                    id: `PR_${other}`,
                    number: other,
                    url: `https://github.com/${repository.id}/pull/${other}`,
                    repository: {
                      nameWithOwner: repository.id,
                      isPrivate: false,
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    async fileText(_owner: string, _repo: string, path: string, ref: string) {
      if (ref !== base) throw Error("Policy revision changed");
      return path === "AGENTS.md"
        ? { text: "Credit retained work once.", truncated: false }
        : null;
    },
  };
  async function collect(): Promise<WorkUnitSource[]> {
    const policy = await loadValuePolicy(
      client,
      repository.owner,
      repository.name,
      base,
    );
    return Promise.all(
      [1, 2].map(async (number) => ({
        evidence: await collectValueEvidence(
          client,
          repository.id,
          number,
          repository,
        ),
        policy,
      })),
    );
  }
  return { state, client, collect };
}

test("trusted collection resolves the short merge and preserves the original claim", async () => {
  const f = fixture();
  const sources = await f.collect();
  expect(sources.flatMap((s) => s.evidence.limitations)).toEqual([]);
  const prepared = await prepareWorkUnitEvidence(sources, [repository]);
  expect(prepared.limitations).toEqual([]);
  expect(prepared.claims).toEqual([
    expect.objectContaining({
      commitSha: originalSha,
      creditPullRequestId: "PR_1",
      implementationActorNodeIds: [author.node_id],
      retainedCopy: {
        acceptancePullRequestId: "PR_2",
        acceptedCommitSha: copiedSha,
        preexistingCommitShas: [],
      },
    }),
  ]);
  expect(f.state.calls).toContain(`/repos/${repository.id}/commits/${short}`);
  const current = await verifyCurrentWorkUnitSource(
    f.client,
    prepared,
    { sourceDigest: prepared.sourceDigest },
    [repository],
  );
  expect(current.claims).toEqual(prepared.claims);
  const { evidence, policy } = sources[0];
  await expect(
    verifyCurrentValueSource(
      f.client,
      evidence,
      {
        policySha: base,
        sourceDigest: await valueSourceDigest(evidence, policy),
      },
      [repository],
    ),
  ).resolves.toMatchObject({
    evidence: { retainedMergeReferences: evidence.retainedMergeReferences },
  });
});

test("a self-consistent submitted resolution cannot replace trusted work-unit recollection", async () => {
  const f = fixture();
  const sources = await f.collect();
  const supplied = await prepareWorkUnitEvidence(sources, [repository]);
  // The caller has complete stored mappings and matching source hashes, but
  // the provider can no longer establish the short reference.
  f.state.failure = true;
  await expect(
    verifyCurrentWorkUnitSource(
      f.client,
      supplied,
      { sourceDigest: supplied.sourceDigest },
      [repository],
    ),
  ).rejects.toThrow();
});

test("a same-repository PR-commit destination retains its verified source", async () => {
  const f = fixture();
  f.state.comments[0].body = `Replacement merged as [${short}](https://github.com/${repository.id}/pull/2/commits/${short}).`;
  const prepared = await prepareWorkUnitEvidence(await f.collect(), [
    repository,
  ]);
  expect(prepared.limitations).toEqual([]);
  expect(prepared.claims[0].creditPullRequestId).toBe("PR_1");
});

test("full merge SHA needs no new resolution and keeps existing behavior", async () => {
  const f = fixture();
  f.state.comments[0].body = `Replacement merged as ${merge}.`;
  const sources = await f.collect();
  expect(sources[0].evidence.retainedMergeReferences).toBeUndefined();
  const prepared = await prepareWorkUnitEvidence(sources, [repository]);
  expect(prepared.limitations).toEqual([]);
  expect(prepared.claims[0].creditPullRequestId).toBe("PR_1");
  expect(f.state.calls).not.toContain(
    `/repos/${repository.id}/commits/${short}`,
  );
});

for (const change of [
  "foreign-reference",
  "foreign-link-label",
  "foreign-pr-commit-link",
  "wrong-actor",
  "before-merge",
] as const) {
  test(`fresh ${change} comment cannot authorize retention`, async () => {
    const f = fixture();
    if (change === "foreign-reference")
      f.state.comments[0].body = `Replacement merged as other/repo@${short}.`;
    if (change === "foreign-link-label")
      f.state.comments[0].body = `Replacement merged as [${short}](https://github.com/other/repo/commit/${short}).`;
    if (change === "foreign-pr-commit-link")
      f.state.comments[0].body = `Replacement merged as [${short}](https://github.com/other/repo/pull/123/commits/${short}).`;
    if (change === "wrong-actor") f.state.comments[0].user = author;
    if (change === "before-merge")
      f.state.comments[0].created_at = "2026-09-01T00:00:00Z";
    const sources = await f.collect();
    const bindings = await retainedCopyBindings(sources);
    expect(bindings.bindings.size).toBe(0);
    expect(bindings.limitations).toContain(
      "PR_1: matching copied edits require authenticated retention acknowledgement",
    );
    if (change.startsWith("foreign-"))
      expect(
        f.state.calls.filter(
          (path) =>
            path === `/repos/${repository.id}/commits/${short}` ||
            path.startsWith(`/repos/${repository.id}/commits/${short}?`),
        ),
      ).toEqual([]);
  });
}

for (const change of [
  "ambiguous",
  "missing",
  "wrong-sha",
  "other-merge",
  "wrong-repository",
] as const) {
  test(`unproved ${change} provider resolution cannot assign copied work`, async () => {
    const f = fixture();
    assert(f.state.resolution);
    const resolution = f.state.resolution;
    if (change === "ambiguous") f.state.failure = true;
    else if (change === "missing") f.state.resolution = null;
    else if (change === "wrong-sha") resolution.sha = "f".repeat(40);
    else if (change === "other-merge") {
      resolution.sha = `${short}${"6".repeat(30)}`;
      resolution.html_url = `https://github.com/${repository.id}/commit/${resolution.sha}`;
    } else
      resolution.html_url = `https://github.com/other/repo/commit/${merge}`;
    const sources = await f.collect();
    const bindings = await retainedCopyBindings(sources);
    expect(bindings.bindings.size).toBe(0);
    expect(bindings.limitations).toContain(
      "PR_1: matching copied edits require authenticated retention acknowledgement",
    );
  });
}

for (const change of [
  "body",
  "updated",
  "comment-id",
  "actor",
  "before-merge",
  "repository",
  "removed",
  "forged-sha",
  "duplicate",
] as const) {
  test(`retained resolution refuses ${change} acknowledgement evidence`, async () => {
    const f = fixture();
    const sources = await f.collect();
    const evidence = sources[0].evidence;
    const references = evidence.retainedMergeReferences;
    assert(references);
    if (change === "body") evidence.comments[0].body += " Changed meaning.";
    if (change === "updated")
      evidence.comments[0].updated_at = "2026-09-06T00:00:00Z";
    if (change === "comment-id") evidence.comments[0].node_id = "IC_other";
    if (change === "actor") evidence.comments[0].user = author;
    if (change === "before-merge")
      evidence.comments[0].created_at = "2026-09-01T00:00:00Z";
    if (change === "repository") evidence.repositoryDatabaseId = 43;
    if (change === "removed") evidence.comments = [];
    if (change === "forged-sha") references[0].commitSha = "f".repeat(40);
    if (change === "duplicate") references.push(references[0]);
    const bindings = await retainedCopyBindings(sources);
    expect(bindings.bindings.size).toBe(0);
    expect(bindings.limitations).toContain(
      "PR_1: matching copied edits require authenticated retention acknowledgement",
    );
  });
}

for (const change of [
  "edited",
  "removed",
  "resolution-changed",
  "resolution-failed",
] as const) {
  test(`publication refresh refuses ${change} evidence instead of trusting the submitted resolution`, async () => {
    const f = fixture();
    const [source] = await f.collect();
    const sourceDigest = await valueSourceDigest(
      source.evidence,
      source.policy,
    );
    if (change === "edited") f.state.comments[0].body += " Updated.";
    if (change === "removed") f.state.comments = [];
    if (change === "resolution-changed") {
      assert(f.state.resolution);
      f.state.resolution.sha = `${short}${"6".repeat(30)}`;
      f.state.resolution.html_url = `https://github.com/${repository.id}/commit/${f.state.resolution.sha}`;
    }
    if (change === "resolution-failed") f.state.failure = true;
    await expect(
      verifyCurrentValueSource(
        f.client,
        source.evidence,
        {
          policySha: base,
          sourceDigest,
        },
        [repository],
      ),
    ).rejects.toThrow();
  });
}

test("complete copied edits and unique original authorship remain required", async () => {
  const f = fixture();
  const sources = await f.collect();
  const duplicate: WorkUnitSource = structuredClone(sources[0]);
  duplicate.evidence.pull.node_id = "PR_competing";
  // A second fully collected acknowledgement still cannot own the same edit.
  duplicate.evidence.comments[0].body = `Replacement merged as ${merge}.`;
  const conflict = await retainedCopyBindings([...sources, duplicate]);
  expect(conflict.limitations).toContain(
    "PR_competing: retained copy has competing original sources",
  );
  const files = sources[1].evidence.commitAttribution[0].files;
  assert(files);
  files[0].patch = "@@ -1 +1 @@\n-old();\n+different();";
  const missing = await retainedCopyBindings(sources);
  expect(missing.bindings.size).toBe(0);
  expect(missing.limitations[0]).toContain("has 0 exact copy bindings");
  files[0] = structuredClone(file);
  sources[1].evidence.commits[0].author = maintainer;
  const wrongAuthor = await prepareWorkUnitEvidence(sources, [repository]);
  expect(wrongAuthor.limitations).toContain(
    "PR_1: retained primary author identity differs between commits",
  );
});

for (const reference of [
  `other/repo@${merge}`,
  `[${merge}](https://github.com/other/repo/pull/123/commits/${merge})`,
])
  test(`foreign full reference ${reference} stays held`, async () => {
    const f = fixture();
    f.state.comments[0].body = `Replacement merged as ${reference}.`;
    const bindings = await retainedCopyBindings(await f.collect());
    expect(bindings.bindings.size).toBe(0);
  });
