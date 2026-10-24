/**
 * Runs the D1 project registry end to end on the shipped build: the real
 * Pages Functions, a fresh local D1 with every migration, and four seeded
 * site sessions. scripts/run-e2e.mjs creates the sessions and serves the
 * loopback GitHub API fixture, which both the ownership check and the
 * same-origin setup lookups read, so the run never depends on GitHub's rate
 * limit. Project pages, skills and archives come from D1 with no rebuild.
 * A throwaway Ed25519 key stands in for the external secure-VM vetting
 * service, so the lane signs harmless scan results the way the service must.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_SHA,
  vettingResult,
} from "../vetting-fixtures";

const APPLICANT_TOKEN = process.env.SLOP_E2E_APPLICANT_TOKEN ?? "";
const ADMIN_TOKEN = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
const OWNER_TOKEN = process.env.SLOP_E2E_OWNER_TOKEN ?? "";
const MODERATOR_TOKEN = process.env.SLOP_E2E_MODERATOR_TOKEN ?? "";
const VETTING_PUBLIC_KEY = process.env.SLOP_E2E_VETTING_PUBLIC_KEY ?? "";
const VETTING_PRIVATE_KEY = process.env.SLOP_E2E_VETTING_PRIVATE_KEY ?? "";
const GITHUB_FIXTURE = process.env.SLOP_E2E_GITHUB_API_ORIGIN ?? "";

function walkthroughOptions() {
  return process.env.SLOP_E2E_VIDEO === "1"
    ? { recordVideo: { dir: test.info().outputPath("walkthrough-videos") } }
    : {};
}

/** Posts a harmless signed scan result for the project's queued scan. */
async function postVettingResult(
  request: APIRequestContext,
  projectId: string,
  repository: string,
  disposition: "clean" | "incomplete" | "malicious",
) {
  if (!VETTING_PUBLIC_KEY || !VETTING_PRIVATE_KEY)
    throw new Error("Missing E2E vetting key");
  const decode = (value: string) =>
    Uint8Array.from(Buffer.from(value, "base64"));
  const publicKey = decode(VETTING_PUBLIC_KEY);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decode(VETTING_PRIVATE_KEY),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const queue = await request.get("/api/v1/vetting/requests", {
    headers: await signedVettingHeaders(
      privateKey,
      publicKey,
      "GET",
      "/api/v1/vetting/requests",
      "",
    ),
  });
  expect(queue.status()).toBe(200);
  const queued = (
    (await queue.json()) as {
      assessments: {
        assessmentId: string;
        projectId: string;
        revision: number;
        manifestSha256: string;
        commitSha: string;
        templateSha256: string;
      }[];
    }
  ).assessments.find((entry) => entry.projectId === projectId);
  if (queued === undefined) throw new Error("No queued scan for the project");
  const evidencePath = `/api/v1/vetting/evidence/${queued.assessmentId}/vm-run-${queued.revision}`;
  const evidenceManifest = JSON.stringify({
    traceSha256: VETTING_TRACE_SHA,
    objects: VETTING_EVIDENCE_OBJECTS.map(
      ({ body: _body, ...object }) => object,
    ),
  });
  for (const [method, path, data] of [
    ["POST", evidencePath, evidenceManifest],
    ...VETTING_EVIDENCE_OBJECTS.map((object) => [
      "PUT",
      `${evidencePath}/${object.sha256}`,
      object.body,
    ]),
  ]) {
    const response = await request.fetch(path, {
      method,
      data: Buffer.from(data),
      headers: {
        "content-type": "application/json",
        ...(await signedVettingHeaders(
          privateKey,
          publicKey,
          method,
          path,
          data,
        )),
      },
    });
    expect(response.status()).toBeLessThan(300);
  }
  const body = JSON.stringify(
    vettingResult({ ...queued, repository }, disposition),
  );
  const posted = await request.post("/api/v1/vetting/results", {
    data: body,
    headers: {
      "content-type": "application/json",
      ...(await signedVettingHeaders(
        privateKey,
        publicKey,
        "POST",
        "/api/v1/vetting/results",
        body,
      )),
    },
  });
  expect(posted.status()).toBe(disposition === "clean" ? 422 : 200);
  if (disposition === "clean")
    expect((await posted.json()).error).toBe("evidence_incomplete");
}

/** Queues a scan of the current revision from the admin vetting panel. */
async function queueScan(
  admin: Page,
  projectId: string,
  reason: string,
  revision = 1,
) {
  await admin.goto(`/admin?project=${encodeURIComponent(projectId)}`, {
    waitUntil: "networkidle",
  });
  const card = admin.getByRole("article", {
    name: `Security vetting for ${projectId}`,
  });
  await card.getByLabel("Reason for the scan").fill(reason);
  await card
    .getByRole("button", { name: `Queue scan of revision ${revision}` })
    .click();
  await expect(
    admin.getByRole("region", { name: "Security vetting" }).getByRole("status"),
  ).toContainText(`Queued a scan of ${projectId} revision ${revision}.`);
  // A queued rescan keeps the last finished decision until its result lands.
  await expect(
    card.getByText(new RegExp(`Revision ${revision} · Queued`, "u")),
  ).toBeVisible();
  return card;
}

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
      repository: `e2e-applicant/open-registry-${suffix}`,
      id: `open-registry-${suffix}`,
      name: `Open Registry ${words}`,
    },
    owned: {
      repository: `e2e-owner/owned-registry-${suffix}`,
      id: `owned-registry-${suffix}`,
      name: `Owned Registry ${words}`,
    },
    setup: {
      repository: `e2e-owner/setup-registry-${suffix}`,
      id: `setup-registry-${suffix}`,
      name: `Setup Registry ${words}`,
    },
    stored: {
      repository: `e2e-owner/stored-registry-${suffix}`,
      id: `stored-registry-${suffix}`,
      name: `Stored Registry ${words}`,
    },
  };
}

/** Sets what the Slopbot GitHub App reads in the loopback GitHub fixture. */
async function setSlopbot(path: string) {
  if (!GITHUB_FIXTURE) throw new Error("Missing E2E GitHub fixture");
  const response = await fetch(`${GITHUB_FIXTURE}/__fixture/slopbot/${path}`, {
    method: "PUT",
  });
  expect(response.status).toBe(204);
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
    // Other APIs reject this local origin; only application failures count.
    if (
      message.type() === "error" &&
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

async function draftApplication(
  page: Page,
  project: { repository: string; name: string },
) {
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByLabel("Public GitHub repository").fill(project.repository);
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    `Found ${project.repository}`,
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await page.getByLabel("Project name").fill(project.name);
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Pay contributors a monthly amount").check();
  await page.getByLabel("Monthly amount (USDC)").fill("1000");
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(
    page.getByRole("article", { name: "Listing preview" }),
  ).toContainText("1,000");
}

async function listedProject(page: Page, id: string) {
  const body = await (await page.request.get("/api/v1/projects")).json();
  return body.projects.find((entry: { id: string }) => entry.id === id);
}

test("an empty registry shows the empty state, never stale build data @registry", async ({
  page,
}) => {
  const errors = observe(page);
  const projects = await page.request.get("/api/v1/projects");
  expect(projects.status()).toBe(200);
  expect(projects.headers()["cache-control"]).toBe(
    "public, max-age=0, s-maxage=30",
  );
  expect(await projects.json()).toMatchObject({ schemaVersion: "1" });
  // Other viewports share this D1, so the empty registry is the API answer
  // the page receives, not an assumption about the database.
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const section = page.locator("#projects");
  await expect(section.locator("a.project-card, a.project-row")).toHaveCount(0);
  await expect(
    section.getByRole("link", { name: "Add a project" }),
  ).toHaveAttribute("href", "/projects/new");
  await expectAccessible(page);
  expect(errors).toEqual([]);
});

test("a signed-out visitor must sign in to look up GitHub and submit @registry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The lookup API answers a signed-out visitor with an expected 401.
    if (
      message.type() === "error" &&
      !/\/api\/v1\/(points|payments|project-github)\//u.test(
        message.location().url,
      )
    )
      errors.push(message.text());
  });
  const project = fixtureProjects().queued;
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByLabel("Public GitHub repository").fill(project.repository);
  await expect(
    page.getByRole("button", { name: "Look up on GitHub" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toHaveAttribute("href", /\/login\?next=%2Fprojects%2Fnew$/u);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toHaveAttribute("href", /\/login\?next=%2Fprojects%2Fnew$/u);
  const lookup = await page.request.get(
    `/api/v1/project-github/repositories/${project.repository}`,
  );
  expect(lookup.status()).toBe(401);
  const forged = await page.request.post("/api/v1/projects", {
    data: {},
    headers: { origin: "https://attacker.example" },
  });
  expect(forged.status()).toBe(403);
  await expectAccessible(page);
  expect(errors).toEqual([]);
});

test("an owner creates a paused project without admin approval @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().queued;
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  const errors = observe(page);
  await signIn(page, APPLICANT_TOKEN);
  await draftApplication(page, project);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  expect(await listedProject(page, project.id)).toMatchObject({
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
    await page.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (entry: { projectId: string }) => entry.projectId === project.id,
    ),
  ).toMatchObject([{ revision: 1 }]);
  // Without the Slopbot installation, the project stays paused.
  await expect(page.locator("main")).toContainText("Slopbot");
  await expectAccessible(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("an owner creates and updates directly; an admin can delist by exception @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().owned;
  const ownerContext = await browser.newContext(walkthroughOptions());
  const owner = await ownerContext.newPage();
  const ownerErrors = observe(owner);
  await signIn(owner, OWNER_TOKEN);
  await draftApplication(owner, project);
  await owner
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  await expectAccessible(owner);
  const listed = await listedProject(owner, project.id);
  expect(listed).toMatchObject({ status: "paused" });

  // Facts that GitHub does not confirm are refused, never listed.
  // The request API keeps the expected 422 out of the page console.
  const forgedResponse = await owner.request.post("/api/v1/projects", {
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
  });
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

  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  const adminErrors = observe(admin);
  await signIn(admin, ADMIN_TOKEN);
  await admin.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const card = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await expect(card).toContainText("Generated from revision 1");
  await expectAccessible(admin);

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

  // A maintainer submits a real update; approval publishes one paused revision.
  const returningContext = await browser.newContext(walkthroughOptions());
  const returningOwner = await returningContext.newPage();
  await signIn(returningOwner, OWNER_TOKEN);
  await returningOwner.goto(`/projects/${project.id}/manage`, {
    waitUntil: "networkidle",
  });
  await returningOwner
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("Useful accepted outcomes with a clearer project scope");
  await returningOwner
    .getByLabel("Revision note", { exact: true })
    .fill("Clarify the project scope for contributors");
  await returningOwner.getByRole("button", { name: "Publish changes" }).click();
  await expect(
    returningOwner
      .getByRole("status")
      .filter({ hasText: "Published revision 2" }),
  ).toBeVisible();
  expect(
    (await (await admin.request.get(`/api/v1/projects/${project.id}`)).json())
      .revision,
  ).toBe(2);
  await admin.reload({ waitUntil: "networkidle" });
  await expect(card).toContainText("2 · updated");
  expect(
    (await (await admin.request.get(`/api/v1/projects/${project.id}`)).json())
      .project.headline,
  ).toBe("Useful accepted outcomes with a clearer project scope");
  await returningOwner.goto("/projects/new", { waitUntil: "networkidle" });
  await returningOwner.getByText("Your projects", { exact: true }).click();
  await expect(returningOwner.locator("main")).toContainText(project.name);
  await expectAccessible(returningOwner);
  await returningContext.close();

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

test("an admin cannot activate or publish skills without canonical scan closure @registry", async ({
  browser,
  request,
}) => {
  const project = fixtureProjects().queued;
  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  const errors = observe(admin);
  await signIn(admin, ADMIN_TOKEN);

  // The approved paused project already shows on the public site from D1.
  await admin.goto(`/projects/${project.id}`, { waitUntil: "networkidle" });
  await expect(admin.locator("h1")).toHaveText(project.name);
  // The reward asset is the Base stablecoin the application chose.
  await expect(admin.locator(".project-hero")).toContainText(
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  );
  // An unscanned revision serves no executable skill (PRD VET-01).
  const unscanned = await request.get(`/projects/${project.id}/skill.md`);
  expect(unscanned.status()).toBe(404);
  expect(await unscanned.text()).toContain("security vetting");
  expect(
    await (await request.get(`/api/v1/projects/${project.id}`)).json(),
  ).toMatchObject({ skillsPublished: false, vetting: { state: "queued" } });

  // An incomplete scan quarantines the revision, and it cannot activate.
  await admin.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  let vettingCard = admin.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(vettingCard.locator(".admin-badge")).toHaveText("Queued");
  await postVettingResult(
    request,
    project.id,
    project.repository,
    "incomplete",
  );
  await admin.reload({ waitUntil: "networkidle" });
  vettingCard = admin.getByRole("article", {
    name: `Security vetting for ${project.id}`,
  });
  await expect(vettingCard.locator(".admin-badge")).toHaveText("Quarantined");
  await vettingCard.getByText(/Revision 1 · Incomplete/u).click();
  await expect(vettingCard).toContainText("vendor/addon.node (native-module)");
  await expect(vettingCard).toContainText(
    "A pinned TLS client hid HTTP bodies",
  );
  await expectAccessible(admin);
  const refusedCard = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await refusedCard.getByRole("button", { name: "Edit manifest" }).click();
  await refusedCard.getByLabel("Project status").selectOption("active");
  await refusedCard
    .getByLabel("Reason for this revision (public history)")
    .fill("Activate before a clean scan");
  await refusedCard.getByRole("button", { name: "Save revision 2" }).click();
  await expect(refusedCard.getByRole("alert")).toContainText(
    "Security vetting is quarantined",
  );
  // The refused write is the only failed request the browser saw.
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
  errors.length = 0;

  // A signed clean claim still lacks canonical runtime closure.
  await queueScan(admin, project.id, "Rescan after the gap");
  await postVettingResult(request, project.id, project.repository, "clean");
  await admin.reload({ waitUntil: "networkidle" });
  await expect(
    admin
      .getByRole("article", { name: `Security vetting for ${project.id}` })
      .locator(".admin-badge"),
  ).toHaveText("Quarantined");
  for (const path of [
    "skill.md",
    "SKILL.md",
    "skill-manifest.json",
    "review/SKILL.md",
    `downloads/contribute-to-${project.id}.skill`,
  ])
    expect(
      (await request.get(`/projects/${project.id}/${path}`)).status(),
    ).toBe(404);
  expect(
    await (await request.get(`/api/v1/projects/${project.id}`)).json(),
  ).toMatchObject({
    revision: 1,
    skillsPublished: false,
    project: { status: "paused" },
  });
  const card = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await card.getByRole("button", { name: "Edit manifest" }).click();
  await card.getByLabel("Project status").selectOption("active");
  await card
    .getByLabel("Reason for this revision (public history)")
    .fill("Activation remains blocked without canonical closure");
  await card.getByRole("button", { name: "Save revision 2" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Security vetting is quarantined",
  );
  expect(errors).toEqual([
    "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)",
  ]);
  errors.length = 0;
  await postVettingResult(
    request,
    project.id,
    project.repository,
    "incomplete",
  );
  // A normal paused manifest edit remains available and produces its own notice.
  await card.getByLabel("Project status").selectOption("paused");
  await card
    .getByText("Advanced project settings (revision 1)", { exact: true })
    .click();
  const manifestEditor = card.getByLabel("Other manifest fields");
  const pausedManifest = JSON.parse(await manifestEditor.inputValue());
  expect(pausedManifest).not.toHaveProperty("status");
  expect(pausedManifest).not.toHaveProperty("contribution");
  expect(pausedManifest).not.toHaveProperty("rewardAsset");
  await manifestEditor.fill(
    JSON.stringify({ ...pausedManifest, status: "active" }),
  );
  await expect(
    card.getByRole("region", { name: "Revision changes" }),
  ).toContainText("Remove those keys");
  await expect(
    card.getByRole("button", { name: "Save revision 2" }),
  ).toBeDisabled();
  await manifestEditor.fill(JSON.stringify(pausedManifest, null, 2));
  await card
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("A reviewed paused project awaiting complete security evidence.");
  expect(JSON.parse(await manifestEditor.inputValue()).headline).toBe(
    "A reviewed paused project awaiting complete security evidence.",
  );
  await card
    .getByText("Advanced project settings (revision 1)", { exact: true })
    .click();
  await card
    .getByLabel("Reason for this revision (public history)")
    .fill("Clarify paused project description");
  await card.getByRole("button", { name: "Close and keep draft" }).click();
  await card.getByRole("button", { name: "Edit manifest" }).click();
  await expect(
    card.getByLabel("Reason for this revision (public history)"),
  ).toHaveValue("Clarify paused project description");
  await expect(
    card.getByRole("region", { name: "Revision changes" }),
  ).toContainText("headline");
  await expect(
    card.getByRole("textbox", { name: "Short description", exact: true }),
  ).toHaveValue(
    "A reviewed paused project awaiting complete security evidence.",
  );
  expect(
    await admin.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await admin.evaluate(() => window.innerWidth));
  await admin.screenshot({
    path: test.info().outputPath("admin-routine-edit.png"),
    fullPage: true,
  });
  await card.getByRole("button", { name: "Save revision 2" }).click();
  await expect(card).toContainText("2 · updated");
  await expectAccessible(admin);
  expect(errors).toEqual([]);
  await adminContext.close();
});

test("the applicant's inbox lists each decision and revision once and keeps the read state @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().queued;
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  const errors = observe(page);
  await signIn(page, APPLICANT_TOKEN);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Inbox");
  const revised = page.locator(".inbox-item", {
    hasText: `The ${project.id} project manifest changed.`,
  });
  await expect(revised).toHaveCount(1);
  await expect(revised).toContainText("Clarify paused project description");
  await expectAccessible(page);

  await revised.getByRole("button", { name: /^Mark as read/u }).click();
  await expect(page.getByRole("status")).toHaveText("Marked as read.");
  await expect(revised.locator(".inbox-state")).toHaveText("Read");
  await expect(revised.getByRole("button")).toHaveCount(0);
  // The read state is stored, not kept only in the page.
  await page.reload({ waitUntil: "networkidle" });
  await expect(revised.locator(".inbox-state")).toHaveText("Read");

  // The request client sends no Secure cookie over local http.
  const cookie = `__Host-slop_points=${APPLICANT_TOKEN}`;
  const inbox = await (
    await page.request.get("/api/v1/notifications", { headers: { cookie } })
  ).json();
  // One row per event: the decision and the revision, never a duplicate.
  const mine = inbox.notifications.filter(
    (entry: { subject: string }) => entry.subject === project.id,
  );
  expect(mine.map((entry: { kind: string }) => entry.kind).sort()).toEqual([
    "project_revision",
  ]);
  const keys = inbox.notifications.map(
    (entry: { eventKey: string }) => entry.eventKey,
  );
  expect(new Set(keys).size).toBe(keys.length);
  const forged = await page.request.post("/api/v1/notifications/read", {
    headers: { cookie, origin: "https://attacker.example" },
    data: { eventKeys: [`project-revision:${project.id}:2`] },
  });
  expect(forged.status()).toBe(403);
  expect(errors).toEqual([]);
  await context.close();
});

test("moderators restrict a project and refuse reinstatement without canonical scan closure @registry", async ({
  browser,
  request,
}) => {
  const project = fixtureProjects().queued;
  const evidence = `https://github.com/${project.repository}/security/advisories/GHSA-e2e`;
  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  const adminErrors = observe(admin);
  await signIn(admin, ADMIN_TOKEN);
  await admin.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const card = () =>
    admin.locator(".admin-card", {
      has: admin.getByText(project.id, { exact: true }),
    });
  const panel = () =>
    card().getByRole("region", { name: "Enforcement", exact: true });
  await expect(panel()).toContainText("No restriction");

  // Each action needs a reason, an evidence reference, the server preview
  // and a confirmation.
  async function act(action: string, reason: string) {
    await panel().getByLabel("Action").selectOption({ label: action });
    await panel().getByLabel("Reason (private audit record)").fill(reason);
    await panel()
      .getByLabel("Evidence reference (link or case id)")
      .fill(evidence);
    await panel().getByRole("button", { name: "Preview action" }).click();
    const preview = panel().getByRole("group", {
      name: "Preview: check it, then confirm",
    });
    await expect(preview).toContainText(project.id);
    return preview;
  }

  const quarantine = await act(
    "Quarantine",
    "Confirmed malware in the release script",
  );
  await expect(quarantine).toContainText("2 → 3");
  await expect(quarantine).toContainText("paused, community → paused, retired");
  await expect(quarantine).toContainText("Appends the matching revision");
  await expectAccessible(admin);
  await quarantine.getByRole("button", { name: "Confirm: Quarantine" }).click();
  await expect(admin.getByRole("status").first()).toContainText(
    "Quarantine recorded",
  );
  await expect(panel()).toContainText("Quarantined");
  await expect(card()).toContainText("3 · updated");

  // Every public route closes at once: the cached list, the direct project
  // read, the skill, the archive and the discovery index.
  const registry = await (await request.get("/api/v1/projects")).json();
  expect(registry.restrictions).toContainEqual(
    expect.objectContaining({ projectId: project.id, state: "quarantined" }),
  );
  expect(
    registry.projects.find((entry: { id: string }) => entry.id === project.id),
  ).toMatchObject({ status: "paused", listingTier: "retired" });
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  expect((await request.get(`/projects/${project.id}/SKILL.md`)).status()).toBe(
    410,
  );
  expect(
    (
      await request.get(
        `/projects/${project.id}/downloads/contribute-to-${project.id}.skill`,
      )
    ).status(),
  ).toBe(410);
  const discovery = await (
    await request.get("/.well-known/slop/projects.json")
  ).json();
  expect(
    discovery.projects.some(
      (entry: { project_id: string }) => entry.project_id === project.id,
    ),
  ).toBe(false);

  const ban = await act("Ban project", "Repeated malware after notice");
  await expect(ban).toContainText("Stays at 3");
  await expect(ban).toContainText("No revision needed");
  await ban.getByRole("button", { name: "Confirm: Ban project" }).click();
  await expect(panel()).toContainText("Banned");
  // ELG-02: the applicant who listed the project files the appeal. The
  // request client sends no Secure cookie over local http.
  const appeal = {
    projectId: project.id,
    reason: "Maintainer removed the script and asked for review",
    evidenceReference: evidence,
  };
  const appealHeaders = (token: string) => ({
    origin: new URL(admin.url()).origin,
    cookie: `__Host-slop_points=${token}`,
  });
  const stranger = await admin.request.post("/api/v1/project-appeals", {
    headers: appealHeaders(OWNER_TOKEN),
    data: appeal,
  });
  expect(stranger.status()).toBe(403);
  const appealed = await admin.request.post("/api/v1/project-appeals", {
    headers: appealHeaders(APPLICANT_TOKEN),
    data: appeal,
  });
  expect(appealed.status()).toBe(200);
  expect((await appealed.json()).record).toMatchObject({
    actorRole: "project-steward",
    decisionSource: "owner-request",
    appealAfter: "requested",
  });
  await admin.reload({ waitUntil: "networkidle" });
  await expect(panel()).toContainText("Reinstatement requested");
  await panel()
    .getByText(/Enforcement history/u)
    .click();
  await expect(panel()).toContainText("project-steward, owner-request");

  // The moderator who placed the restriction cannot decide the appeal. The
  // request API keeps the expected 403 out of the page console.
  const current = await (
    await admin.request.get("/api/v1/admin/projects", {
      headers: { cookie: `__Host-slop_points=${ADMIN_TOKEN}` },
    })
  ).json();
  const restricted = current.projects.find(
    (entry: { id: string }) => entry.id === project.id,
  );
  const self = await admin.request.post(
    `/api/v1/admin/projects/${project.id}/enforcement-preview`,
    {
      headers: {
        origin: new URL(admin.url()).origin,
        cookie: `__Host-slop_points=${ADMIN_TOKEN}`,
      },
      data: {
        action: "reinstate",
        reason: "Self review",
        evidenceReference: evidence,
        expectedRevision: restricted.revision,
        expectedSequence: restricted.enforcement.nextSequence,
      },
    },
  );
  expect(self.status()).toBe(403);
  expect((await self.json()).error).toBe("independent_review_required");
  expect(adminErrors).toEqual([]);
  await adminContext.close();

  const moderatorContext = await browser.newContext({
    recordVideo: { dir: test.info().outputPath("enforcement-video") },
  });
  const moderator = await moderatorContext.newPage();
  const moderatorErrors = observe(moderator);
  await signIn(moderator, MODERATOR_TOKEN);
  await moderator.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const moderatorPanel = moderator
    .locator(".admin-card", {
      has: moderator.getByText(project.id, { exact: true }),
    })
    .getByRole("region", { name: "Enforcement", exact: true });
  await expect(moderatorPanel).toContainText("@e2e-admin");
  await moderatorPanel
    .getByLabel("Action")
    .selectOption({ label: "Reinstate after review" });
  await moderatorPanel
    .getByLabel("Reason (private audit record)")
    .fill("Attempt review without complete canonical evidence");
  await moderatorPanel
    .getByLabel("Evidence reference (link or case id)")
    .fill(evidence);
  // Both preview and confirmation must refuse an unscanned appeal. Use the
  // API for the expected refusal so it does not create a console error.
  const unscannedAppeal = await moderator.request.post(
    `/api/v1/admin/projects/${project.id}/enforcement-preview`,
    {
      headers: {
        origin: new URL(moderator.url()).origin,
        cookie: `__Host-slop_points=${MODERATOR_TOKEN}`,
      },
      data: {
        action: "reinstate",
        reason: "Review without a fresh scan",
        evidenceReference: evidence,
        expectedRevision: 3,
        expectedSequence: 4,
      },
    },
  );
  expect(unscannedAppeal.status()).toBe(409);
  expect((await unscannedAppeal.json()).error).toBe("vetting_required");
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  await moderator.screenshot({
    path: test.info().outputPath("enforcement-before-scan.png"),
    fullPage: true,
  });
  await queueScan(moderator, project.id, "Confirm the reported finding", 3);
  await postVettingResult(request, project.id, project.repository, "malicious");
  await queueScan(
    moderator,
    project.id,
    "Fresh scan for independent appeal",
    3,
  );
  await postVettingResult(request, project.id, project.repository, "clean");
  await moderator.reload({ waitUntil: "networkidle" });
  await moderatorPanel
    .getByLabel("Action")
    .selectOption({ label: "Reinstate after review" });
  await moderatorPanel
    .getByLabel("Reason (private audit record)")
    .fill("Attempt review without complete canonical evidence");
  await moderatorPanel
    .getByLabel("Evidence reference (link or case id)")
    .fill(evidence);
  await moderatorPanel.getByRole("button", { name: "Preview action" }).click();
  await expect(moderatorPanel.getByRole("alert")).toContainText(
    "fresh clean scan",
  );
  expect(moderatorErrors).toEqual([
    "Failed to load resource: the server responded with a status of 409 (Conflict)",
  ]);
  moderatorErrors.length = 0;
  await expect(
    moderatorPanel.getByRole("button", {
      name: "Confirm: Reinstate after review",
    }),
  ).toHaveCount(0);
  await expectAccessible(moderator);
  await moderatorPanel.getByText(/Enforcement history/u).click();
  await expect(moderatorPanel.locator("li")).toHaveCount(4);
  await expect(moderatorPanel).toContainText(
    "the signed security vetting service",
  );
  await moderator.screenshot({
    path: test.info().outputPath("enforcement-history.png"),
    fullPage: true,
  });
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  expect((await request.get(`/projects/${project.id}/SKILL.md`)).status()).toBe(
    410,
  );

  // The independent moderator was asked to review the appeal in the inbox.
  await moderator.goto("/inbox", { waitUntil: "networkidle" });
  const review = moderator.locator(".inbox-item", {
    hasText: `A reinstatement request for ${project.id} needs your independent review.`,
  });
  await expect(review).toHaveCount(1);
  await expect(
    review.getByRole("link", { name: "Open admin" }),
  ).toHaveAttribute("href", "/admin");
  const banNotice = moderator.locator(".inbox-item", {
    hasText: `The ${project.id} project is banned.`,
  });
  await expect(banNotice).toHaveCount(1);
  await expect(
    banNotice.getByRole("link", { name: "Open admin" }),
  ).toHaveAttribute("href", "/admin");
  await expect(moderator.locator("main")).not.toContainText(evidence);
  await moderator.screenshot({
    path: test.info().outputPath("operator-ban-notice.png"),
    fullPage: true,
  });
  await moderator.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectAccessible(moderator);
  await moderator.screenshot({
    path: test.info().outputPath("operator-ban-notice-zoom200.png"),
    fullPage: true,
  });
  await banNotice.getByRole("link", { name: "Open admin" }).focus();
  await moderator.keyboard.press("Enter");
  await expect(
    moderator.getByRole("heading", { name: "Admin", exact: true }),
  ).toBeVisible();

  await expectAccessible(moderator);
  expect(moderatorErrors).toEqual([]);
  await moderatorContext.close();

  // The applicant who listed the project sees each enforcement record once,
  // without the private reason or evidence reference.
  const applicantContext = await browser.newContext(walkthroughOptions());
  const applicant = await applicantContext.newPage();
  const applicantErrors = observe(applicant);
  await signIn(applicant, APPLICANT_TOKEN);
  await applicant.goto("/inbox", { waitUntil: "networkidle" });
  for (const title of [
    `The ${project.id} project is quarantined.`,
    `The ${project.id} project is banned.`,
    `A reinstatement request for ${project.id} is open for independent review.`,
  ])
    await expect(
      applicant.locator(".inbox-item", { hasText: title }),
    ).toHaveCount(title === `The ${project.id} project is banned.` ? 2 : 1);
  await expect(applicant.locator("main")).not.toContainText("malware");
  await expect(applicant.locator("main")).not.toContainText(evidence);
  // Only moderators are asked to decide the appeal.
  await expect(applicant.locator("main")).not.toContainText(
    "needs your independent review",
  );
  await expectAccessible(applicant);
  expect(applicantErrors).toEqual([]);
  await applicantContext.close();
});

test("an owner resumes setup after installing Slopbot; a failed scan and lost access each show the next action @registry", async ({
  browser,
  request,
}) => {
  const project = fixtureProjects().setup;
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  const errors = observe(page);
  await signIn(page, OWNER_TOKEN);
  await draftApplication(page, project);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();

  // New setup: the paused project is listed, its first scan is queued, and
  // the one next action is to install Slopbot.
  const created = page.locator(".project-setup-status");
  await expect(created.locator("h2")).toHaveText("Setup status: Action needed");
  await expect(created.getByRole("status")).toContainText(
    `Slopbot is not installed on ${project.repository}.`,
  );
  await expect(
    created.getByRole("link", { name: "Install Slopbot" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/apps/slopdotcash/installations/new",
  );
  await expect(created).toContainText("Queued. The security scan is queued.");
  await expectAccessible(page);

  // Resumed setup: after the installation, the owner checks again from
  // "Your projects" on a new page load. Slopbot reads admin access.
  await setSlopbot(`${project.repository}/installed`);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  const entry = page.locator("#your-projects li", { hasText: project.name });
  await entry.getByRole("button", { name: "Check setup" }).click();
  const resumed = entry.locator(".project-setup-status");
  await expect(resumed.locator("h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expect(resumed).toContainText(
    `Confirmed. @e2e-owner has admin access to ${project.repository}.`,
  );
  await expect(resumed).toContainText(
    `Installed. Slopbot is installed on ${project.repository}.`,
  );

  // Scan failure: an incomplete scan does not clear the project. The owner
  // requests a new scan without an admin.
  await postVettingResult(
    request,
    project.id,
    project.repository,
    "incomplete",
  );
  await resumed.getByRole("button", { name: "Check again" }).click();
  await expect(resumed.locator("h2")).toHaveText("Setup status: Action needed");
  await expect(resumed.getByRole("status")).toContainText(
    "The last scan could not finish, so it did not clear the project.",
  );
  await resumed.getByRole("button", { name: "Request a new scan" }).click();
  await expect(resumed.locator("h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expectAccessible(page);

  // Owner edit: a text-only change publishes at once as revision 2.
  await page.goto(`/projects/${project.id}/manage`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("Accepted setup outcomes with a clear project scope");
  await page
    .getByLabel("Revision note", { exact: true })
    .fill("Clarify the project scope for contributors");
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 2" }),
  ).toBeVisible();
  expect(errors).toEqual([]);

  // Permission loss: Slopbot now reads only read access. The setup status
  // names the next action, and the owner cannot publish another change.
  await setSlopbot(`${project.repository}/permission/e2e-owner/read`);
  await page.reload({ waitUntil: "networkidle" });
  const managed = page.locator(".project-setup-status");
  await expect(managed.locator("h2")).toHaveText("Setup status: Action needed");
  await expect(managed).toContainText(
    `Not confirmed. @e2e-owner has read access to ${project.repository}. Write, maintain or admin access is required.`,
  );
  await page
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("A change from an account without write access");
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Write, maintain or admin access is required",
  );
  const history = await (
    await page.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (revision: { projectId: string }) => revision.projectId === project.id,
    ),
  ).toHaveLength(2);
  expect(await listedProject(page, project.id)).toMatchObject({
    status: "paused",
    headline: "Accepted setup outcomes with a clear project scope",
  });
  await expectAccessible(page);
  // The only console error is the browser's report of the refused publish.
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("403");
  await context.close();
});

test("an applicant publishes an application stored before self-service setup without entering it again @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().stored;
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  if (!persist) throw new Error("Missing E2E registry database");

  // The stored row holds the manifest this form submits, as the earlier
  // review queue stored it. The request never reaches the server.
  const draftContext = await browser.newContext();
  const draft = await draftContext.newPage();
  await signIn(draft, OWNER_TOKEN);
  let manifest: Record<string, unknown> | undefined;
  await draft.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    manifest = route.request().postDataJSON().manifest;
    await route.abort();
  });
  await draft.goto("/projects/new", { waitUntil: "networkidle" });
  await draft.getByLabel("Public GitHub repository").fill(project.repository);
  await draft.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(draft.locator(".lookup-status")).toContainText(
    `Found ${project.repository}`,
  );
  await draft.getByRole("button", { name: "Next: Contribution rules" }).click();
  await draft.getByLabel("Project name").fill(project.name);
  await draft.getByRole("button", { name: "Next: Rewards" }).click();
  await draft.getByRole("button", { name: "Next: Review" }).click();
  await draft
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect.poll(() => manifest).toBeDefined();
  await draftContext.close();
  const text = JSON.stringify(manifest);
  const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const applicationId = `app_stored-${project.id}`;
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persist,
      "--command",
      `INSERT INTO project_applications(id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification) VALUES(${[
        applicationId,
        project.id,
        project.repository.toLowerCase(),
        text,
        createHash("sha256").update(text).digest("hex"),
        "Merged pull requests that the maintainers accept",
        "900000003",
        "e2e-owner",
        "2026-10-01T00:00:00.000Z",
        "pending",
        "pending",
      ]
        .map(sql)
        .join(",")})`,
    ],
    { stdio: "pipe" },
  );

  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  const errors = observe(page);
  await signIn(page, OWNER_TOKEN);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  const entry = page.locator("#your-projects li", { hasText: project.name });
  await expect(entry).toContainText(
    "submitted 2026-10-01 before self-service setup",
  );
  await entry.getByRole("button", { name: "Create this project" }).click();
  await expect(entry.locator(".project-setup-status h2")).toHaveText(
    "Setup status: Action needed",
  );
  await expect(entry.locator(".project-setup-status")).toContainText(
    `Slopbot is not installed on ${project.repository}.`,
  );
  expect(await listedProject(page, project.id)).toMatchObject({
    name: project.name,
    status: "paused",
  });
  const history = await (
    await page.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (revision: { projectId: string }) => revision.projectId === project.id,
    ),
  ).toMatchObject([{ revision: 1 }]);

  // The application is published once. It leaves the list, and a second
  // publish is refused, so no duplicate row can appear.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  await expect(
    page.locator("#your-projects li", { hasText: project.name }),
  ).toHaveCount(1);
  await expect(
    page.locator("#your-projects li", { hasText: project.name }),
  ).toContainText(`${project.name} · paused`);
  const again = await page.request.post(
    `/api/v1/project-applications/${applicationId}/publish`,
    {
      headers: {
        origin: new URL(page.url()).origin,
        cookie: `__Host-slop_points=${OWNER_TOKEN}`,
      },
      data: {},
    },
  );
  expect(again.status()).toBe(409);
  await expectAccessible(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("an unavailable registry shows an error, never an empty list @registry", async ({
  page,
}) => {
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  // The failure is an alert with its status and a retry, never a list.
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("503");
  await expect(alert.getByRole("button")).toBeVisible();
  await expect(page.locator("#projects")).toHaveCount(0);
  await expectAccessible(page);
  for (const [path, heading] of [
    ["/account", "Account"],
    ["/login", "Log in to slop.cash"],
  ]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      heading,
    );
    await expect(
      page.getByRole("heading", { name: "Projects are unavailable" }),
    ).toHaveCount(0);
  }
});

test.describe("private evidence console", () => {
  test("a designated operator inspects retained vetting bytes with reasoned access @registry", async ({
    page,
  }) => {
    const errors: string[] = [];
    const failures: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin === new URL(page.url()).origin)
        failures.push(
          `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
        );
    });
    await signIn(page, ADMIN_TOKEN);
    const overview = await page.request.get("/api/v1/admin/vetting", {
      headers: { cookie: `__Host-slop_points=${ADMIN_TOKEN}` },
    });
    expect(overview.status()).toBe(200);
    const assessment = (await overview.json()).assessments.find(
      (entry: { projectId: string; result: unknown }) =>
        entry.projectId === fixtureProjects().queued.id && entry.result,
    );
    expect(assessment).toBeTruthy();
    const path = `/vetting-evidence?assessmentId=${assessment.id}&runId=${assessment.result.environment.runId}`;
    const privatePath = `/api/v1/operator/vetting-evidence?assessmentId=${assessment.id}&runId=${assessment.result.environment.runId}`;
    expect(
      (
        await page.request.get(privatePath, {
          headers: { cookie: `__Host-slop_points=${ADMIN_TOKEN}` },
        })
      ).status(),
    ).toBe(403);
    await page.goto(`/admin?project=${fixtureProjects().queued.id}`, {
      waitUntil: "networkidle",
    });
    const consoleLink = page.locator(`a[href="${path}"]`);
    await consoleLink
      .locator("xpath=ancestor::details")
      .locator("summary")
      .click();
    await expect(consoleLink).toHaveText("Open restricted evidence console");
    await signIn(page, OWNER_TOKEN);
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", {
        name: "Private vetting evidence",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Inspect evidence inventory" })
      .click();
    await expect(
      page.getByText("Access expiry is enforced here.", { exact: false }),
    ).toBeVisible();
    const trace = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Harmless trace fixture",
        exact: true,
      }),
    });
    await trace
      .getByLabel("Reason to inspect Harmless trace fixture")
      .fill("Verify complete private collector evidence");
    await trace
      .getByRole("button", { name: "Read Harmless trace fixture" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(trace.getByRole("status")).toHaveText(
      "Complete bytes verified. Text is displayed without execution.",
    );
    await expect(trace.locator("pre")).toHaveText(
      VETTING_EVIDENCE_OBJECTS[0].body.trim(),
    );
    const binary = page
      .getByRole("article")
      .filter({ hasText: VETTING_EVIDENCE_OBJECTS[2].sha256 });
    await binary
      .getByRole("textbox")
      .fill("Inspect exact binary artifact without executing it");
    const downloaded = page.waitForEvent("download");
    await binary.getByRole("button").click();
    const download = await downloaded;
    const saved = test.info().outputPath("harmless-artifact.bin");
    await download.saveAs(saved);
    expect(await readFile(saved, "utf8")).toBe(
      VETTING_EVIDENCE_OBJECTS[2].body,
    );
    // At 200% zoom, keep at least the supported 320 CSS-pixel reflow width.
    // Zooming a 320px viewport directly would test an unsupported 160px layout.
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 640)
      await page.setViewportSize({ ...viewport, width: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(trace.locator("pre")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("private-evidence-zoom.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    await expectAccessible(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (viewport) await page.setViewportSize(viewport);
    await page.screenshot({
      path: test.info().outputPath("private-evidence.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    const video = page.video();
    await page.close();
    if (video)
      await video.saveAs(
        test.info().outputPath("private-evidence-walkthrough.webm"),
      );
  });
});

test("repository lookup failures explain the next action and preserve the draft @registry", async ({
  browser,
}) => {
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  await signIn(page, OWNER_TOKEN);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  const repository = page.getByRole("textbox", {
    name: "Public GitHub repository",
    exact: true,
  });
  for (const [name, message] of [
    ["lookup-rate-limited", "GitHub limited lookups."],
    ["lookup-unavailable", "GitHub returned 503."],
  ]) {
    await repository.fill(`e2e-owner/${name}`);
    await page
      .getByRole("button", { name: "Look up on GitHub", exact: true })
      .click();
    await expect(page.locator(".lookup-status")).toContainText(message);
    await expect(repository).toHaveValue(`e2e-owner/${name}`);
    await expect(page.locator("main")).not.toContainText(
      "Private upstream diagnostic",
    );
  }
  await repository.fill(fixtureProjects().owned.repository);
  await page
    .getByRole("button", { name: "Look up on GitHub", exact: true })
    .click();
  await expect(page.locator(".lookup-status")).toContainText("Found ");
  await page.screenshot({
    path: test.info().outputPath("repository-lookup-recovery.png"),
    fullPage: true,
  });
  await context.close();
});
