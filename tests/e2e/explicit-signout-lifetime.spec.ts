/** Source-authored regressions; HTTP identities and wallet responses are synthetic. */
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { PROJECTS, type ProjectDefinition } from "../../src/lib/projects.mjs";
import { escapeRegExp, expect, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const actor = "4242";
const notice = "Private notice before explicit signout";

function gate() {
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    requested: new Promise<void>((resolve) => {
      started = resolve;
    }),
    responded: new Promise<void>((resolve) => {
      finished = resolve;
    }),
    release: () => release(),
    started: () => started(),
    finished: () => finished(),
  };
}

async function serve(page: Page) {
  const state = {
    signedIn: true,
    failSignout: false,
    sessionGate: null as ReturnType<typeof gate> | null,
    override: null as ((route: Route) => Promise<boolean>) | null,
    projects: [...PROJECTS],
    writes: [] as string[],
  };
  const membership = {
    actor: { id: "MDQ6VXNlcjQyNDI=", login: "signout-fixture" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: false,
    welcome: 5,
  };
  await page.route(`${site}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/payments/received") return route.fallback();
    if (
      path === "/data/fixture-project-registry.json" ||
      path === "/.well-known/slop/projects.json"
    )
      return route.fulfill({
        json: { schemaVersion: "1", projects: state.projects },
      });
    if (!path.startsWith("/api/"))
      return route.fulfill({
        path: join(
          process.cwd(),
          "dist",
          request.resourceType() === "document" ? "index.html" : path,
        ),
      });
    if (request.method() !== "GET") state.writes.push(path);
    if (state.override && (await state.override(route))) return;
    if (path === "/api/v1/project-session") {
      // Capture the server's response before a later signout. The old response
      // must not regain authority merely because its body arrives last.
      const session = state.signedIn
        ? { githubId: actor, githubLogin: "signout-fixture", admin: true }
        : null;
      const held = state.sessionGate;
      state.sessionGate = null;
      if (held) {
        held.started();
        await held.promise;
      }
      await route.fulfill({ json: { session } });
      held?.finished();
      return;
    }
    if (path === "/api/v1/points/me")
      return route.fulfill({ json: state.signedIn ? membership : null });
    if (path === "/api/v1/points/signout") {
      if (state.failSignout)
        return route.fulfill({ status: 503, json: { error: "unavailable" } });
      state.signedIn = false;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (path === "/api/v1/projects")
      return route.fulfill({
        json: { schemaVersion: "1", projects: state.projects },
      });
    if (path === "/api/v1/admin/projects")
      return route.fulfill({ json: { projects: [] } });
    if (path === "/api/v1/admin/fee-conversions")
      return route.fulfill({ json: { routes: [], totals: [] } });
    if (path === "/api/v1/project-appeals")
      return route.fulfill({ json: { appeals: [] } });
    if (path === "/api/v1/notifications/email")
      return route.fulfill({
        json: {
          enabled: false,
          securityEnabled: false,
          enrollmentAvailable: false,
          pending: null,
          availability: "unverified",
        },
      });
    if (path === "/api/v1/notifications")
      return route.fulfill({
        json: {
          recipientGithubId: actor,
          unread: 1,
          nextCursor: null,
          notifications: [
            {
              eventKey: "project-ready:signout-fixture",
              kind: "project_ready",
              subject: "signout-fixture",
              detail: notice,
              actionPath: "/projects",
              sourceAt: "2026-10-27T12:00:00.000Z",
              createdAt: "2026-10-27T12:00:00.000Z",
              readAt: null,
            },
          ],
        },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor, githubLogin: "signout-fixture" },
          programs: [],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: actor, automatic: false, submissions: [] },
      });
    if (path === "/api/v1/payments/me")
      return route.fulfill({
        json: {
          githubUserId: actor,
          wallets: [],
          payments: [],
          monthlyAwards: [],
          balances: [],
          directTransfers: [],
          walletObservations: [],
        },
      });
    if (/^\/api\/v1\/payments\/projects\/[^/]+\/direct-transfers$/u.test(path))
      return route.fulfill({ json: { transfers: [], totalMicro: "0" } });
    if (path === "/api/v1/referrals/me")
      return route.fulfill({ json: { enabled: false } });
    throw new Error(
      `Unexpected signout fixture request: ${request.method()} ${path}`,
    );
  });
  return state;
}

async function signout(page: Page) {
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test("successful header signout retires a held admin session response", async ({
  page,
}) => {
  const state = await serve(page);
  await page.goto(`${site}/admin`, { waitUntil: "networkidle" });
  const administration = page.getByRole("navigation", {
    name: "Administration",
    exact: true,
  });
  await expect(administration).toBeVisible();
  const held = gate();
  state.sessionGate = held;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await held.requested;
  try {
    await signout(page);
    await expect(administration).toHaveCount(0);
  } finally {
    held.release();
  }
  await held.responded;
  await settle(page);
  await expect(administration).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
  ).toBeVisible();
});

test("failed header signout keeps the current admin session", async ({
  page,
  diagnostics,
}) => {
  const state = await serve(page);
  state.failSignout = true;
  diagnostics.allow(
    new RegExp(`^503 POST ${escapeRegExp(site)}/api/v1/points/signout$`, "u"),
    new RegExp(
      `^console Failed to load resource: the server responded with a status of 503 .* at ${escapeRegExp(site)}/api/v1/points/signout$`,
      "u",
    ),
  );
  await page.goto(`${site}/admin`, { waitUntil: "networkidle" });
  await signout(page);
  await expect(page.getByRole("alert")).toContainText(
    "Could not sign out. Retry.",
  );
  await expect(
    page.getByRole("navigation", { name: "Administration", exact: true }),
  ).toBeVisible();
  expect(state.signedIn).toBe(true);
});

for (const activeWrite of [false, true]) {
  test(`header signout clears Inbox with ${activeWrite ? "an accepted pending write" : "no pending write"}`, async ({
    page,
  }) => {
    const state = await serve(page);
    const held = gate();
    let accepted = false;
    state.override = async (route) => {
      if (
        new URL(route.request().url()).pathname !== "/api/v1/notifications/read"
      )
        return false;
      expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
        actor,
      );
      accepted = true;
      held.started();
      await held.promise;
      await route.fulfill({ json: { read: 1 } });
      held.finished();
      return true;
    };
    await page.goto(`${site}/inbox`, { waitUntil: "networkidle" });
    await expect(page.getByText(notice, { exact: true })).toBeVisible();
    if (activeWrite) {
      await page
        .getByRole("button", { name: "Mark shown as read", exact: true })
        .click();
      await held.requested;
    }
    try {
      await signout(page);
      await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("region", {
          name: "Private security reports",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
      ).toBeVisible();
    } finally {
      held.release();
    }
    if (activeWrite) await held.responded;
    await settle(page);
    await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
    expect(accepted).toBe(activeWrite);
    expect(
      state.writes.filter((path) => path === "/api/v1/notifications/read"),
    ).toHaveLength(activeWrite ? 1 : 0);
  });
}

test("header signout clears a held standalone payout read", async ({
  page,
  diagnostics,
}) => {
  const state = await serve(page);
  const held = gate();
  diagnostics.allow(
    new RegExp(
      `^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled) GET ${escapeRegExp(site)}/api/v1/payments/me$`,
      "u",
    ),
  );
  state.override = async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/payments/me")
      return false;
    held.started();
    await held.promise;
    await route.fulfill({
      json: {
        githubUserId: actor,
        wallets: [],
        payments: [],
        monthlyAwards: [],
        balances: [],
        directTransfers: [],
        walletObservations: [],
      },
    });
    held.finished();
    return true;
  };
  await page.goto(`${site}/earnings`, { waitUntil: "domcontentloaded" });
  await held.requested;
  try {
    await signout(page);
    await expect(
      page.getByRole("link", { name: "Sign in with GitHub", exact: true }),
    ).toBeVisible();
  } finally {
    held.release();
  }
  await held.responded;
  await settle(page);
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toEqual(["/api/v1/points/signout"]);
});

test("header signout stops a connected standalone payout wallet before registration", async ({
  page,
}) => {
  const state = await serve(page);
  await page.addInitScript(() => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const control = {
      calls: [] as string[],
      returned: false,
      release: () => release(),
    };
    Object.assign(window, {
      signoutWallet: control,
      ethereum: {
        isMetaMask: true,
        async request({ method }: { method: string }) {
          control.calls.push(method);
          if (method !== "eth_requestAccounts")
            throw new Error(`Unexpected method: ${method}`);
          await pending;
          control.returned = true;
          return ["0x1111111111111111111111111111111111111111"];
        },
      },
    });
  });
  await page.goto(`${site}/account#wallets`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Connect EVM wallet", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Connect an EVM wallet" })
    .getByRole("button", { name: "MetaMask", exact: true })
    .click();
  type WalletWindow = Window & {
    signoutWallet: { calls: string[]; returned: boolean; release(): void };
  };
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as WalletWindow).signoutWallet.calls,
      ),
    )
    .toEqual(["eth_requestAccounts"]);
  try {
    await signout(page);
    await expect(
      page.getByRole("dialog", { name: "Connect an EVM wallet" }),
    ).not.toBeVisible();
  } finally {
    await page.evaluate(() =>
      (window as unknown as WalletWindow).signoutWallet.release(),
    );
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as WalletWindow).signoutWallet.returned,
      ),
    )
    .toBe(true);
  await settle(page);
  expect(state.writes).toEqual(["/api/v1/points/signout"]);
  await expect(
    page.getByRole("button", { name: "Connect EVM wallet", exact: true }),
  ).toHaveCount(0);
});

test("header signout retires a pending owner awards refresh", async ({
  page,
}) => {
  const state = await serve(page);
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  const project: ProjectDefinition = {
    ...original,
    reward: { ...original.reward, feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    },
  };
  state.projects = state.projects.map((entry) =>
    entry.id === project.id ? project : entry,
  );
  let held: ReturnType<typeof gate> | null = null;
  state.override = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/v1/project-setup/${project.id}`) {
      await route.fulfill({ json: { viewer: { githubId: actor } } });
      return true;
    }
    if (
      !/^\/api\/v1\/payments\/projects\/eliza\/monthly\/\d{4}-\d{2}$/u.test(
        path,
      )
    )
      return false;
    const pending = held;
    if (pending) {
      pending.started();
      await pending.promise;
    }
    await route.fulfill({
      json: {
        projectId: project.id,
        period: path.split("/").at(-1),
        manifestSha256: "a".repeat(64),
        automatic: false,
        canManage: true,
        cutoffAt: null,
        deployment: null,
        asset: null,
        proposal: null,
        run: null,
      },
    });
    pending?.finished();
    return true;
  };
  await page.goto(`${site}/projects/eliza/funding`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: "Review monthly awards", exact: true })
    .click();
  const settings = page.getByRole("region", {
    name: "Monthly payment settings",
    exact: true,
  });
  await expect(settings).toBeVisible();
  const pending = gate();
  held = pending;
  await page
    .getByRole("button", { name: "Refresh awards", exact: true })
    .click();
  await pending.requested;
  try {
    await signout(page);
    await expect(
      page.locator("#monthly-awards").getByRole("link", {
        name: "Sign in with GitHub",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    pending.release();
  }
  await pending.responded;
  await settle(page);
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Turn on automatic finalization",
      exact: true,
    }),
  ).toHaveCount(0);
});

for (const kind of ["verify", "unsubscribe"] as const) {
  test(`header signout ${kind === "verify" ? "retires verification but retains its token" : "does not cancel email opt-out"}`, async ({
    page,
  }) => {
    const state = await serve(page);
    const held = gate();
    const token =
      kind === "verify"
        ? "a".repeat(64)
        : `${"b".repeat(64)}.${"c".repeat(64)}`;
    state.override = async (route) => {
      if (
        new URL(route.request().url()).pathname !==
        `/api/v1/notifications/email/${kind}`
      )
        return false;
      expect(route.request().postDataJSON()).toEqual({ token });
      if (kind === "verify")
        expect(route.request().headers()["x-slop-expected-github-id"]).toBe(
          actor,
        );
      held.started();
      await held.promise;
      await route.fulfill({
        json:
          kind === "verify"
            ? {
                enabled: true,
                securityEnabled: true,
                enrollmentAvailable: true,
                pending: null,
                availability: "verified",
                email: "fixture@example.com",
                destinationVersion: "d".repeat(64),
              }
            : { enabled: false, securityEnabled: false },
      });
      held.finished();
      return true;
    };
    await page.goto(
      `${site}/inbox#${kind === "verify" ? "verify-email" : "unsubscribe-email"}=${token}`,
      { waitUntil: "networkidle" },
    );
    const action = page.locator(".email-link-action");
    await action
      .getByRole("button", {
        name: kind === "verify" ? "Verify email" : "Unsubscribe",
        exact: true,
      })
      .click();
    await held.requested;
    try {
      await signout(page);
      if (kind === "verify")
        await expect(
          action.getByRole("link", {
            name: "Sign in to verify email",
            exact: true,
          }),
        ).toBeVisible();
    } finally {
      held.release();
    }
    await held.responded;
    await settle(page);
    const stored = await page.evaluate(() =>
      sessionStorage.getItem("slop:email-action:v1"),
    );
    if (kind === "verify") {
      expect(JSON.parse(stored ?? "null")).toMatchObject({ kind, token });
      await expect(
        action.getByText("Email verified.", { exact: true }),
      ).toHaveCount(0);
    } else {
      expect(stored).toBeNull();
      await expect(
        action.getByText("Email notifications stopped.", { exact: true }),
      ).toBeVisible();
    }
  });
}
