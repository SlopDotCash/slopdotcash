import { afterEach, expect, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AFTER_NOVEMBER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { createLeaderboardSnapshot } from "./lib/leaderboard";
import { createProjectView } from "./lib/project-view";
import { findProject } from "./lib/projects.mjs";
import { RewardValue } from "./ProjectLeaderboard";

afterEach(() => setSystemTime());

// Token amounts are never dollars, and a monthly pool has no prize share.
test("a funded token pool shows each share of payment weight, never 0%", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const asi = findProject("asi");
  if (!asi) throw new Error("fixture project missing");
  const view = createProjectView(
    createLeaderboardSnapshot(penaltyScoreInput([], AFTER_NOVEMBER)),
    "asi",
    "2026-11",
    undefined,
    {
      ...asi,
      reward: {
        ...asi.reward,
        fundingState: "committed",
        committedMinor: "1000000000",
      },
      rewardAsset: {
        network: "solana",
        kind: "token",
        address: "So11111111111111111111111111111111111111112",
        symbol: "TOKEN",
        decimals: 9,
        chainId: null,
        cluster: "mainnet-beta",
        verifiedAt: "2026-10-01T00:00:00.000Z",
      },
    },
  );
  const cells = view.leaders.map((leader) =>
    renderToStaticMarkup(
      <RewardValue leader={leader} view={view} />,
    ).replaceAll("<!-- -->", ""),
  );
  expect(cells).toEqual([
    "50.00% of payment weight",
    "50.00% of payment weight",
  ]);
});
