/** Browser contract for the Settings trace licensing section; the API suite uses real SQLite. */
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";
import { type Diagnostics, expect, test } from "./fixtures";

const { site } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const GITHUB_ID = "900000097";
/** The legacy GitHub node ID form, which names the account above. */
const NODE_ID = Buffer.from(`04:User${GITHUB_ID}`).toString("base64");
const ON_SINCE = "2026-11-22T09:30:00.000Z";

type Trace = {
  runId: string;
  finalizedAt: string;
  projectId: string;
  repository: string;
  provider: string;
  model: string;
  client: string;
  termsVersion: "private-trace-v1" | "private-trace-v2";
  licence: "none" | "licensed" | "withdrawn";
  pullRequestUrl: string | null;
};

function run(index: number, licence: Trace["licence"] = "none"): Trace {
  return {
    runId: `run_${index}`,
    finalizedAt: `2026-11-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`,
    projectId: index % 2 === 0 ? "eliza" : "asi",
    repository: index % 2 === 0 ? "elizaOS/eliza" : "SlopDotCash/asi",
    provider: "anthropic",
    model: "claude-opus-5-5",
    client: "claude-code",
    termsVersion: index === 0 ? "private-trace-v2" : "private-trace-v1",
    licence,
    pullRequestUrl: null,
  };
}

/** The account's server state, which each test changes as the routes would. */
type Server = { enabled: boolean; traces: Trace[]; pageSize: number };

type Write = { body: unknown; githubId: string | null };

function listing(server: Server, cursor: string | null) {
  const start = cursor === null ? 0 : Number(cursor);
  const shown = server.traces.slice(start, start + server.pageSize);
  const licensed = server.traces.filter((t) => t.licence === "licensed").length;
  const next = start + server.pageSize;
  return {
    setting: {
      enabled: server.enabled,
      since: server.enabled ? ON_SINCE : null,
      providerTermsConfirmed: server.enabled,
    },
    totals: {
      traces: server.traces.length,
      licensed,
      eligible: server.traces.length - licensed,
    },
    traces: shown,
    nextCursor: next < server.traces.length ? String(next) : null,
  };
}

async function openSettings(
  page: Page,
  diagnostics: Diagnostics,
  server: Server,
  routes: {
    me?: () => { status: number; json: unknown } | null;
    setting?: (body: Record<string, unknown>) => {
      status: number;
      json: unknown;
    };
    licences?: (body: Record<string, unknown>) => {
      status: number;
      json: unknown;
    };
  } = {},
) {
  const settings: Write[] = [];
  const licences: Write[] = [];
  await page.route(`${site}/**`, (route) =>
    ["/api/v1/payments/received"].includes(
      new URL(route.request().url()).pathname,
    )
      ? route.fallback()
      : route.fulfill({
          path: join(
            process.cwd(),
            "dist",
            route.request().resourceType() === "document"
              ? "index.html"
              : new URL(route.request().url()).pathname,
          ),
        }),
  );
  const json = (path: string, body: unknown) =>
    page.route(`${site}/api/v1/${path}`, (route) =>
      route.fulfill({ json: body }),
    );
  await json("project-session", {
    session: { githubId: GITHUB_ID, githubLogin: "trace-test", admin: false },
  });
  await json("project-appeals", { appeals: [] });
  await json("points/me", {
    actor: { id: NODE_ID, login: "trace-test" },
    joinedAt: "2026-10-01T00:00:00Z",
    public: true,
    welcome: 5,
    referralCode: null,
  });
  await json("payments/me", {
    githubUserId: GITHUB_ID,
    wallets: [],
    payments: [],
    monthlyAwards: [],
    balances: [],
    directTransfers: [],
    walletObservations: [],
  });
  await json("notifications/email", {
    enabled: false,
    securityEnabled: false,
    enrollmentAvailable: false,
    pending: null,
    availability: "unverified",
  });
  await json("notifications", {
    recipientGithubId: GITHUB_ID,
    notifications: [],
    unread: 0,
    nextCursor: null,
  });
  await json("security-cases", {
    viewer: { githubId: GITHUB_ID, githubLogin: "trace-test" },
    programs: [],
    cases: [],
  });
  await json("security-submissions", {
    recipientGithubId: GITHUB_ID,
    automatic: false,
    submissions: [],
  });
  await json("referrals/me", { enabled: false });
  await page.route(`${site}/api/v1/traces/me**`, (route) => {
    const answer = routes.me?.() ?? null;
    if (answer !== null) return route.fulfill(answer);
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({ json: listing(server, cursor) });
  });
  await page.route(`${site}/api/v1/traces/licensing`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    settings.push({
      body,
      githubId: await request.headerValue("x-slop-expected-github-id"),
    });
    if (routes.setting) return route.fulfill(routes.setting(body));
    server.enabled = body.enabled === true;
    if (!server.enabled)
      for (const t of server.traces)
        if (t.licence === "licensed") t.licence = "withdrawn";
    return route.fulfill({ json: { setting: listing(server, null).setting } });
  });
  await page.route(`${site}/api/v1/traces/licences`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    licences.push({
      body,
      githubId: await request.headerValue("x-slop-expected-github-id"),
    });
    if (routes.licences) return route.fulfill(routes.licences(body));
    const ids = Array.isArray(body.runIds) ? body.runIds : null;
    let licensed = 0;
    for (const t of server.traces)
      if (t.licence !== "licensed" && (ids === null || ids.includes(t.runId))) {
        t.licence = "licensed";
        licensed += 1;
      }
    return route.fulfill({ json: { licensed } });
  });
  diagnostics.allowCanceledBackgroundReads();
  await page.goto(`${site}/account`, { waitUntil: "domcontentloaded" });
  const section = page.getByRole("region", {
    name: "Trace licensing",
    exact: true,
  });
  await expect(section).toBeVisible();
  return { section, settings, licences };
}

test("turn on requires the tick", async ({ page, diagnostics }) => {
  const server: Server = { enabled: false, traces: [], pageSize: 100 };
  const { section, settings } = await openSettings(page, diagnostics, server);
  await expect(
    section.getByText(
      "Let Slop license your traces to AI model builders for pay. You get 50% of each sale.",
    ),
  ).toBeVisible();
  await expect(section.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "/protocol/private-trace-v2.md",
  );
  await expect(
    section.getByText("No traces yet", { exact: true }),
  ).toBeVisible();
  await expect(section.getByText(/Your traces/u)).toHaveCount(0);

  const turnOn = section.getByRole("button", { name: "Turn on", exact: true });
  await expect(turnOn).toBeDisabled();
  await section
    .getByRole("checkbox", {
      name: "My model provider's terms let me license these runs' output.",
    })
    .check();
  await turnOn.click();
  await expect(
    section.getByText("On since Nov 22, 2026", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Turn off", exact: true }),
  ).toBeVisible();
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  expect(settings).toEqual([
    {
      body: { enabled: true, providerTermsConfirmed: true },
      githubId: GITHUB_ID,
    },
  ]);
});

test("bulk confirm shows the count and posts expectedCount", async ({
  page,
  diagnostics,
}) => {
  const server: Server = {
    enabled: true,
    traces: [run(0, "licensed"), run(1), run(2, "withdrawn")],
    pageSize: 100,
  };
  let raced = false;
  const { section, licences } = await openSettings(page, diagnostics, server, {
    licences: (body) => {
      // The first bulk confirm races a new upload: nothing is licensed.
      if (body.all === true && !raced) {
        raced = true;
        server.traces.push(run(3));
        return {
          status: 409,
          json: {
            error: "count_changed",
            message:
              "The number of eligible traces changed. Review the list and confirm again.",
          },
        };
      }
      for (const t of server.traces) t.licence = "licensed";
      return { status: 200, json: { licensed: 3 } };
    },
  });
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 409 \(.+\) at .+\/api\/v1\/traces\/licences$/u,
  );
  await expect(
    section.getByText("Your traces (3) · licensed 1", { exact: true }),
  ).toBeVisible();
  const all = section.getByRole("button", {
    name: "License all 2 earlier traces",
    exact: true,
  });

  // Dismissing the confirm sends nothing.
  const dismissed = page.waitForEvent("dialog");
  await all.click();
  const first = await dismissed;
  expect(first.message()).toBe(
    "License 2 traces? You can turn this off any time.",
  );
  await first.dismiss();
  expect(licences).toEqual([]);

  page.once("dialog", (dialog) => dialog.accept());
  await all.click();
  await expect(section.getByRole("alert")).toHaveText(
    "The number of eligible traces changed. Review the list and confirm again.",
  );
  // The list reloads with the new count, and the next confirm names it.
  const again = section.getByRole("button", {
    name: "License all 3 earlier traces",
    exact: true,
  });
  await expect(again).toBeVisible();
  const accepted = page.waitForEvent("dialog");
  await again.click();
  const second = await accepted;
  expect(second.message()).toBe(
    "License 3 traces? You can turn this off any time.",
  );
  await second.accept();
  await expect(
    section.getByText("Your traces (4) · licensed 4", { exact: true }),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: /^License/u })).toHaveCount(
    0,
  );
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(licences).toEqual([
    { body: { all: true, expectedCount: 2 }, githubId: GITHUB_ID },
    { body: { all: true, expectedCount: 3 }, githubId: GITHUB_ID },
  ]);
});

test("row License posts one runId", async ({ page, diagnostics }) => {
  const server: Server = {
    enabled: true,
    traces: [run(0, "licensed"), run(1), run(2)],
    pageSize: 2,
  };
  const { section, licences } = await openSettings(page, diagnostics, server);
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText(
    "Nov 20, 2026 · eliza · anthropic/claude-opus-5-5 · v2 · licensed",
  );
  await expect(rows.nth(0).getByRole("button")).toHaveCount(0);
  await expect(rows.nth(1)).toHaveText(
    "Nov 19, 2026 · asi · anthropic/claude-opus-5-5 · v1 · not licensed License",
  );

  // "More" reads the next page and keeps the first.
  await section.getByRole("button", { name: "More", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("Nov 18, 2026 · eliza");
  await expect(
    section.getByRole("button", { name: "More", exact: true }),
  ).toHaveCount(0);

  await rows
    .nth(1)
    .getByRole("button", { name: "License", exact: true })
    .click();
  await expect(
    section.getByText("Your traces (3) · licensed 2", { exact: true }),
  ).toBeVisible();
  expect(licences).toEqual([
    { body: { runIds: ["run_1"] }, githubId: GITHUB_ID },
  ]);
});

test("turn off shows the withdrawn count", async ({ page, diagnostics }) => {
  const server: Server = {
    enabled: true,
    traces: [run(0, "licensed"), run(1, "licensed"), run(2)],
    pageSize: 100,
  };
  const { section, settings } = await openSettings(page, diagnostics, server);
  await expect(
    section.getByText("Your traces (3) · licensed 2", { exact: true }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Turned off. 2 traces withdrawn.",
  );
  await expect(
    section.getByText("Your traces (3) · licensed 0", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Turn on", exact: true }),
  ).toBeDisabled();
  await expect(section.getByRole("button", { name: /^License/u })).toHaveCount(
    0,
  );
  expect(settings).toEqual([{ body: { enabled: false }, githubId: GITHUB_ID }]);
});

test("error shows the server message", async ({ page, diagnostics }) => {
  const server: Server = { enabled: false, traces: [run(1)], pageSize: 100 };
  diagnostics.allow(
    /^console Failed to load resource: the server responded with a status of 403 \(.+\) at .+\/api\/v1\/traces\/me$/u,
  );
  const { section } = await openSettings(page, diagnostics, server, {
    me: () => ({
      status: 403,
      json: { error: "account_closed", message: "This account is closed." },
    }),
  });
  await expect(section.getByRole("alert")).toHaveText(
    "This account is closed.",
  );
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  await expect(section.getByText(/Your traces/u)).toHaveCount(0);
});
