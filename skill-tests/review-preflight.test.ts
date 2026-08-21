/** Tests the Eliza review compatibility classifier with deterministic live-path fixtures. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assessReviewCompatibility } from "../skills/contribute-to-eliza/scripts/review-preflight.mjs";

const branchSha = "1".repeat(40);
const commitId = "65455082b87f12ddf5ea4a40e4e8734dbae9e961";
const configuration = JSON.parse(
  readFileSync(
    new URL(
      "../skills/contribute-to-eliza/review-compatibility.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const proofSkillRevision =
  "elizaOS/slopdotcash@1bde21d6d8229678f20bbd450f8e49f9fd95f989:skills/contribute-to-eliza";
const marker = {
  provider: "openai",
  model: "gpt-5.6-sol",
  client: "codex",
  skill_revision: proofSkillRevision,
  run: {
    schema_version: "1",
    run_id: "run_01M001JJ3EJEXAR11GKPE15MXM",
    project: "eliza",
    repository: "elizaOS/eliza",
    signature_algorithm: "ed25519",
    device_public_key: "public-key",
    device_signature: "signature",
  },
};

function fixture() {
  return {
    branchSha,
    policy:
      "Every review ends with <!-- eliza-computer-attribution:v1 {...} -->",
    proofReview: {
      id: 4936838769,
      commit_id: commitId,
      html_url:
        "https://github.com/elizaOS/eliza/pull/19560#pullrequestreview-4936838769",
      submitted_at: "2026-08-14T11:48:42Z",
      state: "CHANGES_REQUESTED",
      body: `Verified review\n<!-- slop-contribution-attribution:v1 ${JSON.stringify(marker)} -->`,
    },
    validator: "const marker = 'eliza-computer-attribution:v1';",
    automationFiles: [
      {
        path: ".github/workflows/pr.yaml",
        source:
          "on:\n  pull_request:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs",
      },
      {
        path: ".github/workflows/claude.yml",
        source: "on:\n  pull_request_review:\nsteps:\n  - run: echo unrelated",
      },
    ],
  };
}

describe("Eliza review compatibility preflight", () => {
  it("reports documentation drift without inventing a publishing blocker", () => {
    const result = assessReviewCompatibility(fixture());
    assert.equal(result.status, "supported-with-documentation-drift");
    assert.equal(result.safeToPublish, true);
    assert.equal(result.documentation, "legacy-only-drift");
    assert.equal(result.enforcement, "not-wired-for-reviews");
    assert.equal(result.forwardProof.valid, true);
  });

  it("blocks when a review-event workflow invokes the incompatible validator", () => {
    const input = fixture();
    input.automationFiles.push({
      path: ".github/workflows/review-policy.yml",
      source:
        "on:\n  pull_request_review:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs",
    });
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "blocked");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.enforcement, "incompatible");
    assert.deepEqual(result.enforcingWorkflows, [
      ".github/workflows/review-policy.yml",
    ]);
  });

  it("accepts explicit Slop-aware review enforcement", () => {
    const input = fixture();
    input.validator += "\nconst slop = 'slop-contribution-attribution:v1';";
    input.policy +=
      "\nSigned reviews may end with slop-contribution-attribution:v1.";
    input.automationFiles.push({
      path: ".github/workflows/review-policy.yml",
      source:
        "on:\n  pull_request_review:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs\n# slop-contribution-attribution:v1",
    });
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "supported");
    assert.equal(result.safeToPublish, true);
    assert.equal(result.documentation, "aligned");
    assert.equal(result.enforcement, "compatible");
  });

  it("traces review enforcement through reusable workflows and composite actions", () => {
    const input = fixture();
    input.automationFiles.push(
      {
        path: ".github/workflows/review-policy.yml",
        source:
          "on:\n  pull_request_review:\njobs:\n  policy:\n    uses: ./.github/workflows/reusable-policy.yml",
      },
      {
        path: ".github/workflows/reusable-policy.yml",
        source:
          "on:\n  workflow_call:\njobs:\n  policy:\n    steps:\n      - uses: ./.github/actions/review-policy",
      },
      {
        path: ".github/actions/review-policy/action.yml",
        source:
          "runs:\n  using: composite\n  steps:\n    - run: node scripts/check-agent-comment-attribution.mjs\n      shell: bash",
      },
    );
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "blocked");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.enforcement, "incompatible");
    assert.deepEqual(result.enforcingWorkflows, [
      ".github/workflows/review-policy.yml",
    ]);
  });

  it("accepts Slop-aware enforcement reached through local automation", () => {
    const input = fixture();
    input.validator += "\nconst slop = 'slop-contribution-attribution:v1';";
    input.policy +=
      "\nSigned reviews may end with slop-contribution-attribution:v1.";
    input.automationFiles.push(
      {
        path: ".github/workflows/review-policy.yml",
        source:
          "on:\n  pull_request_review:\njobs:\n  policy:\n    uses: ./.github/workflows/reusable-policy.yml",
      },
      {
        path: ".github/workflows/reusable-policy.yml",
        source:
          "on:\n  workflow_call:\njobs:\n  policy:\n    steps:\n      - uses: ./.github/actions/review-policy",
      },
      {
        path: ".github/actions/review-policy/action.yaml",
        source:
          "runs:\n  using: composite\n  steps:\n    - run: node scripts/check-agent-comment-attribution.mjs\n      shell: bash\n# slop-contribution-attribution:v1",
      },
    );
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "supported");
    assert.equal(result.safeToPublish, true);
    assert.equal(result.enforcement, "compatible");
  });

  it("fails closed when a review workflow references missing local automation", () => {
    const input = fixture();
    input.automationFiles.push({
      path: ".github/workflows/review-policy.yml",
      source:
        "on:\n  pull_request_review:\njobs:\n  policy:\n    uses: ./.github/workflows/missing.yml",
    });
    assert.throws(
      () => assessReviewCompatibility(input),
      /local automation target is missing/u,
    );
  });

  it("fails closed when the known proof loses its terminal marker", () => {
    const input = fixture();
    input.proofReview.body += "\ntrailing prose";
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "unknown");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.forwardProof.valid, false);
  });

  it("fails closed when the proof marker names a different skill revision", () => {
    const input = fixture();
    const mismatchedMarker = {
      ...marker,
      skill_revision: `elizaOS/slopdotcash@${"2".repeat(40)}:skills/contribute-to-eliza`,
    };
    input.proofReview.body = `Verified review\n<!-- slop-contribution-attribution:v1 ${JSON.stringify(mismatchedMarker)} -->`;
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "unknown");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.forwardProof.valid, false);
  });

  it("rejects an unregistered repository identity in proof configuration", () => {
    const invalidConfiguration = structuredClone(configuration);
    invalidConfiguration.forwardProof.skillRevision = `example/slopdotcash@${"2".repeat(40)}:skills/contribute-to-eliza`;
    assert.throws(
      () => assessReviewCompatibility(fixture(), invalidConfiguration),
      /forward proof has an invalid identity/u,
    );
  });

  it("rejects unbounded or malformed workflow inventories", () => {
    const input = fixture();
    input.automationFiles = Array.from({ length: 257 }, (_, index) => ({
      path: `.github/workflows/${index}.yml`,
      source: "on: pull_request",
    }));
    assert.throws(
      () => assessReviewCompatibility(input),
      /automation inventory is missing or unbounded/u,
    );
  });

  it("uses scoped Contents API inventory instead of a recursive repository tree", () => {
    const source = readFileSync(
      new URL(
        "../skills/contribute-to-eliza/scripts/review-preflight.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /recursive=1/u);
    assert.match(source, /contents\/\$\{canonicalRepositoryPath/u);
  });
});
