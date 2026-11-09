/** Source-authored readiness lifetime regressions; not executed in this audit. */
import type { Page, Route } from "@playwright/test";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { RAW_PROJECT_DEFINITIONS } from "../fixtures/project-registry.mjs";
import { expect, test } from "./fixtures";

test.use({ video: "on" });

const projects = assertProjectRegistry(RAW_PROJECT_DEFINITIONS);
const project = projects.find((entry) => entry.id === "eliza");
const other = projects.find((entry) => entry.id === "slopdotcash");
if (!project || !other) throw new Error("Missing readiness project fixtures");
const projectId = project.id;
const otherId = other.id;
const handoff = (id = projectId) =>
  `https://github.com/example/${id}/security/advisories/new`;

function gate() {
  let release!: () => void;
  let observe!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    requested: new Promise<void>((resolve) => {
      observe = resolve;
    }),
    release: () => release(),
    observe: () => observe(),
  };
}

async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date(0) });
  await page.clock.pauseAt(new Date("2026-11-01T12:00:00.000Z"));
}

function readiness(
  { ready = false, stale = false, stored = true, age = 2, id = projectId } = {},
) {
  return {
    state: ready ? "ready" : "disabled",
    automatic: "ready",
    storedIntake: stored,
    automaticConfigured: true,
    checkedAt: "2026-11-01T12:00:00.000Z",
    stale,
    maxAgeSeconds: age,
    paidParticipation: "closed",
    handoffUrl: ready ? handoff(id) : null,
  };
}

async function serve(
  page: Page,
  reply: (route: Route, projectId: string) => Promise<void>,
) {
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects } }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: { session: { githubId: "42", githubLogin: "readiness-reporter", admin: false } },
    }),
  );
  await page.route("**/api/v1/projects/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const found = projects.find((entry) => entry.id === id);
    return route.fulfill({ json: { revision: 1, project: found } });
  });
  await page.route("**/api/v1/security-programs/*/intake", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    if (!id) throw new Error("Missing readiness request project");
    return reply(route, id);
  });
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
}

async function openDelivery(page: Page) {
  const options = page.locator(".security-intake-card .security-reference");
  if ((await options.getAttribute("open")) === null)
    await options.locator("summary").click();
  return options;
}

test("a pending readiness recheck expires at the original deadline and keeps the private draft", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await pauseClock(page);
  const held = gate();
  let rechecking = false;
  await serve(page, async (route) => {
    if (rechecking) {
      held.observe();
      await held.promise;
      return route.fulfill({ json: readiness({ ready: true, age: 30 }) });
    }
    return route.fulfill({ json: readiness() });
  });
  try {
    await page.goto(`/projects/${projectId}/security`, { waitUntil: "networkidle" });
    const summary = page.getByRole("textbox", { name: "Summary", exact: true });
    await summary.fill("Draft stays while the readiness observation expires");
    const options = await openDelivery(page);
    await page.clock.fastForward(1000);
    rechecking = true;
    await options.getByRole("button", { name: "Check again", exact: true }).click();
    await held.requested;
    await page.clock.fastForward(1100);
    await expect(options.getByRole("alert")).toContainText("is out of date");
    await expect(options.getByRole("button", { name: "Checking…", exact: true })).toBeDisabled();
    await expect(summary).toHaveValue("Draft stays while the readiness observation expires");
    held.release();
    await expect(options.getByRole("link", { name: /report directly on GitHub/u })).toBeVisible();
    await expect(summary).toHaveValue("Draft stays while the readiness observation expires");
  } finally {
    held.release();
  }
});

test("a queued old expiry callback cannot hide a newly accepted readiness link", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await pauseClock(page);
  // Retain the actual timeout closure and deliver it after a newer response.
  // This controls callback order, not the readiness or React implementation.
  await page.addInitScript(() => {
    const scope = window as Window & { readinessExpiryCallbacks?: (() => void)[] };
    const schedule = window.setTimeout.bind(window);
    scope.readinessExpiryCallbacks = [];
    window.setTimeout = (handler, delay, ...args) => {
      if (typeof handler === "function" && delay !== undefined && delay > 1500 && delay <= 2100) {
        scope.readinessExpiryCallbacks?.push(() => handler(...args));
        return schedule(() => {}, delay);
      }
      return schedule(handler, delay, ...args);
    };
  });
  let refreshed = false;
  await serve(page, (route) => route.fulfill({ json: readiness({ ready: refreshed, age: refreshed ? 30 : 2 }) }));
  await page.goto(`/projects/${projectId}/security`, { waitUntil: "networkidle" });
  const options = await openDelivery(page);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { readinessExpiryCallbacks?: (() => void)[] }).readinessExpiryCallbacks?.length ?? 0,
  )).toBeGreaterThan(0);
  refreshed = true;
  await options.getByRole("button", { name: "Check again", exact: true }).click();
  const link = options.getByRole("link", { name: /report directly on GitHub/u });
  await expect(link).toBeVisible();
  await page.evaluate(() => {
    for (const callback of (window as Window & { readinessExpiryCallbacks?: (() => void)[] }).readinessExpiryCallbacks ?? [])
      callback();
  });
  await expect(link).toBeVisible();
  await expect(options.getByText(/is out of date/u)).toHaveCount(0);
});

test("zero remaining readiness age hides the GitHub handoff while retaining Slop intake", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await serve(page, (route) => route.fulfill({ json: readiness({ ready: true, age: 0 }) }));
  await page.goto(`/projects/${projectId}/security`, { waitUntil: "networkidle" });
  const options = await openDelivery(page);
  await expect(options.getByText(/is out of date/u)).toBeVisible();
  await expect(options.getByRole("link", { name: /report directly on GitHub/u })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Summary", exact: true })).toBeVisible();
});

test("a failed recheck keeps the draft and recovers with a later readiness response", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", `/api/v1/security-programs/${projectId}/intake`);
  let mode: "initial" | "failure" | "recovered" = "initial";
  await serve(page, (route) => mode === "failure"
    ? route.fulfill({ status: 503, json: { error: "unavailable", message: "Readiness unavailable" } })
    : route.fulfill({ json: readiness({ ready: mode === "recovered", age: 30 }) }));
  await page.goto(`/projects/${projectId}/security`, { waitUntil: "networkidle" });
  const summary = page.getByRole("textbox", { name: "Summary", exact: true });
  await summary.fill("Preserved across failed readiness refresh");
  const options = await openDelivery(page);
  mode = "failure";
  await options.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(options.getByText(/is out of date/u)).toBeVisible();
  await expect(summary).toHaveValue("Preserved across failed readiness refresh");
  mode = "recovered";
  await options.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(options.getByRole("link", { name: /report directly on GitHub/u })).toBeVisible();
  await expect(summary).toHaveValue("Preserved across failed readiness refresh");
});

test("a late readiness reply from a departed project cannot replace the current project", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  const held = gate();
  await serve(page, async (route, id) => {
    if (id === projectId) {
      held.observe();
      await held.promise;
    }
    return route.fulfill({ json: readiness({ ready: true, age: 30, id }) });
  });
  try {
    await page.goto(`/projects/${projectId}/security`, { waitUntil: "domcontentloaded" });
    await held.requested;
    await page.evaluate((id) => {
      history.pushState({}, "", `/projects/${id}/security`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, otherId);
    const options = await openDelivery(page);
    const link = options.getByRole("link", { name: /report directly on GitHub/u });
    await expect(link).toHaveAttribute("href", handoff(otherId));
    const oldResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/security-programs/${projectId}/intake`,
    );
    held.release();
    await (await oldResponse).finished();
    await expect(link).toHaveAttribute("href", handoff(otherId));
  } finally {
    held.release();
  }
});

test("an initial readiness outage remains distinct from a ready empty intake and retries", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  diagnostics.allowResponse(503, "GET", `/api/v1/security-programs/${projectId}/intake`);
  let unavailable = true;
  await serve(page, (route) => unavailable
    ? route.fulfill({ status: 503, json: { error: "unavailable", message: "Initial readiness unavailable" } })
    : route.fulfill({ json: readiness({ ready: false, stored: true, age: 30 }) }));
  await page.goto(`/projects/${projectId}/security`, { waitUntil: "networkidle" });
  const options = await openDelivery(page);
  await expect(options.getByRole("alert")).toContainText("Initial readiness unavailable");
  await expect(page.getByRole("textbox", { name: "Summary", exact: true })).toHaveCount(0);
  unavailable = false;
  await options.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Summary", exact: true })).toBeVisible();
  await expect(options.getByRole("link", { name: /report directly on GitHub/u })).toHaveCount(0);
});
