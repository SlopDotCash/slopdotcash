import type { Page } from "@playwright/test";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { RAW_PROJECT_DEFINITIONS } from "../fixtures/project-registry.mjs";
import { expect, test } from "./fixtures";

// These preview stubs use the frozen fixture, not the registry being deployed.
const project = assertProjectRegistry(RAW_PROJECT_DEFINITIONS).find(
  (entry) => entry.id === "eliza",
);
if (!project) throw new Error("Missing private-report project fixture");
const projectId = project.id;
const storageKey = (actor: string) =>
  `slop-report-compose:${actor}:${projectId}`;
const summary = "Private draft survives an uncertain response";
const description =
  "Private reproduction evidence retained only for its signed-in researcher.";

async function readDraft(page: Page, actor: string) {
  return page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, storageKey(actor));
}

test("confirmed sign-out clears an uncertain private draft, while a session outage retains it", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", "/api/v1/project-session");
  diagnostics.allow(/net::ERR_FAILED.*security-submissions/u);
  let identity: "42" | "signed-out" | "error" = "42";
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      status: identity === "error" ? 503 : 200,
      json:
        identity === "error"
          ? { error: "session_unavailable", message: "Session unavailable" }
          : {
              session:
                identity === "signed-out"
                  ? null
                  : { githubId: identity, githubLogin: "reporter-a" },
            },
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
  const attempts: unknown[] = [];
  await page.route("**/api/v1/security-submissions", (route) => {
    attempts.push(route.request().postDataJSON());
    return route.abort("failed");
  });
  await page.goto(`/projects/${projectId}/security`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill(summary);
  await page
    .getByRole("textbox", { name: /^Description\b/u })
    .fill(description);
  await page
    .getByRole("button", { name: "Review report", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit private report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry same report" }),
  ).toBeVisible();
  const uncertain = await readDraft(page, "42");
  expect(uncertain).toMatchObject({
    attempted: true,
    draft: { summary, description },
  });

  identity = "error";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Session unavailable", { exact: true }),
  ).toBeVisible();
  expect(await readDraft(page, "42")).toEqual(uncertain);

  identity = "42";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Retry same report" }),
  ).toBeVisible();
  await expect(page.locator(".report-preview")).toHaveText(description);
  await page.getByRole("button", { name: "Retry same report" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await readDraft(page, "42")).toEqual(uncertain);

  identity = "signed-out";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
  await expect.poll(() => readDraft(page, "42")).toBeNull();

  identity = "42";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("textbox", { name: "Summary", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: /^Description\b/u }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Retry same report" }),
  ).toHaveCount(0);
});

test("a confirmed account replacement cannot restore the prior reporter's draft", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  let actor = "42";
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: actor, githubLogin: `reporter-${actor}` } },
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
  await page.goto(`/projects/${projectId}/security`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox", { name: "Summary", exact: true })
    .fill(summary);
  await page
    .getByRole("textbox", { name: /^Description\b/u })
    .fill(description);
  await expect
    .poll(() => readDraft(page, "42"))
    .toMatchObject({
      draft: { summary, description },
    });
  actor = "43";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Draft kept in this tab for @reporter-43.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Summary", exact: true }),
  ).toHaveValue("");
  expect(await readDraft(page, "42")).toBeNull();
  actor = "42";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Draft kept in this tab for @reporter-42.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /^Description\b/u }),
  ).toHaveValue("");
});
