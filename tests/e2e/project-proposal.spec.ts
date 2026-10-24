/**
 * The setup wizard reads public GitHub facts through the same-origin
 * /api/v1/project-github API. The preview lane has no Pages Functions, so the
 * route below runs the real server lookup code against fixtures of GitHub's
 * REST responses; the page, validation, manifest and handoff are the real
 * application, and the browser never calls api.github.com.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
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

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

const LICENSE_TEXT = "MIT License\n\nCopyright (c) Example Research\n";
const COMMIT = "c".repeat(40);

type GithubFixture = (url: URL) => Promise<Response> | Response;

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
    if (owned && url.pathname === "/users/example/repos") return owned(url);
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

function observe(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Chromium logs every non-2xx fetch; the GitHub 404/403 cases are the
    // tested failure paths, not application errors.
    if (
      message.type() === "error" &&
      !message.location().url.includes("/api/v1/project-github/")
    )
      errors.push(message.text());
  });
  return errors;
}

test("drafts a project through the setup steps and creates it without an admin", async ({
  page,
}) => {
  const errors = observe(page);
  await routeGitHub(page);
  // The registry API itself runs in the @registry lane; here it is a fixture
  // so the wizard's submission can be checked byte for byte.
  let submitted: {
    manifest: Record<string, unknown>;
    referrer?: string;
  } | null = null;
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
  for (const label of ["Repository", "Contribution rules", "Rewards", "Review"])
    await expect(steps.getByRole("button", { name: label })).toBeVisible();
  await page
    .getByLabel("Public GitHub repository")
    .fill("https://github.com/example/open-protein.git");
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "Found example/open-protein",
  );
  const facts = page.locator(".proposal-facts");
  await expect(facts).toContainText("123456789");
  await expect(facts).toContainText("@example · organization");
  await expect(facts).toContainText("MIT · LICENSE at ccccccc");
  await expect(page.getByLabel("Integration branch")).toHaveValue("trunk");
  // Repository facts must not survive a different repository, including after
  // restoring a saved draft. The lookup response remains an explicit fixture.
  await page.reload();
  await page
    .getByLabel("Public GitHub repository")
    .fill("example/another-repository");
  await expect(facts).not.toContainText("123456789");
  await expect(facts).not.toContainText("MIT · LICENSE at ccccccc");
  await expect(page.getByLabel("Integration branch")).toHaveValue("main");
  await page
    .getByLabel("Public GitHub repository")
    .fill("example/open-protein");
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "Found example/open-protein",
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  // The lookup suggests a name and editable default criteria (PRJ-03). With no
  // repository description, only the description and goal stay empty.
  await expect(page.getByLabel("Project name")).toHaveValue("open-protein");
  await expect(page.getByLabel("Acceptance criteria")).toHaveValue(
    /^Merged pull requests that fix a reproduced bug/u,
  );
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  const summary = page.locator(".form-error-summary");
  await expect(summary).toContainText("Fix 2 fields to continue");
  await expect(summary).toBeFocused();
  await summary.getByRole("button", { name: "Short description" }).click();
  await expect(page.getByLabel("Short description")).toBeFocused();
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Short description")
    .fill("Reproducible protein-folding benchmarks.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Accepted pull requests with verified tests.");
  await expect(page.getByLabel("Copyright model")).toHaveValue("unknown");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  // Funding is optional; asset and vault details follow the choice.
  await expect(page.getByLabel("No monthly funding")).toBeChecked();
  await expect(page.getByLabel("Network")).toHaveCount(0);
  await expect(page.getByLabel(/review budget/iu)).toHaveCount(0);
  await page.getByLabel("Pay contributors a monthly amount").check();
  await page.getByLabel("Network").selectOption("solana");
  await expect(page.getByLabel(/USD$/u)).toHaveCount(0);
  await page.getByLabel("Monthly amount (USDC)").fill("2500");
  await expect(page.locator(".fee-preview")).toContainText(
    "Payout fee: 2%. Unused-fund withdrawal fee: 2%.",
  );
  await page.getByRole("button", { name: "Next: Review" }).click();

  const preview = page.getByRole("article", { name: "Listing preview" });
  await expect(preview).toContainText("Preview");
  await expect(preview).toContainText("Open Protein");
  await expect(preview).toContainText("2,500 USDC on Solana · pledge");
  await expect(preview).not.toContainText("$");
  await expect(preview).toContainText("MIT");
  await expect(preview).toContainText("Referred by");
  await expect(preview).toContainText("@example-referrer");
  await expect(
    preview.getByRole("button", { name: "Clear referral" }),
  ).toBeVisible();
  // PRD section 4: the generated contributor skill tells capable agents to
  // star and fork, and asks for the requirement and implementation choice.
  await page.getByText("Preview generated contributor skill").click();
  const contributorSkill = page.getByLabel("Contributor skill SKILL.md");
  await expect(contributorSkill).toHaveValue(
    /If you can use computer use or browser use, star and fork\s+`[^`]+\/[^`]+` on github\.com/u,
  );
  await expect(contributorSkill).toHaveValue(
    /the requirement it serves[\s\S]+the implementation choice/u,
  );
  const handoff = page.getByRole("button", { name: /Create project/u });
  await expect(
    page.getByRole("button", { name: "Download manifest" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy manifest" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Project manifest JSON")).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  // Creation posts the reviewed manifest, criteria and monthly amount, then
  // shows one setup status with the next action.
  await handoff.click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  await expect(page.locator(".proposal-submitted")).toContainText(
    "Referred by @example-referrer.",
  );
  await expect(
    page.getByRole("heading", {
      name: "Setup status: Waiting for the security scan",
    }),
  ).toBeVisible();
  const setupPanel = page.locator(".project-setup-status");
  await expect(setupPanel.locator(".setup-badge")).toContainText([
    "Confirmed",
    "Installed",
    "Queued",
  ]);
  const details = setupPanel.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("@example-maintainer has admin access");
  await expectAccessibleSetup();
  async function expectAccessibleSetup() {
    expect(
      (
        await new AxeBuilder({ page })
          .include(".project-setup-status")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
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
    steward: { github: { login: "example", actorId: "987654321" } },
    reward: {
      chain: "solana",
      monthlyCapMinor: "2500000000",
      committedMinor: "0",
      paymentMode: "disabled",
      fundingState: "pledged",
      // PRD section 11, owner decision of 24 October 2026 (D3).
      feeBasisPoints: 200,
    },
    funding: {
      disclosure:
        "Funds are committed in the project vault. Slop holds no payment keys.",
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
    repositories: [{ id: "example/open-protein", integrationBranch: "trunk" }],
  });
  expect(posted?.reward).not.toHaveProperty("reviewBudget");

  // The draft persists on this device without credentials and never claims
  // to be a listing. Clearing it needs a second confirmation.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "4. Review", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Setup steps" })
    .getByRole("button", { name: "Repository" })
    .click();
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}"),
  );
  expect(stored.name).toBe("Open Protein");
  expect(
    Object.keys(stored).some((key) => /token|secret|key$/iu.test(key)),
  ).toBe(false);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("failed or partial GitHub lookups never fill unknown facts", async ({
  page,
}) => {
  const errors = observe(page);
  await routeGitHub(page, { repository: 404 });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page
    .getByLabel("Public GitHub repository")
    .fill("example/open-protein");
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "GitHub has no public repository with that name. Nothing was filled in.",
  );
  await expect(page.locator(".proposal-facts")).toContainText("Not looked up");
  await expect(page.getByLabel("Repository numeric ID")).toBeVisible();
  await expect(page.getByLabel("Repository numeric ID")).toHaveValue("");

  await page.unrouteAll();
  await routeGitHub(page, { repository: 403 });
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "GitHub limited lookups. Try again later or enter the facts by hand.",
  );
  await expect(page.getByLabel("Repository numeric ID")).toHaveValue("");

  await page.unrouteAll();
  await routeGitHub(page, { licensePath: "LICENSE.md" });
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "License stays unknown: The license file is LICENSE.md.",
  );
  await expect(page.getByLabel("Repository numeric ID")).toHaveValue(
    "123456789",
  );
  await expect(page.getByLabel("License SPDX")).toHaveValue("");
  await expect(page.locator(".proposal-facts")).toContainText("Unknown");
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
    await page
      .getByLabel("Public GitHub repository")
      .fill("example/open-protein");
    await page.getByRole("button", { name: "Look up on GitHub" }).click();
    await requested;
    if (action === "clear") {
      await page.getByRole("button", { name: "Start over" }).click();
      await page.getByRole("button", { name: "Clear draft" }).click();
    } else {
      await page
        .getByLabel("Public GitHub repository")
        .fill("example/new-project");
    }
    release();
    await page.waitForLoadState("networkidle");
    const expected = action === "clear" ? "" : "example/new-project";
    await expect(page.getByLabel("Public GitHub repository")).toHaveValue(
      expected,
    );
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slop:project-proposal:v1") ?? "{}")
            .repository,
      ),
    ).toBe(expected);
  }
  expect(errors).toEqual([]);
});

test("Robinhood Chain drafts a USDG escrow manifest", async ({ page }) => {
  const errors = observe(page);
  await routeGitHub(page);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page
    .getByLabel("Public GitHub repository")
    .fill("example/open-protein");
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "Found example/open-protein",
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await page.getByLabel("Project name").fill("Open Protein");
  await page
    .getByLabel("Short description")
    .fill("Reproducible protein-folding benchmarks.");
  await page.getByLabel("Goal").fill("Make protein research reproducible.");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Accepted pull requests with verified tests.");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Pay contributors a monthly amount").check();
  const network = page.getByLabel("Network");
  await network.selectOption("robinhood");
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
  // USDG is the one Robinhood Chain asset, and the chain is escrow only.
  expect(manifest).toMatchObject({
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
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("a signed-in maintainer picks an owned repository and gets suggested text", async ({
  page,
}) => {
  const errors = observe(page);
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
  await expect(page.getByLabel("Your repositories")).toHaveCount(0);

  signedIn = true;
  await page.reload();
  const picker = page.getByLabel("Your repositories");
  await expect(picker.locator("option")).toHaveText([
    "Choose a repository",
    "example/open-protein",
  ]);
  await picker.selectOption("example/open-protein");
  await expect(page.locator(".lookup-status")).toContainText(
    "Found example/open-protein",
  );
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue(
    "example/open-protein",
  );
  await expect(page.locator(".proposal-facts")).toContainText("123456789");
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("open-protein");
  await expect(page.getByLabel("Short description")).toHaveValue(description);
  await expect(page.getByLabel("Goal")).toHaveValue(description);
  // Ownership terms stay Unknown and folded away unless the maintainer opens them.
  const terms = page.locator("details", {
    has: page.getByText("Ownership and contribution terms (optional)"),
  });
  await expect(terms).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Copyright model")).toHaveValue("unknown");
  // The maintainer's own words survive a later lookup of the same repository.
  await page.getByLabel("Project name").fill("Open Protein");
  await page.getByRole("button", { name: "1 Repository" }).click();
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    "Found example/open-protein",
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Open Protein");
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await expect(page.getByLabel("No monthly funding")).toBeChecked();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  // The signed-out session check is a real 401, which Chromium logs.
  expect(
    errors.filter((message) => !message.includes("status of 401")),
  ).toEqual([]);
});

for (const [name, expectedId] of [
  ["한글 프로젝트", "open-protein"],
  [
    `${"a".repeat(MAX_PROJECT_ID_LENGTH - 1)} b`,
    "a".repeat(MAX_PROJECT_ID_LENGTH - 1),
  ],
]) {
  test(`submits a valid project identity for ${name}`, async ({ page }) => {
    const errors = observe(page);
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
    await page
      .getByLabel("Public GitHub repository")
      .fill("example/open-protein");
    await page.getByRole("button", { name: "Look up on GitHub" }).click();
    await expect(page.locator(".lookup-status")).toContainText(
      "Found example/open-protein",
    );
    await page
      .getByRole("button", { name: "Next: Contribution rules" })
      .click();
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
    expect(() => validate(manifest)).not.toThrow();
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
    expect(errors).toEqual([]);
  });
}
