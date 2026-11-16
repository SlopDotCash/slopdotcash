import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { workUnitCreditActorIds } from "../../src/lib/implementation-lines";
import {
  VALUE_RUBRIC_VERSION,
  type ValueAssessment,
} from "../../src/lib/value-assessment";
import {
  commit,
  makeOriginal,
  repository,
} from "../../tests/value-promotion-fixture";
import { collectValueEvidence } from "./value-evidence";
import { retainedRepair } from "./value-original-repair";
import { valueSourceDigest } from "./value-review";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { consumeWorkUnitHistory } from "./value-work-unit-consumption";
import {
  type WorkUnitRecord,
  workUnitIdentity,
  workUnitSourceBindings,
} from "./value-work-unit-journal";

function fixture() {
  const original = makeOriginal(),
    accepted = makeOriginal();
  original.evidence.pull.merged_at = null;
  original.evidence.pull.merge_commit_sha = null;
  original.evidence.mergeCommitEvidence = null;
  const patch = {
    filename: "format.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+fixed",
    blob_url: null,
  };
  const before = commit("4".repeat(40));
  before.parents = [{ sha: original.evidence.pull.head.sha }];
  original.evidence.commits.push(before);
  original.evidence.pull.head.sha = before.sha;
  original.evidence.pull.commits = 2;
  original.evidence.files.push(patch);
  original.evidence.pull.changed_files = 2;
  original.evidence.commitAttribution.push({
    sha: before.sha,
    actorNodeIds: ["U_author"],
    changedPaths: [patch.filename],
    files: [structuredClone(patch)],
    limitations: [],
  });
  const owner = { node_id: "U_owner", login: "owner", type: "User" };
  const repair = commit("5".repeat(40));
  repair.parents = [{ sha: original.evidence.commits[0].sha }];
  repair.author = { node_id: "U_repair", login: "repair", type: "User" };
  Object.assign(accepted.evidence.pull, {
    node_id: "PR_accepted",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    user: owner,
    merged_by: owner,
    head: { sha: repair.sha },
    merged_at: "2026-10-02T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    commits: 2,
    changed_files: 2,
    body: `Repair #1 at ${repair.sha}.`,
  });
  accepted.evidence.commits = [
    structuredClone(original.evidence.commits[0]),
    repair,
  ];
  accepted.evidence.files = structuredClone(original.evidence.files);
  accepted.evidence.commitAttribution = [
    structuredClone(original.evidence.commitAttribution[0]),
    {
      sha: repair.sha,
      actorNodeIds: ["U_repair"],
      changedPaths: [patch.filename],
      files: [structuredClone(patch)],
      limitations: [],
    },
  ];
  accepted.evidence.repairBodyEdit = {
    id: "PR_accepted",
    body: accepted.evidence.pull.body ?? "",
    headRefOid: repair.sha,
    mergedAt: accepted.evidence.pull.merged_at ?? "",
    updatedAt: accepted.evidence.pull.updated_at,
    lastEditedAt: "2026-10-02T09:00:00Z",
    editor: { id: owner.node_id, type: "User" },
    author: { id: owner.node_id, type: "User" },
  };
  original.evidence.relatedPullRequests = [
    {
      id: accepted.evidence.pull.node_id,
      number: 2,
      url: accepted.evidence.pull.html_url,
      repository: repository.id,
    },
  ];
  original.evidence.comments = [
    {
      node_id: "IC_accepted",
      html_url: `${original.evidence.pull.html_url}#issuecomment-1`,
      body: "Your commits are carried over unchanged, with authorship, in #2.",
      user: owner,
      created_at: "2026-10-02T11:00:00Z",
      updated_at: "2026-10-02T11:00:00Z",
    },
  ];
  return { original, accepted, repair };
}

test("authenticated copied repair preserves the claim and ordinary accepted primary", async () => {
  const { original, accepted, repair } = fixture();
  const proof = retainedRepair(
    original,
    accepted,
    repair.sha,
    original.evidence.pull.head.sha,
    "format.ts",
  );
  expect(proof).not.toBeNull();
  expect(proof?.reference.sourceDigests[original.evidence.pull.node_id]).toBe(
    await valueSourceDigest(original.evidence, original.policy),
  );
  expect(proof?.reference.sourceDigests[accepted.evidence.pull.node_id]).toBe(
    await valueSourceDigest(accepted.evidence, accepted.policy),
  );
  const evidence = await prepareWorkUnitEvidence(
    [original, accepted],
    [repository],
  );
  expect(evidence.limitations).toEqual([]);
  const claim = evidence.claims.find((item) => item.path === "format.ts");
  if (!claim) throw Error("Missing repair claim");
  expect(claim.commitSha).toBe(original.evidence.pull.head.sha);
  expect(claim.retainedCopy?.repair).toEqual(proof ?? undefined);
  expect(workUnitCreditActorIds(evidence, claim)).toEqual(["U_repair"]);
});

for (const invalid of [
  "editor",
  "head",
  "body",
  "author",
  "ancestor",
  "missing",
  "cycle",
  "post-merge",
  "wrong-repository",
  "source-count",
  "disconnected",
  "copy-path",
  "copy-bytes",
  "identity",
] as const)
  test(`copied repair refuses ${invalid}`, () => {
    const { original, accepted, repair } = fixture();
    const body = accepted.evidence.repairBodyEdit;
    if (!body) throw Error("Missing body metadata");
    if (invalid === "editor" && body.editor) body.editor.id = "U_wrong";
    if (invalid === "head") body.headRefOid = "9".repeat(40);
    if (invalid === "body") body.body = "Changed";
    if (invalid === "author")
      original.evidence.commits[1].author = repair.author;
    if (invalid === "ancestor") repair.parents = [{ sha: "9".repeat(40) }];
    if (invalid === "missing") delete accepted.evidence.repairBodyEdit;
    if (invalid === "cycle") repair.parents = [{ sha: repair.sha }];
    if (invalid === "post-merge") body.lastEditedAt = "2026-10-02T10:00:01Z";
    if (invalid === "wrong-repository")
      accepted.evidence.repositoryDatabaseId++;
    if (invalid === "source-count") original.evidence.pull.commits++;
    if (invalid === "disconnected") {
      const extra = commit("6".repeat(40));
      accepted.evidence.commits.push(extra);
      accepted.evidence.pull.commits++;
    }
    const copiedFile = accepted.evidence.commitAttribution[1].files?.[0];
    if (!copiedFile) throw Error("Missing copy file");
    if (invalid === "copy-path") copiedFile.filename = "unrelated.ts";
    if (invalid === "copy-bytes")
      copiedFile.patch = "@@ -0,0 +1 @@\n+different";
    if (invalid === "identity")
      accepted.evidence.commits[0].author = {
        node_id: "U_other",
        login: "other",
        type: "User",
      };
    expect(
      retainedRepair(
        original,
        accepted,
        repair.sha,
        original.evidence.pull.head.sha,
        "format.ts",
      ),
    ).toBeNull();
  });

test("November keeps accepted primary", async () => {
  const { original, accepted } = fixture();
  accepted.evidence.pull.merged_at = "2026-11-02T10:00:00Z";
  accepted.evidence.pull.updated_at = accepted.evidence.pull.merged_at;
  original.evidence.comments[0].created_at = "2026-11-02T11:00:00Z";
  original.evidence.comments[0].updated_at = "2026-11-02T11:00:00Z";
  const m = accepted.evidence.repairBodyEdit;
  if (!m) throw Error("metadata");
  m.mergedAt = accepted.evidence.pull.merged_at;
  m.updatedAt = accepted.evidence.pull.updated_at;
  m.lastEditedAt = "2026-11-02T09:00:00Z";
  const e = await prepareWorkUnitEvidence([original, accepted], [repository]);
  const c = e.claims.find((c) => c.path === "format.ts");
  if (!c) throw Error("claim");
  expect(e.limitations).toEqual([]);
  expect(workUnitCreditActorIds(e, c)).toEqual(["U_repair"]);
});

for (const changed of [false, true])
  test(`collector body metadata changed=${changed}`, async () => {
    const { accepted } = fixture();
    const e = accepted.evidence,
      r = `/repos/${repository.id}`;
    e.mergeCommitEvidence = {
      sha: e.pull.merge_commit_sha ?? "",
      html_url: "https://example.invalid",
      parents: [{ sha: e.pull.base.sha }, { sha: e.pull.head.sha }],
      stats: { additions: 2, deletions: 0, total: 2 },
      files: e.files,
    };
    const values = new Map<string, unknown>([
      [r, { id: 42, node_id: repository.expectedNodeId }],
      [`${r}/pulls/2`, e.pull],
      [`${r}/pulls/2/files?per_page=100&page=1`, e.files],
      [`${r}/pulls/2/commits?per_page=100&page=1`, e.commits],
      [
        `${r}/commits/${e.pull.merge_commit_sha}?per_page=100&page=1`,
        e.mergeCommitEvidence,
      ],
    ]);
    for (const c of e.commits)
      values.set(`${r}/commits/${c.sha}?per_page=100&page=1`, {
        ...c,
        stats: { additions: 1, deletions: 0, total: 1 },
        files: e.commitAttribution.find((a) => a.sha === c.sha)?.files,
      });
    for (const path of [
      "pulls/2/reviews",
      "pulls/2/comments",
      "issues/2/comments",
    ])
      values.set(`${r}/${path}?per_page=100&page=1`, []);
    let calls = 0;
    const out = await collectValueEvidence(
      {
        async get<T>(path: string) {
          return structuredClone(values.get(path) ?? null) as T | null;
        },
        async graphql<T>(q: string) {
          if (q.includes("SlopRetainedRepairBody")) {
            calls++;
            const b = e.repairBodyEdit;
            return {
              repository: {
                pullRequest: {
                  ...b,
                  body: changed ? "changed" : b?.body,
                  editor: { id: "U_owner", __typename: "User" },
                  author: { id: "U_owner", __typename: "User" },
                },
              },
            } as T;
          }
          return {
            repository: {
              pullRequest: {
                id: e.pull.node_id,
                timelineItems: {
                  nodes: [
                    {
                      source: {
                        __typename: "PullRequest",
                        id: "PR_original",
                        number: 1,
                        url: `https://github.com/${repository.id}/pull/1`,
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
      },
      repository.id,
      2,
      repository,
    );
    expect(calls).toBe(1);
    if (changed) {
      expect(out.repairBodyEdit).toBeUndefined();
      expect(out.limitations).toContain(
        "Retained repair body changed during collection",
      );
    } else expect(out.repairBodyEdit).toEqual(e.repairBodyEdit);
  });

test("a mixed repair group replays with unrelated supplemental metadata and exact repair evidence", async () => {
  const { original, accepted } = fixture();
  const other = makeOriginal();
  other.evidence.pull.node_id = "PR_unrelated";
  other.evidence.pull.number = 3;
  other.evidence.pull.html_url = `https://github.com/${repository.id}/pull/3`;
  other.evidence.pull.head.sha = "8".repeat(40);
  other.evidence.commits[0].sha = other.evidence.pull.head.sha;
  other.evidence.commits[0].parents = [{ sha: "7".repeat(40) }];
  other.evidence.commitAttribution[0].sha = other.evidence.pull.head.sha;
  other.evidence.evidenceUrls = [other.evidence.pull.html_url];
  const sources = [original, accepted, other];
  const evidence = await prepareWorkUnitEvidence(sources, [repository]);
  expect(evidence.limitations).toEqual([]);
  expect(evidence.claims.some((claim) => claim.retainedCopy?.repair)).toBe(
    true,
  );
  const assessment: ValueAssessment = {
    status: "assessed",
    tier: "micro",
    rationale: "Synthetic source identity boundary.",
    dimensions: {
      alignment: "Synthetic boundary.",
      impact: "Synthetic boundary.",
      complexity: "Synthetic boundary.",
      verification: "Synthetic boundary.",
      maintenance: "Synthetic boundary.",
      overlap: "Synthetic boundary.",
    },
    evidenceUrls: [original.evidence.pull.html_url],
    relatedPullRequests: [],
    limitations: [],
    reviews: [],
  };
  const unit = {
    claimIds: evidence.claims.map((claim) => claim.id),
    assessment,
  };
  const record: WorkUnitRecord = {
    schemaVersion: "slop-work-unit-record:v1",
    projectId: repository.projectId,
    sourceDigest: evidence.sourceDigest,
    sources: workUnitSourceBindings(evidence, [repository]),
    claims: evidence.claims,
    units: [{ ...unit, workUnitId: await workUnitIdentity(unit) }],
    rubricVersion: VALUE_RUBRIC_VERSION,
    producerRevision: "a".repeat(40),
    assessedAt: "2026-11-01T00:00:00Z",
    supersedes: [],
    legacyPredecessors: [],
    revisionReason: null,
    model: {
      provider: "surplus",
      requested: "gpt-6.1-sol",
      reported: "gpt-6.1-sol",
    },
  };
  const text = JSON.stringify(record);
  const row = {
    sequence: 1,
    record_digest: await sha256Hex(text),
    record_json: text,
    recorded_at: record.assessedAt,
  };
  const history = {
    history: [row],
    throughSequence: 1,
    current: { row, record },
  };
  other.evidence.repairBodyEdit = {
    ...structuredClone(
      accepted.evidence.repairBodyEdit as NonNullable<
        typeof accepted.evidence.repairBodyEdit
      >,
    ),
    id: other.evidence.pull.node_id,
  };
  const raw = JSON.stringify(sources);
  const read = () =>
    consumeWorkUnitHistory(
      history,
      sources,
      new Map(sources.map((source) => [source.evidence.pull.node_id, null])),
      [repository],
    );
  const replay = await read();
  expect(replay.status).toBe("assessed");
  expect(JSON.stringify(sources)).toBe(raw);
  const metadata = accepted.evidence.repairBodyEdit;
  if (!metadata) throw Error("Missing fixture metadata");
  metadata.author.id = "U_forged";
  expect((await read()).status).not.toBe("assessed");
});
