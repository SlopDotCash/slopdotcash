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
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { enlargeText } from "../text-size";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_SHA,
  vettingResult,
} from "../vetting-fixtures";
import {
  CANCELED,
  expect,
  expectAccessible,
  projectSuffix,
  test,
} from "./fixtures";

const APPLICANT_TOKEN = process.env.SLOP_E2E_APPLICANT_TOKEN ?? "";
const ADMIN_TOKEN = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
const OWNER_TOKEN = process.env.SLOP_E2E_OWNER_TOKEN ?? "";
const EVIDENCE_OWNER_TOKEN = process.env.SLOP_E2E_EVIDENCE_OWNER_TOKEN ?? "";
const MODERATOR_TOKEN = process.env.SLOP_E2E_MODERATOR_TOKEN ?? "";
const VETTING_PUBLIC_KEY = process.env.SLOP_E2E_VETTING_PUBLIC_KEY ?? "";
const VETTING_PRIVATE_KEY = process.env.SLOP_E2E_VETTING_PRIVATE_KEY ?? "";
const GITHUB_FIXTURE = process.env.SLOP_E2E_GITHUB_API_ORIGIN ?? "";
/** One maintainer session per viewport, which a moderator bans. */
const MAINTAINER_TOKENS = JSON.parse(
  process.env.SLOP_E2E_MAINTAINER_TOKENS ?? "{}",
) as Record<string, string>;
/** A contributor session from the security roles, used as a flagger. */
const SECURITY_ACCOUNT = {
  id: "900000011",
  login: "e2e-reporter-a",
  token: (
    JSON.parse(process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}") as Record<
      string,
      string
    >
  )["reporter-a"],
};

function walkthroughOptions() {
  return {
    viewport: test.info().project.use.viewport,
    ...(process.env.SLOP_E2E_VIDEO === "1"
      ? { recordVideo: { dir: test.info().outputPath("walkthrough-videos") } }
      : {}),
  };
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
  await card
    .getByText(`Queue scan of revision ${revision}`, { exact: true })
    .locator("xpath=self::summary")
    .click();
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

// The points and payments APIs reject this local origin; only application
// failures count.
test.beforeEach(({ diagnostics }) => {
  diagnostics.allow(
    /^(?:console .* at |403 GET )http:\/\/[^ ]+\/api\/v1\/(?:points|payments)\//u,
  );
  diagnostics.allowCanceledBackgroundReads();
});

/**
 * Every viewport shares one D1, so each uses its own repositories and project
 * ids instead of assuming the registry it finds is empty. The organization
 * repository cannot prove control; the user repository belongs to e2e-owner.
 */
function fixtureProjects() {
  const suffix = projectSuffix();
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

/** Sets the GitHub account facts that flag eligibility reads. */
async function setGithubUser(
  id: string,
  login: string,
  createdAt: string,
  merged: number,
) {
  if (!GITHUB_FIXTURE) throw new Error("Missing E2E GitHub fixture");
  const url = new URL(`${GITHUB_FIXTURE}/__fixture/github-users/${id}`);
  url.searchParams.set("login", login);
  url.searchParams.set("createdAt", createdAt);
  url.searchParams.set("merged", String(merged));
  const response = await fetch(url, { method: "PUT" });
  if (response.status !== 204) throw new Error("GitHub fixture refused");
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

/** Open a settings group only when it is folded; repeated saves preserve it. */
async function openSettings(page: Page, label: string) {
  if (label === "Contributor instructions")
    await openSettings(page, "Contribution rules");
  const summary = page
    .getByText(label, { exact: true })
    .locator("xpath=self::summary");
  const group = summary.locator("xpath=parent::details");
  if ((await group.getAttribute("open")) === null) await summary.click();
}

/** One setup check shows its state badge and, under Check details, its message. */
async function expectSetupCheck(
  setup: Locator,
  check: "GitHub access" | "Slopbot" | "Security scan",
  state: string,
  message: string,
) {
  const badge = setup
    .locator(".setup-checks dt", { hasText: check })
    .locator("xpath=following-sibling::dd[1]");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(state);
  await expect(
    setup
      .locator(".setup-details dt", { hasText: check })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText(message);
}

async function draftApplication(
  page: Page,
  project: {
    repository: string;
    name: string;
    network?: string;
    automaticClosure?: boolean;
  },
) {
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByLabel("Public GitHub repository").fill(project.repository);
  await page.getByRole("button", { name: "Look up on GitHub" }).click();
  await expect(page.locator(".lookup-status")).toContainText(
    `Found ${project.repository}`,
  );
  await page.getByRole("button", { name: "Next: Contribution rules" }).click();
  await page.getByLabel("Project name").fill(project.name);
  const consent = page.getByRole("checkbox", {
    name: "Allow automatic closure by Slopbot",
  });
  await expect(consent).not.toBeChecked();
  if (project.automaticClosure) await consent.check();
  await page.getByRole("button", { name: "Next: Rewards" }).click();
  await page.getByLabel("Monthly rewards").check();
  await page.getByLabel("Monthly amount (USDC)").fill("1000");
  if (project.network)
    await page
      .getByRole("combobox", { name: "Network", exact: true })
      .selectOption(project.network);
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
});

test("a signed-out visitor must sign in to look up GitHub and submit @registry", async ({
  diagnostics,
  page,
}) => {
  // The lookup API answers a signed-out visitor with an expected 401.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 401 \(Unauthorized\) at |401 GET )http:\/\/[^ ]+\/api\/v1\/project-github\//u,
  );
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
});

test("an owner creates a paused project without admin approval @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().queued;
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  await signIn(page, APPLICANT_TOKEN);
  // Owner decision D11: Slop reads authority through the installation.
  await setSlopbot(`${project.repository}/installed`);
  await draftApplication(page, { ...project, automaticClosure: true });
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  expect(await listedProject(page, project.id)).toMatchObject({
    status: "paused",
    listingTier: "community",
    slopbot: { automaticClosure: true },
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
  // Until the scan passes, the project stays paused.
  await expect(page.locator(".project-setup-status h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expectAccessible(page);
  await context.close();
});

test("an owner creates and updates directly; an admin can delist by exception @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().owned;
  const ownerContext = await browser.newContext(walkthroughOptions());
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER_TOKEN);
  await setSlopbot(`${project.repository}/installed`);
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
  expect(listed.slopbot).toBeUndefined();

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
  await ownerContext.close();

  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_TOKEN);
  await admin.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const card = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await expect(card).toContainText("Generated from revision 1");
  await card.getByRole("button", { name: "Edit project" }).click();
  await card
    .getByText("Customize contributor instructions", { exact: true })
    .click();
  const adminTests = card.getByRole("textbox", { name: /^Required tests/u });
  const originalAdminTests = await adminTests.inputValue();
  await adminTests.fill("x".repeat(2001));
  await expect(adminTests).toHaveAttribute("aria-invalid", "true");
  await adminTests.fill(originalAdminTests);
  await expect(adminTests).toBeVisible();
  await card.getByRole("button", { name: "Close and keep draft" }).click();
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
  await openSettings(returningOwner, "Contribution rules");
  await openSettings(returningOwner, "Contributor instructions");
  const requiredTests = returningOwner.getByLabel("Required tests", {
    exact: true,
  });
  const originalTests = await requiredTests.inputValue();
  await requiredTests.fill("x".repeat(2001));
  await returningOwner.getByText("Contribution rules", { exact: true }).click();
  await returningOwner.getByRole("button", { name: "Publish changes" }).click();
  await expect(requiredTests).toBeVisible();
  await expect(requiredTests).toHaveAttribute("aria-invalid", "true");
  await requiredTests.fill(originalTests);
  await expect(requiredTests).toBeVisible();
  const consent = returningOwner.getByRole("checkbox", {
    name: "Allow automatic closure by Slopbot",
  });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await returningOwner
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("Useful accepted outcomes with a clearer project scope");

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
  await admin.reload();
  await expect(card).toContainText("2 · updated");
  expect(
    (await (await admin.request.get(`/api/v1/projects/${project.id}`)).json())
      .project.headline,
  ).toBe("Useful accepted outcomes with a clearer project scope");
  // The form must finish loading before it is edited and published.
  await returningOwner.reload({ waitUntil: "networkidle" });
  await openSettings(returningOwner, "Contribution rules");
  await expect(consent).toBeChecked();
  await consent.uncheck();

  await returningOwner.getByRole("button", { name: "Publish changes" }).click();
  await expect(
    returningOwner
      .getByRole("status")
      .filter({ hasText: "Published revision 3" }),
  ).toBeVisible();
  const revoked = await (
    await returningOwner.request.get(`/api/v1/projects/${project.id}`)
  ).json();
  expect(revoked.project.slopbot).toEqual({ automaticClosure: false });
  const consentHistory = await (
    await returningOwner.request.get(
      `/api/v1/project-revisions/${project.id}/2`,
    )
  ).json();
  expect(JSON.parse(consentHistory.manifestText).slopbot).toEqual({
    automaticClosure: true,
  });
  await returningOwner.reload({ waitUntil: "networkidle" });
  await openSettings(returningOwner, "Contribution rules");
  await expect(consent).not.toBeChecked();
  await expectAccessible(returningOwner);
  await returningOwner.goto("/projects/new", { waitUntil: "networkidle" });
  await returningOwner.getByText("Your projects", { exact: true }).click();
  await expect(returningOwner.locator("main")).toContainText(project.name);
  await expectAccessible(returningOwner);
  await returningContext.close();

  // Revocation appended revision 3 after the admin's last read.
  await admin.reload();
  await expect(card).toContainText("3 · updated");
  await card.getByRole("button", { name: "Delist", exact: true }).click();
  await card.getByRole("button", { name: "Delist project" }).click();
  await expect(admin.getByRole("status")).toContainText("Saved.");
  await expect(card).toContainText("Delisted.");
  expect(await listedProject(admin, project.id)).toMatchObject({
    status: "paused",
    listingTier: "retired",
  });
  await adminContext.close();
});

test("an admin cannot activate or publish skills without canonical scan closure @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  const project = fixtureProjects().queued;
  // The two refused activations below.
  diagnostics.allowResponse(403, "GET", `/api/v1/project-setup/${project.id}`);
  const refused = diagnostics.allowResponse(
    422,
    "PUT",
    `/api/v1/admin/projects/${project.id}/manifest`,
  );
  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_TOKEN);

  // The approved paused project already shows on the public site from D1.
  await admin.goto(`/projects/${project.id}`);
  await expect(admin.locator("h1")).toHaveText(project.name);
  // Native stablecoins use the shared reward label without a token address.
  await expect(admin.locator(".project-reward-status")).toContainText(
    "$1,000 monthly target, split between contributors",
  );
  await expect(admin.locator(".project-hero")).not.toContainText(
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  );
  // An unscanned revision serves no executable skill (PRD VET-01).
  const unscanned = await request.get(`/projects/${project.id}/skill.md`);
  expect(unscanned.status()).toBe(404);
  expect(await unscanned.text()).toContain("admission clearance");
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
  const quarantinedArtifact = vettingCard
    .locator(".operations-artifact-list li")
    .filter({ hasText: "vendor/addon.node" });
  await expect(quarantinedArtifact).toContainText("native-module");
  await expect(quarantinedArtifact).toContainText("quarantined");
  await expect(vettingCard).toContainText(
    "A pinned TLS client hid HTTP bodies",
  );
  await expectAccessible(admin);
  const refusedCard = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await refusedCard.getByRole("button", { name: "Edit project" }).click();
  await refusedCard.getByLabel("Project status").selectOption("active");
  await refusedCard
    .getByLabel("Reason for this revision (public history)")
    .fill("Activate before a clean scan");
  await refusedCard.getByRole("button", { name: "Save revision 2" }).click();
  await expect(refusedCard.getByRole("alert")).toContainText(
    "Security vetting is quarantined",
  );
  expect(diagnostics.count(refused)).toBe(1);

  // A signed clean claim still lacks canonical runtime closure. Rejection
  // leaves this newer investigation queued; it cannot revive the old result.
  await queueScan(admin, project.id, "Rescan after the gap");
  await postVettingResult(request, project.id, project.repository, "clean");
  await admin.reload();
  await expect(
    admin
      .getByRole("article", { name: `Security vetting for ${project.id}` })
      .locator(".admin-badge"),
  ).toHaveText("Queued");
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
    vetting: { state: "queued" },
  });
  const card = admin.locator(".admin-card", {
    has: admin.getByText(project.id, { exact: true }),
  });
  await card.getByRole("button", { name: "Edit project" }).click();
  await card.getByLabel("Project status").selectOption("active");
  await card
    .getByLabel("Reason for this revision (public history)")
    .fill("Activation remains blocked without canonical closure");
  await card.getByRole("button", { name: "Save revision 2" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Security vetting is queued",
  );
  expect(diagnostics.count(refused)).toBe(2);
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
  const manifestEditor = card.getByLabel("Other fields");
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
    .getByRole("combobox", { name: "Network", exact: true })
    .selectOption("robinhood");
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
  await card.getByRole("button", { name: "Edit project" }).click();
  await expect(
    card.getByLabel("Reason for this revision (public history)"),
  ).toHaveValue("Clarify paused project description");
  await expect(
    card.getByRole("region", { name: "Revision changes" }),
  ).toContainText("Short description");
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
  await enlargeText(admin.locator("body"));
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await card.getByRole("button", { name: "Save revision 2" }).focus();
  await admin.keyboard.press("Enter");
  await expect(card).toContainText("2 · updated");
  expect(await listedProject(admin, project.id)).toMatchObject({
    reward: {
      chain: "robinhood",
      currency: "USDG",
      monthlyCapMinor: "1000000000",
    },
    rewardAsset: { network: "robinhood", symbol: "USDG" },
    escrow: { chain: "robinhood", deployments: [] },
  });
  const prior = await (
    await admin.request.get(`/api/v1/project-revisions/${project.id}/1`)
  ).json();
  expect(JSON.parse(prior.manifestText).escrow.chain).toBe("base");
  await expectAccessible(admin);
  await adminContext.close();
});

test("the applicant's inbox lists each decision and revision once and keeps the read state @registry", async ({
  browser,
}) => {
  const project = fixtureProjects().queued;
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  await signIn(page, APPLICANT_TOKEN);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Inbox");
  const revised = page.locator(".inbox-item", {
    hasText: `The ${project.id} project settings changed.`,
  });
  await expect(revised).toHaveCount(1);
  await expect(revised).toContainText("Clarify paused project description");
  await expectAccessible(page);

  await revised.getByRole("button", { name: /^Mark as read/u }).click();
  await expect(page.getByRole("status")).toHaveText("Marked as read.");
  await expect(revised.getByText("Read", { exact: true })).toBeVisible();
  await expect(revised.getByRole("button")).toHaveCount(0);
  // The read state is stored, not kept only in the page.
  await page.reload();
  await expect(revised.getByText("Read", { exact: true })).toBeVisible();

  // The request client sends no Secure cookie over local http.
  const cookie = `__Host-slop_points=${APPLICANT_TOKEN}`;
  const inbox = await (
    await page.request.get("/api/v1/notifications", { headers: { cookie } })
  ).json();
  // One row per event: the revision and, once per assessment, each earlier
  // scan that could not establish clearance. Never a duplicate.
  const mine: { kind: string; eventKey: string }[] = inbox.notifications.filter(
    (entry: { subject: string }) => entry.subject === project.id,
  );
  const scans = mine.filter((entry) => entry.kind === "project_scan_failed");
  expect(scans.length).toBeGreaterThan(0);
  for (const scan of scans)
    expect(scan.eventKey).toMatch(/^project-scan:[A-Za-z0-9_-]+$/u);
  expect(
    mine
      .filter((entry) => entry.kind !== "project_scan_failed")
      .map((entry) => entry.kind)
      .sort(),
  ).toEqual(["project_revision"]);
  const keys = inbox.notifications.map(
    (entry: { eventKey: string }) => entry.eventKey,
  );
  expect(new Set(keys).size).toBe(keys.length);
  const forged = await page.request.post("/api/v1/notifications/read", {
    headers: { cookie, origin: "https://attacker.example" },
    data: { eventKeys: [`project-revision:${project.id}:2`] },
  });
  expect(forged.status()).toBe(403);
  await context.close();
});

test("moderators restrict a project and refuse reinstatement without canonical scan closure @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  const project = fixtureProjects().queued;
  // The refused reinstatement preview below.
  const refused = diagnostics.allowResponse(
    409,
    "POST",
    `/api/v1/admin/projects/${project.id}/enforcement-preview`,
  );
  const evidence = `https://github.com/${project.repository}/security/advisories/GHSA-e2e`;
  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
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
      name: "Preview",
      exact: true,
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
  await admin.reload();
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
  await adminContext.close();

  const moderatorContext = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("enforcement-video") },
  });
  const moderator = await moderatorContext.newPage();
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
  await moderator.reload({ waitUntil: "networkidle" });
  // The old request is kept in history but cannot authorize reinstatement.
  // The moderator can record a new project request through the same UI.
  await expect(
    moderatorPanel.getByRole("option", {
      name: "Reinstate after review",
      exact: true,
    }),
  ).toHaveCount(0);
  await moderatorPanel
    .getByLabel("Action")
    .selectOption({ label: "Request reinstatement" });
  await moderatorPanel
    .getByLabel("Reason (private audit record)")
    .fill("Request a fresh review after the malicious result");
  await moderatorPanel
    .getByLabel("Evidence reference (link or case id)")
    .fill(evidence);
  await moderatorPanel.getByRole("button", { name: "Preview action" }).focus();
  await moderator.keyboard.press("Enter");
  await moderator.screenshot({
    path: test.info().outputPath("kept-appeal-request-preview.png"),
    fullPage: true,
  });
  await moderatorPanel
    .getByRole("button", {
      name: "Confirm: Request reinstatement",
      exact: true,
    })
    .focus();
  await moderator.keyboard.press("Enter");
  await expect(moderator.getByRole("status").first()).toContainText(
    "Request reinstatement recorded",
  );
  await expect(
    moderatorPanel.getByRole("option", {
      name: "Reinstate after review",
      exact: true,
    }),
  ).toHaveCount(1);
  await moderator.screenshot({
    path: test.info().outputPath("kept-appeal-requested.png"),
    fullPage: true,
  });
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
  expect(diagnostics.count(refused)).toBe(1);
  await expect(
    moderatorPanel.getByRole("button", {
      name: "Confirm: Reinstate after review",
    }),
  ).toHaveCount(0);
  await expectAccessible(moderator);
  await moderatorPanel.getByText(/Enforcement history/u).click();
  await expect(moderatorPanel.locator("li")).toHaveCount(5);
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

  // The applicant's first request notified this independent moderator. The
  // moderator's own new request does not notify its author a second time.
  await moderator.goto("/inbox", { waitUntil: "networkidle" });
  const review = moderator.locator(".inbox-item", {
    hasText: `A reinstatement request for ${project.id} needs your independent review.`,
  });
  await expect(review).toHaveCount(1);
  for (const notice of await review.all())
    await expect(
      notice.getByRole("link", { name: "Open admin" }),
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
  await moderatorContext.close();

  // The applicant who listed the project sees each enforcement record once,
  // without the private reason or evidence reference.
  const applicantContext = await browser.newContext(walkthroughOptions());
  const applicant = await applicantContext.newPage();
  await signIn(applicant, APPLICANT_TOKEN);
  await applicant.goto("/inbox", { waitUntil: "networkidle" });
  for (const [title, count] of [
    [`The ${project.id} project is quarantined.`, 1],
    [`The ${project.id} project is banned.`, 2],
    [
      `A reinstatement request for ${project.id} is open for independent review.`,
      2,
    ],
  ] as const)
    await expect(
      applicant.locator(".inbox-item", { hasText: title }),
    ).toHaveCount(count);
  await expect(applicant.locator("main")).not.toContainText("malware");
  await expect(applicant.locator("main")).not.toContainText(evidence);
  // Only moderators are asked to decide the appeal.
  await expect(applicant.locator("main")).not.toContainText(
    "needs your independent review",
  );
  await expectAccessible(applicant);
  await applicantContext.close();
});

test("a moderator decides a confirmed malicious result and bans the project and its maintainer @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  // The banned maintainer's refused creation below.
  const refused = diagnostics.allowResponse(403, "POST", "/api/v1/projects");
  const suffix = projectSuffix();
  const login = `e2e-maintainer-${suffix}`;
  const token = MAINTAINER_TOKENS[`maintainer-${suffix}`] ?? "";
  const words = suffix.replaceAll("-", " ");
  const project = {
    id: `malice-${suffix}`,
    repository: `${login}/malice-${suffix}`,
    name: `Malice ${words}`,
  };
  const next = {
    id: `malice-next-${suffix}`,
    repository: `${login}/malice-next-${suffix}`,
    name: `Malice next ${words}`,
  };
  const evidence = `https://github.com/${project.repository}/security/advisories/GHSA-e2e`;

  // The maintainer lists the project; setup queues its first scan.
  const maintainerContext = await browser.newContext(walkthroughOptions());
  const maintainer = await maintainerContext.newPage();
  await signIn(maintainer, token);
  await setSlopbot(`${project.repository}/installed`);
  await draftApplication(maintainer, project);
  await maintainer
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    maintainer.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();

  // A signed confirmed malicious result bans the project at once.
  await postVettingResult(request, project.id, project.repository, "malicious");
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  await maintainerContext.close();

  // Without an appeal, the moderator queue lists the result for a decision.
  const moderatorContext = await browser.newContext(walkthroughOptions());
  const moderator = await moderatorContext.newPage();
  await signIn(moderator, MODERATOR_TOKEN);
  await moderator.goto("/admin", { waitUntil: "networkidle" });
  const summary = moderator.locator(".admin-project-summary", {
    has: moderator.getByRole("heading", { name: project.name, exact: true }),
  });
  await expect(summary).toContainText(
    "Moderator decision needed: confirmed malicious result",
  );
  await expectAccessible(moderator);
  await moderator.screenshot({
    path: test.info().outputPath("malicious-decision-queue.png"),
    fullPage: true,
  });
  await summary.getByRole("button", { name: `Open ${project.name}` }).click();
  const panel = moderator
    .locator(".admin-card", {
      has: moderator.getByText(project.id, { exact: true }),
    })
    .getByRole("region", { name: "Enforcement", exact: true });
  await expect(panel).toContainText("Moderator decision needed");
  await expect(panel).toContainText("Banned");
  await expect(panel.getByLabel("Action")).toHaveValue("ban");
  await expect(panel.getByLabel("Action").locator("option:checked")).toHaveText(
    "Ban project and maintainer",
  );
  await panel
    .getByLabel("Reason (private audit record)")
    .fill("Reviewed the signed finding: the install script steals tokens");
  await panel.getByLabel("Evidence reference (link or case id)").fill(evidence);
  await panel.getByLabel("Responsible GitHub accounts").fill(login);
  await panel.getByRole("button", { name: "Preview action" }).click();
  const preview = panel.getByRole("group", {
    name: "Preview",
    exact: true,
  });
  await expect(preview).toContainText("Banned → Banned");
  await expect(preview).toContainText(`Maintainer accounts banned@${login}`);
  await expectAccessible(moderator);
  await moderator.screenshot({
    path: test.info().outputPath("malicious-decision-preview.png"),
    fullPage: true,
  });
  await preview
    .getByRole("button", { name: "Confirm: Ban project and maintainer" })
    .click();
  await expect(moderator.getByRole("status").first()).toContainText(
    "Ban project and maintainer recorded",
  );
  await expect(panel).not.toContainText("Moderator decision needed");
  await expect(panel).toContainText(`Banned maintainers@${login}`);
  await panel.getByText(/Enforcement history/u).click();
  await expect(panel.locator("li")).toHaveCount(2);
  await expect(panel.locator("li").nth(1)).toContainText(
    "Ban project and maintainer by @e2e-moderator (project-moderator, admin-panel)",
  );
  await expectAccessible(moderator);
  await moderator.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectAccessible(moderator);
  await moderator.screenshot({
    path: test.info().outputPath("malicious-decision-zoom200.png"),
    fullPage: true,
  });
  await moderatorContext.close();

  // The decision stays a ban on every public route.
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  expect((await request.get(`/projects/${project.id}/SKILL.md`)).status()).toBe(
    410,
  );

  // The banned maintainer returns in a new session and cannot list another
  // project.
  const returningContext = await browser.newContext(walkthroughOptions());
  const returning = await returningContext.newPage();
  await signIn(returning, token);
  await setSlopbot(`${next.repository}/installed`);
  await draftApplication(returning, next);
  await returning
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(returning.getByRole("alert").first()).toContainText(
    "A moderator banned this maintainer",
  );
  expect(await listedProject(returning, next.id)).toBeUndefined();
  expect(diagnostics.count(refused)).toBe(1);
  await expectAccessible(returning);
  await returning.screenshot({
    path: test.info().outputPath("banned-maintainer-refused.png"),
    fullPage: true,
  });

  // The maintainer's inbox has the automatic ban and the moderator decision,
  // without the private reason or evidence reference.
  await returning.goto("/inbox");
  await expect(
    returning.locator(".inbox-item", {
      hasText: `The ${project.id} project is banned.`,
    }),
  ).toHaveCount(2);
  await expect(returning.locator("main")).not.toContainText("steals tokens");
  await expect(returning.locator("main")).not.toContainText(evidence);
  await returning.goto("/account", { waitUntil: "networkidle" });
  await expect(
    returning.locator("#security, #recovery, #close-account"),
  ).toHaveCount(0);
  await expect(
    returning.getByRole("form", {
      name: `Account appeal for ${project.id}`,
    }),
  ).toHaveCount(0);
  // The Settings appeal form is gone; its existing authenticated API still
  // records account appeals for independent review in this isolated local D1.
  const accountAppeal = await returning.request.post(
    "/api/v1/project-appeals",
    {
      headers: {
        origin: new URL(returning.url()).origin,
        cookie: `__Host-slop_points=${token}`,
      },
      data: {
        projectId: project.id,
        appealScope: "account",
        reason: "The account is not responsible for this code",
        evidenceReference: evidence,
      },
    },
  );
  expect(accountAppeal.status()).toBe(200);
  await returning.reload();
  const storedAppeal = await returning.request.get("/api/v1/project-appeals", {
    headers: { cookie: `__Host-slop_points=${token}` },
  });
  expect(storedAppeal.status()).toBe(200);
  expect((await storedAppeal.json()).appeals).toContainEqual({
    projectId: project.id,
    state: "banned",
    appeal: "requested",
  });
  await expect(
    returning.getByRole("form", { name: `Account appeal for ${project.id}` }),
  ).toHaveCount(0);
  await expectAccessible(returning);
  await returning.screenshot({
    path: test.info().outputPath("account-appeal-api-retained.png"),
    fullPage: true,
  });
  await returningContext.close();

  const independentContext = await browser.newContext(walkthroughOptions());
  const independent = await independentContext.newPage();
  await signIn(independent, ADMIN_TOKEN);
  await independent.goto("/admin", { waitUntil: "networkidle" });
  await independent
    .getByRole("button", { name: `Open ${project.name}`, exact: true })
    .click();
  const accountPanel = independent
    .locator(".admin-card", {
      has: independent.getByText(project.id, { exact: true }),
    })
    .getByRole("region", { name: "Enforcement", exact: true });
  // An account-only appeal cannot authorize reinstatement of its project.
  await expect(
    accountPanel.getByRole("option", {
      name: "Reinstate after review",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    accountPanel.getByRole("option", {
      name: "Request reinstatement",
      exact: true,
    }),
  ).toHaveCount(1);
  await accountPanel.getByLabel("Action").selectOption("reinstate_accounts");
  await accountPanel.getByLabel("GitHub accounts to reinstate").fill(login);
  await accountPanel
    .getByLabel("Reason (private audit record)")
    .fill("The evidence clears this account; the project stays banned");
  await accountPanel
    .getByLabel("Evidence reference (link or case id)")
    .fill(evidence);
  await accountPanel.getByRole("button", { name: "Preview action" }).click();
  const accountPreview = accountPanel.getByRole("group", {
    name: "Preview",
    exact: true,
  });
  await expect(accountPreview).toContainText(`Accounts reinstated@${login}`);
  await expect(accountPreview).toContainText("Banned → Banned");
  await expectAccessible(independent);
  await independent.screenshot({
    path: test.info().outputPath("account-reinstatement-preview.png"),
    fullPage: true,
  });
  await accountPreview
    .getByRole("button", { name: "Confirm: Reinstate selected accounts" })
    .click();
  await expect(independent.getByRole("status").first()).toContainText(
    "Reinstate selected accounts recorded",
  );
  await expect(accountPanel).not.toContainText(`Banned maintainers@${login}`);
  expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(
    410,
  );
  await expectAccessible(independent);
  await independent.screenshot({
    path: test.info().outputPath("account-reinstated-project-banned.png"),
    fullPage: true,
  });
  await independentContext.close();
});

test("an owner installs Slopbot before creation and resumes setup; a failed scan and lost access each show the next action @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  const project = fixtureProjects().setup;
  // The refused creation before install and the refused publish after access
  // is lost.
  const refusedCreation = diagnostics.allowResponse(
    409,
    "POST",
    "/api/v1/projects",
  );
  const refusedPublish = diagnostics.allowResponse(
    403,
    "PUT",
    `/api/v1/projects/${project.id}`,
  );
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  await signIn(page, OWNER_TOKEN);
  await draftApplication(page, project);
  const create = page.getByRole("button", {
    name: "Create project",
    exact: true,
  });
  await create.click();

  // Owner decision D11: without the Slopbot installation, Slop cannot read
  // the account's access, so nothing is created. The next action links the
  // installation, and the draft stays.
  const refused = page.locator("form").getByRole("alert");
  await expect(refused).toContainText(
    `Install Slopbot on ${project.repository} to confirm your access.`,
  );
  await expect(
    refused.getByRole("link", { name: "Install Slopbot" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/apps/slopdotcash/installations/new",
  );
  expect(await listedProject(page, project.id)).toBeUndefined();
  await expectAccessible(page);

  // New setup: after the installation, the same draft creates the paused
  // project. Slopbot reads admin access, and the first scan is queued.
  await setSlopbot(`${project.repository}/installed`);
  await create.click();
  const created = page.locator(".project-setup-status");
  await expect(created.locator("h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expectSetupCheck(
    created,
    "GitHub access",
    "Confirmed",
    `@e2e-owner has admin access to ${project.repository}.`,
  );
  await expectSetupCheck(
    created,
    "Security scan",
    "Queued",
    "The security scan is queued. Nothing is needed from you.",
  );
  await expectAccessible(page);

  // Resumed setup: the owner checks again from "Your projects" on a new
  // page load.
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  const entry = page.locator("#your-projects li", { hasText: project.name });
  await entry.getByRole("button", { name: "Check setup" }).click();
  const resumed = entry.locator(".project-setup-status");
  await expect(resumed.locator("h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expectSetupCheck(
    resumed,
    "GitHub access",
    "Confirmed",
    `@e2e-owner has admin access to ${project.repository}.`,
  );
  await expectSetupCheck(
    resumed,
    "Slopbot",
    "Installed",
    `Slopbot is installed on ${project.repository}.`,
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
  // The failed scan reaches the owner's inbox once (PRD NOT-01).
  await page.goto("/inbox");
  await expect(
    page.locator(".inbox-item", {
      hasText: `The security scan of ${project.id} could not finish.`,
    }),
  ).toHaveCount(1);
  await expectAccessible(page);

  // Owner edit: a text-only change publishes at once as revision 2.
  await page.goto(`/projects/${project.id}/manage`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox", { name: "Short description", exact: true })
    .fill("Accepted setup outcomes with a clear project scope");

  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 2" }),
  ).toBeVisible();
  // The only refusal so far is the creation before install.
  expect(diagnostics.count(refusedCreation)).toBe(1);
  expect(diagnostics.count(refusedPublish)).toBe(0);

  // A policy with no deployed or funded vault must not lock the asset.
  await openSettings(page, "Monthly rewards");
  await expect(
    page.getByRole("combobox", { name: "Network", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Network", exact: true })
    .selectOption("ethereum");
  await openSettings(page, "Monthly rewards");
  await page.getByLabel("Monthly amount (USDC)").fill("1200");

  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 3" }),
  ).toBeVisible();
  const switched = await listedProject(page, project.id);
  const now = new Date();
  expect(switched).toMatchObject({
    rewardAsset: { network: "ethereum", kind: "stablecoin" },
    reward: {
      monthlyCapMinor: "1200000000",
      cycleCaps: [
        { cycleId: now.toISOString().slice(0, 7), monthlyCapMinor: "0" },
      ],
    },
  });
  await page.screenshot({
    path: test.info().outputPath("unfunded-asset-change.png"),
    fullPage: true,
  });

  // Lost repository access removes the form and the server also refuses writes.
  await setSlopbot(`${project.repository}/permission/e2e-owner/read`);
  diagnostics.allowResponse(403, "GET", `/api/v1/project-setup/${project.id}`);
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText(
      "Project settings are available only to this project's maintainers.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Short description", exact: true }),
  ).toHaveCount(0);
  const rejectedStatus = await page.evaluate(
    async ({ id, manifest }) => {
      const response = await fetch(`/api/v1/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 3, manifest }),
      });
      return response.status;
    },
    { id: project.id, manifest: switched },
  );
  expect(rejectedStatus).toBe(403);
  expect(diagnostics.count(refusedCreation)).toBe(1);
  expect(diagnostics.count(refusedPublish)).toBe(1);
  const history = await (
    await page.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (revision: { projectId: string }) => revision.projectId === project.id,
    ),
  ).toHaveLength(3);
  expect(await listedProject(page, project.id)).toMatchObject({
    status: "paused",
    headline: "Accepted setup outcomes with a clear project scope",
  });
  await expectAccessible(page);
  await context.close();
});

test("an owner publishes while public GitHub is rate limited and recovers only a stale revision @registry", async ({
  browser,
  diagnostics,
}) => {
  const suffix = projectSuffix();
  const project = {
    id: `app-facts-${suffix}`,
    repository: `e2e-owner/app-facts-${suffix}`,
    name: `App facts ${suffix}`,
    network: "solana",
  };
  // The publish during the App outage and the refused stale publish below.
  const unavailable = diagnostics.allowResponse(
    503,
    "PUT",
    `/api/v1/projects/${project.id}`,
  );
  const stale = diagnostics.allowResponse(
    409,
    "PUT",
    `/api/v1/projects/${project.id}`,
  );
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  await signIn(page, OWNER_TOKEN);
  await setSlopbot(`${project.repository}/installed`);
  await draftApplication(page, project);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  await page.goto(`/projects/${project.id}/manage`, {
    waitUntil: "networkidle",
  });
  await openSettings(page, "Monthly rewards");
  const network = page.getByRole("combobox", { name: "Network", exact: true });
  await network.selectOption("base");
  await page.getByLabel("Monthly amount (USDC)").fill("1000");

  // The public GitHub read is really limited. The shipped Slopbot Worker
  // still reads the installation, immutable identity and caller permission.
  expect(
    (
      await fetch(
        `${GITHUB_FIXTURE}/__fixture/public-repository/${project.repository}/rate-limited`,
        { method: "PUT" },
      )
    ).status,
  ).toBe(204);
  const limited = await fetch(`${GITHUB_FIXTURE}/repos/${project.repository}`);
  expect(limited.status).toBe(403);
  expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  await publish.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 2" }),
  ).toBeVisible();
  const switched = await listedProject(page, project.id);
  expect(switched).toMatchObject({
    rewardAsset: { network: "base", kind: "stablecoin" },
    reward: {
      monthlyCapMinor: "1000000000",
      feeBasisPoints: 200,
      cycleCaps: [
        { cycleId: new Date().toISOString().slice(0, 7), monthlyCapMinor: "0" },
      ],
    },
  });
  await page.screenshot({
    path: test.info().outputPath("app-facts-published.png"),
    fullPage: true,
  });

  // A temporary App failure must preserve the draft and offer a retry, not
  // claim the immutable revision changed. No new revision is written.
  await setSlopbot(`${project.repository}/unavailable`);
  const headline = page.getByRole("textbox", {
    name: "Short description",
    exact: true,
  });
  await headline.fill("Useful work with an authenticated GitHub check");
  await publish.click();
  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toContainText("GitHub or Slopbot did not answer");
  expect(diagnostics.count(unavailable)).toBe(1);
  const reload = page.getByRole("button", {
    name: "Reload",
    exact: true,
  });
  await expect(reload).toHaveCount(0);
  await expect(headline).toHaveValue(
    "Useful work with an authenticated GitHub check",
  );
  await expect(network).toHaveValue("base");
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("app-failure-retains-draft.png"),
    fullPage: true,
  });
  await setSlopbot(`${project.repository}/installed`);
  await publish.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 3" }),
  ).toBeVisible();

  // A real concurrent owner revision must still show the load action.
  const current = await listedProject(page, project.id);
  const concurrent = await page.evaluate(
    async ({ id, manifest }) => {
      // The browser sends the same secure loopback fixture cookie as the form.
      const response = await fetch(`/api/v1/projects/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: {
            ...manifest,
            headline: "The owner published this from another tab",
          },
          expectedRevision: 3,
          reason: "Update from another owner tab",
        }),
      });
      return response.status;
    },
    { id: project.id, manifest: current },
  );
  expect(concurrent).toBe(200);
  await headline.fill("A draft based on the previous revision");
  await publish.click();
  await expect(alert).toContainText("The project changed since you loaded it");
  await expect(reload).toBeVisible();
  expect(diagnostics.count(stale)).toBe(1);
  await page.screenshot({
    path: test.info().outputPath("real-stale-revision.png"),
    fullPage: true,
  });
  await reload.click();
  await expect(
    page.getByText(
      "This draft was saved against revision 3. The current revision is 4.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(headline).toHaveValue("A draft based on the previous revision");
  await expect(publish).toBeDisabled();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(headline).toHaveValue(
    "The owner published this from another tab",
  );
  await expectAccessible(page);
  const history = await (
    await page.request.get("/api/v1/project-revisions")
  ).json();
  expect(
    history.revisions.filter(
      (revision: { projectId: string }) => revision.projectId === project.id,
    ),
  ).toHaveLength(4);
  await context.close();
});

test("an owner initializes a legacy monthly project without shortening its accepted policy @registry", async ({
  browser,
}) => {
  const suffix = projectSuffix();
  const project = {
    id: `legacy-policy-${suffix}`,
    repository: `e2e-owner/legacy-policy-${suffix}`,
    name: `Legacy policy ${suffix}`,
    network: "solana",
  };
  const context = await browser.newContext(walkthroughOptions());
  const page = await context.newPage();
  try {
    await signIn(page, OWNER_TOKEN);
    await setSlopbot(`${project.repository}/installed`);
    await draftApplication(page, project);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Project created" }),
    ).toBeVisible();
    const manifest = await listedProject(page, project.id);
    const criteria =
      "Accept reproduced defects with exact-source tests and preserve every existing funded obligation. "
        .repeat(18)
        .trim();
    const { escrow: _escrow, rewardAsset: _asset, ...legacy } = manifest;
    // Seed an imported historical revision in this isolated local database.
    // The live update API correctly refuses removing an established vault
    // policy; this fixture is an old record, not a permitted downgrade.
    const oldManifest = {
      ...legacy,
      reward: { ...legacy.reward, feeBasisPoints: 100 },
      contribution: { ...legacy.contribution, approvedScope: criteria },
    };
    const { assertProjectDefinition } = await import(
      "../../src/lib/project-schema.mjs"
    );
    assertProjectDefinition(oldManifest);
    const persist = process.env.SLOP_E2E_PERSIST_TO;
    if (!persist) throw new Error("Missing local registry database");
    const text = JSON.stringify(oldManifest);
    const digest = createHash("sha256").update(text).digest("hex");
    const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
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
        `INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) SELECT id,2,${sql(text)},${sql(digest)},'Historical import fixture',NULL,NULL,updated_at FROM projects WHERE id=${sql(project.id)}; UPDATE projects SET revision=2,manifest=${sql(text)},manifest_sha256=${sql(digest)} WHERE id=${sql(project.id)};`,
      ],
      { stdio: "pipe" },
    );
    // Publish one legitimate text revision so the public registry cache is
    // refreshed after the fixture's historical import, just as normal writes do.
    const refreshed = await page.evaluate(
      async ({ id, manifest }) => {
        const response = await fetch(`/api/v1/projects/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            manifest: {
              ...manifest,
              headline: "Historical monthly funding before vault adoption",
            },
            expectedRevision: 2,
          }),
        });
        return response.status;
      },
      { id: project.id, manifest: oldManifest },
    );
    expect(refreshed).toBe(200);
    expect((await listedProject(page, project.id)).escrow).toBeUndefined();
    // The form must finish loading before it is edited and published.
    await page.goto(`/projects/${project.id}/manage`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByLabel("Acceptance criteria", { exact: true }),
    ).toHaveValue(criteria);
    await expect(page.getByLabel("Monthly amount (USDC)")).toHaveValue("1000");
    const publish = page.getByRole("button", {
      name: "Publish changes",
      exact: true,
    });
    await page
      .getByLabel("Short description", { exact: true })
      .fill("Useful work under the project's complete accepted policy");
    await publish.focus();
    await page.keyboard.press("Enter");
    await page.screenshot({
      path: test.info().outputPath("legacy-policy-publish.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision 4" }),
    ).toBeVisible();
    const unchangedFunding = await listedProject(page, project.id);
    expect(unchangedFunding.contribution.approvedScope).toBe(criteria);
    expect(unchangedFunding.reward.feeBasisPoints).toBe(100);
    expect(unchangedFunding.escrow).toBeUndefined();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("legacy-policy-preserved.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Enable vault setup", exact: true })
      .click();
    await publish.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision 5" }),
    ).toBeVisible();
    const saved = await listedProject(page, project.id);
    expect(saved.contribution.approvedScope).toBe(criteria);
    expect(saved.reward).toMatchObject({
      monthlyCapMinor: "1000000000",
      paymentMode: "disabled",
      feeBasisPoints: 200,
    });
    expect(saved.rewardAsset).toMatchObject({
      network: "solana",
      symbol: "USDC",
    });
    expect(saved.escrow).toMatchObject({ chain: "solana", deployments: [] });
    await page.screenshot({
      path: test.info().outputPath("vault-setup-enabled.png"),
      fullPage: true,
    });
    await expectAccessible(page);
    const vaultSetupLink = page
      .getByRole("status")
      .filter({ hasText: "Published revision 5" })
      .getByRole("link", { name: "Set up vault", exact: true });
    await vaultSetupLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/manage#project-vault$`),
    );
    await expect(
      page.getByRole("heading", { name: /Project vault.*Solana/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Set up project vault", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("published-vault-funding.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("an applicant publishes an application stored before self-service setup without entering it again @registry", async ({
  browser,
  diagnostics,
}) => {
  // The aborted form submission below.
  diagnostics.allow(
    /^(?:console Failed to load resource: net::ERR_FAILED at |net::ERR_FAILED POST )http:\/\/[^ ]+\/api\/v1\/projects$/u,
  );
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
  await signIn(page, OWNER_TOKEN);
  await page.goto("/projects/new", { waitUntil: "networkidle" });
  await page.getByText("Your projects", { exact: true }).click();
  const entry = page.locator("#your-projects li", { hasText: project.name });
  await expect(entry).toContainText("submitted 2026-10-01");
  await setSlopbot(`${project.repository}/installed`);
  await entry.getByRole("button", { name: "Create this project" }).click();
  await expect(entry.locator(".project-setup-status h2")).toHaveText(
    "Setup status: Waiting for the security scan",
  );
  await expectSetupCheck(
    entry.locator(".project-setup-status"),
    "GitHub access",
    "Confirmed",
    `@e2e-owner has admin access to ${project.repository}.`,
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
  ).toContainText(`${project.name} · Paused`);
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
  await context.close();
});

test.describe("private evidence console", () => {
  test("a designated operator inspects retained vetting bytes with reasoned access @registry", async ({
    diagnostics,
    page,
  }) => {
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
    await signIn(page, EVIDENCE_OWNER_TOKEN);
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", {
        name: "Private vetting evidence",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Access expiry is enforced here.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `Select Harmless trace fixture, ${VETTING_EVIDENCE_OBJECTS[0].sha256.slice(0, 12)}`,
        exact: true,
      })
      .click();
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
    await expect(
      trace.getByRole("textbox", {
        name: "Harmless trace fixture verified content",
      }),
    ).toHaveValue(VETTING_EVIDENCE_OBJECTS[0].body);
    await page
      .getByRole("button", {
        name: `Select ${VETTING_EVIDENCE_OBJECTS[2].label}, ${VETTING_EVIDENCE_OBJECTS[2].sha256.slice(0, 12)}`,
        exact: true,
      })
      .click();
    const binary = page
      .getByRole("article")
      .filter({ hasText: VETTING_EVIDENCE_OBJECTS[2].sha256 });
    await binary
      .getByRole("textbox")
      .fill("Inspect exact binary artifact without executing it");
    const downloaded = page.waitForEvent("download");
    await binary
      .getByRole("button", {
        name: `Download ${VETTING_EVIDENCE_OBJECTS[2].label}`,
        exact: true,
      })
      .click();
    const download = await downloaded;
    const saved = test.info().outputPath("harmless-artifact.bin");
    await download.saveAs(saved);
    expect(await readFile(saved, "utf8")).toBe(
      VETTING_EVIDENCE_OBJECTS[2].body,
    );
    // Changing the selected file removes the preceding private viewer. A
    // fresh read still requires its own reason and audited grant.
    await expect(
      page.getByRole("textbox", {
        name: "Harmless trace fixture verified content",
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: `Select Harmless trace fixture, ${VETTING_EVIDENCE_OBJECTS[0].sha256.slice(0, 12)}`,
        exact: true,
      })
      .click();
    await trace
      .getByLabel("Reason to inspect Harmless trace fixture")
      .fill("Inspect this trace again for the enlarged-text review");
    await trace
      .getByRole("button", { name: "Read Harmless trace fixture" })
      .click();
    await expect(
      trace.getByRole("textbox", {
        name: "Harmless trace fixture verified content",
      }),
    ).toHaveValue(VETTING_EVIDENCE_OBJECTS[0].body);
    // At 200% zoom, keep at least the supported 320 CSS-pixel reflow width.
    // Zooming a 320px viewport directly would test an unsupported 160px layout.
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 640)
      await page.setViewportSize({ ...viewport, width: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(
      trace.getByRole("textbox", {
        name: "Harmless trace fixture verified content",
      }),
    ).toBeVisible();
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
    // The private evidence reads cancel no request.
    expect(diagnostics.count(CANCELED)).toBe(0);
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
  diagnostics,
}) => {
  // The rate-limited and unavailable lookups below.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 50[23] .* at |50[23] GET )http:\/\/[^ ]+\/api\/v1\/project-github\/repositories\//u,
  );
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
  // GitHub limits the shared anonymous Pages address. After Slopbot is
  // installed, the repository's own installation reads its facts.
  const limited = `e2e-owner/slopbot-lookup-${projectSuffix()}`;
  expect(
    (
      await fetch(
        `${GITHUB_FIXTURE}/__fixture/public-repository/${limited}/rate-limited`,
        { method: "PUT" },
      )
    ).status,
  ).toBe(204);
  const lookUp = page.getByRole("button", {
    name: "Look up on GitHub",
    exact: true,
  });
  await repository.fill(limited);
  await lookUp.click();
  await expect(page.locator(".lookup-status")).toContainText(
    "GitHub limited lookups.",
  );
  await setSlopbot(`${limited}/installed`);
  await lookUp.click();
  await expect(page.locator(".lookup-status")).toContainText("Found ");
  await expect(
    page.getByRole("textbox", { name: "Integration branch", exact: true }),
  ).toHaveValue("main");
  await page.screenshot({
    path: test.info().outputPath("repository-lookup-through-slopbot.png"),
    fullPage: true,
  });
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

test("two contributors flag through the agent API, pause the project and notify moderators @registry", async ({
  browser,
  diagnostics,
}) => {
  const readPrivate = (page: Page, path: string) =>
    page.evaluate(async (url) => (await fetch(url)).json(), path);
  const suffix = projectSuffix();
  const project = {
    id: `flag-flow-${suffix}`,
    repository: `e2e-owner/flag-flow-${suffix}`,
    name: `Flag flow ${suffix}`,
  };
  // A contributor may inspect this page without having maintainer access.
  diagnostics.allowResponse(403, "GET", `/api/v1/project-setup/${project.id}`);
  // Owner decision D3: a flagger's GitHub account is at least 30 days old
  // and has at least 1 merged pull request in a registered project.
  await setGithubUser("900000002", "e2e-applicant", "2020-01-01T00:00:00Z", 2);
  await setGithubUser(
    SECURITY_ACCOUNT.id,
    SECURITY_ACCOUNT.login,
    "2021-06-01T00:00:00Z",
    1,
  );
  await setGithubUser(
    "900000004",
    "e2e-moderator",
    new Date().toISOString(),
    3,
  );

  const ownerContext = await browser.newContext(walkthroughOptions());
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER_TOKEN);
  await setSlopbot(`${project.repository}/installed`);
  await draftApplication(owner, project);
  await owner
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Project created" }),
  ).toBeVisible();
  expect(await listedProject(owner, project.id)).toMatchObject({
    status: "paused",
  });
  const fileFlag = (
    token: string,
    category = "other",
    evidence = "Synthetic fixture: a refused flag must not be recorded.",
  ) =>
    owner.request.post(`/api/v1/project-flags/${project.id}`, {
      headers: {
        origin: new URL(owner.url()).origin,
        cookie: `__Host-slop_points=${token}`,
      },
      data: {
        category,
        evidence,
      },
    });
  // The project's own owner and a new GitHub account cannot flag.
  const ownFlag = await fileFlag(OWNER_TOKEN);
  expect(ownFlag.status()).toBe(403);
  expect(await ownFlag.json()).toMatchObject({ error: "owner_cannot_flag" });
  const newAccount = await fileFlag(MODERATOR_TOKEN);
  expect(newAccount.status()).toBe(403);
  expect(await newAccount.json()).toMatchObject({
    error: "flagger_account_too_new",
  });

  const adminContext = await browser.newContext(walkthroughOptions());
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_TOKEN);

  const firstContext = await browser.newContext(walkthroughOptions());
  const first = await firstContext.newPage();
  await signIn(first, APPLICANT_TOKEN);
  const firstEvidence =
    "Synthetic fixture: install.js requests credentials before starting.";
  await first.goto(`/projects/${project.id}`, { waitUntil: "networkidle" });
  await expect(first.locator(".project-risk-flag")).toHaveCount(0);
  expect(
    (
      await fileFlag(APPLICANT_TOKEN, "credential-theft", firstEvidence)
    ).status(),
  ).toBe(201);
  const ownPath = `/api/v1/project-flags/${project.id}`;
  expect(await readPrivate(first, ownPath)).toMatchObject({
    restriction: "clear",
    pausedByFlags: false,
  });
  await expectAccessible(first);
  await first.screenshot({
    path: test.info().outputPath("first-flag.png"),
    fullPage: true,
  });

  const secondContext = await browser.newContext(walkthroughOptions());
  const second = await secondContext.newPage();
  await signIn(second, SECURITY_ACCOUNT.token);
  expect(await readPrivate(second, ownPath)).toMatchObject({
    flag: null,
  });
  await second.goto(`/projects/${project.id}`, { waitUntil: "networkidle" });
  expect(
    (
      await fileFlag(
        SECURITY_ACCOUNT.token,
        "unsafe-execution",
        "Synthetic fixture: setup.sh runs an unverified downloaded script.",
      )
    ).status(),
  ).toBe(201);
  await second.reload({ waitUntil: "networkidle" });
  await expect(second.locator("main")).not.toContainText(firstEvidence);
  await expect(
    second.getByRole("heading", { name: "Project not found", exact: true }),
  ).toBeVisible();
  expect(await readPrivate(second, ownPath)).toMatchObject({
    restriction: "quarantined",
    pausedByFlags: true,
  });
  expect(
    (await second.request.get(`/projects/${project.id}/skill.md`)).status(),
  ).toBe(410);
  await expectAccessible(second);
  await second.screenshot({
    path: test.info().outputPath("second-flag-paused.png"),
    fullPage: true,
  });

  await second.reload({ waitUntil: "networkidle" });
  const withdrawn = await second.request.post(`${ownPath}/withdraw`, {
    headers: {
      origin: new URL(second.url()).origin,
      cookie: `__Host-slop_points=${SECURITY_ACCOUNT.token}`,
    },
    data: {},
  });
  expect(withdrawn.status()).toBe(200);
  expect(await readPrivate(second, ownPath)).toMatchObject({
    flag: null,
    restriction: "quarantined",
  });
  const inbox = await readPrivate(admin, "/api/v1/notifications");
  expect(
    inbox.notifications.filter(
      (notice: { subject: string; kind: string }) =>
        notice.subject === project.id && notice.kind === "project_quarantined",
    ),
  ).toHaveLength(1);
  await ownerContext.close();
  await firstContext.close();
  await secondContext.close();
  await adminContext.close();
});
