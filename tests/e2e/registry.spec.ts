/**
 * Runs the D1 project registry end to end on the shipped build: the real
 * Pages Functions, a fresh local D1 with every migration, and three seeded
 * site sessions. scripts/run-e2e.mjs creates the sessions and serves the
 * loopback GitHub API fixture; the browser's GitHub lookup is mocked from the
 * same facts, so the run never depends on GitHub's rate limit.
 */
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { fixtureRepository } from "../github-api-fixture.mjs";

const APPLICANT_TOKEN = process.env.SLOP_E2E_APPLICANT_TOKEN ?? "";
const ADMIN_TOKEN = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
const OWNER_TOKEN = process.env.SLOP_E2E_OWNER_TOKEN ?? "";

test.describe.configure({ mode: "serial" });

/**
 * Every viewport shares one D1, so each uses its own repositories and project
 * ids instead of assuming the registry it finds is empty. The organization
 * repository cannot prove control; the user repository belongs to e2e-owner.
 */
function fixtureProjects() {
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const words = suffix.replaceAll("-", " ");
  return {
    queued: {
      repository: `example/open-registry-${suffix}`,
      id: `open-registry-${suffix}`,
      name: `Open Registry ${words}`,
    },
    owned: {
      repository: `e2e-owner/owned-registry-${suffix}`,
      id: `owned-registry-${suffix}`,
      name: `Owned Registry ${words}`,
    },
  };
}

/** Sets the /login session cookie; local http origins are secure contexts. */
async function signIn(page: Page, token: string) {
  if (!token) throw new Error("Missing E2E session");
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate((value) => {
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, token);
}

function observe(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Other APIs reject this local origin, and the GitHub fixture answers 404
    // for the missing license; only application failures count.
    if (
      message.type() === "error" &&
      !message.location().url.startsWith("https://api.github.com/") &&
      !/\/api\/v1\/(points|payments)\//u.test(message.location().url)
    )
      errors.push(message.text());
  });
  return errors;
}

async function expectAccessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function routeGitHub(page: Page) {
  await page.route("https://api.github.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const match = /^\/repos\/([^/]+\/[^/]+)$/u.exec(path);
    return match
      ? route.fulfill({ json: fixtureRepository(match[1]) })
      : route.fulfill({ status: 404, json: { message: "Not Found" } });
  });
}

async function draftApplication(
  page: Page,
  project: { repository: string; name: string },
) {
  await routeGitHub(page);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByLabel("Public GitHub repository").fill(project.repository);
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    `Found ${project.repository}`,
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await page.getByLabel("Project name").fill(project.name);
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Monthly pool target, USD").fill("1000");
  await page.getByRole("button", { name: "Next: Funding" }).click();
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toContainText("$1,000 · unfunded pledge");
}

async function listedProject(page: Page, id: string) {
  const body = await (await page.request.get("/api/v1/projects")).json();
  return body.projects.find((entry: { id: string }) => entry.id === id);
}

test("the shipped build lists no project @registry", async ({ page }) => {
  const errors = observe(page);
  const projects = await page.request.get("/api/v1/projects");
  expect(projects.status()).toBe(200);
  expect(await projects.json()).toMatchObject({ schemaVersion: "1" });
  await page.goto("/", { waitUntil: "networkidle" });
  const section = page.locator("#projects");
  await expect(section).toContainText("No projects are listed yet.");
  await expect(
    section.getByRole("link", { name: "Add a project" }),
  ).toHaveAttribute("href", "/projects/new");
  await expectAccessible(page);
  expect(errors).toEqual([]);
});

test("a signed-out visitor must sign in before submitting @registry", async ({
  page,
}) => {
  const errors = observe(page);
  await draftApplication(page, fixtureProjects().queued);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub to submit" }),
  ).toHaveAttribute("href", /\/login\?next=%2Fprojects%2Fnew$/u);
  await expect(
    page.getByRole("button", { name: /Submit for review/u }),
  ).toHaveCount(0);
  const forged = await page.request.post("/api/v1/project-applications", {
    data: {},
    headers: { origin: "https://attacker.example" },
  });
  expect(forged.status()).toBe(403);
  await expectAccessible(page);
  expect(errors).toEqual([]);
});

test("an unproven application waits for an admin, who lists it paused @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().queued;
  const applicantContext = await browser.newContext();
  const applicant = await applicantContext.newPage();
  const applicantErrors = observe(applicant);
  await signIn(applicant, APPLICANT_TOKEN);
  await draftApplication(applicant, project);
  await applicant.getByRole("button", { name: /Submit for review/u }).click();
  const receipt = applicant.getByRole("status").filter({
    hasText: "Application submitted",
  });
  await expect(receipt).toContainText(
    `${project.name} is waiting for admin review`,
  );
  await expect(receipt).toContainText(
    "GitHub check: Not proven: @e2e-applicant is not a public member of example",
  );
  await expect(receipt).toContainText("submitted by @e2e-applicant");
  await expectAccessible(applicant);
  expect(await listedProject(applicant, project.id)).toBeUndefined();

  // An applicant is not an admin, so the review queue stays closed.
  await applicant.goto("/admin", { waitUntil: "networkidle" });
  await expect(applicant.getByRole("alert")).toContainText(
    "@e2e-applicant is not a Slop admin",
  );
  expect(applicantErrors).toEqual([]);
  await applicantContext.close();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminErrors = observe(admin);
  await signIn(admin, ADMIN_TOKEN);
  await admin.goto("/admin", { waitUntil: "networkidle" });
  const card = admin.locator(".admin-card", { hasText: project.repository });
  await expect(card).toContainText(project.name);
  await expect(card).toContainText("$1,000 pledged");
  // No notify Worker runs locally, so the stored application says so.
  await expect(card).toContainText("Failed to send");
  await expectAccessible(admin);
  await card.getByRole("button", { name: "Approve as paused project" }).click();
  const listedCard = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await expect(listedCard).toContainText("paused");
  await expect(listedCard).toContainText("1 · updated");
  await expect(listedCard).toContainText("Generated from revision 1");

  expect(await listedProject(admin, project.id)).toMatchObject({
    status: "paused",
    listingTier: "community",
    skill: {
      id: `contribute-to-${project.id}`,
      sourcePath: "skills/project-contributor-template",
    },
    reward: { monthlyCapMinor: "1000000000", paymentMode: "disabled" },
    contribution: {
      approvedScope: expect.stringMatching(/^Merged pull requests/u),
    },
  });
  const history = await (
    await admin.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (entry: { projectId: string }) => entry.projectId === project.id,
    ),
  ).toMatchObject([{ revision: 1 }]);
  expect(adminErrors).toEqual([]);
  await adminContext.close();
});

test("an owner's proof and generated skills reach the admin, who lists and delists it @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().owned;
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const ownerErrors = observe(owner);
  await signIn(owner, OWNER_TOKEN);
  await draftApplication(owner, project);
  await owner.getByRole("button", { name: /Submit for review/u }).click();
  const receipt = owner.getByRole("status").filter({
    hasText: "Application submitted",
  });
  await expect(receipt).toContainText(
    `GitHub check: Proven: @e2e-owner owns ${project.repository}`,
  );
  await expectAccessible(owner);
  // Every application waits for an admin, even a proven owner's (PRJ-02).
  expect(await listedProject(owner, project.id)).toBeUndefined();
  const mine = await (
    await owner.request.get("/api/v1/project-applications/mine", {
      headers: { cookie: `__Host-slop_points=${OWNER_TOKEN}` },
    })
  ).json();
  const listed = mine.applications.find(
    (entry: { projectId: string }) => entry.projectId === project.id,
  ).manifest;

  // Facts that GitHub does not confirm are refused, never listed.
  // The request API keeps the expected 422 out of the page console.
  const forgedResponse = await owner.request.post(
    "/api/v1/project-applications",
    {
      // The request client sends no Secure cookie over local http.
      headers: {
        origin: new URL(owner.url()).origin,
        cookie: `__Host-slop_points=${OWNER_TOKEN}`,
      },
      data: {
        manifest: {
          ...listed,
          id: `${project.id}-forged`,
          slug: `${project.id}-forged`,
          skill: {
            ...listed.skill,
            publicPath: `/projects/${project.id}-forged/skill.md`,
          },
          repositories: [
            {
              ...listed.repositories[0],
              id: `${project.repository}-forged`,
              displayName: `${project.repository}-forged`,
              githubUrl: `https://github.com/${project.repository}-forged`,
            },
          ],
          links: {
            ...listed.links,
            repository: `https://github.com/${project.repository}-forged`,
          },
        },
      },
    },
  );
  const forged = {
    status: forgedResponse.status(),
    body: await forgedResponse.json(),
  };
  expect(forged).toMatchObject({
    status: 422,
    body: { error: "invalid_manifest" },
  });
  expect(ownerErrors).toEqual([]);
  await ownerContext.close();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminErrors = observe(admin);
  await signIn(admin, ADMIN_TOKEN);
  await admin.goto("/admin", { waitUntil: "networkidle" });
  const application = admin.locator(".admin-card", {
    hasText: project.repository,
  });
  await expect(application).toContainText(
    `Proven: @e2e-owner owns ${project.repository}`,
  );
  // The admin reviews the exact generated skill before approving it.
  await application
    .getByText("Preview generated contributor skill", { exact: true })
    .click();
  await expect(
    application.getByLabel("Contributor skill SKILL.md"),
  ).toHaveValue(new RegExp(`# Contribute to ${project.repository}`, "u"));
  await expect(
    application.getByLabel("Contributor skill project.json"),
  ).toHaveValue(/"approvedScope": "Merged pull requests/u);
  await expectAccessible(admin);
  await application
    .getByRole("button", { name: "Approve as paused project" })
    .click();
  const card = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await expect(card).toContainText("Generated from revision 1");

  // The installer's trust root: the exact approved bytes and their digest.
  const revision = await (
    await admin.request.get(`/api/v1/project-revisions/${project.id}/1`)
  ).json();
  expect(createHash("sha256").update(revision.manifestText).digest("hex")).toBe(
    revision.manifestSha256,
  );
  expect(JSON.parse(revision.manifestText)).toMatchObject({
    id: project.id,
    skill: { sourcePath: "skills/project-contributor-template" },
  });

  await card.getByRole("button", { name: "Delist", exact: true }).click();
  await card.getByRole("button", { name: "Delist project" }).click();
  await expect(admin.getByRole("status")).toContainText("Saved.");
  await expect(card).toContainText("Delisted.");
  expect(await listedProject(admin, project.id)).toMatchObject({
    status: "paused",
    listingTier: "retired",
  });
  expect(adminErrors).toEqual([]);
  await adminContext.close();
});
