/**
 * The private report form takes a description file and a proof-of-concept
 * file, read in the browser; the Inbox shows a saved proof file. Explicit API
 * fixtures only: no report leaves this test.
 */
import type { Page } from "@playwright/test";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { RAW_PROJECT_DEFINITIONS } from "../fixtures/project-registry.mjs";
import { expect, expectAccessible, routeReporterInbox, test } from "./fixtures";

const project = assertProjectRegistry(RAW_PROJECT_DEFINITIONS).find(
  (entry) => entry.id === "eliza",
);
if (!project) throw new Error("Missing private-report project fixture");
const projectId = project.id;
const description =
  "At commit abc, withdraw() rounds shares down. The attached test repeats a synthetic withdrawal.";
const patch =
  "--- a/test/Vault.t.sol\n+++ b/test/Vault.t.sol\n@@ -1 +1,3 @@\n+function testWithdrawRounding() public {\n+  vault.withdraw(1);\n+}\n";

async function choose(
  page: Page,
  button: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).click();
  await (await chooser).setFiles(file);
}

test("a report takes its description and a proof-of-concept file from files, keeps them in the draft and submits both", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "42", githubLogin: "reporter-a" } },
    }),
  );
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route(`**/api/v1/security-programs/${projectId}/intake`, (route) =>
    route.fulfill({
      json: {
        state: "unavailable",
        storedIntake: true,
        automaticConfigured: false,
        checkedAt: null,
        maxAgeSeconds: 3600,
        paidParticipation: "closed",
        handoffUrl: null,
      },
    }),
  );
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/v1/security-submissions", (route) => {
    posted.push(route.request().postDataJSON());
    return route.abort("failed");
  });
  diagnostics.allow(/net::ERR_FAILED.*security-submissions/u);
  await page.goto(`/projects/${projectId}/security`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill("Withdrawal rounds shares in the wrong direction");
  await choose(page, "Load report from file", {
    name: "report.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`\n${description}\n`),
  });
  await expect(
    page.getByRole("textbox", { name: /^Description\b/u }),
  ).toHaveValue(description);

  // A binary file is refused with a plain reason and nothing is kept.
  await choose(page, "Choose file", {
    name: "test.patch",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x2b, 0x00, 0xff, 0xfe]),
  });
  await expect(
    page.getByText("The file must be text, not a binary file.", {
      exact: true,
    }),
  ).toBeVisible();
  // A file with another ending is refused before it is read.
  await choose(page, "Choose file", {
    name: "exploit.sh",
    mimeType: "text/plain",
    buffer: Buffer.from("echo\n"),
  });
  await expect(page.getByText(/^The proof file must end in /u)).toBeVisible();

  await choose(page, "Choose file", {
    name: "WithdrawRounding.t.sol",
    mimeType: "text/plain",
    buffer: Buffer.from(patch),
  });
  const size = `${Buffer.byteLength(patch).toLocaleString("en-US")} bytes`;
  await expect(
    page.getByText(`WithdrawRounding.t.sol · ${size}`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectAccessible(page);

  // The draft keeps the proof file across a reload.
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText(`WithdrawRounding.t.sol · ${size}`, { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(/WithdrawRounding\.t\.sol/u)).toHaveCount(0);
  await choose(page, "Choose file", {
    name: "WithdrawRounding.t.sol",
    mimeType: "text/plain",
    buffer: Buffer.from(patch),
  });

  await page
    .getByRole("button", { name: "Review report", exact: true })
    .click();
  await expect(
    page.getByText("Proof of concept: WithdrawRounding.t.sol", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit private report", exact: true })
    .click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]?.report).toEqual({
    summary: "Withdrawal rounds shares in the wrong direction",
    description,
    proofOfConcept: { fileName: "WithdrawRounding.t.sol", patch },
  });
});

test("the Inbox shows a saved proof-of-concept file with a download", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const id = "ss_proof_file";
  const submission = {
    id,
    projectId: "fixture-project",
    repository: "example/fixture-project",
    origin: "slop",
    state: "draft",
    revision: 2,
    attempt: 0,
    advisory: null,
    githubCreatedAt: null,
    failureCode: null,
    caseId: null,
    retryAllowed: false,
    reconcileAfter: null,
    intake: {
      state: "legitimate",
      receivedAt: "2026-11-20T12:00:00.000Z",
      routingState: "routed",
      revision: 2,
      reason: null,
      reviewedAt: null,
      canReview: false,
      canForward: false,
      canRetryScreening: false,
      canAuthorize: false,
      canRevise: false,
    },
  };
  const report = {
    summary: "Withdrawal rounds shares in the wrong direction",
    description,
    proofOfConcept: { fileName: "rounding.patch", patch },
  };
  await routeReporterInbox(page, {
    submission: () => submission,
    automatic: true,
    onRequest: async (route, path) => {
      if (path === `security-submissions/${id}`)
        return route.fulfill({ json: { submission, report } });
      throw new Error(`Unexpected proof fixture request: ${path}`);
    },
  });
  await page.goto(`/inbox?submission=${id}`, { waitUntil: "networkidle" });
  const card = page.locator(`[aria-labelledby="submission-${id}"]`);
  await card.getByText("Report", { exact: true }).click();
  await expect(card.locator("pre.security-report-text").first()).toHaveText(
    description,
  );
  await expect(
    card.getByRole("heading", { name: "Proof of concept: rounding.patch" }),
  ).toBeVisible();
  await expect(card.locator("pre.security-report-text").nth(1)).toHaveText(
    patch.trimEnd(),
  );
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: /^Download / }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("rounding.patch");
  await expectAccessible(page);
});
