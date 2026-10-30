import { expect, expectAccessible, test } from "./fixtures";

test("same-project report references identify the private evidence to open", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  const actor = { githubId: "42", githubLogin: "reporter" };
  const projectId = "reference-fixture";
  const advisory = (ghsa: string) => ({
    ghsa,
    url: `https://github.com/example/private/security/advisories/${ghsa}`,
  });
  const reports = [
    { suffix: "aaa11111", caseId: "sc_00000000aaa11111", advisory: null },
    {
      suffix: "bbb22222",
      caseId: "sc_00000000bbb22222",
      advisory: advisory("GHSA-2222-3333-4444"),
    },
    {
      suffix: "ccc33333",
      caseId: "sc_00000000ccc33333",
      advisory: advisory("GHSA-5555-6666-7777"),
    },
    {
      suffix: "ddd44444",
      caseId: null,
      advisory: advisory("GHSA-8888-9999-cccc"),
    },
  ].map((entry) => ({
    ...entry,
    id: `ss_00000000${entry.suffix}`,
    projectId,
    repository: "example/private",
    origin: "slop",
    state: "draft",
    revision: 1,
    attempt: 0,
    githubCreatedAt: null,
    failureCode: null,
    retryAllowed: false,
    reconcileAfter: null,
    intake: {
      state: "legitimate",
      receivedAt: "2026-10-27T12:00:00.000Z",
      routingState: "routed",
      revision: 1,
      reason: null,
      reviewedAt: null,
      canReview: false,
      canForward: false,
      canRetryScreening: false,
      canAuthorize: false,
      canRevise: false,
    },
  }));
  const currentAdvisory = advisory("GHSA-cccc-gggg-mmmm");
  const cases = reports.slice(0, 2).map((report, index) => ({
    id: report.caseId,
    projectId,
    revision: 1,
    view: "reporter",
    viewerRoles: ["reporter"],
    allowedActions: [],
    nextStep: "Wait for owner review.",
    nextStepDueAt: null,
    submissionState: "verified",
    receivedAt: "2026-10-27T12:00:00.000Z",
    receivedAtSource: "slop-received",
    policyRevision: 1,
    terms: null,
    awardState: "not-assessed",
    award: null,
    relatedParty: "not-assessed",
    relatedPartyReview: "not-applicable",
    paymentState: "not-ready",
    paymentRail: "unavailable",
    paymentNetworks: [],
    settlement: null,
    paymentDeadline: null,
    advisory: index === 1 ? currentAdvisory : null,
  }));
  const reads: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/projects")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/project-session")
      return route.fulfill({ json: { session: actor } });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          notifications: [],
          unread: 0,
          nextCursor: null,
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({ json: { viewer: actor, programs: [], cases } });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: {
          recipientGithubId: actor.githubId,
          automatic: true,
          submissions: reports,
        },
      });
    const report = reports.find(
      (entry) => path === `/api/v1/security-submissions/${entry.id}`,
    );
    if (report) {
      expect(route.request().headers()["x-slop-expected-github-id"]).toBe("42");
      reads.push(report.id);
      return route.fulfill({
        json: {
          submission: report,
          report: {
            summary: `Synthetic finding ${report.suffix}`,
            description: `Synthetic private evidence for report ${report.suffix}.`,
          },
        },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto("/inbox");
  await expect(page.locator(".private-report-heading")).toHaveCount(4);
  await page.screenshot({
    path: info.outputPath("report-list.png"),
    fullPage: true,
  });
  const title = (reference: string) =>
    `Private report · ${projectId} · ${reference}`;
  await expect(
    page.getByRole("heading", { name: title("Case aaa11111"), exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: title(currentAdvisory.ghsa),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: title("GHSA-5555-6666-7777"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: title("GHSA-8888-9999-cccc"),
      exact: true,
    }),
  ).toBeVisible();
  const selected = page.getByRole("article", {
    name: title(currentAdvisory.ghsa),
    exact: true,
  });
  await expect(selected.locator("h3 span")).toHaveAttribute(
    "title",
    reports[1].caseId as string,
  );
  expect(reads).toEqual([]);
  await selected.locator("summary.private-report-summary").click();
  const read = selected.getByText("Read private report", { exact: true });
  await read.focus();
  await page.keyboard.press("Enter");
  await expect(
    selected.getByText("Synthetic private evidence for report bbb22222.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(reads).toEqual([reports[1].id]);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("selected-report.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(
    selected.getByRole("heading", {
      name: title(currentAdvisory.ghsa),
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("report-reference-200-percent.png"),
    fullPage: true,
  });
});
