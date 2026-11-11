// Stored unresolved assessments exercise history consumption, not model quality.
import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  VALUE_DIMENSIONS,
  VALUE_RUBRIC_VERSION,
} from "../../src/lib/value-assessment";
import { fixture, policy, repository } from "../../tests/value-binary-fixture";
import { type CallRecord, TRIAGE_ROUTE } from "./models";
import { readValueDecisionFromHistory } from "./value-consumption";
import { collectValueEvidence } from "./value-evidence";
import { valueProducerIdentity } from "./value-producer";
import { valueSourceDigest } from "./value-review";

const at = "2026-11-01T00:00:00.000Z";

test("old Surplus journal identities remain readable after the active route changes", async () => {
  const source = fixture({ direct: true, textOnly: true });
  const evidence = await collectValueEvidence(
    source.client,
    repository.id,
    1,
    repository,
  );
  for (const model of ["claude-opus-5.5", "gpt-6.1-sol"]) {
    const record = {
      schemaVersion: "slop-value-record:v1",
      projectId: repository.projectId,
      repository: repository.id,
      repositoryNodeId: evidence.repositoryNodeId,
      repositoryDatabaseId: evidence.repositoryDatabaseId,
      pullRequestNodeId: evidence.pull.node_id,
      pullRequestNumber: evidence.pull.number,
      headSha: evidence.pull.head.sha,
      mergeSha: evidence.pull.merge_commit_sha,
      occurredAt: evidence.pull.merged_at ?? evidence.pull.closed_at,
      policySha: policy.sha,
      sourceDigest: await valueSourceDigest(evidence, policy),
      rubricVersion: VALUE_RUBRIC_VERSION,
      producerRevision: "a".repeat(40),
      assessedAt: at,
      supersedes: null,
      revisionReason: null,
      model: { provider: "surplus", requested: model, reported: model },
      assessment: {
        status: "unresolved",
        tier: null,
        rationale:
          "Retained unresolved storage fixture; no inference was requested.",
        dimensions: Object.fromEntries(
          VALUE_DIMENSIONS.map((dimension) => [dimension, "Not assessed."]),
        ),
        evidenceUrls: [evidence.pull.html_url],
        relatedPullRequests: [],
        limitations: ["No model quality claim."],
        reviews: [],
      },
    };
    const recordJson = JSON.stringify(record);
    const result = await readValueDecisionFromHistory(
      async () => ({
        records: [
          {
            sequence: 1,
            record_digest: await sha256Hex(recordJson),
            record_json: recordJson,
            recorded_at: at,
          },
        ],
        nextAfter: null,
      }),
      evidence,
      policy,
      undefined,
      [repository],
    );
    expect(result.status).toBe("unresolved");
    expect(result.history[0].record_json).toBe(recordJson);
    const historicalCall: CallRecord = {
      routeStep: 1,
      provider: "surplus",
      requestedModel: model,
      servedModel: model,
      priceKey: `surplus/${model}`,
      outcome: "ok",
      failure: null,
      usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
      providerCostMicroUsd: null,
      providerRequestId: null,
    };
    expect(() => valueProducerIdentity(historicalCall, at)).toThrow(
      "validated model identity",
    );
    expect(
      valueProducerIdentity(
        {
          ...historicalCall,
          ...{
            provider: TRIAGE_ROUTE[0].provider,
            requestedModel: TRIAGE_ROUTE[0].model,
            servedModel: TRIAGE_ROUTE[0].model,
            priceKey: TRIAGE_ROUTE[0].priceKey,
          },
        },
        at,
      ),
    ).toEqual({
      provider: "orbio",
      requested: TRIAGE_ROUTE[0].model,
      reported: TRIAGE_ROUTE[0].model,
    });
  }
});
