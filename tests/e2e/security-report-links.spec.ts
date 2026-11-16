/**
 * Link, record, import and resend controls of the private security page. The
 * built app runs with synthetic sessions and case responses; no private
 * report or GitHub request leaves the test.
 */
import type { Page, Request } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, expectAccessible, test } from "./fixtures";

const ACTOR = "42";
const LOGIN = "fixture-maintainer";
const project = PROJECTS.find((entry) => entry.id === "eliza");
if (!project) throw new Error("Missing fixture project");
const repository = project.repositories[0].id;

/** A case view as the API returns it, with no award or payment yet. */
function caseView(
  id: string,
  ghsa: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    projectId: project?.id,
    revision: 1,
    view: "reporter",
    viewerRoles: ["reporter"],
    allowedActions: [],
    nextStep: "A maintainer verifies the link.",
    nextStepDueAt: null,
    submissionState: "claimed",
    receivedAt: null,
    receivedAtSource: null,
    policyRevision: null,
    terms: null,
    awardState: "not-applicable",
    award: null,
    relatedParty: "not-assessed",
    relatedPartyReview: "not-applicable",
    paymentState: "not-applicable",
    paymentRail: "unavailable",
    paymentNetworks: [],
    settlement: null,
    paymentDeadline: null,
    advisory: {
      repository,
      ghsa,
      url: `https://github.com/${repository}/security/advisories/${ghsa}`,
    },
    receiptState: "received",
    remediationState: "not-started",
    disclosureState: "embargoed",
    recognition: "private",
    appealState: "none",
    events: [],
    ...overrides,
  };
}

type Fixture = {
  automatic: boolean;
  cases: ReturnType<typeof caseView>[];
  submissions: Record<string, unknown>[];
  posts: { path: string; body: Record<string, unknown> }[];
  caseReads: number;
  answer?: (
    path: string,
    body: Record<string, unknown>,
  ) => { status?: number; json: unknown } | undefined;
};

/** Serves the private security APIs for one signed-in maintainer. */
async function serveSecurity(page: Page, fixture: Fixture) {
  await page.route("**/api/v1/**", (route) => {
    const request: Request = route.request();
    const path = new URL(request.url()).pathname.slice("/api/v1/".length);
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      fixture.posts.push({ path, body });
      const answer = fixture.answer?.(path, body);
      if (answer) return route.fulfill(answer);
      throw new Error(`Unexpected security fixture write: ${path}`);
    }
    if (path === "project-session")
      return route.fulfill({
        json: { session: { githubId: ACTOR, githubLogin: LOGIN } },
      });
    if (path === "projects")
      return route.fulfill({
        json: { schemaVersion: "1", projects: [project] },
      });
    if (path === "notifications")
      return route.fulfill({
        json: { recipientGithubId: ACTOR, notifications: [], unread: 0 },
      });
    if (path === "security-cases") {
      fixture.caseReads += 1;
      return route.fulfill({
        json: {
          viewer: { githubId: ACTOR, githubLogin: LOGIN },
          programs: [
            {
              projectId: project?.id,
              roles: ["security-maintainer"],
            },
          ],
          cases: fixture.cases,
        },
      });
    }
    if (path.startsWith("security-cases/")) {
      const found = fixture.cases.find(
        (entry) => entry.id === path.slice("security-cases/".length),
      );
      return route.fulfill(
        found
          ? { json: { case: found } }
          : { status: 500, json: { error: "missing_fixture_case" } },
      );
    }
    if (path === "security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: ACTOR,
          automatic: fixture.automatic,
          submissions: fixture.submissions,
        },
      });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

async function openLinkOptions(page: Page) {
  const options = page.locator("details.security-reference").filter({
    has: page.getByText("Link or import a GitHub report", { exact: true }),
  });
  if ((await options.getAttribute("open")) === null)
    await options.locator("summary").first().click();
  return options;
}

test("a reporter links a GitHub report and a maintainer records a verified one", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  const linked = caseView("sc_e2elinkedreport1", "GHSA-2c3f-4g5h-6j7m");
  const recorded = caseView("sc_e2erecordreport1", "GHSA-3c4f-5g6h-7j8m", {
    view: "restricted",
    viewerRoles: ["security-maintainer"],
    submissionState: "verified",
    receivedAt: "2026-10-30T14:05:00.000Z",
    receivedAtSource: "maintainer-attested",
    nextStep: "Triage the report.",
  });
  const fixture: Fixture = {
    automatic: false,
    cases: [],
    submissions: [],
    posts: [],
    caseReads: 0,
    answer: (_path, body) => {
      if (body.mode === "claim") {
        fixture.cases = [linked, ...fixture.cases];
        return { status: 201, json: { case: linked } };
      }
      if (body.mode === "record") {
        fixture.cases = [recorded, ...fixture.cases];
        return { status: 201, json: { case: recorded } };
      }
      return undefined;
    },
  };
  await serveSecurity(page, fixture);
  await page.goto("/security", { waitUntil: "networkidle" });
  const options = await openLinkOptions(page);
  const link = options.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Link a report you submitted on GitHub",
    }),
  });
  const advisory = link.getByRole("textbox", {
    name: "GitHub advisory ID",
  });
  // Report details are refused by the advisory ID pattern before sending.
  await advisory.fill("The vault rounding bug");
  await link
    .getByRole("button", { name: "Link my GitHub report", exact: true })
    .click();
  expect(
    await advisory.evaluate(
      (input: HTMLInputElement) => input.validity.patternMismatch,
    ),
  ).toBe(true);
  expect(fixture.posts).toEqual([]);
  await advisory.fill("GHSA-2c3f-4g5h-6j7m");
  await link
    .getByRole("button", { name: "Link my GitHub report", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Report saved." }),
  ).toBeVisible();
  const linkedDetail = page.locator(`[aria-labelledby="case-${linked.id}"]`);
  await expect(linkedDetail).toBeVisible();
  await expect(advisory).toHaveValue("");
  expect(fixture.posts).toHaveLength(1);
  expect(fixture.posts[0]).toMatchObject({
    path: "security-cases",
    body: {
      mode: "claim",
      projectId: project?.id,
      advisory: "GHSA-2c3f-4g5h-6j7m",
    },
  });
  const firstKey = fixture.posts[0].body.idempotencyKey;
  expect(firstKey).toEqual(expect.any(String));
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("linked-report.png"),
    fullPage: true,
  });

  const record = options.locator("section").filter({
    has: page.getByRole("heading", { name: "Reports sent on GitHub directly" }),
  });
  await record
    .getByRole("textbox", { name: "GitHub advisory ID" })
    .fill("GHSA-3c4f-5g6h-7j8m");
  await record
    .getByRole("textbox", { name: "Reporter GitHub account ID" })
    .fill("900000123");
  await record
    .getByRole("textbox", { name: "Reporter GitHub login" })
    .fill("fixture-researcher");
  await record
    .getByLabel("Time GitHub received the report (UTC)")
    .fill("2026-10-30T14:05");
  await record.getByRole("checkbox").check();
  await record
    .getByRole("button", { name: "Record verified report", exact: true })
    .click();
  await expect(
    page.locator(`[aria-labelledby="case-${recorded.id}"]`),
  ).toBeVisible();
  expect(fixture.posts).toHaveLength(2);
  expect(fixture.posts[1]).toMatchObject({
    path: "security-cases",
    body: {
      mode: "record",
      projectId: project?.id,
      advisory: "GHSA-3c4f-5g6h-7j8m",
      reporterGithubId: "900000123",
      reporterGithubLogin: "fixture-researcher",
      receivedAt: "2026-10-30T14:05:00.000Z",
      confirmation: true,
    },
  });
  expect(fixture.posts[1].body.idempotencyKey).not.toBe(firstKey);
  await expectAccessible(page);
});

test("a maintainer brings in GitHub private reports after GitHub was unavailable", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const imported = caseView("sc_e2eimportreport1", "GHSA-4c5f-6g7h-8j9m", {
    view: "restricted",
    viewerRoles: ["security-maintainer"],
    submissionState: "verified",
    receivedAt: "2026-10-29T09:00:00.000Z",
    receivedAtSource: "github-verified",
    nextStep: "Triage the report.",
  });
  let imports = 0;
  const fixture: Fixture = {
    automatic: true,
    cases: [],
    submissions: [],
    posts: [],
    caseReads: 0,
    answer: (path, body) => {
      if (path !== "security-cases" || body.mode !== "import") return undefined;
      imports += 1;
      if (imports === 1) return { json: { state: "unavailable", received: 0 } };
      fixture.cases = [imported];
      return { json: { state: "ok", received: 1 } };
    },
  };
  await serveSecurity(page, fixture);
  await page.goto("/security", { waitUntil: "networkidle" });
  const options = await openLinkOptions(page);
  const bring = options.getByRole("button", {
    name: "Bring in GitHub private reports",
    exact: true,
  });
  await bring.click();
  await expect(options.getByRole("alert")).toContainText(
    "Slop could not read the repository's private reports on GitHub. Nothing changed; try again later.",
  );
  const readsBefore = fixture.caseReads;
  await expect(bring).toBeEnabled();
  await bring.click();
  await expect(options.getByRole("status")).toHaveText(
    "1 new private report recorded.",
  );
  await expect(options.getByRole("alert")).toHaveCount(0);
  // The case list reloads and shows the imported report.
  await expect.poll(() => fixture.caseReads).toBeGreaterThan(readsBefore);
  await expect(
    page.getByRole("button", { name: /GHSA-4c5f-6g7h-8j9m/u }),
  ).toBeVisible();
  expect(fixture.posts).toEqual([
    {
      path: "security-cases",
      body: { mode: "import", projectId: project?.id },
    },
    {
      path: "security-cases",
      body: { mode: "import", projectId: project?.id },
    },
  ]);
  await expectAccessible(page);
});

test("a failed private delivery is fixed and resent", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  const id = "ss_e2efailedsend1";
  let submission: Record<string, unknown> = {
    id,
    projectId: project.id,
    repository,
    origin: "slop",
    state: "failed",
    revision: 3,
    attempt: 1,
    advisory: null,
    githubCreatedAt: null,
    failureCode: "github-unavailable",
    caseId: null,
    retryAllowed: true,
    reconcileAfter: null,
    intake: null,
  };
  const fixture: Fixture = {
    automatic: true,
    cases: [],
    submissions: [submission],
    posts: [],
    caseReads: 0,
    answer: (path) => {
      if (path !== `security-submissions/${id}/send`) return undefined;
      submission = {
        ...submission,
        state: "submitted",
        revision: 4,
        attempt: 2,
      };
      fixture.submissions = [submission];
      return { status: 202, json: { submission } };
    },
  };
  await serveSecurity(page, fixture);
  await page.goto(`/security?submission=${id}`, { waitUntil: "networkidle" });
  const card = page.locator(`[aria-labelledby="submission-${id}"]`);
  const form = card.locator("form");
  const resend = form.getByRole("button", {
    name: "Fix and resend",
    exact: true,
  });
  await expect(resend).toBeVisible();
  const report = {
    summary: "Vault share rounding drains deposits",
    description: "Corrected reproduction on an isolated local fork.",
  };
  await form
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill(report.summary);
  await form.locator("textarea").fill(report.description);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("failed-delivery.png"),
    fullPage: true,
  });
  await resend.click();
  await expect(form).toHaveCount(0);
  await expect(card).toContainText("Check again");
  expect(fixture.posts).toEqual([
    {
      path: `security-submissions/${id}/send`,
      body: { expectedRevision: 3, report },
    },
  ]);
  // The sent text is no longer kept as a local draft.
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `slop-intake-draft:${id}`,
    ),
  ).toBeNull();
  await expectAccessible(page);
});
