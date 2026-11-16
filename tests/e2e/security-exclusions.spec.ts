import { PROJECTS } from "../../src/lib/projects.mjs";
import { SECURITY_DEFAULT_EXCLUSIONS } from "../../src/lib/security-bounty.mjs";
import { expect, expectAccessible, test } from "./fixtures";

/**
 * Every security program page lists Slop's default "does not qualify" lines
 * after its scope facts, then any lines the program owner added (operator
 * decision, 16 November 2026).
 */
const OWNER_LINES = [
  "Price feed staleness within the documented heartbeat",
  "Rounding dust below one cent",
];

function programProject(excludedFindings?: string[]) {
  const project = PROJECTS.find((entry) => entry.id === "eliza");
  if (!project) throw new Error("Missing fixture project");
  const repository = project.repositories[0].id;
  return {
    ...project,
    securityBounty: {
      version: "1",
      status: "open",
      fundingPolicy: "after-approval",
      rewardMode: "separate",
      eligibility: "critical-loss-of-funds",
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base",
        grossMinor: "10000000000",
      },
      split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
      sponsor: { name: project.name, githubId: null },
      funding: { state: "pledged" },
      capacity: {
        awards: null,
        closesAt: null,
        exhaustionRule: "Each finding is reviewed on its own merits.",
      },
      scope: {
        sourceRevisions: [{ repository, commit: "a".repeat(40) }],
        deployments: [],
        includedAssets: ["Vault deposits held by the protocol contracts"],
        excludedDependencies: [],
        ...(excludedFindings ? { excludedFindings } : {}),
        testingPermission:
          "Local forks and isolated test networks only. No production testing.",
        severityRubric:
          "Critical means unauthorized loss or permanent theft of covered assets.",
        lossDefinition:
          "Unauthorized loss of covered assets caused by the defect.",
      },
      intake: { kind: "github-private-vulnerability-reporting", repository },
      responseTargets: {
        acknowledgeHours: 24,
        triageBusinessDays: 3,
        updateIntervalDays: 7,
      },
      approvers: {
        technical: [{ githubId: "4242", githubLogin: "example-owner" }],
        financial: [{ githubId: "4242", githubLogin: "example-owner" }],
        dispute: [{ githubId: "4242", githubLogin: "example-owner" }],
      },
      dispute: {
        authority: "advisory",
        process: "Ask for a private review with supporting evidence.",
      },
      disclosure: "The maintainer controls public disclosure.",
      safeHarbor: "Good-faith research inside this scope is authorized.",
    },
  };
}

for (const excludedFindings of [OWNER_LINES, undefined]) {
  test(`the program page lists what does not qualify ${excludedFindings ? "with owner lines" : "for terms without owner lines"}`, async ({
    page,
    diagnostics,
  }, info) => {
    const project = programProject(excludedFindings);
    diagnostics.allowPreviewApiMisses();
    diagnostics.allowCanceledBackgroundReads();
    await page.route("**/data/fixture-project-registry.json", (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
    );
    await page.route("**/.well-known/slop/projects.json", (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
    );
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({ json: { session: null } }),
    );
    await page.goto(`/projects/${project.id}/security`, {
      waitUntil: "networkidle",
    });
    const scope = page.getByRole("region", { name: "Scope", exact: true });
    await expect(
      scope.getByRole("heading", { name: "Does not qualify", exact: true }),
    ).toBeVisible();
    await expect(
      scope
        .getByRole("list", { name: "Does not qualify", exact: true })
        .getByRole("listitem"),
    ).toHaveText([...SECURITY_DEFAULT_EXCLUSIONS]);
    const own = scope.getByRole("list", {
      name: "Also does not qualify for this program",
      exact: true,
    });
    if (excludedFindings) {
      await expect(own.getByRole("listitem")).toHaveText(excludedFindings);
      await expectAccessible(page);
      await page.screenshot({
        path: info.outputPath("security-exclusions.png"),
        fullPage: true,
      });
    } else {
      await expect(own).toHaveCount(0);
      await expect(
        scope.getByRole("heading", {
          name: "Also does not qualify for this program",
        }),
      ).toHaveCount(0);
    }
  });
}
