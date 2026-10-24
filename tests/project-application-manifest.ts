/**
 * The manifest `/projects/new` submits for a new community project: paused,
 * unverified, unfunded, payments disabled. Tests start from it the way a
 * maintainer does.
 */

export const CONTRIBUTION = {
  approvedScope:
    "Bug fixes and documented features in the reproducible-research toolkit. Release tooling is out of scope.",
  contributionGuide:
    "Run `bun install`, branch from `main`, keep one change per pull request, and follow `CONTRIBUTING.md`.",
  supportedTasks:
    "Reproduced bugs with a failing test, and issues labeled `help wanted`.",
  requiredTests: "Run `bun test` and attach the output to the pull request.",
  reviewExpectations:
    "Check that the failing test fails on the base and passes on the head, and that public behavior is documented.",
  securityContact: "security@example.org",
  closurePolicy:
    "Maintainers close pull requests that duplicate open work or have no test.",
  maintainerNotes: "",
};

export function applicationManifest(
  id: string,
  repository: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = "2026-10-18T00:00:00.000Z";
  return {
    schemaVersion: "1",
    id,
    slug: id,
    name: `Project ${id}`,
    eyebrow: "Open-source project",
    headline: "Reproducible research tooling for everyone.",
    description:
      "Build and maintain reproducible research tooling with accepted, tested pull requests.",
    listingTier: "community",
    status: "paused",
    steward: {
      displayName: "Example maintainers",
      kind: "organization",
      github: {
        actorId: "987654321",
        nodeId: "O_example",
        login: "example",
        type: "Organization",
        profileUrl: "https://github.com/example",
      },
      website: null,
    },
    authority: {
      state: "unverified",
      reason: "missing-repository-proof",
      role: "project-steward",
      repositoryId: "123456789",
      repositoryNodeId: "R_example",
      proof: null,
    },
    terms: {
      revision: "draft-1",
      effectiveAt: now,
      paymentTransfersIp: false,
      retroactive: false,
      receiptPolicy: {
        state: "pending-authority-activation",
        activatedAt: null,
        bindings: [],
      },
      copyright: {
        model: "unknown",
        claimedLegalHolder: null,
        notice: null,
        legalCapacity: null,
        governanceResolution: null,
      },
      repositoryLicense: {
        state: "unknown",
        spdx: null,
        url: null,
        commitSha: null,
        fileSha256: null,
      },
      inbound: {
        mode: "unknown",
        termsUrl: null,
        commitSha: null,
        fileSha256: null,
        version: null,
        acceptance: null,
      },
      assignment: null,
      externalPrize: null,
    },
    repositories: [
      {
        id: repository,
        displayName: repository,
        githubUrl: `https://github.com/${repository}`,
        description: "Reproducible research tooling for everyone.",
        integrationBranch: "main",
      },
    ],
    skill: {
      id: `contribute-to-${id}`,
      publishAtRoot: false,
      sourcePath: "skills/project-contributor-template",
      publicPath: `/projects/${id}/skill.md`,
    },
    reviewSkill: {
      id: `review-${id}-contributions`,
      sourcePath: "skills/project-reviewer-template",
    },
    rewardAsset: {
      network: "ethereum",
      kind: "stablecoin",
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
    },
    contribution: CONTRIBUTION,
    reward: {
      kind: "monthly-pool",
      currency: "USDC",
      chain: "ethereum",
      rewardStartAt: now,
      cycle: "calendar-month-utc",
      monthlyCapMinor: "1000000000",
      monthlyCapDisplay: "$1,000",
      committedMinor: "0",
      paymentMode: "disabled",
      feeBasisPoints: 200,
      unusedFunds: "rollover-without-cap-increase",
      fundingState: "pledged",
    },
    funding: {
      mode: "direct-noncustodial",
      disclosure:
        "Funds are committed in the project vault. Slop holds no payment keys.",
      recordsPath: `funding/${id}`,
      addresses: [],
    },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: {
      repository: `https://github.com/${repository}`,
      issues: `https://github.com/${repository}/issues`,
    },
    ...overrides,
  };
}
