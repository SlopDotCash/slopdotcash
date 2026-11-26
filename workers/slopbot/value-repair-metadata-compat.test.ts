import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  VALUE_RUBRIC_VERSION,
  type ValueAssessment,
} from "../../src/lib/value-assessment";
import { makeOriginal, repository } from "../../tests/value-promotion-fixture";
import { readValueDecisionFromHistory } from "./value-consumption";
import { valueSourceDigest } from "./value-review";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { consumeWorkUnitHistory } from "./value-work-unit-consumption";
import {
  type WorkUnitRecord,
  workUnitIdentity,
  workUnitSourceBindings,
} from "./value-work-unit-journal";

const at = "2026-11-01T00:00:00.000Z";
const assessment = (): ValueAssessment => ({
  status: "assessed" as const,
  tier: "micro" as const,
  rationale: "Synthetic accepted repair for source-identity testing.",
  dimensions: {
    alignment: "Synthetic source boundary.",
    impact: "Synthetic source boundary.",
    complexity: "Synthetic source boundary.",
    verification: "Synthetic source boundary.",
    maintenance: "Synthetic source boundary.",
    overlap: "Synthetic source boundary.",
  },
  evidenceUrls: ["https://github.com/example/promotion/pull/1"],
  relatedPullRequests: [],
  limitations: [],
  reviews: [],
});
function addMetadata(source: ReturnType<typeof makeOriginal>) {
  const pull = source.evidence.pull;
  source.evidence.repairBodyEdit = {
    id: pull.node_id,
    body: pull.body ?? "",
    headRefOid: pull.head.sha,
    mergedAt: pull.merged_at ?? at,
    updatedAt: pull.updated_at,
    lastEditedAt: "2026-10-01T09:30:00Z",
    editor: { id: pull.user.node_id, type: "User" },
    author: { id: pull.user.node_id, type: "User" },
  };
}
async function jointFixture(metadata = false, extraSource = false) {
  const source = makeOriginal();
  if (metadata) addMetadata(source);
  const sources = [source];
  if (extraSource) {
    const other = makeOriginal();
    other.evidence.pull.node_id = "PR_other";
    other.evidence.pull.number = 2;
    other.evidence.pull.html_url = `https://github.com/${repository.id}/pull/2`;
    other.evidence.pull.head.sha = "8".repeat(40);
    other.evidence.commits[0].sha = other.evidence.pull.head.sha;
    other.evidence.commitAttribution[0].sha = other.evidence.pull.head.sha;
    other.evidence.commits[0].parents = [{ sha: "7".repeat(40) }];
    other.evidence.evidenceUrls = [other.evidence.pull.html_url];
    sources.push(other);
  }
  const evidence = await prepareWorkUnitEvidence(sources, [repository]);
  const unit = {
    claimIds: evidence.claims.map((c) => c.id),
    assessment: assessment(),
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
    assessedAt: at,
    supersedes: [],
    legacyPredecessors: [],
    revisionReason: null,
    model: {
      provider: "surplus",
      requested: "gpt-6.1-sol",
      reported: "gpt-6.1-sol",
    },
  };
  const text = JSON.stringify(record),
    row = {
      sequence: 1,
      record_digest: await sha256Hex(text),
      record_json: text,
      recorded_at: at,
    };
  const history = {
    history: [row],
    throughSequence: 1,
    current: { row, record },
  };
  return { source, sources, record, history };
}
async function consume(input: Awaited<ReturnType<typeof jointFixture>>) {
  return consumeWorkUnitHistory(
    input.history,
    input.sources,
    new Map(
      input.sources.map((source) => [source.evidence.pull.node_id, null]),
    ),
    [repository],
  );
}
test("old joint source keeps its exact record when only supplemental repair metadata is collected", async () => {
  const input = await jointFixture();
  addMetadata(input.source);
  const before = JSON.stringify(input.source);
  const result = await consume(input);
  expect(result.status).toBe("assessed");
  if (!("record" in result)) throw new Error("Expected retained record");
  expect(result.record).toBe(input.record);
  expect(JSON.stringify(input.source)).toBe(before);
});
for (const field of [
  "body",
  "author",
  "head",
  "file",
  "review",
  "binding",
] as const) {
  test(`old joint metadata compatibility refuses changed ${field}`, async () => {
    const input = await jointFixture();
    addMetadata(input.source);
    if (field === "body")
      input.source.evidence.pull.body = "Changed after acceptance";
    if (field === "author") input.source.evidence.pull.user.node_id = "U_other";
    if (field === "head") input.source.evidence.pull.head.sha = "9".repeat(40);
    if (field === "file") {
      const file = input.source.evidence.commitAttribution[0].files?.[0];
      if (!file) throw new Error("Missing fixture file");
      file.patch = "@@ -0,0 +1 @@\n+changed";
    }
    if (field === "review")
      input.source.evidence.comments.push({
        node_id: "IC_new",
        html_url: "https://github.com/example/promotion/pull/1#issuecomment-1",
        body: "Changed discussion",
        user: input.source.evidence.pull.user,
        created_at: at,
        updated_at: at,
      });
    if (field === "binding") input.record.sources[0].headSha = "9".repeat(40);
    expect((await consume(input)).status).not.toBe("assessed");
  });
}
for (const field of ["editor", "time", "missing"] as const) {
  test(`new metadata-bound joint record refuses ${field}`, async () => {
    const input = await jointFixture(true);
    const metadata = input.source.evidence.repairBodyEdit;
    if (!metadata?.editor) throw new Error("Missing fixture metadata");
    if (field === "editor") metadata.editor.id = "U_other";
    if (field === "time") metadata.lastEditedAt = "2026-10-02T00:00:00Z";
    if (field === "missing") delete input.source.evidence.repairBodyEdit;
    expect((await consume(input)).status).toBe("stale");
  });
}
test("ordinary historical source permits only the supplemental metadata difference", async () => {
  const source = makeOriginal(),
    evidence = source.evidence;
  const record = {
    schemaVersion: "slop-value-record:v1",
    projectId: repository.projectId,
    repository: repository.id,
    repositoryNodeId: evidence.repositoryNodeId,
    repositoryDatabaseId: evidence.repositoryDatabaseId,
    pullRequestNodeId: evidence.pull.node_id,
    pullRequestNumber: 1,
    headSha: evidence.pull.head.sha,
    mergeSha: evidence.pull.merge_commit_sha,
    occurredAt: evidence.pull.merged_at,
    policySha: source.policy.sha,
    sourceDigest: await valueSourceDigest(evidence, source.policy),
    rubricVersion: VALUE_RUBRIC_VERSION,
    producerRevision: "a".repeat(40),
    assessedAt: at,
    supersedes: null,
    revisionReason: null,
    model: {
      provider: "surplus",
      requested: "gpt-6.1-sol",
      reported: "gpt-6.1-sol",
    },
    assessment: assessment(),
  };
  const text = JSON.stringify(record),
    row = {
      sequence: 1,
      record_digest: await sha256Hex(text),
      record_json: text,
      recorded_at: at,
    };
  addMetadata(source);
  const before = JSON.stringify(evidence);
  const read = () =>
    readValueDecisionFromHistory(
      async () => ({ records: [row], nextAfter: null }),
      evidence,
      source.policy,
      undefined,
      [repository],
    );
  expect((await read()).status).toBe("assessed");
  expect(JSON.stringify(evidence)).toBe(before);
  evidence.pull.body = "Changed source";
  expect((await read()).status).toBe("stale");
});

test("an altered repair claim cannot match the exact retained source shape", async () => {
  const input = await jointFixture();
  const original = structuredClone(input.record.claims[0]);
  input.record.claims[0] = {
    ...original,
    retainedCopy: {
      acceptancePullRequestId: input.source.evidence.pull.node_id,
      acceptedCommitSha: original.commitSha,
      preexistingCommitShas: [],
      repair: {} as NonNullable<
        NonNullable<typeof original.retainedCopy>["repair"]
      >,
    },
  };
  addMetadata(input.source);
  const raw = JSON.stringify(input.source);
  expect((await consume(input)).status).toBe("stale");
  expect(JSON.stringify(input.source)).toBe(raw);
});

test("mixed source metadata retains the bound source and restores only the old unbound shape", async () => {
  const input = await jointFixture(true, true);
  const other = input.sources[1];
  addMetadata(other);
  const raw = JSON.stringify(input.sources);
  const result = await consume(input);
  expect(result.status).toBe("assessed");
  if (!("evidence" in result)) throw Error("Expected assessed evidence");
  expect(result.evidence.sources[0].evidence.repairBodyEdit).toEqual(
    input.source.evidence.repairBodyEdit,
  );
  expect(result.evidence.sources[1].evidence.repairBodyEdit).toBeUndefined();
  expect(JSON.stringify(input.sources)).toBe(raw);
  const metadata = input.source.evidence.repairBodyEdit;
  if (!metadata?.editor) throw Error("Missing bound metadata");
  metadata.editor.id = "U_other";
  expect((await consume(input)).status).toBe("stale");
});

test("mixed metadata compatibility refuses source and claim substitution", async () => {
  for (const field of ["body", "binding", "claim", "missing-bound"] as const) {
    const input = await jointFixture(true, true);
    addMetadata(input.sources[1]);
    if (field === "body") input.sources[1].evidence.pull.body = "changed";
    if (field === "binding")
      input.record.sources[1].sourceDigest = "f".repeat(64);
    if (field === "claim") input.record.claims[0].path = "foreign.ts";
    if (field === "missing-bound") delete input.source.evidence.repairBodyEdit;
    expect((await consume(input)).status).not.toBe("assessed");
  }
});
