import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { IssueRecord } from "../src/lib/leaderboard-types";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

const SKILL_REVISION =
  "N/A - ordinary GitHub contribution without optional run evidence";

// The footer `run-receipt.mjs disclose --provider <p> --model <m> --client codex`
// prints. The generator accepts a model field that repeats the provider.
function footer(provider: string, model: string): string {
  return [
    "Made via @slopdotcash",
    `AI provider/model: ${provider} / ${model}`,
    "Client / agent tooling: codex",
    `Contribution skill revision: ${SKILL_REVISION}`,
    "Attribution status: self-reported",
    "— [contributor]",
    `<!-- slop-contribution-attribution:v1 ${JSON.stringify({ provider, model, client: "codex", skill_revision: SKILL_REVISION })} -->`,
  ].join("\n");
}

function openIssueWithComment(body: string): IssueRecord {
  return {
    id: "I_open",
    number: 100,
    title: "Fix the broken thing",
    url: "https://github.com/SlopDotCash/asi/issues/100",
    body: "A defect.",
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    closedAt: null,
    stateReason: null,
    author: PENALIZED_AUTHOR,
    assignees: [],
    labels: [],
    comments: [
      {
        id: "IC_row",
        artifactId: "I_open",
        kind: "comment",
        body,
        url: "https://github.com/SlopDotCash/asi/issues/100#issuecomment-1",
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
        author: PENALIZED_AUTHOR,
        authorAssociation: "NONE",
      },
    ],
    closedByPullRequests: [],
  };
}

function snapshotWith(model: string, place: "merged body" | "issue comment") {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  if (place === "merged body") {
    const body = `Fixes a defect.\n\n${footer("openai", model)}`;
    for (const pull of [
      ...input.mergedPullRequests,
      ...(input.mergedPullRequestOutcomes ?? []),
    ]) {
      if (pull.id === "PR_november") pull.body = body;
    }
  } else {
    input.openIssues = [
      openIssueWithComment(`AI provider/model: openai / ${model}`),
    ];
  }
  const snapshot = createLeaderboardSnapshot(input);
  return {
    reported: snapshot.leaders.flatMap((leader) => leader.reportedModels),
    issueModels: snapshot.workQueue.issues.flatMap(
      (issue) => issue.model.identifiers,
    ),
  };
}

// exactIdentifier drops a provider repeated at the start of the model, so
// `openai / openai/unknown` would publish `openai/unknown`, which the snapshot
// validator refuses. Such a declaration names no exact model and must not
// abort the whole snapshot.
test.each([
  ["openai/unavailable", "merged body"],
  ["openai/unknown", "merged body"],
  ["openai/gpt", "merged body"],
  ["openai/unknown", "issue comment"],
  ["openai/gpt-5", "merged body"],
  ["openai/gpt-5", "issue comment"],
] as const)("model %s declared in the %s", (model, place) => {
  const { reported, issueModels } = snapshotWith(model, place);
  const published = model === "openai/gpt-5" ? ["openai/gpt-5"] : [];
  expect(place === "merged body" ? reported : issueModels).toEqual(published);
});
