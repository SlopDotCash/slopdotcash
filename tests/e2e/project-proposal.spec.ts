/**
 * The setup wizard reads public GitHub facts. These routes are test fixtures
 * for GitHub's REST responses so the run does not depend on its rate limit;
 * the page, validation, manifest and handoff are the real application.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

const LICENSE_TEXT = "MIT License\n\nCopyright (c) Example Research\n";
const COMMIT = "c".repeat(40);

async function routeGitHub(
  page: Page,
  {
    repository = 200,
    licensePath = "LICENSE",
    description = null as string | null,
  } = {},
  beforeRepository?: () => Promise<void>,
) {
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/repos/example/open-protein") {
      await beforeRepository?.();
      return route.fulfill({
        status: repository,
        json:
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
      });
    }
    if (url.pathname === "/repos/example/open-protein/branches/trunk")
      return route.fulfill({ json: { commit: { sha: COMMIT } } });
    if (url.pathname === "/repos/example/open-protein/license") {
      expect(url.searchParams.get("ref")).toBe(COMMIT);
      return route.fulfill({
        json: {
          path: licensePath,
          encoding: "base64",
          content: Buffer.from(LICENSE_TEXT).toString("base64"),
          license: { spdx_id: "MIT" },
        },
      });
    }
    return route.fulfill({ status: 500, json: {} });
  });
}

// The preview lane has no Pages Functions; the registry lane tests the API.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
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
      !message.location().url.startsWith("https://api.github.com/")
    )
      errors.push(message.text());
  });
  return errors;
}

test("drafts a project through the setup steps and submits it for review", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = observe(page);
  await routeGitHub(page);
  // The registry API itself runs in the @registry lane; here it is a fixture
  // so the wizard's submission can be checked byte for byte.
  let submitted: { manifest: Record<string, unknown> } | null = null;
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
  await page.route("**/api/v1/project-applications", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        application: {
          id: "app_fixture0001",
          projectId: "open-protein",
          repository: "example/open-protein",
          manifest: submitted?.manifest,
          manifestSha256: "a".repeat(64),
          acceptanceCriteria: "Accepted pull requests with verified tests.",
          applicant: { githubId: "4242", githubLogin: "example-maintainer" },
          submittedAt: "2026-10-18T00:00:00.000Z",
          status: "pending",
          adminNotification: "sent",
          adminNotificationAt: "2026-10-18T00:00:00.000Z",
          decidedAt: null,
          decidedBy: null,
          decisionReason: null,
          githubCheck:
            "Not proven: @example-maintainer is not a public member of example",
        },
      },
    });
  });
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  const steps = page.getByRole("navigation", { name: "Setup steps" });
  for (const label of [
    "Repository",
    "Contribution rules",
    "Rewards",
    "Funding",
    "Review",
  ])
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
  await page.getByLabel("Payout network").selectOption("solana");
  await page.getByLabel("Monthly pool target, USD").fill("2500");
  await expect(page.getByLabel("Monthly review budget, USD")).toHaveCount(0);
  await page.getByLabel("Add a separate review budget").check();
  await page.getByLabel("Monthly review budget, USD").fill("50");
  await page.getByRole("button", { name: "Next: Funding" }).click();
  await expect(page.locator(".activation-gates")).toContainText(
    "Project vault: not deployed",
  );
  await page.getByRole("button", { name: "Next: Review" }).click();

  const preview = page.getByRole("article", { name: "Listing preview" });
  await expect(preview).toContainText("Draft · not listed");
  await expect(preview).toContainText("Open Protein");
  await expect(preview).toContainText("$2,500 · unfunded pledge");
  await expect(preview).toContainText("Solana · payments disabled");
  await expect(preview).toContainText("MIT");
  const manifestDetails = page.locator("details.manifest-preview");
  await expect(manifestDetails).not.toHaveAttribute("open", "");
  const handoff = page.getByRole("button", { name: /Submit for review/u });
  await expect(page.locator(".handoff-actions")).toContainText(
    "You submit as @example-maintainer.",
  );
  const alternatives = page.locator(".handoff-alternatives");
  expect(
    await handoff.evaluate(
      (link, other) =>
        Boolean(
          other &&
            link.compareDocumentPosition(other) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await alternatives.elementHandle(),
    ),
  ).toBe(true);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download manifest" }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Missing manifest download");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  expect(manifest).toMatchObject({
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
      reviewBudget: { monthlyCapMinor: "50000000", fundingState: "pledged" },
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

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.getByRole("button", { name: "Copy manifest" }).click();
  await expect(
    page.getByRole("button", { name: "Copy unavailable; select the manifest" }),
  ).toBeVisible();
  await expect(manifestDetails).toHaveAttribute("open", "");
  await expect(page.getByLabel("Project manifest JSON")).toHaveValue(
    /"monthlyCapMinor": "2500000000"/u,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  // Submission posts the reviewed manifest and criteria, then confirms it.
  await handoff.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Application submitted" }),
  ).toContainText(
    "Application app_fixture0001 · submitted by @example-maintainer",
  );
  expect(submitted).toMatchObject({
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

  // The draft persists on this device without credentials and never claims
  // to be a listing. Clearing it needs a second confirmation.
  await page.reload();
  await expect(page.getByText("Your saved draft was restored.")).toBeVisible();
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
    "GitHub limited lookups from this network",
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
  const network = page.getByLabel("Payout network");
  await network.selectOption("robinhood");
  await expect(network.locator("option:checked")).toHaveText("Robinhood Chain");
  await page.getByLabel("Monthly pool target, USD").fill("1000");
  await page.getByRole("button", { name: "Next: Funding" }).click();
  await expect(page.locator(".activation-gates")).toContainText(
    "A reviewed Robinhood Chain deployment is required first.",
  );
  await page.getByRole("button", { name: "Next: Review" }).click();
  const preview = page.getByRole("article", { name: "Listing preview" });
  await expect(preview).toContainText("Robinhood Chain · payments disabled");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download manifest" }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("Missing manifest download");
  const manifest = JSON.parse(await readFile(path, "utf8"));
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
  await routeGitHub(page, { description });
  // Only the public repository list for the signed-in login is a new fixture.
  await page.route(
    "https://api.github.com/users/example/repos?**",
    async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("type")).toBe("owner");
      expect(route.request().headers().authorization).toBeUndefined();
      if (url.searchParams.get("page") === "1") {
        await route.fulfill({
          headers: {
            "access-control-expose-headers": "Link",
            link: '<https://api.github.com/users/example/repos?type=owner&sort=pushed&per_page=100&page=2>; rel="next"',
          },
          json: [
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
        });
        return;
      }
      expect(url.searchParams.get("page")).toBe("2");
      await route.fulfill({
        json: [
          {
            full_name: "example/open-protein",
            description,
            private: false,
            fork: false,
            archived: false,
          },
        ],
      });
    },
  );
  let signedIn = false;
  await page.route(`${deployment.site}/**`, async (route) => {
    const url = new URL(route.request().url());
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
  await expect(page.getByLabel("Payout network")).toBeVisible();
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
