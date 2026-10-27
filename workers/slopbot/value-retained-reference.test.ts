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
const mergedAt = "2026-09-05T03:28:03Z";

/** PR_1 is the closed original and PR_2 the merged acceptance. GitHub numbers
 * and timestamps are inputs so a later duplicate can be described exactly. */
function fixture({
  originalNumber = 1,
  originalCreatedAt = "2026-09-01T00:00:00Z",
  originalUser = author,
  originalCommitAuthor = author as ReturnType<typeof actor> | null,
} = {}) {
  const comment = {
    node_id: "IC_ack",
    html_url: `https://github.com/${repository.id}/pull/${originalNumber}#issuecomment-1`,
    user: maintainer,
    body: `Replacement merged as ${short}.`,
    created_at: "2026-09-05T16:27:10Z",
    updated_at: "2026-09-05T16:27:10Z",
  };
  const pulls = [originalNumber, 2].map((number, index) => ({
    node_id: `PR_${index + 1}`,
    number,
    html_url: `https://github.com/${repository.id}/pull/${number}`,
    title: "Retained logger fix",
    body: "",
    user: index === 0 ? originalUser : maintainer,
    merged_by: index === 0 ? null : maintainer,
    state: "closed",
    created_at: index === 0 ? originalCreatedAt : "2026-09-04T00:00:00Z",
    merged_at: index === 0 ? null : mergedAt,
    closed_at: index === 0 ? "2026-09-05T16:27:11Z" : mergedAt,
    merge_commit_sha: index === 0 ? null : merge,
    updated_at: "2026-09-05T16:28:00Z",
    head: { sha: index === 0 ? originalSha : copiedSha },
    base: { sha: base, ref: "main" },
    changed_files: 1,
    comments: index === 0 ? 1 : 0,
    review_comments: 0,
    commits: 1,
  }));
  const [original] = pulls;
  const commit = (sha: string) => ({
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    author: sha === originalSha ? originalCommitAuthor : author,
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
    routes: new Map<string, unknown>(),
  };
  const root = `/repos/${repository.id}`;
  const client = {
    async get<T>(path: string): Promise<T | null> {
      state.calls.push(path);
      const url = new URL(path, "https://api.github.com");
      let result: unknown;
      if (state.routes.has(url.pathname))
        result = state.routes.get(url.pathname);
      else if (url.pathname === root)
        result = { id: 42, node_id: repository.expectedNodeId, private: false };
      else if (url.pathname === `${root}/commits/${short}`) {
        if (state.failure)
          throw new GitHubError(422, "Ambiguous local reference");
        result = state.resolution;
      } else if (url.pathname === `${root}/commits/${merge}/pulls`)
        result = [{ number: 2, merged_at: mergedAt, merge_commit_sha: merge }];
      // GitHub lists no PR for a commit that no PR carries.
      else if (
        /^\/repos\/[^/]+\/[^/]+\/commits\/\w+\/pulls$/u.test(url.pathname)
      )
        result = [];
      else if (url.pathname.startsWith(`${root}/commits/`)) {
        const sha = url.pathname.split("/").at(-1);
        if (![originalSha, copiedSha, merge].includes(sha ?? ""))
          throw Error("Unexpected commit");
        result = commit(sha as string);
      } else if (url.pathname === `${root}/issues/${original.number}/comments`)
        result = state.comments;
      else if (url.pathname === `${root}/issues/2/comments`) result = [];
      else {
        const match = url.pathname.match(
          /\/pulls\/(\d+)(?:\/(files|commits|reviews|comments))?$/u,
        );
        const pull = pulls.find((entry) => entry.number === Number(match?.[1]));
        if (!match || !pull)
          throw Error(`Unexpected local route: ${url.pathname}`);
        result =
          match[2] === "files"
            ? [file]
            : match[2] === "commits"
              ? [commit(pull.head.sha)]
              : match[2]
                ? []
                : {
                    ...pull,
                    comments: pull === original ? state.comments.length : 0,
                  };
      }
      return structuredClone(result) as T | null;
    },
    async graphql<T>(
      _query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      const index = pulls.findIndex(
        (pull) => pull.number === Number(variables.number),
      );
      const other = pulls[1 - index];
      return {
        repository: {
          pullRequest: {
            id: pulls[index].node_id,
            timelineItems: {
              nodes: [
                {
                  source: {
                    __typename: "PullRequest",
                    id: other.node_id,
                    number: other.number,
                    url: other.html_url,
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
      pulls.map(async ({ number }) => ({
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
  return { state, client, collect, root };
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

for (const reference of [
  `[${short}](https://github.com/${repository.id}/pull/2/commits/${short})`,
  `${repository.owner}@${short}`,
  `[${short}](<http://www.github.com/${repository.id}/commit/${short}>)`,
])
  test(`same-repository reference ${reference} retains its verified source`, async () => {
    const f = fixture();
    f.state.comments[0].body = `Replacement merged as ${reference}.`;
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
  "foreign-fork-reference",
  "foreign-reference-link",
  "foreign-angle-link",
  "foreign-www-link",
  "foreign-http-link",
  "wrong-actor",
  "before-merge",
] as const) {
  test(`fresh ${change} comment cannot authorize retention`, async () => {
    const f = fixture();
    const reference = {
      "foreign-reference": `other/repo@${short}`,
      "foreign-link-label": `[${short}](https://github.com/other/repo/commit/${short})`,
      "foreign-pr-commit-link": `[${short}](https://github.com/other/repo/pull/123/commits/${short})`,
      "foreign-fork-reference": `other@${short}`,
      "foreign-reference-link": `[${short}][1]\n\n[1]: https://github.com/other/repo/commit/${short}`,
      "foreign-angle-link": `[${short}](<https://github.com/other/repo/commit/${short}>)`,
      "foreign-www-link": `https://www.github.com/other/repo/commit/${short}`,
      "foreign-http-link": `[${short}](http://github.com/other/repo/commit/${short})`,
      "wrong-actor": short,
      "before-merge": short,
    }[change];
    f.state.comments[0].body = `Replacement merged as ${reference}.`;
    if (change === "wrong-actor") f.state.comments[0].user = author;
    if (change === "before-merge")
      f.state.comments[0].created_at = "2026-09-02T00:00:00Z";
    const sources = await f.collect();
    // A comment that cannot authorize retention adds no source evidence.
    expect(sources[0].evidence.retainedMergeReferences).toBeUndefined();
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
  `other@${merge}`,
  `http://github.com/other/repo/commit/${merge}`,
])
  test(`foreign full reference ${reference} stays held`, async () => {
    const f = fixture();
    f.state.comments[0].body = `Replacement merged as ${reference}.`;
    const bindings = await retainedCopyBindings(await f.collect());
    expect(bindings.bindings.size).toBe(0);
  });

for (const [opened, originalCreatedAt] of [
  // PR_2 was opened at 2026-09-04T00:00Z and merged at 03:28Z the next day.
  ["during review of", "2026-09-04T12:00:00Z"],
  ["after the merge of", "2026-09-05T10:00:00Z"],
] as const)
  for (const reference of [short, merge])
    test(`a duplicate opened ${opened} the accepted PR cannot take its credit through ${reference.length === 40 ? "a full" : "a short"} merge reference`, async () => {
      // PR_1 opened after PR_2 with the same edits and was closed as a
      // duplicate of the accepted merge.
      const f = fixture({
        originalNumber: 3,
        originalCreatedAt,
        originalUser: actor("U_late"),
      });
      f.state.comments[0].body = `Already merged in ${reference}.`;
      const sources = await f.collect();
      expect(sources[0].evidence.retainedMergeReferences).toBeUndefined();
      const prepared = await prepareWorkUnitEvidence(sources, [repository]);
      expect(prepared.claims).toEqual([
        expect.objectContaining({
          commitSha: copiedSha,
          creditPullRequestId: "PR_2",
          implementationActorNodeIds: [maintainer.node_id, author.node_id],
        }),
      ]);
      expect(prepared.claims[0].retainedCopy).toBeUndefined();
      // The linked exact duplicate still holds for review; it is never dropped.
      expect(prepared.limitations).toContain(
        "PR_1: matching copied edits require authenticated retention acknowledgement",
      );
    });

for (const [name, originalCommitAuthor] of [
  ["unlinked", null],
  ["agent", { node_id: "U_kgDOD-0LXg", login: "codex", type: "User" }],
] as const)
  test(`an ${name} original commit author cannot hide a different accepted author`, async () => {
    const f = fixture({ originalUser: actor("U_other"), originalCommitAuthor });
    const prepared = await prepareWorkUnitEvidence(await f.collect(), [
      repository,
    ]);
    expect(prepared.limitations).toContain(
      "PR_1: retained primary author identity differs between commits",
    );
  });

test("a hint flood holds the source instead of hiding the acknowledgement", async () => {
  const f = fixture();
  f.state.comments.push({
    ...f.state.comments[0],
    node_id: "IC_flood",
    user: actor("U_flood"),
    body: `merged ${Array.from({ length: 17 }, (_, i) => 1_000_000 + i).join(" ")}`,
  });
  const [source] = await f.collect();
  expect(source.evidence.limitations).toContain(
    "Retained merge reference: discovery bounds reached; complete reconciliation required",
  );
});

test("an indirect-accepted source collects no retained merge reference", async () => {
  const f = fixture();
  const { root } = f;
  const encoder = new TextEncoder();
  const gitSha = async (type: string, body: Uint8Array) => {
    const header = encoder.encode(`${type} ${body.length}\0`);
    const bytes = new Uint8Array(header.length + body.length);
    bytes.set(header);
    bytes.set(body, header.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };
  const entry = (mode: string, name: string, sha: string) =>
    new Uint8Array([
      ...encoder.encode(`${mode} ${name}\0`),
      ...(sha.match(/../gu) ?? []).map((pair) => Number.parseInt(pair, 16)),
    ]);
  const text = "fixed();\n";
  const blob = await gitSha("blob", encoder.encode(text));
  const directory = await gitSha("tree", entry("100644", "logger.ts", blob));
  const tree = await gitSha("tree", entry("40000", "src", directory));
  // The maintainer merged the closed PR head into main and named that merge.
  const integration = `c0ffee${"7".repeat(34)}`;
  const hint = integration.slice(0, 10);
  const integrationCommit = {
    sha: integration,
    html_url: `https://github.com/${repository.id}/commit/${integration}`,
    parents: [{ sha: base }, { sha: originalSha }],
    stats: { additions: 1, deletions: 1, total: 2 },
    files: [file],
  };
  const order = [base, originalSha, integration];
  const routes = f.state.routes;
  routes.set(`${root}/commits/${hint}`, integrationCommit);
  routes.set(`${root}/commits/${integration}`, integrationCommit);
  routes.set(`${root}/branches/main`, {
    name: "main",
    commit: { sha: integration },
  });
  for (const a of order)
    for (const b of order)
      routes.set(
        `${root}/compare/${a}...${b}`,
        order.indexOf(a) <= order.indexOf(b)
          ? {
              status: a === b ? "identical" : "ahead",
              merge_base_commit: { sha: a },
              files: [],
            }
          : { status: "behind", merge_base_commit: { sha: b }, files: [] },
      );
  routes.set(`${root}/actions/runs`, {
    total_count: 1,
    workflow_runs: [
      {
        id: 7,
        html_url: `https://github.com/${repository.id}/actions/runs/7`,
        event: "push",
        head_branch: "main",
        head_sha: integration,
        created_at: "2026-09-05T16:00:00Z",
        repository: { node_id: repository.expectedNodeId },
      },
    ],
  });
  for (const sha of [originalSha, integration])
    routes.set(`${root}/git/commits/${sha}`, { sha, tree: { sha: tree } });
  routes.set(`${root}/git/trees/${tree}`, {
    sha: tree,
    truncated: false,
    tree: [
      { path: "src", mode: "040000", type: "tree", sha: directory },
      { path: "src/logger.ts", mode: "100644", type: "blob", sha: blob },
    ],
  });
  routes.set(`${root}/contents/src/logger.ts`, {
    type: "file",
    encoding: "base64",
    content: btoa(text),
    size: text.length,
    sha: blob,
  });
  f.state.comments[0].body = `Integrated in ${hint}.`;
  const evidence = await collectValueEvidence(
    f.client,
    repository.id,
    1,
    repository,
  );
  expect(evidence.indirectAcceptance?.integrationSha).toBe(integration);
  expect(evidence.retainedMergeReferences).toBeUndefined();
  // Only the indirect collector resolves the hint; retained discovery is skipped.
  expect(f.state.calls).not.toContain(`${root}/commits/${hint}`);
});
