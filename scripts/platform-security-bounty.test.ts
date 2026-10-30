import { describe, expect, test } from "bun:test";
import {
  assertSecurityBountyTerms,
  SECURITY_FULL_AWARD_SPLIT,
  SECURITY_SPLIT,
  type SecurityBountyTerms,
  securityBountySplit,
} from "../src/lib/security-bounty.mjs";
import {
  carriedSecurityTerms,
  initialSecuritySplit,
} from "../src/lib/security-program-draft";

const PLATFORM = [{ id: "SlopDotCash/slopdotcash" }];
const OTHER = [{ id: "SlopDotCash/umia-protocol" }];
const REWARD = { kind: "monthly-pool" };
const SOURCE_COMMIT = "a".repeat(40);
const PROGRAM_RULES = {
  exhaustionRule:
    "Each distinct finding is reviewed; the owner decides whether to fund an award.",
  includedAssets: [
    "Published project contracts at the recorded source revision",
  ],
  excludedDependencies: ["Third-party contracts and intended owner actions"],
  testingPermission:
    "Use local forks and synthetic funds; never exploit production systems.",
  severityRubric:
    "Critical findings demonstrate unauthorized loss or permanent freezing of funds.",
  lossDefinition:
    "Unauthorized theft or permanent freezing of user funds caused by a contract defect.",
  dispute: "Ask for a private review with supporting evidence.",
  disclosure:
    "Keep findings private until the authorized maintainer approves disclosure.",
  safeHarbor:
    "Good-faith research within these local testing rules is authorized.",
};

/** Historical full-award terms; the editor must preserve their economics. */
function platformProgram(overrides: Record<string, unknown> = {}) {
  return {
    fundingPolicy: "after-approval",
    version: "1",
    status: "open",
    rewardMode: "separate",
    eligibility: "critical-loss-of-funds",
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "10000000000",
    },
    split: { ...SECURITY_FULL_AWARD_SPLIT },
    sponsor: { name: "slop.cash", githubId: "318901292" },
    funding: { state: "pledged" },
    capacity: {
      awards: null,
      closesAt: null,
      exhaustionRule: PROGRAM_RULES.exhaustionRule,
    },
    scope: {
      sourceRevisions: [
        {
          repository: "SlopDotCash/slopdotcash",
          commit: SOURCE_COMMIT,
        },
      ],
      deployments: [],
      includedAssets: [...PROGRAM_RULES.includedAssets],
      excludedDependencies: [...PROGRAM_RULES.excludedDependencies],
      testingPermission: PROGRAM_RULES.testingPermission,
      severityRubric: PROGRAM_RULES.severityRubric,
      lossDefinition: PROGRAM_RULES.lossDefinition,
    },
    intake: {
      kind: "github-private-vulnerability-reporting",
      repository: "SlopDotCash/slopdotcash",
    },
    responseTargets: {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
    approvers: {
      technical: [{ githubId: "18633264", githubLogin: "lalalune" }],
      financial: [{ githubId: "18633264", githubLogin: "lalalune" }],
      dispute: [{ githubId: "18633264", githubLogin: "lalalune" }],
    },
    dispute: { authority: "advisory", process: PROGRAM_RULES.dispute },
    disclosure: PROGRAM_RULES.disclosure,
    safeHarbor: PROGRAM_RULES.safeHarbor,
    ...overrides,
  };
}

describe("approved security bounty splits", () => {
  test("the full-award split pays the whole gross to the researcher", () => {
    expect(
      securityBountySplit("10000000000", SECURITY_FULL_AWARD_SPLIT),
    ).toEqual({
      grossMinor: "10000000000",
      researcherMinor: "10000000000",
      slopMinor: "0",
    });
    // No divisibility rule applies when nothing is shared.
    expect(securityBountySplit("3", SECURITY_FULL_AWARD_SPLIT).slopMinor).toBe(
      "0",
    );
    expect(securityBountySplit("100").researcherMinor).toBe("75");
    expect(() => securityBountySplit("3", SECURITY_SPLIT)).toThrow(RangeError);
    expect(() =>
      securityBountySplit("100", {
        researcherBasisPoints: 9000,
        slopBasisPoints: 1000,
      } as never),
    ).toThrow(TypeError);
  });

  test("historical full-award terms remain valid without generated deployment defaults", () => {
    const terms = assertSecurityBountyTerms(platformProgram(), {
      projectId: "slopdotcash",
      repositories: PLATFORM,
      reward: REWARD,
    });
    expect(terms.split).toEqual(SECURITY_FULL_AWARD_SPLIT);
    expect(terms.scope.deployments).toEqual([]);
  });

  test("approved full-award terms are independent of the project identity", () => {
    expect(
      assertSecurityBountyTerms(
        platformProgram({
          intake: {
            kind: "github-private-vulnerability-reporting",
            repository: OTHER[0].id,
          },
          scope: {
            ...platformProgram().scope,
            sourceRevisions: [
              {
                repository: OTHER[0].id,
                commit: SOURCE_COMMIT,
              },
            ],
          },
        }),
        { projectId: "umia-protocol", repositories: OTHER, reward: REWARD },
      ).split,
    ).toEqual(SECURITY_FULL_AWARD_SPLIT);
  });

  test("a full-award program cannot bind the 25% bounty vault or require prefunding", () => {
    const { fundingPolicy: _policy, ...prefunded } = platformProgram({
      status: "paused",
    });
    expect(() =>
      assertSecurityBountyTerms(prefunded, {
        projectId: "slopdotcash",
        repositories: PLATFORM,
        reward: REWARD,
      }),
    ).toThrow("project.securityBounty.fundingPolicy must be after-approval");
    expect(() =>
      assertSecurityBountyTerms(
        platformProgram({
          settlement: { chain: "base", deployments: [] },
        }),
        { projectId: "slopdotcash", repositories: PLATFORM, reward: REWARD },
      ),
    ).toThrow("project.securityBounty.settlement cannot bind");
  });

  test("the platform may still publish an ordinary 75/25 program", () => {
    expect(
      assertSecurityBountyTerms(
        platformProgram({ split: { ...SECURITY_SPLIT } }),
        { projectId: "slopdotcash", repositories: PLATFORM, reward: REWARD },
      ).split,
    ).toEqual(SECURITY_SPLIT);
  });

  test("the owner editor uses shared defaults and preserves an existing authorized split", () => {
    const ordinary = { split: { ...SECURITY_SPLIT } } as const;
    const full = { split: { ...SECURITY_FULL_AWARD_SPLIT } } as const;
    expect(initialSecuritySplit(undefined)).toBe(SECURITY_SPLIT);
    expect(initialSecuritySplit(ordinary)).toEqual(SECURITY_SPLIT);
    expect(initialSecuritySplit(full)).toEqual(SECURITY_FULL_AWARD_SPLIT);
  });

  test("the owner editor carries the registered vault and approved split", () => {
    const settlement = { chain: "base", deployments: [] };
    const existing = {
      ...platformProgram({ split: { ...SECURITY_SPLIT } }),
      settlement,
    } as unknown as SecurityBountyTerms;
    const kept = carriedSecurityTerms(existing);
    expect(kept.settlement).toEqual(settlement as never);
    expect(kept.split).toEqual(SECURITY_SPLIT);
    expect("fundingPolicy" in kept).toBe(false);
    expect(carriedSecurityTerms(undefined)).toEqual({});
    const full = carriedSecurityTerms(
      platformProgram() as unknown as SecurityBountyTerms,
    );
    expect(
      assertSecurityBountyTerms(
        { ...full, fundingPolicy: "after-approval" },
        { projectId: "slopdotcash", repositories: PLATFORM, reward: REWARD },
      ).split,
    ).toEqual(SECURITY_FULL_AWARD_SPLIT);
  });
});
