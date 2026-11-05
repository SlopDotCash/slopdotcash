/** A bounty-only project has no monthly pool; its sponsors card names the bounty. */

import type { Page } from "@playwright/test";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import type { SecurityBountyTerms } from "../../src/lib/security-bounty.mjs";
import { expect, test } from "./fixtures";

function bountyOnlyProject(
  overrides: Partial<SecurityBountyTerms> = {},
): ProjectDefinition {
  const original = PROJECTS.find((project) => project.id === "eliza");
  if (!original) throw new Error("Missing project fixture");
  const reward = {
    ...original.reward,
    monthlyCapMinor: "0",
    monthlyCapDisplay: "$0",
    committedMinor: "0",
    paymentMode: "disabled",
    fundingState: "pledged",
  } as ProjectDefinition["reward"];
  delete (reward as { cycleCaps?: unknown }).cycleCaps;
  const terms: SecurityBountyTerms = {
    fundingPolicy: "after-approval",
    version: "1",
    status: "open",
    rewardMode: "bounty-only",
    eligibility: "critical-loss-of-funds",
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "solana",
      grossMinor: "10000000000",
    },
    split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    sponsor: { name: "Example Foundation", githubId: null },
    funding: { state: "pledged" },
    capacity: {
      awards: null,
      closesAt: null,
      exhaustionRule:
        "Each distinct finding is reviewed; the owner decides whether to fund an award.",
    },
    scope: {
      sourceRevisions: [
        { repository: "elizaOS/eliza", commit: "a".repeat(40) },
      ],
      deployments: [],
      includedAssets: [
        "Published project contracts at the recorded source revision",
      ],
      excludedDependencies: [
        "Third-party contracts and intended owner actions",
      ],
      testingPermission:
        "Use local forks and synthetic funds; never exploit production systems.",
      severityRubric:
        "Critical findings demonstrate unauthorized loss or permanent freezing of funds.",
      lossDefinition:
        "Unauthorized theft or permanent freezing of user funds caused by a contract defect.",
    },
    intake: {
      kind: "github-private-vulnerability-reporting",
      repository: "elizaOS/eliza",
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
    dispute: {
      authority: "advisory",
      process: "Ask for a private review with supporting evidence.",
    },
    disclosure:
      "Keep findings private until the authorized maintainer approves disclosure.",
    safeHarbor:
      "Good-faith research within these local testing rules is authorized.",
    ...overrides,
  };
  return {
    ...original,
    status: "active",
    reward,
    securityBounty: terms,
  };
}

async function serveSponsors(page: Page, project: ProjectDefinition) {
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.goto("/sponsors", { waitUntil: "networkidle" });
  return page
    .getByRole("list", { name: "Project funding pools" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "Eliza", exact: true }) });
}

test.beforeEach(async ({ page }) => {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({ path: "public/slop-mark.svg" }),
  );
});

test("a bounty-only project's sponsors card names its bounty offer", async ({
  page,
}) => {
  const pool = await serveSponsors(page, bountyOnlyProject());
  await expect(
    pool.getByText("$10k / Critical", { exact: true }),
  ).toBeVisible();
  await expect(pool.getByText("Pledged", { exact: true })).toBeVisible();
  await expect(pool.getByText("Solana", { exact: true })).toBeVisible();
  await expect(pool.getByText("$0 monthly · not funded")).toHaveCount(0);
  await expect(pool.getByText("Vault: Not set up")).toHaveCount(0);
  await expect(pool.getByText("Payments: Disabled")).toHaveCount(0);
});

test("a closed bounty-only program does not read as an open offer", async ({
  page,
}) => {
  const pool = await serveSponsors(
    page,
    bountyOnlyProject({
      status: "closed",
      funding: {
        state: "verified-available",
        evidence: "vault deposit",
        verifiedAt: "2026-10-01T00:00:00.000Z",
      },
    }),
  );
  await expect(
    pool.getByText("$10k / Critical · bounty closed", { exact: true }),
  ).toBeVisible();
  await expect(
    pool.getByText("Funding verified", { exact: true }),
  ).toBeVisible();
  await expect(pool.getByText("$0 monthly · not funded")).toHaveCount(0);
});
