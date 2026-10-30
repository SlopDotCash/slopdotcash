/**
 * The setup wizard reads public GitHub facts through the same-origin
 * /api/v1/project-github API. The preview lane has no Pages Functions, so the
 * route below runs the real server lookup code against fixtures of GitHub's
 * REST responses; the page, validation, manifest and handoff are the real
 * application, and the browser never calls api.github.com.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  GithubLookupError,
  listOwnedRepositories,
  lookupGitHubRepository,
} from "../../backend/projects/github-lookup";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import {
  assertProjectDefinition,
  MAX_PROJECT_ID_LENGTH,
} from "../../src/lib/project-schema.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { expect, expectAccessible, test } from "./fixtures";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

const LICENSE_TEXT = "MIT License\n\nCopyright (c) Example Research\n";
const COMMIT = "c".repeat(40);
const EXTRA_CONTROLS =
  "main details, main select:not(#field-integrationBranch):not(#field-repository)";

type GithubFixture = (url: URL) => Promise<Response> | Response;

/** Uses the picker's organization/URL entry mode; valid input looks up itself. */
async function enterRepository(page: Page, repository: string) {
  const control = page.getByLabel("GitHub repository", { exact: true });
  await expect(control).toBeEnabled();
  const input = page.getByRole("textbox", {
    name: "GitHub repository",
    exact: true,
  });
  if ((await control.evaluate((element) => element.tagName)) === "SELECT")
    await control.selectOption("__other");
  await input.fill(repository);
}

/** Serves the same-origin lookup API with the real server code. */
async function serveGithubLookups(page: Page, github: GithubFixture) {
  await page.route("**/api/v1/project-github/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      "/api/v1/project-github/".length,
    );
    const fetcher = async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBeNull();
      return github(new URL(url));
    };
    try {
      const body =
        path === "owned-repositories"
          ? {
              repositories: await listOwnedRepositories(
                fetcher,
                undefined,
                "example",
              ),
            }
          : {
              repository: await lookupGitHubRepository(
                fetcher,
                undefined,
                path.replace(/^repositories\//u, ""),
              ),
            };
      await route.fulfill({ json: body });
    } catch (error) {
      if (!(error instanceof GithubLookupError)) throw error;
      await route.fulfill({
        status: error.status,
        json: { error: error.code, message: error.message },
      });
    }
  });
}

async function routeGitHub(
  page: Page,
  {
    repository = 200,
    licensePath = "LICENSE",
    description = null as string | null,
    owned = undefined as GithubFixture | undefined,
  } = {},
  beforeRepository?: () => Promise<void>,
) {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f65b22"/></svg>',
    }),
  );
  await serveGithubLookups(page, async (url) => {
    if (url.pathname === "/repos/example/open-protein") {
      await beforeRepository?.();
      return Response.json(
        repository === 200
          ? {
              id: 123456789,
              node_id: "R_fixture",
              full_name: "example/open-protein",
              description,
              private: false,
              default_branch: "trunk",
              owner: {
                login: "example",
                id: 987654321,
                node_id: "O_fixture",
                type: "Organization",
              },
            }
          : { message: repository === 404 ? "Not Found" : "rate limited" },
        {
          status: repository,
          headers:
            repository === 403 ? { "x-ratelimit-remaining": "0" } : undefined,
        },
      );
    }
    if (url.pathname === "/repos/example/open-protein/branches")
      return Response.json(
        ["trunk", "main", "development"].map((name) => ({
          name,
          commit: { sha: COMMIT },
        })),
      );
    if (url.pathname === "/repos/example/open-protein/branches/trunk")
      return Response.json({ commit: { sha: COMMIT } });
    if (url.pathname === "/repos/example/open-protein/license") {
      expect(url.searchParams.get("ref")).toBe(COMMIT);
      return Response.json({
        path: licensePath,
        encoding: "base64",
        content: Buffer.from(LICENSE_TEXT).toString("base64"),
        license: { spdx_id: "MIT" },
      });
    }
    if (url.pathname === "/users/example/repos")
      return owned ? owned(url) : Response.json([]);
    return Response.json({}, { status: 500 });
  });
}

/** The setup status the API returns for a project it just created. */
const CREATED_SETUP = {
  projectId: "open-protein",
  name: "Open Protein",
  slug: "open-protein",
  revision: 1,
  status: "paused",
  state: "waiting",
  nextAction: {
    kind: "wait_for_scan",
    message: "The security scan is queued. Nothing is needed from you.",
    href: null,
  },
  checks: {
    authority: {
      state: "verified",
      message: "@example-maintainer has admin access to example/open-protein.",
    },
    installation: {
      state: "installed",
      message: "Slopbot is installed on example/open-protein.",
    },
    scan: {
      state: "queued",
      message: "The security scan is queued. Nothing is needed from you.",
    },
  },
  funding: { mode: "none" },
  activatedRevision: null,
  checkedAt: "2026-10-18T00:00:00.000Z",
};

/** Answers project creation; every other projects request passes through. */
async function routeCreation(
  page: Page,
  answer: (body: { manifest: Record<string, unknown>; referrer?: string }) => {
    status: number;
    json: unknown;
  },
) {
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill(answer(route.request().postDataJSON()));
  });
}

// The preview lane has no Pages Functions; the registry lane tests the API.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/project-setup", (route) =>
    route.fulfill({ json: { projects: [], applications: [] } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: {
          githubId: "4242",
          githubLogin: "example-maintainer",
          admin: false,
        },
      },
    }),
  );
});

test("drafts a project through the setup steps and creates it without an admin", async ({
  diagnostics,
  page,
}) => {
  // Chromium logs every non-2xx fetch; the GitHub 404 and 403 lookups are
  // the tested failure paths, not application errors.
  diagnostics.allow(
    /^(?:console Failed to load resource: .* at |\d{3} GET )http:\/\/[^ ]+\/api\/v1\/project-github\//u,
  );
  await routeGitHub(page);
  // The registry API itself runs in the @registry lane; here it is a fixture
  // so the wizard's submission can be checked byte for byte.
  let submitted: {
    manifest: Record<string, unknown>;
    referrer?: string;
  } | null = null;
  let currentSession = {
    githubId: "4242",
    githubLogin: "example-maintainer",
    admin: false,
  };
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: currentSession,
      },
    }),
  );
  await routeCreation(page, (body) => {
    submitted = body;
    return {
      status: 201,
      json: {
        project: {
          id: "open-protein",
          revision: 1,
          referrer: { githubId: "4343", githubLogin: "example-referrer" },
        },
        setup: CREATED_SETUP,
      },
    };
  });
  // A referral link names the referrer; the draft keeps it across reloads
  // and the applicant can clear it before submitting (PRJ-05).
  await page.goto("/projects/new?ref=example-referrer", {
    waitUntil: "networkidle",
  });
  const steps = page.getByRole("navigation", { name: "Setup steps" });
  await expect(steps.getByRole("button")).toHaveCount(3);
  for (const label of ["Project", "Rewards", "Review"])
    await expect(steps.getByRole("button", { name: label })).toBeVisible();
  await expect(page.locator(EXTRA_CONTROLS)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start over" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Look up on GitHub" }),
  ).toHaveCount(0);
  await expect(page.locator(".setup-repository")).toHaveCount(0);
  await expect(page.getByLabel("Integration branch")).toBeDisabled();
  await steps.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("GitHub repository")).toBeFocused();
  await expect(page.locator("#field-repository-error")).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toHaveCount(0);
  await enterRepository(page, "https://github.com/example/open-protein.git");
  await expect(page.getByLabel("GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  const branch = page.getByRole("combobox", { name: "Integration branch" });
  await expect(branch).toHaveValue("trunk");
  expect((await branch.locator("option").allTextContents()).sort()).toEqual([
    "development",
    "main",
    "trunk",
  ]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
    ),
  ).toMatchObject({
    repositoryNumericId: "123456789",
    repositoryNodeId: "R_fixture",
  });
  await expect(page.getByLabel("Repository numeric ID")).toHaveCount(0);
  await branch.selectOption("development");
  // Repository facts must not survive a different repository, including after
  // restoring a saved draft. The lookup response remains an explicit fixture.
  await page.reload();
  await expect(branch).toHaveValue("development");
  await enterRepository(page, "example/another-repository");
  await expect(page.getByLabel("Integration branch")).toBeDisabled();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
    ),
  ).toMatchObject({
    repositoryNumericId: "",
    repositoryNodeId: "",
    integrationBranch: "main",
    licenseSpdx: "",
  });
  await enterRepository(page, "example/open-protein");
  await expect(branch).toHaveValue("trunk");
  await branch.selectOption("development");
  await expect(branch).toHaveValue("development");
  await expect(page.locator(EXTRA_CONTROLS)).toHaveCount(0);
  // The lookup suggests a name and editable default criteria (PRJ-03). With no
  // repository description, only the description and goal stay empty.
  await expect(page.getByLabel("Project name")).toHaveValue("open-protein");
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(
    /^Merged pull requests that fix a reproduced bug/u,
  );
  const goalBounds = await page
    .getByLabel("Goal", { exact: true })
    .boundingBox();
  const criteriaBounds = await page
    .getByLabel("Acceptance criteria")
    .boundingBox();
  if (!goalBounds || !criteriaBounds)
    throw new Error("Contribution fields must be visible.");
  expect(criteriaBounds.y).toBeGreaterThanOrEqual(
    goalBounds.y + goalBounds.height,
  );
  const closure = page.getByRole("checkbox", {
    name: /Allow Slopbot to close/u,
  });
  await expect(closure).toBeChecked();
  await closure.uncheck();
  await page.reload();
  await expect(closure).not.toBeChecked();
  await expect(branch).toHaveValue("development");
  const avatar = page.locator(".project-image-upload img");
  await expect(avatar).toHaveAttribute(
    "src",
    /^https:\/\/avatars\.githubusercontent\.com\/example(?:\?|$)/u,
  );
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#f65b22";
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png");
  });
  await page
    .getByLabel("Project image (optional)", { exact: true })
    .setInputFiles({
      name: "project.png",
      mimeType: "image/png",
      buffer: Buffer.from(png.split(",")[1], "base64"),
    });
  await expect(avatar).toHaveAttribute(
    "src",
    /^data:image\/(?:webp|jpeg);base64,/u,
  );
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(avatar).toHaveAttribute(
    "src",
    /^https:\/\/avatars\.githubusercontent\.com\/example(?:\?|$)/u,
  );
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(page.locator(".form-error-summary")).toHaveCount(0);
  await expect(page.getByLabel("Short description")).toBeFocused();
  await expect(page.locator("#field-headline-error")).toBeVisible();
  await expect(page.locator("#field-goal-error")).toBeVisible();
  await steps.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("Short description")).toBeFocused();
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Short description")
    .fill("Reproducible protein-folding benchmarks.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Accepted pull requests with verified tests.");
  const requiredTests = page.getByLabel("Required tests", { exact: true });
  await requiredTests.fill("x".repeat(2001));
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(requiredTests).toHaveAttribute("aria-invalid", "true");
  await requiredTests.fill("Run the project's existing test suite.");
  await expect(requiredTests).not.toHaveAttribute("aria-invalid", "true");
  await expect(requiredTests).toBeVisible();
  await expect(page.getByLabel("Copyright model")).toHaveCount(0);
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(page.locator(EXTRA_CONTROLS)).toHaveCount(0);
  // Funding is optional; asset and vault details follow the choice.
  await expect(page.getByLabel("Points only")).toBeChecked();
  await expect(page.getByRole("group", { name: "Network" })).toHaveCount(0);
  await expect(page.getByLabel(/review budget/iu)).toHaveCount(0);
  await page.getByLabel("Monthly rewards").check();
  await page
    .getByRole("group", { name: "Network", exact: true })
    .getByRole("radio", { name: "Solana", exact: true })
    .check();
  await expect(page.getByLabel(/USD$/u)).toHaveCount(0);
  await steps.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("Monthly amount (USDC)")).toBeFocused();
  await expect(page.locator("#field-monthlyPool-error")).toBeVisible();
  await expect(page.locator(".form-error-summary")).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("inline-required-amount.png"),
    fullPage: true,
  });
  await page.getByLabel("Monthly amount (USDC)").fill("2500");
  await expect(page.locator(".fee-preview")).toHaveCount(0);
  // A different account may have signed in in another tab during setup.
  // Review must identify the current actor before enabling creation.
  currentSession = {
    ...currentSession,
    githubId: "4343",
    githubLogin: "other-maintainer",
  };
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.locator(".setup-actor")).toHaveText("@other-maintainer");
  currentSession = {
    ...currentSession,
    githubId: "4242",
    githubLogin: "example-maintainer",
  };
  await steps.getByRole("button", { name: "Rewards", exact: true }).click();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.locator(".setup-actor")).toHaveText("@example-maintainer");
  await expect(page.locator(EXTRA_CONTROLS)).toHaveCount(0);

  const preview = page.getByRole("article", { name: "Listing preview" });
  await expect(preview).toContainText("Open Protein");
  await expect(preview).toContainText("example/open-protein · development");
  await expect(preview).toContainText("2,500 USDC on Solana · pledge");
  await expect(preview).toContainText(
    "2% of ordinary awards and unused-fund withdrawals.",
  );
  await expect(preview).not.toContainText("$");
  await expect(preview).toContainText("MIT");
  await expect(preview).toContainText("Referred by");
  await expect(preview).toContainText("@example-referrer");
  await expect(
    preview.getByRole("button", { name: "Clear referral" }),
  ).toBeVisible();
  // PRD section 4: the generated contributor skill tells capable agents to
  // star and fork, and asks for the requirement and implementation choice.
  const contributorSkill = page.getByLabel("Contributor skill SKILL.md");
  await expect(contributorSkill).toHaveValue(
    /If you can use computer use or browser use, star and fork\s+`[^`]+\/[^`]+` on github\.com/u,
  );
  await expect(contributorSkill).toHaveValue(
    /the requirement it serves[\s\S]+the implementation choice/u,
  );
  await page.getByRole("radio", { name: "Contributor", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Reviewer", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Reviewer skill SKILL.md")).toBeVisible();
  await page.getByRole("radio", { name: "Contributor", exact: true }).check();
  await expect(contributorSkill).toBeVisible();
  const handoff = page.getByRole("button", { name: /Create project/u });
  await expect(
    page.getByRole("button", { name: "Download manifest" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy manifest" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Project manifest JSON")).toHaveCount(0);
  await expectAccessible(page);

  // Creation posts the reviewed manifest, criteria and monthly amount, then
  // shows one setup status with the next action.
  await handoff.click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  await expect(page.getByText("Referred by @example-referrer.")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Setup steps" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Setup status: Waiting for the security scan",
    }),
  ).toBeVisible();
  const setupPanel = page.locator(".project-setup-status");
  for (const [label, status] of [
    ["GitHub access", "Confirmed"],
    ["Slopbot", "Installed"],
    ["Security scan", "Queued"],
  ]) {
    const value = setupPanel
      .locator("dl > div")
      .filter({
        has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }),
      })
      .locator("dd");
    await expect(value).toHaveText(status);
    await expect(value).toBeVisible();
  }
  const details = setupPanel.locator(".setup-details-compact");
  await expect(details).toBeVisible();
  await expect(details).toContainText("@example-maintainer has admin access");
  await expect(page.locator(EXTRA_CONTROLS)).toHaveCount(0);
  await expectAccessible(page, { include: ".project-setup-status" });
  await page.screenshot({
    path: test.info().outputPath("setup-status-badges.png"),
    fullPage: true,
  });
  expect(submitted).toMatchObject({
    referrer: "example-referrer",
    // Whole USDC units; the server stores them in the asset's base units.
    monthlyAmount: "2500",
    manifest: {
      id: "open-protein",
      status: "paused",
      listingTier: "community",
      skill: {
        id: "contribute-to-open-protein",
        sourcePath: "skills/project-contributor-template",
      },
      reviewSkill: {
        id: "review-open-protein-contributions",
        sourcePath: "skills/project-reviewer-template",
      },
      contribution: {
        approvedScope: "Accepted pull requests with verified tests.",
        maintainerNotes: "",
      },
    },
  });
  // The posted manifest carries the verified repository, steward, reward and
  // license facts the wizard read from GitHub.
  const posted = (submitted as { manifest: Record<string, unknown> } | null)
    ?.manifest;
  expect(posted).toMatchObject({
    id: "open-protein",
    status: "paused",
    authority: {
      state: "unverified",
      repositoryId: "123456789",
      repositoryNodeId: "R_fixture",
    },
    steward: {
      displayName: "@example",
      github: { login: "example", actorId: "987654321" },
    },
    reward: {
      chain: "solana",
      monthlyCapMinor: "2500000000",
      committedMinor: "0",
      paymentMode: "disabled",
      fundingState: "pledged",
    },
    terms: {
      repositoryLicense: {
        state: "verified",
        spdx: "MIT",
        commitSha: COMMIT,
        url: `https://github.com/example/open-protein/blob/${COMMIT}/LICENSE`,
        fileSha256: createHash("sha256").update(LICENSE_TEXT).digest("hex"),
      },
      copyright: { model: "unknown" },
    },
    repositories: [
      { id: "example/open-protein", integrationBranch: "development" },
    ],
  });
  expect(posted?.reward).not.toHaveProperty("reviewBudget");
  expect(posted?.slopbot).toBeUndefined();
  expect(posted?.image).toBeUndefined();

  // A completed setup offers the next action instead of the old wizard.
  await page.getByRole("button", { name: "Add another project" }).click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toHaveCount(0);
  await enterRepository(page, "example/open-protein");
  await expect(branch).toHaveValue("trunk");
  await expect(closure).toBeChecked();
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Short description")
    .fill("Reproducible protein-folding benchmarks.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(handoff).toBeVisible();
  let completeCreation!: () => void;
  const pendingCreation = new Promise<void>((resolve) => {
    completeCreation = resolve;
  });
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await pendingCreation;
    await route.fulfill({
      status: 201,
      json: {
        project: { id: "open-protein", revision: 1, referrer: null },
        setup: CREATED_SETUP,
      },
    });
  });
  await handoff.click();
  await expect(page.getByRole("button", { name: "Creating…" })).toBeDisabled();
  completeCreation();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();

  // The draft persists on this device without credentials and never claims
  // to be a listing.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Setup steps" })
    .getByRole("button", { name: "Project" })
    .click();
  await expect(page.getByLabel("GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
  );
  expect(stored.name).toBe("Open Protein");
  expect(stored.integrationBranch).toBe("trunk");
  await expect(branch).toHaveValue("trunk");
  expect(
    Object.keys(stored).some((key) => /token|secret|key$/iu.test(key)),
  ).toBe(false);
  // A branch removed since a draft was saved needs a new explicit choice.
  await page.evaluate(() => {
    const draft = JSON.parse(
      localStorage.getItem("slop:project-proposal:v1") ?? "{}",
    );
    draft.integrationBranch = "retired-branch";
    localStorage.setItem("slop:project-proposal:v1", JSON.stringify(draft));
  });
  await page.reload();
  await expect(branch.locator("option:checked")).toHaveText("Select a branch");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(branch).toHaveAttribute("aria-invalid", "true");
  await branch.selectOption("development");
  await expect(page.getByLabel("Project name")).toHaveValue("Open Protein");
});

test("failed or partial GitHub lookups never fill unknown facts", async ({
  diagnostics,
  page,
}) => {
  // Chromium logs every non-2xx fetch; the GitHub 404 and 403 lookups are
  // the tested failure paths, not application errors.
  diagnostics.allow(
    /^(?:console Failed to load resource: .* at |\d{3} GET )http:\/\/[^ ]+\/api\/v1\/project-github\//u,
  );
  // A changed or cleared draft cancels its pending lookup below.
  diagnostics.allow(
    /^net::ERR_ABORTED GET http:\/\/[^ ]+\/api\/v1\/project-github\/repositories\/example\/open-protein$/u,
  );
  await routeGitHub(page, { repository: 404 });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await enterRepository(page, "example/open-protein");
  await expect(page.locator("#field-repository-error")).toContainText(
    "GitHub has no public repository with that name.",
  );
  await expect(page.getByLabel("Integration branch")).toBeDisabled();
  await expect(page.getByLabel("Repository numeric ID")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}")
          .repositoryNumericId,
    ),
  ).toBe("");

  await page.unrouteAll();
  await routeGitHub(page, { repository: 403 });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("#field-repository-error")).toContainText(
    "GitHub limited lookups.",
  );
  await expect(page.getByLabel("Integration branch")).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}")
          .repositoryNumericId,
    ),
  ).toBe("");

  await page.unrouteAll();
  await routeGitHub(page, { licensePath: "LICENSE.md" });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
    ),
  ).toMatchObject({
    repositoryNumericId: "123456789",
    repositoryNodeId: "R_fixture",
    licenseSpdx: "",
    licenseCommit: "",
    licenseDigest: "",
  });
  await expect(page.getByLabel("License SPDX")).toHaveCount(0);
  // A response that arrives after the user changes or clears the draft must
  // not restore the previous repository. Only GitHub responses are fixtures.
  for (const action of ["change", "clear"]) {
    await page.unrouteAll();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    await routeGitHub(page, {}, async () => {
      started();
      await pending;
    });
    await enterRepository(page, "");
    await enterRepository(page, "example/open-protein");
    await requested;
    await expect(page.getByLabel("Integration branch")).toBeDisabled();
    if (action === "clear") {
      await enterRepository(page, "");
    } else {
      await enterRepository(page, "example/new-project");
    }
    release();
    await page.waitForLoadState("networkidle");
    const expected = action === "clear" ? "" : "example/new-project";
    await expect(page.getByLabel("GitHub repository")).toHaveValue(expected);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}")
            .repository,
      ),
    ).toBe(expected);
  }
});

test("Robinhood Chain drafts a USDG escrow manifest", async ({
  diagnostics,
  page,
}) => {
  // Chromium logs every non-2xx fetch; the GitHub 404 and 403 lookups are
  // the tested failure paths, not application errors.
  diagnostics.allow(
    /^(?:console Failed to load resource: .* at |\d{3} GET )http:\/\/[^ ]+\/api\/v1\/project-github\//u,
  );
  await routeGitHub(page);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await enterRepository(page, "example/open-protein");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Short description")
    .fill("Reproducible protein-folding benchmarks.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Accepted pull requests with verified tests.");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Monthly rewards").check();
  await page
    .getByRole("group", { name: "Network", exact: true })
    .getByRole("radio", { name: "Robinhood Chain", exact: true })
    .check();
  await page.getByLabel("Monthly amount (USDG)").fill("1000");
  await page.getByRole("button", { name: "Next: Review" }).click();
  const preview = page.getByRole("article", { name: "Listing preview" });
  await expect(preview).toContainText("1,000 USDG on Robinhood Chain · pledge");
  let manifest: Record<string, unknown> | null = null;
  await routeCreation(page, (body) => {
    manifest = body.manifest;
    return {
      status: 201,
      json: {
        project: { id: "open-protein", revision: 1, referrer: null },
        setup: CREATED_SETUP,
      },
    };
  });
  await page.getByRole("button", { name: /Create project/u }).click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  // USDG remains the default Robinhood Chain asset.
  expect(manifest).toMatchObject({
    slopbot: { automaticClosure: true },
    reward: {
      chain: "robinhood",
      currency: "USDG",
      monthlyCapMinor: "1000000000",
      paymentMode: "disabled",
      fundingState: "pledged",
    },
    escrow: { chain: "robinhood", deployments: [] },
    funding: { addresses: [] },
  });
  await expectAccessible(page);
});

test("native rewards keep ETH and SOL units through review and creation", async ({
  page,
}) => {
  await routeGitHub(page, {
    description: "Reproducible protein-folding benchmarks for open research.",
    owned: () => Response.json([]),
  });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await enterRepository(page, "example/open-protein");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Monthly rewards").check();

  for (const id of ["base", "ethereum", "robinhood", "solana"] as const) {
    const network = REWARD_ASSET_NETWORKS[id];
    await page
      .getByRole("group", { name: "Network", exact: true })
      .getByRole("radio", { name: network.name, exact: true })
      .check();
    const assets = page.getByRole("group", { name: "Asset", exact: true });
    await expect(
      assets.getByRole("radio", {
        name: network.stablecoin.symbol,
        exact: true,
      }),
    ).toBeVisible();
    await assets
      .getByRole("radio", {
        name: network.native.symbol,
        exact: true,
      })
      .check();
    await expect(page.getByLabel("Token address")).toHaveCount(0);
    await expect(
      page.locator("main details, main select, .fee-preview"),
    ).toHaveCount(0);
    const amount = page.getByLabel(`Monthly amount (${network.native.symbol})`);
    await amount.fill(
      id === "solana" ? "0.0000000001" : "0.0000000000000000001",
    );
    await page.getByRole("button", { name: "Next: Review" }).click();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    const value = id === "solana" ? "1.000000001" : "1.000000000000000001";
    await amount.fill(value);
    await page.screenshot({
      path: test.info().outputPath(`native-${id}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Next: Review" }).click();
    const preview = page.getByRole("article", { name: "Listing preview" });
    await expect(preview).toContainText(
      `${value} ${network.native.symbol} on ${network.name} · pledge`,
    );
    await expect(preview).not.toContainText("$");
    if (id !== "solana") {
      await page
        .getByRole("navigation", { name: "Setup steps" })
        .getByRole("button", { name: "Rewards", exact: true })
        .click();
    }
  }
  let submitted: Record<string, unknown> | undefined;
  await routeCreation(page, (body) => {
    submitted = body.manifest;
    const network = REWARD_ASSET_NETWORKS.solana;
    assertProjectDefinition({
      ...submitted,
      rewardAsset: {
        ...(submitted.rewardAsset as object),
        chainId: network.chainId,
        cluster: network.cluster,
        decimals: network.native.decimals,
        verifiedAt: "2026-10-29T00:00:00.000Z",
      },
    });
    return {
      status: 201,
      json: {
        project: { id: "open-protein", revision: 1, referrer: null },
        setup: CREATED_SETUP,
      },
    };
  });
  await expectAccessible(page);
  await page.getByRole("button", { name: /Create project/u }).click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  expect(submitted).toMatchObject({
    rewardAsset: {
      kind: "native",
      network: "solana",
      symbol: "SOL",
      address: REWARD_ASSET_NETWORKS.solana.native.address,
    },
    reward: {
      currency: "SOL",
      monthlyCapMinor: "1000000001",
      monthlyCapDisplay: "1.000000001 SOL",
      paymentMode: "disabled",
    },
  });
});

test("a saved native reward with an unknown network stays editable until corrected", async ({
  page,
}) => {
  await routeGitHub(page, {
    description: "Reproducible protein-folding benchmarks for open research.",
  });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await enterRepository(page, "example/open-protein");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Monthly rewards").check();
  await page
    .getByRole("group", { name: "Asset", exact: true })
    .getByRole("radio", { name: "ETH", exact: true })
    .check();
  await page.getByLabel("Monthly amount (ETH)").fill("1");
  await page.evaluate(() => {
    const key = "slop:project-proposal:v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved, settlementChain: "retired-network" }),
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Add a project", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.locator("#field-settlementChain-error")).toHaveText(
    "Choose a supported network.",
  );
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toHaveCount(0);
  const networks = page.getByRole("group", { name: "Network", exact: true });
  await expect(networks.locator("input:checked")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}")
          .settlementChain,
    ),
  ).toBe("retired-network");
  await page.screenshot({
    path: test.info().outputPath("saved-native-network-error.png"),
    fullPage: true,
  });
  await networks.getByRole("radio", { name: "Base", exact: true }).check();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toContainText("1 ETH on Base");
  await page
    .getByRole("navigation", { name: "Setup steps" })
    .getByRole("button", { name: "Rewards", exact: true })
    .click();
  await page.getByLabel("Private bounty", { exact: true }).check();
  await page.getByRole("button", { name: "Next: Review" }).click();
  const bountyPreview = page.getByRole("article", { name: "Listing preview" });
  await expect(bountyPreview).toContainText("1 ETH per accepted finding");
  await expect(bountyPreview).not.toContainText("critical finding");
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("saved-native-network-recovered.png"),
    fullPage: true,
  });
});

test("a signed-in maintainer picks an owned repository and gets suggested text", async ({
  diagnostics,
  page,
}) => {
  // The signed-out session check is a real 401, which Chromium logs.
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 401 .* at https:\/\/[^ ]+\/api\/v1\/points\/me$/u,
  );
  const description =
    "Reproducible protein-folding benchmarks for open research labs.";
  // Only the public repository list for the signed-in login is a new fixture.
  const owned: GithubFixture = (url) => {
    expect(url.searchParams.get("type")).toBe("owner");
    if (url.searchParams.get("page") === "1")
      return Response.json(
        [
          {
            full_name: "example/forked-tool",
            description: null,
            private: false,
            fork: true,
            archived: false,
          },
          {
            full_name: "example/old-notes",
            description: null,
            private: false,
            fork: false,
            archived: true,
          },
        ],
        {
          headers: {
            link: '<https://api.github.com/users/example/repos?type=owner&sort=pushed&per_page=100&page=2>; rel="next"',
          },
        },
      );
    expect(url.searchParams.get("page")).toBe("2");
    return Response.json([
      {
        full_name: "example/open-protein",
        description,
        private: false,
        fork: false,
        archived: false,
      },
    ]);
  };
  let signedIn = false;
  await page.route(`${deployment.site}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/v1/projects" &&
      route.request().method() === "GET"
    ) {
      await route.fulfill({
        json: { schemaVersion: "1", projects: [], restrictions: [] },
      });
      return;
    }
    if (url.pathname === "/api/v1/project-session") {
      await route.fulfill({
        json: {
          session: signedIn
            ? { githubId: "987654321", githubLogin: "example", admin: false }
            : null,
        },
      });
      return;
    }
    if (url.pathname === "/api/v1/project-setup") {
      await route.fulfill({ json: { projects: [], applications: [] } });
      return;
    }
    if (url.pathname === "/api/v1/points/me") {
      if (signedIn)
        await route.fulfill({
          json: {
            actor: { id: "MDQ6VXNlcjk4NzY1NDMyMQ==", login: "example" },
            joinedAt: "2026-10-01T00:00:00.000Z",
            public: false,
            welcome: 5,
            socialPoints: 0,
          },
        });
      else await route.fulfill({ status: 401, json: {} });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    await route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        route.request().resourceType() === "document"
          ? "index.html"
          : url.pathname,
      ),
    });
  });

  // Registered last, so it takes precedence over the site fixture above.
  await routeGitHub(page, { description, owned });
  // Signed out, the page offers GitHub sign-in that returns here.
  await page.goto(`${deployment.site}/projects/new`);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toHaveAttribute("href", "/login?next=%2Fprojects%2Fnew");
  await expect(page.getByLabel("Integration branch")).toBeDisabled();

  signedIn = true;
  await page.reload();
  const picker = page.getByRole("combobox", {
    name: "GitHub repository",
    exact: true,
  });
  await expect(
    picker.locator('option[value="example/open-protein"]'),
  ).toHaveCount(1);
  await expect(
    picker.locator('option[value="example/forked-tool"]'),
  ).toHaveCount(1);
  await expect(picker.locator('option[value="example/old-notes"]')).toHaveCount(
    0,
  );
  await picker.selectOption("example/open-protein");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  await expect(page.getByLabel("GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
    ),
  ).toMatchObject({
    repositoryNumericId: "123456789",
    repositoryNodeId: "R_fixture",
  });
  await expect(page.getByLabel("Project name")).toHaveValue("open-protein");
  await expect(page.getByLabel("Short description")).toHaveValue(description);
  await expect(page.getByLabel("Goal")).toHaveValue(description);
  // Fresh projects retain Unknown terms without asking for legal evidence.
  await expect(page.getByLabel("Copyright model")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
    ),
  ).toMatchObject({ copyrightModel: "unknown", inboundMode: "unknown" });
  // The maintainer's own words survive a later lookup of the same repository.
  await page.getByLabel("Project name").fill("Open Protein");
  await enterRepository(page, "");
  await enterRepository(page, "example/open-protein");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  await expect(page.getByLabel("Project name")).toHaveValue("Open Protein");
  await page
    .getByRole("button", { name: "Choose from your repositories", exact: true })
    .click();
  await expect(picker).toHaveValue("example/open-protein");
  await expect(picker).toBeFocused();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(page.getByLabel("Points only")).toBeChecked();
  await expectAccessible(page);
});

for (const [name, expectedId] of [
  ["한글 프로젝트", "open-protein"],
  [
    `${"a".repeat(MAX_PROJECT_ID_LENGTH - 1)} b`,
    "a".repeat(MAX_PROJECT_ID_LENGTH - 1),
  ],
]) {
  test(`submits a valid project identity for ${name}`, async ({ page }) => {
    await routeGitHub(page);
    await page.route("**/api/v1/project-session", (route) =>
      route.fulfill({
        json: {
          session: {
            githubId: "4242",
            githubLogin: "example-maintainer",
            admin: false,
          },
        },
      }),
    );
    // Without monthly funding the manifest names no reward asset; with one,
    // the server adds reviewed stablecoin metadata before validation.
    const validate = (manifest: Record<string, unknown>) => {
      const network = REWARD_ASSET_NETWORKS.base;
      return assertProjectDefinition(
        manifest.rewardAsset === undefined
          ? manifest
          : {
              ...manifest,
              rewardAsset: {
                ...(manifest.rewardAsset as object),
                decimals: network.stablecoin.decimals,
                chainId: network.chainId,
                cluster: network.cluster,
                verifiedAt: "2026-10-20T00:00:00.000Z",
              },
            },
      );
    };
    let submitted: unknown;
    await routeCreation(page, (body) => {
      submitted = body.manifest;
      validate(body.manifest);
      return {
        status: 201,
        json: {
          project: { id: expectedId, revision: 1, referrer: null },
          setup: { ...CREATED_SETUP, projectId: expectedId, slug: expectedId },
        },
      };
    });
    await page.goto("/projects/new", { waitUntil: "networkidle" });
    await enterRepository(page, "example/open-protein");
    await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
    await page.getByLabel("Project name").fill(name);
    await page
      .getByLabel("Short description")
      .fill("Reproducible protein-folding benchmarks.");
    await page.getByLabel("Goal").fill("Make protein research reproducible.");
    await page.getByRole("button", { name: "Next: Rewards" }).click();
    await page.getByRole("button", { name: "Next: Review" }).click();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(
      page.getByRole("heading", { name: "Project created" }),
    ).toBeVisible();
    const manifest = submitted as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: expectedId,
      slug: expectedId,
      name,
      skill: {
        id: `contribute-to-${expectedId}`,
        publicPath: `/projects/${expectedId}/skill.md`,
      },
      reviewSkill: { id: `review-${expectedId}-contributions` },
    });
  });
}
