/** Source-authored lifecycle regressions. Not executed during this audit. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { emptyPointsJournal } from "../../src/lib/points";
import { sha256Hex } from "../../src/lib/sha256";
import { expect, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

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

async function serve(page: Page) {
  const state = {
    signedIn: true,
    actor: 1,
    failSession: false,
    failPoints: false,
    failSignout: false,
    failAvatar: false,
    sessionGate: null as ReturnType<typeof gate> | null,
    signoutGate: null as ReturnType<typeof gate> | null,
    signouts: 0,
  };
  const membership = {
    actor: { id: "MDQ6VXNlcjEyMw==", login: "menu-fixture" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: true,
    welcome: 5,
    socialPoints: 10,
  };
  const currentMembership = () =>
    state.actor === 1
      ? membership
      : {
          ...membership,
          actor: { id: "MDQ6VXNlcjQ1Ng==", login: "replacement-menu" },
          welcome: 0,
          socialPoints: 0,
        };
  const journal = emptyPointsJournal("2026-11-01T00:00:00.000Z");
  const emptyShard = "[]";
  await page.route(`${site}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/points/me") {
      const held = state.sessionGate;
      if (held) {
        held.observe();
        await held.promise;
      }
      return state.failSession
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({ json: state.signedIn ? currentMembership() : null });
    }
    if (path === "/api/v1/project-session")
      return route.fulfill({
        json: {
          session: state.signedIn
            ? {
                githubId: state.actor === 1 ? "123" : "456",
                githubLogin: currentMembership().actor.login,
                admin: false,
              }
            : null,
        },
      });
    if (path === "/api/v1/points/signout") {
      expect(request.method()).toBe("POST");
      state.signouts++;
      const held = state.signoutGate;
      if (held) {
        held.observe();
        await held.promise;
      }
      if (state.failSignout)
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      state.signedIn = false;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (path === "/data/points.json")
      return state.failPoints
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({
            json: {
              schemaVersion: "1",
              ruleVersion: journal.ruleVersion,
              generatedAt: journal.generatedAt,
              coverage: journal.coverage,
              revisionCount: 0,
              shards: Array.from({ length: 16 }, (_, index) => ({
                path: `/data/points/${index.toString(16)}.json`,
                count: 0,
                sha256: sha256Hex(emptyShard),
              })),
            },
          });
    if (/^\/data\/points\/[0-9a-f]\.json$/u.test(path))
      return route.fulfill({ contentType: "application/json", body: emptyShard });
    if (path === "/.well-known/slop/projects.json")
      return route.fulfill({ json: { schemaVersion: "1", projects: [] } });
    if (path === "/api/v1/points/member" || path === "/api/v1/points/x/profile")
      return route.fulfill({ json: null });
    if (path === "/api/v1/payments/received") return route.fallback();
    return route.fulfill({
      path: join(
        process.cwd(),
        "dist",
        request.resourceType() === "document" ? "index.html" : path,
      ),
    });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: state.failAvatar
        ? "not an image"
        : '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80"/></svg>',
    }),
  );
  await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
    route.fulfill({ json: null }),
  );
  return state;
}

function controls(page: Page) {
  return {
    trigger: page.getByRole("button", { name: "Your account", exact: true }),
    panel: page.getByRole("region", {
      name: "Your account details",
      exact: true,
    }),
    header: page.getByRole("banner"),
  };
}

/** Keep valid response bytes pending after fetch has already returned headers. */
async function holdSignoutBody(page: Page) {
  await page.addInitScript(() => {
    const scope = window as Window & {
      menuSignoutBody?: {
        headers: boolean;
        settled: boolean;
        release: () => void;
      };
    };
    const fetchResponse = window.fetch.bind(window);
    const state = { headers: false, settled: false, release: () => {} };
    scope.menuSignoutBody = state;
    window.fetch = async (input, init) => {
      const response = await fetchResponse(input, init);
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      ).pathname;
      if (path !== "/api/v1/points/signout" || !response.body) return response;
      const reader = response.body.getReader();
      const released = new Promise<void>((resolve) => {
        state.release = resolve;
      });
      state.headers = true;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await released;
          try {
            for (;;) {
              const result = await reader.read();
              if (result.done) break;
              controller.enqueue(result.value);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            reader.releaseLock();
            state.settled = true;
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });
}

async function releaseSignoutBody(page: Page) {
  await page.evaluate(() => {
    const scope = window as Window & { menuSignoutBody?: { release: () => void } };
    scope.menuSignoutBody?.release();
  });
}

test("the account menu keeps interior focus and returns Escape focus to its trigger", async ({
  page,
}) => {
  await serve(page);
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("link", { name: "View profile", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

for (const outside of ["pointer", "focus"] as const) {
  test(`an outside ${outside} closes the account menu without redirecting focus`, async ({
    page,
  }) => {
    await serve(page);
    await page.goto(`${site}/how-it-works`);
    const { trigger, panel, header } = controls(page);
    await trigger.click();
    await expect(panel).toBeVisible();
    const home = header.getByRole("link", {
      name: "Slop home",
      exact: true,
    });
    if (outside === "pointer") await header.click({ position: { x: 1, y: 1 } });
    else await home.focus();
    await expect(panel).toHaveCount(0);
    if (outside === "focus") await expect(home).toBeFocused();
  });
}

test("an unrelated fragment change keeps the open menu while history navigation closes it", async ({
  page,
}) => {
  await serve(page);
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await trigger.click();
  await page.evaluate(() => {
    history.replaceState({}, "", "/how-it-works#menu-fragment");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/how-it-works?from=history#menu-fragment");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(panel).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("historical membership awards display after the empty earned journal is ready", async ({
  page,
}) => {
  await serve(page);
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await expect(trigger).toContainText("15 pts");
  await trigger.click();
  await expect(panel).toContainText("@menu-fixture");
  await expect(
    panel.getByRole("link", { name: "View profile", exact: true }),
  ).toHaveAttribute("href", "/contributors/menu-fixture");
  await expect(
    panel.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText("15 pts", { exact: true })).toHaveCount(0);
});

test("a failed points read stays unavailable until the menu retry succeeds", async ({
  page,
  diagnostics,
}) => {
  const state = await serve(page);
  state.failPoints = true;
  diagnostics.allowResponse(503, "GET", "/data/points.json");
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await trigger.click();
  await expect(panel).toContainText("Points unavailable");
  await expect(trigger).not.toContainText("15 pts");
  state.failPoints = false;
  await panel.getByRole("button", { name: "Retry points", exact: true }).click();
  await expect(trigger).toContainText("15 pts");
  await expect(
    panel.getByRole("button", { name: "Retry points", exact: true }),
  ).toHaveCount(0);
});

test("a failed signout retains its error across dismissal and permits a fresh attempt", async ({
  page,
  diagnostics,
}) => {
  const state = await serve(page);
  const held = gate();
  state.signoutGate = held;
  state.failSignout = true;
  diagnostics.allowResponse(503, "POST", "/api/v1/points/signout");
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel, header } = controls(page);
  await trigger.click();
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await held.requested;
  await expect(
    panel.getByRole("button", { name: "Signing out…", exact: true }),
  ).toBeDisabled();
  await header.click({ position: { x: 1, y: 1 } });
  await expect(panel).toHaveCount(0);
  held.release();
  await trigger.click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Could not sign out. Retry.",
  );
  state.signoutGate = null;
  state.failSignout = false;
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toBeVisible();
  expect(state.signouts).toBe(2);
});

test("a hidden pending signout still completes against the current return location", async ({
  page,
}) => {
  const state = await serve(page);
  const held = gate();
  state.signoutGate = held;
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await trigger.click();
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await held.requested;
  await page.evaluate(() => {
    history.pushState({}, "", "/how-it-works?after=signout#return-here");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await expect(
    panel.getByRole("button", { name: "Signing out…", exact: true }),
  ).toBeDisabled();
  held.release();
  await expect(trigger).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveAttribute(
    "href",
    "/login?next=%2Fhow-it-works%3Fafter%3Dsignout%23return-here",
  );
  expect(state.signouts).toBe(1);
});

test("an anonymous header waits for session resolution and tracks the latest fragment", async ({
  page,
}) => {
  const state = await serve(page);
  const held = gate();
  state.sessionGate = held;
  state.signedIn = false;
  await page.goto(`${site}/how-it-works?source=old`, {
    waitUntil: "domcontentloaded",
  });
  await held.requested;
  await expect(page.getByText("Checking login…", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    history.replaceState({}, "", "/how-it-works?source=new#latest");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  held.release();
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toHaveAttribute(
    "href",
    "/login?next=%2Fhow-it-works%3Fsource%3Dnew%23latest",
  );
});

test("the login page suppresses the anonymous header control even while checking", async ({
  page,
}) => {
  const state = await serve(page);
  const held = gate();
  state.signedIn = false;
  state.sessionGate = held;
  await page.goto(`${site}/login`, { waitUntil: "domcontentloaded" });
  await held.requested;
  await expect(
    page.getByRole("banner").getByText("Checking login…"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Log in", exact: true }),
  ).toHaveCount(0);
  held.release();
  await expect(
    page.getByRole("button", { name: "Continue with GitHub", exact: true }),
  ).toBeEnabled();
});

test("an undecodable account image falls back to initials without removing its trigger", async ({
  page,
}) => {
  const state = await serve(page);
  state.failAvatar = true;
  await page.goto(`${site}/how-it-works`);
  const { trigger, panel } = controls(page);
  await expect(trigger.locator("img")).toHaveCount(0);
  await expect(trigger).toContainText("ME");
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("@menu-fixture");
});

for (const outcome of ["success", "failure"] as const) {
  test(`a delayed signout ${outcome} body cannot overwrite a newer member or its draft`, async ({
    page,
    diagnostics,
  }) => {
    const state = await serve(page);
    state.failSignout = outcome === "failure";
    if (state.failSignout)
      diagnostics.allowResponse(503, "POST", "/api/v1/points/signout");
    await holdSignoutBody(page);
    try {
      await page.goto(`${site}/how-it-works`);
      const { trigger, panel } = controls(page);
      await trigger.click();
      await panel.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const scope = window as Window & {
              menuSignoutBody?: { headers: boolean };
            };
            return scope.menuSignoutBody?.headers;
          }),
        )
        .toBe(true);

      // The old response's headers are already delivered. A newer login is
      // observed through the actual profile-navigation session recheck.
      state.actor = 2;
      state.signedIn = true;
      await page.evaluate(() => {
        history.pushState({}, "", "/contributors/replacement-menu");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await trigger.click();
      await expect(panel).toContainText("@replacement-menu");
      await page.evaluate(() =>
        sessionStorage.setItem(
          "slop-intake-draft:replacement-report",
          JSON.stringify({
            summary: "new member draft",
            description: "retained",
            severity: "high",
            cvss: "",
            cwe: "",
          }),
        ),
      );
      await releaseSignoutBody(page);
      await expect(
        panel.getByRole("button", { name: "Sign out", exact: true }),
      ).toBeEnabled();
      await expect(panel).toContainText("@replacement-menu");
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() =>
            sessionStorage.getItem("slop-intake-draft:replacement-report"),
          ),
        )
        .not.toBeNull();
      expect(state.signouts).toBe(1);
    } finally {
      await releaseSignoutBody(page);
    }
  });
}

test("a signed-out recheck before the success body still clears the departing member's draft", async ({
  page,
}) => {
  await serve(page);
  await holdSignoutBody(page);
  try {
    await page.goto(`${site}/how-it-works`);
    const { trigger, panel } = controls(page);
    await page.evaluate(() =>
      sessionStorage.setItem("slop-intake-draft:departing-report", "draft"),
    );
    await trigger.click();
    await panel.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scope = window as Window & {
            menuSignoutBody?: { headers: boolean };
          };
          return scope.menuSignoutBody?.headers;
        }),
      )
      .toBe(true);
    await page.evaluate(() => {
      history.pushState({}, "", "/contributors/menu-fixture");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(trigger).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("slop-intake-draft:departing-report"),
      ),
    ).toBe("draft");
    await releaseSignoutBody(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          sessionStorage.getItem("slop-intake-draft:departing-report"),
        ),
      )
      .toBeNull();
  } finally {
    await releaseSignoutBody(page);
  }
});

test("an ordinary same-member recheck does not cancel the pending signout cleanup", async ({
  page,
}) => {
  const state = await serve(page);
  const held = gate();
  state.signoutGate = held;
  try {
    await page.goto(`${site}/how-it-works`);
    const { trigger, panel } = controls(page);
    await page.evaluate(() =>
      sessionStorage.setItem("slop-intake-draft:departing-report", "draft"),
    );
    await trigger.click();
    await panel.getByRole("button", { name: "Sign out", exact: true }).click();
    await held.requested;
    await page.evaluate(() => {
      history.pushState({}, "", "/contributors/menu-fixture");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await trigger.click();
    await expect(panel).toContainText("@menu-fixture");
    held.release();
    await expect(trigger).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          sessionStorage.getItem("slop-intake-draft:departing-report"),
        ),
      )
      .toBeNull();
  } finally {
    held.release();
  }
});
