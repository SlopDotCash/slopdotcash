import { describe, expect, it } from "vitest";
import asi from "../projects/asi/project.json";
import deltaStar from "../projects/delta-star/project.json";
import eliza from "../projects/eliza/project.json";
import heirElementsSdk from "../projects/heir-elements-sdk/project.json";
import { validateProjectTransitions } from "./check-project-transitions.mjs";

function entry(value: { id: string }): [string, string] {
  return [`projects/${value.id}/project.json`, JSON.stringify(value)];
}

describe("project transition gate", () => {
  it("accepts unchanged policy and rejects silent terms history edits", () => {
    expect(validateProjectTransitions([entry(eliza)], [entry(eliza)])).toEqual({
      previous: 1,
      current: 1,
    });
    const rewritten = structuredClone(eliza);
    rewritten.terms.copyright.notice = "Rewritten without a new revision";
    expect(() =>
      validateProjectTransitions([entry(eliza)], [entry(rewritten)]),
    ).toThrow(/new revision/u);
  });

  it("rejects project deletion and malformed inventory paths", () => {
    expect(() => validateProjectTransitions([entry(eliza)], [])).toThrow(
      /cannot be deleted/u,
    );
    expect(() =>
      validateProjectTransitions(
        [["projects/../eliza/project.json", JSON.stringify(eliza)]],
        [entry(eliza)],
      ),
    ).toThrow(/not canonical/u);
  });

  it("rejects a non-boolean root-publication declaration", () => {
    const malformed = structuredClone(eliza) as unknown as {
      id: string;
      skill: Record<string, unknown>;
    };
    malformed.skill.publishAtRoot = "true";
    expect(() =>
      validateProjectTransitions([entry(eliza)], [entry(malformed)]),
    ).toThrow(/project identity/u);
  });

  it("requires an atomic inventory migration with exactly one root", () => {
    const current = [eliza, asi, deltaStar, heirElementsSdk];
    const legacy = current.map((project) => {
      const next = structuredClone(project) as unknown as {
        id: string;
        skill: { publishAtRoot?: unknown };
      };
      delete next.skill.publishAtRoot;
      return next;
    });
    const entries = (projects: Array<{ id: string }>) => projects.map(entry);

    expect(
      validateProjectTransitions(entries(legacy), entries(current)),
    ).toEqual({ previous: 4, current: 4 });

    const partial = structuredClone(current) as unknown as Array<{
      id: string;
      skill: { publishAtRoot?: unknown };
    }>;
    delete partial[3].skill.publishAtRoot;
    expect(() =>
      validateProjectTransitions(entries(legacy), entries(partial)),
    ).toThrow(/publishAtRoot/u);

    const multiple = structuredClone(current) as unknown as Array<{
      id: string;
      skill: { publishAtRoot?: unknown };
    }>;
    multiple[1].skill.publishAtRoot = true;
    expect(() =>
      validateProjectTransitions(entries(legacy), entries(multiple)),
    ).toThrow(/exactly one root publisher/u);

    expect(() =>
      validateProjectTransitions(entries(current), entries(legacy)),
    ).toThrow(/publishAtRoot/u);
  });

  it("accepts the historical one-percent external-prize fee only on the prior side", () => {
    const legacy = structuredClone(deltaStar) as unknown as {
      id: string;
      reward: { feeBasisPoints: number };
    };
    legacy.reward.feeBasisPoints = 100;

    expect(
      validateProjectTransitions(
        [entry(eliza), entry(legacy)],
        [entry(eliza), entry(deltaStar)],
      ),
    ).toEqual({ previous: 2, current: 2 });
    expect(() =>
      validateProjectTransitions(
        [entry(eliza), entry(deltaStar)],
        [entry(eliza), entry(legacy)],
      ),
    ).toThrow(/fee policy/u);
  });

  it("rejects reducing the contributor cap while adding or funding a review budget", () => {
    const withPledgedReview = structuredClone(eliza) as typeof eliza & {
      reward: typeof eliza.reward & {
        reviewBudget: {
          effectiveAt: string;
          monthlyCapMinor: string;
          monthlyCapDisplay: string;
          committedMinor: string;
          paymentMode: "disabled" | "enabled";
          unusedFunds: "rollover-without-cap-increase";
          fundingState: "pledged" | "committed";
        };
      };
    };
    withPledgedReview.reward.reviewBudget = {
      effectiveAt: "2026-10-01T00:00:00.000Z",
      monthlyCapMinor: "50000000",
      monthlyCapDisplay: "$50",
      committedMinor: "0",
      paymentMode: "disabled",
      unusedFunds: "rollover-without-cap-increase",
      fundingState: "pledged",
    };

    const reducedOnAdd = structuredClone(withPledgedReview);
    reducedOnAdd.reward.monthlyCapMinor = "9999000000";
    reducedOnAdd.reward.monthlyCapDisplay = "$9,999";
    expect(() =>
      validateProjectTransitions([entry(eliza)], [entry(reducedOnAdd)]),
    ).toThrow(/review budget.*reducing the contributor pool cap/u);

    expect(
      validateProjectTransitions(
        [entry(eliza)],
        [entry(withPledgedReview)],
        Date.parse("2026-09-02T00:00:00.000Z"),
      ),
    ).toEqual({ previous: 1, current: 1 });

    const retroactive = structuredClone(withPledgedReview);
    retroactive.reward.reviewBudget.effectiveAt = "2026-09-01T00:00:00.000Z";
    expect(() =>
      validateProjectTransitions(
        [entry(eliza)],
        [entry(retroactive)],
        Date.parse("2026-09-02T00:00:00.000Z"),
      ),
    ).toThrow(/open or past cycle/u);

    const funded = structuredClone(withPledgedReview);
    funded.reward.paymentMode = "enabled";
    funded.reward.fundingState = "committed";
    funded.reward.committedMinor = "5000000";
    funded.reward.reviewBudget.fundingState = "committed";
    funded.reward.reviewBudget.paymentMode = "enabled";
    funded.reward.reviewBudget.committedMinor = "1000000";
    funded.reward.monthlyCapMinor = "9999000000";
    funded.reward.monthlyCapDisplay = "$9,999";
    (
      funded as unknown as { funding: { commitments: unknown[] } }
    ).funding.commitments = [
      {
        kind: "squads-v4-vault",
        network: "solana",
        asset: "USDC",
        multisig: "11111111111111111111111111111111",
        vault: "Vote111111111111111111111111111111111111111",
        vaultIndex: 0,
        funderMember: "Stake11111111111111111111111111111111111111",
        stewardMember: "SysvarRent111111111111111111111111111111111",
        funderActorId: "18633264",
        deadline: "2026-12-01T00:00:00.000Z",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        replacedAt: null,
      },
    ];
    expect(() =>
      validateProjectTransitions(
        [entry(withPledgedReview)],
        [entry(funded)],
        Date.parse("2026-09-02T00:00:00.000Z"),
      ),
    ).toThrow(/review budget.*reducing the contributor pool cap/u);
  });
});
