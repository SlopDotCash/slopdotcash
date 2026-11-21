/**
 * A maintainer slop-score ratification must bind the merge credit of the
 * outcome it ratifies wherever the record was collected. Production
 * collection (scripts/generate-leaderboard.ts) hydrates a merged pull
 * request two ways: full detail inside the author's five-per-month detail
 * cap, or review-only (comments included) when the pull request carries a
 * formal review beyond that cap. protocol/scoring-v2.md bounds the cap to
 * hydration and author-detail bonuses ("Review-only hydration never enables
 * author-detail bonuses"); it is not a ratification bound. These tests drive
 * the real snapshot builder and the Points journal with the shared fixture
 * in both placements.
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubTextSource,
  LeaderboardInput,
  MergedPullRequestReviewRecord,
} from "../src/lib/leaderboard-types";
import {
  applyPointsSnapshot,
  POINTS_RULE,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import {
  type ProjectRunReceipt,
  runReceiptMarker,
  runReceiptSigningPayload,
} from "../src/lib/run-receipts";
import {
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { deviceKeyId } from "./run-receipt-crypto";

const GENERATED_AT = "2026-11-20T00:00:00.000Z";
const GENERATED_AT_2 = "2026-11-21T00:00:00.000Z";
const SYSTEM_NOW = new Date("2026-12-02T00:00:00.000Z");
const HEAD = "7".repeat(40);
const WORK_UNIT = "wu_asi_pr7_ratification";

const MAINTAINER = {
  id: "MDQ6VXNlcjQ0",
  login: "maintainer",
  url: "https://github.com/maintainer",
  avatarUrl: "https://avatars.githubusercontent.com/u/44?v=4",
  kind: "User",
} as const;
const REVIEWER = {
  id: "MDQ6VXNlcjQ1",
  login: "reviewer",
  url: "https://github.com/reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/45?v=4",
  kind: "User",
} as const;

const PROVIDER = "anthropic";
const MODEL = "claude-sonnet-4-5-20250929";
const CLIENT = "claude-code";
const SKILL_REVISION = `slopdotcash/slop@${"a".repeat(40)}:skills/contribute-to-asi`;
const RUN_ID = "run_0123456789ABCDEFGHJKMNPQRS";

/** A terminal signed run receipt for the proposal review, as production
 * ingestion verifies it (schema v2 under the 2026-08-20 policy binding). */
function buildReceipt(): ProjectRunReceipt {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const receipt: ProjectRunReceipt = {
    schemaVersion: "2",
    runId: RUN_ID,
    projectId: "asi",
    repositoryId: "elizaOS/asi",
    startedAt: "2026-10-29T10:00:00.000Z",
    completedAt: "2026-10-29T11:00:00.000Z",
    provider: PROVIDER,
    model: MODEL,
    client: CLIENT,
    skillRevision: SKILL_REVISION,
    skillSha256: "b".repeat(64),
    policyAcknowledgement: {
      policyRevision: "2026-08-20.1",
      licenseSha256:
        "4c8d5abe876de66bf1cfbb2e9f2c486b41e53602d072628d2de4630957202a61",
      inboundTermsSha256:
        "3302f9aa0da588c1c2f06e73af939af154466047346071b268e3b71bf6bb3443",
      prizeRulesSha256: null,
      acknowledgedAt: "2026-10-29T10:30:00.000Z",
    },
    usage: {
      source: "none",
      confidence: "unavailable",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costMicroUsd: "0",
      sessionCount: 0,
    },
    trajectorySha256: null,
    traceUpload: null,
    signatureAlgorithm: "ed25519",
    devicePublicKey: Buffer.from(der).toString("base64url"),
    deviceKeyId: deviceKeyId(new Uint8Array(der)),
    deviceSignature: "AAAA",
  };
  receipt.deviceSignature = sign(
    null,
    Buffer.from(runReceiptSigningPayload(receipt), "utf8"),
    privateKey,
  ).toString("base64url");
  return receipt;
}

const MARKER_JSON = JSON.stringify(runReceiptMarker(buildReceipt()));

const REVIEW_RECORD = {
  schemaVersion: "2",
  projectId: "asi",
  artifactUrl: "https://github.com/SlopDotCash/asi/pull/7",
  headSha: HEAD,
  provider: PROVIDER,
  model: MODEL,
  client: CLIENT,
  runId: RUN_ID,
  traceSha256: null,
  recommendation: "accept",
  reproduced: true,
  securityRisk: "none",
  duplicateRisk: "none",
  splitRisk: "none",
  effortBand: "medium",
  complexity: "moderate",
  impact: "meaningful",
  reviewLoad: "deep",
  recommendedTier: "medium",
  recommendedThirds: 9,
  workUnitId: WORK_UNIT,
  confidenceBasisPoints: 8000,
  valueRationale: "The change fixes the defect with a focused regression test.",
  usefulArtifacts: [],
  commands: ["bun test"],
  evidenceUrls: [],
  summary: "Reproduced the defect and verified the fix end to end.",
};

const REVIEW_ID = "PRR_probe_review";
const PROPOSAL_REVIEW = {
  id: REVIEW_ID,
  body: [
    "I reproduced the reported defect and verified the correction.",
    "",
    "```slop-review",
    JSON.stringify(REVIEW_RECORD),
    "```",
    "",
    `AI provider/model: ${PROVIDER} / ${MODEL}`,
    `Client / agent tooling: ${CLIENT}`,
    `Contribution skill revision: ${SKILL_REVISION}`,
    "Attribution status: self-reported",
    "— [review-lane]",
    `<!-- slop-contribution-attribution:v1 ${MARKER_JSON} -->`,
  ].join("\n"),
  state: "APPROVED",
  submittedAt: "2026-10-29T11:30:00.000Z",
  url: "https://github.com/SlopDotCash/asi/pull/7#pullrequestreview-1",
  author: REVIEWER,
  inlineCommentCount: 0,
  commitId: HEAD,
};

function ratificationComment(
  id: string,
  urlNumber: number,
  tier: string,
  scoreThirds: number,
  supersedes: string | null,
  createdAt: string,
): GitHubTextSource {
  const record = {
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId: "asi",
    pullRequestNodeId: "PR_october",
    headSha: HEAD,
    workUnitId: WORK_UNIT,
    tier,
    scoreThirds,
    proposalReviewNodeIds: [REVIEW_ID],
    coRatifierNodeIds: [],
    reason: "Maintainer assessment of the accepted outcome for this unit.",
    supersedes,
  };
  return {
    id,
    artifactId: "PR_october",
    kind: "comment",
    body: [
      "Recording the maintainer assessment for this accepted outcome.",
      "",
      "```slop-score",
      JSON.stringify(record),
      "```",
    ].join("\n"),
    url: `https://github.com/SlopDotCash/asi/pull/7#issuecomment-${urlNumber}`,
    createdAt,
    updatedAt: createdAt,
    author: MAINTAINER,
    authorAssociation: "OWNER",
  };
}

interface PlacementOptions {
  placement: "detail" | "reviewed";
  comments: GitHubTextSource[];
  generatedAt?: string;
}

/**
 * The October fixture merge with the proposal review attached. "detail"
 * keeps it inside the author's detail cap; "reviewed" moves it to the
 * review-only hydration input and out of the cap, exactly as production
 * collection places a reviewed merge beyond the cap.
 */
function placementInput(options: PlacementOptions): LeaderboardInput {
  const input = penaltyScoreInput([], options.generatedAt ?? GENERATED_AT);
  const october = input.mergedPullRequests.find(
    (record) => record.id === "PR_october",
  );
  if (!october) throw new Error("fixture PR_october missing");
  october.reviews = [PROPOSAL_REVIEW];
  october.comments = options.comments;
  if (options.placement === "reviewed") {
    input.mergedPullRequests = input.mergedPullRequests.filter(
      (record) => record.id !== "PR_october",
    );
    const reviewRecord: MergedPullRequestReviewRecord = {
      id: october.id,
      number: october.number,
      title: october.title,
      url: october.url,
      body: october.body,
      createdAt: october.createdAt,
      updatedAt: october.updatedAt,
      lastEditedAt: october.lastEditedAt,
      editor: october.editor,
      mergedAt: october.mergedAt,
      headRefOid: october.headRefOid,
      author: october.author,
      comments: october.comments,
      reviews: october.reviews,
    };
    input.reviewedMergedPullRequests = [reviewRecord];
    input.detailEligibleMergedPullRequestIds =
      input.detailEligibleMergedPullRequestIds.filter(
        (id) => id !== "PR_october",
      );
  }
  return input;
}

function octoberMergeEvent(
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
) {
  return snapshot.ledger.find(
    (event) =>
      event.category === "merged-pull-request" &&
      event.source?.id === "PR_october" &&
      event.actor?.id === PENALIZED_AUTHOR.id,
  );
}

const MEDIUM_RATIFICATION = () =>
  ratificationComment(
    "IC_ratify_1",
    1001,
    "medium",
    9,
    null,
    "2026-11-15T00:00:00.000Z",
  );

beforeAll(() => {
  setSystemTime(SYSTEM_NOW);
});
afterEach(() => {
  setSystemTime(SYSTEM_NOW);
});

describe("maintainer ratification arrival", () => {
  test("an unratified legacy merge keeps provisional small credit", () => {
    const snapshot = createLeaderboardSnapshot(
      placementInput({ placement: "detail", comments: [] }),
    );
    const event = octoberMergeEvent(snapshot);
    expect(event?.scoreThirds).toBe(3);
    expect(event?.reason).toContain("provisional");
  });

  test("a ratified legacy merge inside the detail cap lands at the ratified tier and supersedes in the Points journal", () => {
    const before = createLeaderboardSnapshot(
      placementInput({ placement: "detail", comments: [] }),
    );
    const after = createLeaderboardSnapshot(
      placementInput({
        placement: "detail",
        comments: [MEDIUM_RATIFICATION()],
        generatedAt: GENERATED_AT_2,
      }),
    );
    const event = octoberMergeEvent(after);
    expect(event?.scoreThirds).toBe(9);
    expect(event?.reason).toContain("Maintainer-ratified");

    const empty: PointsJournal = {
      schemaVersion: "1",
      ruleVersion: POINTS_RULE,
      generatedAt: GENERATED_AT,
      coverage: [],
      revisions: [],
    };
    let journal = applyPointsSnapshot(
      empty,
      before,
      "a".repeat(64),
      GENERATED_AT,
    );
    journal = applyPointsSnapshot(
      journal,
      after,
      "b".repeat(64),
      GENERATED_AT_2,
    );
    // The October merge award is superseded in place: 30 journal units
    // (3 thirds) before the ratification, 90 (9 thirds) after — never both.
    const octoberAmounts = journal.revisions
      .filter(
        (revision) =>
          revision.award.actor.id === PENALIZED_AUTHOR.id &&
          revision.award.category === "merged-pull-request" &&
          revision.award.occurredAt.startsWith("2026-10-29"),
      )
      .map((revision) => revision.award.amount);
    expect(octoberAmounts).toEqual([30, 90]);
    const member = pointMembers(journal, "2026-10", "asi").find(
      (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
    );
    expect(member?.monthly).toBe(90);
  });

  test("the same ratification binds a reviewed merge beyond the detail cap", () => {
    const snapshot = createLeaderboardSnapshot(
      placementInput({
        placement: "reviewed",
        comments: [MEDIUM_RATIFICATION()],
      }),
    );
    // The record is collected and honored for the ratifier's own fallback
    // review award in both placements.
    const ratifierAward = snapshot.ledger.find(
      (entry) => entry.id === "PR_october:ratifier:IC_ratify_1",
    );
    expect(ratifierAward?.scoreThirds).toBe(1);
    // And it raises the merge credit it ratifies.
    const event = octoberMergeEvent(snapshot);
    expect(event?.scoreThirds).toBe(9);
    expect(event?.reason).toContain("Maintainer-ratified");
  });

  test("a superseding ratification replaces the earlier one", () => {
    const snapshot = createLeaderboardSnapshot(
      placementInput({
        placement: "detail",
        comments: [
          MEDIUM_RATIFICATION(),
          ratificationComment(
            "IC_ratify_2",
            1002,
            "large",
            24,
            "IC_ratify_1",
            "2026-11-16T00:00:00.000Z",
          ),
        ],
      }),
    );
    const event = octoberMergeEvent(snapshot);
    expect(event?.scoreThirds).toBe(24);
    expect(event?.reason).toContain("Maintainer-ratified large");
  });

  test("a broken supersede chain fails closed", () => {
    expect(() =>
      createLeaderboardSnapshot(
        placementInput({
          placement: "detail",
          comments: [
            MEDIUM_RATIFICATION(),
            ratificationComment(
              "IC_ratify_2",
              1002,
              "large",
              24,
              "IC_missing",
              "2026-11-16T00:00:00.000Z",
            ),
          ],
        }),
      ),
    ).toThrow();
  });
});
