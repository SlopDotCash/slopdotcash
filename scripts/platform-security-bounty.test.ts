import { describe, expect, test } from "bun:test";
import legacyProjects from "../src/lib/legacy-projects.json";
import {
  carriedSecurityTerms,
  fullAwardSelectable,
  initialSecuritySplit,
  PLATFORM_BOUNTY_DEPLOYMENTS,
  PLATFORM_BOUNTY_SOURCE_COMMIT,
  PLATFORM_BOUNTY_TEXT,
} from "../src/lib/platform-security-bounty";
import { SOURCE_REPOSITORY } from "../src/lib/project-skill-publication.mjs";
import {
  assertSecurityBountyTerms,
  isPlatformSecurityProgram,
  PLATFORM_SECURITY_PROJECT_ID,
  PLATFORM_SECURITY_REPOSITORY,
  SECURITY_FULL_AWARD_SPLIT,
  SECURITY_SPLIT,
  type SecurityBountyTerms,
  securityBountySplit,
} from "../src/lib/security-bounty.mjs";

const PLATFORM = [{ id: "SlopDotCash/slopdotcash" }];
const OTHER = [{ id: "SlopDotCash/umia-protocol" }];
const REWARD = { kind: "monthly-pool" };

/** The terms the owner editor proposes for the platform's contract bounty. */
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
      exhaustionRule: PLATFORM_BOUNTY_TEXT.exhaustionRule,
    },
    scope: {
      sourceRevisions: [
        {
          repository: "SlopDotCash/slopdotcash",
          commit: PLATFORM_BOUNTY_SOURCE_COMMIT,
        },
      ],
      deployments: PLATFORM_BOUNTY_DEPLOYMENTS,
      includedAssets: [...PLATFORM_BOUNTY_TEXT.includedAssets],
      excludedDependencies: [...PLATFORM_BOUNTY_TEXT.excludedDependencies],
      testingPermission: PLATFORM_BOUNTY_TEXT.testingPermission,
      severityRubric: PLATFORM_BOUNTY_TEXT.severityRubric,
      lossDefinition: PLATFORM_BOUNTY_TEXT.lossDefinition,
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
    dispute: { authority: "advisory", process: PLATFORM_BOUNTY_TEXT.dispute },
    disclosure: PLATFORM_BOUNTY_TEXT.disclosure,
    safeHarbor: PLATFORM_BOUNTY_TEXT.safeHarbor,
    ...overrides,
  };
}

describe("platform contract bounty (owner decision, 28 October 2026)", () => {
  test("the platform repository constant matches the Slop source repository", () => {
    expect(PLATFORM_SECURITY_REPOSITORY).toBe(SOURCE_REPOSITORY);
    expect(isPlatformSecurityProgram("slopdotcash", PLATFORM)).toBe(true);
    expect(
      isPlatformSecurityProgram("slopdotcash", [
        { id: "slopdotcash/SLOPDOTCASH" },
      ]),
    ).toBe(true);
    expect(isPlatformSecurityProgram("slopdotcash", OTHER)).toBe(false);
  });

  test("the platform project id matches the registered Slop project", () => {
    const registered = (
      legacyProjects as unknown as {
        id: string;
        repositories: { id: string }[];
      }[]
    ).filter((project) =>
      project.repositories.some(
        (repository) => repository.id === PLATFORM_SECURITY_REPOSITORY,
      ),
    );
    expect(registered.map((project) => project.id)).toContain(
      PLATFORM_SECURITY_PROJECT_ID,
    );
  });

  test("listing the Slop repository does not make another project the platform", () => {
    expect(isPlatformSecurityProgram("not-slop", PLATFORM)).toBe(false);
    expect(isPlatformSecurityProgram("not-slop", [...OTHER, ...PLATFORM])).toBe(
      false,
    );
    expect(() =>
      assertSecurityBountyTerms(platformProgram(), {
        projectId: "not-slop",
        repositories: PLATFORM,
        reward: REWARD,
      }),
    ).toThrow("project.securityBounty.split pays the full award only");
  });

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

  test("the proposed platform terms validate with every deployment listed", () => {
    const terms = assertSecurityBountyTerms(platformProgram(), {
      projectId: "slopdotcash",
      repositories: PLATFORM,
      reward: REWARD,
    });
    expect(terms.split).toEqual(SECURITY_FULL_AWARD_SPLIT);
    expect(terms.scope.deployments.map((entry) => entry.network)).toEqual([
      "base-mainnet",
      "base-mainnet",
      "base-mainnet",
      "ethereum",
      "ethereum",
      "ethereum",
      "robinhood-mainnet",
      "robinhood-mainnet",
      "robinhood-mainnet",
      "solana-mainnet",
    ]);
  });

  test("another project cannot publish the full-award split", () => {
    expect(() =>
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
                commit: PLATFORM_BOUNTY_SOURCE_COMMIT,
              },
            ],
          },
        }),
        { projectId: "umia-protocol", repositories: OTHER, reward: REWARD },
      ),
    ).toThrow("project.securityBounty.split pays the full award only");
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

  test("the owner editor defaults new platform terms to the full award but keeps an existing split", () => {
    const ordinary = { split: { ...SECURITY_SPLIT } } as const;
    const full = { split: { ...SECURITY_FULL_AWARD_SPLIT } } as const;
    expect(initialSecuritySplit(true, undefined)).toBe(
      SECURITY_FULL_AWARD_SPLIT,
    );
    expect(initialSecuritySplit(true, ordinary)).toBe(SECURITY_SPLIT);
    expect(initialSecuritySplit(true, full)).toBe(SECURITY_FULL_AWARD_SPLIT);
    expect(initialSecuritySplit(false, undefined)).toBe(SECURITY_SPLIT);
    expect(initialSecuritySplit(false, full)).toBe(SECURITY_SPLIT);
  });

  test("a program with a registered bounty vault cannot select the full award", () => {
    const settlement = { chain: "base", deployments: [] };
    const existing = {
      ...platformProgram({ split: { ...SECURITY_SPLIT } }),
      settlement,
    } as unknown as SecurityBountyTerms;
    // The API refuses any settlement change (security_vault_restricted), so
    // the editor never offers a choice that could not publish.
    expect(fullAwardSelectable(true, existing)).toBe(false);
    expect(fullAwardSelectable(true, undefined)).toBe(true);
    expect(
      fullAwardSelectable(
        true,
        platformProgram() as unknown as SecurityBountyTerms,
      ),
    ).toBe(true);
    expect(fullAwardSelectable(false, undefined)).toBe(false);
    const kept = carriedSecurityTerms(existing, false);
    expect(kept.settlement).toEqual(settlement as never);
    expect("fundingPolicy" in kept).toBe(false);
    // The vault is never silently dropped.
    expect(() => carriedSecurityTerms(existing, true)).toThrow(
      "keeps the 75/25 split",
    );
    expect(carriedSecurityTerms(undefined, true)).toEqual({});
    const full = carriedSecurityTerms(
      platformProgram() as unknown as SecurityBountyTerms,
      true,
    );
    expect(
      assertSecurityBountyTerms(
        { ...full, fundingPolicy: "after-approval" },
        { projectId: "slopdotcash", repositories: PLATFORM, reward: REWARD },
      ).split,
    ).toEqual(SECURITY_FULL_AWARD_SPLIT);
  });
});
