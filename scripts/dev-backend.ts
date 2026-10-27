/**
 * Local development backend: the real identity Worker and the real API on a
 * local SQLite database. GitHub sign-in is real, and it returns to the local
 * dev server, not to slop.cash. Run `bun run dev:backend`, then `bun run
 * dev:local`. This script is never deployed and listens on 127.0.0.1 only.
 *
 * Setup (README, "Local sign-in"): open `<SLOP_DEV_ORIGIN>/__dev/setup` once
 * to create the GitHub App, or put your own App's GITHUB_APP_CLIENT_ID and
 * GITHUB_APP_CLIENT_SECRET in `.env`. Delete `.slop-dev/` to reset the data.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { isLocalDevelopmentOrigin } from "../src/lib/deployment";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import identityWorker from "../workers/identity/index";
import { localNotify } from "./dev-backend-notify";
import {
  convertManifest,
  type GithubApp,
  setupDonePage,
  setupFailedPage,
  setupPage,
} from "./dev-backend-setup";

function fail(message: string): never {
  process.stderr.write(`dev-backend: ${message}\n`);
  process.exit(1);
}

/** Reads KEY=VALUE lines, the format of `.dev.vars` and `.env`. */
function readVars(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/u, "$2")]),
  );
}
const identityVars = readVars(resolve("workers/identity/.dev.vars"));
const setting = (name: string) => process.env[name] || identityVars[name];

const origin = process.env.SLOP_DEV_ORIGIN ?? "http://localhost:4466";
if (!isLocalDevelopmentOrigin(origin))
  fail("SLOP_DEV_ORIGIN must look like http://localhost:4466");
const port = Number(process.env.SLOP_DEV_BACKEND_PORT ?? 4477);

// One database file keeps sessions across restarts. Migrations are tracked here
// because the test adapter does not track them.
mkdirSync(".slop-dev", { recursive: true });

// The GitHub App comes from .env, or from the one-click setup page.
const appFile = ".slop-dev/github-app.json";
function savedApp(): GithubApp | null {
  try {
    const app = JSON.parse(readFileSync(appFile, "utf8")) as GithubApp;
    return app.clientId && app.clientSecret ? app : null;
  } catch {
    return null;
  }
}
let app: GithubApp | null =
  setting("GITHUB_APP_CLIENT_ID") && setting("GITHUB_APP_CLIENT_SECRET")
    ? {
        clientId: setting("GITHUB_APP_CLIENT_ID") as string,
        clientSecret: setting("GITHUB_APP_CLIENT_SECRET") as string,
        name: "your GitHub App",
        htmlUrl: "https://github.com/settings/apps",
      }
    : savedApp();
const setupStates = new Set<string>();
const { db, sqlite } = sqliteD1([], ".slop-dev/slop.sqlite");
sqlite.exec(
  "CREATE TABLE IF NOT EXISTS dev_migrations (name TEXT PRIMARY KEY) STRICT",
);
const applied = new Set(
  (
    sqlite.query("SELECT name FROM dev_migrations").all() as { name: string }[]
  ).map((row) => row.name),
);
for (const name of MIGRATIONS) {
  if (applied.has(name)) continue;
  sqlite.exec(readFileSync(resolve("migrations", name), "utf8"));
  sqlite.query("INSERT INTO dev_migrations (name) VALUES (?)").run(name);
}
sqlite.exec("PRAGMA foreign_keys = ON");

const secret = () => randomBytes(32).toString("base64url");
const allowAll = { limit: async () => ({ success: true }) };
const identityEnv = {
  IDENTITY_DB: db,
  IDENTITY_START_LIMITER: allowAll,
  IDENTITY_POLL_LIMITER: allowAll,
  GITHUB_APP_CLIENT_ID: app?.clientId ?? "",
  GITHUB_APP_CLIENT_SECRET: app?.clientSecret ?? "",
  // Keys last for one run unless you set them. A restart ends only sign-ins
  // that are in progress.
  IDENTITY_STATE_KEY: setting("IDENTITY_STATE_KEY") ?? secret(),
  IDENTITY_ASSERTION_KEY: setting("IDENTITY_ASSERTION_KEY") ?? secret(),
  IDENTITY_PUBLIC_ORIGIN: origin,
  IDENTITY_ALLOW_LOOPBACK: "1",
};
const identity = (request: Request) =>
  identityWorker.fetch(request, identityEnv as never);
const apiEnv = {
  SLOP_DB: db,
  PAYMENTS_ALLOWED_ORIGIN: origin,
  TRACE_AUTH_SECRET: setting("TRACE_AUTH_SECRET") ?? secret(),
  SLOP_IDENTITY: { fetch: identity },
  // Lets the Inbox email preference page work; no email is sent.
  SLOP_NOTIFY: localNotify(
    (githubId) =>
      (
        sqlite
          .query("SELECT login FROM points_members WHERE github_id=?")
          .get(githubId) as { login: string } | null
      )?.login,
  ),
  ADMIN_GITHUB_IDS: setting("ADMIN_GITHUB_IDS"),
  // Optional: connects X. The X app's callback is `${origin}/api/v1/points/x/callback`.
  X_CLIENT_ID: setting("X_CLIENT_ID"),
  X_CLIENT_SECRET: setting("X_CLIENT_SECRET"),
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    // The dev server forwards the browser's own Host, so the origin must match.
    if (url.origin !== origin)
      return new Response(`This backend serves ${origin}. Open that address.`, {
        status: 421,
      });
    if (url.pathname === "/__dev/setup") {
      const state = secret();
      setupStates.add(state);
      if (setupStates.size > 20) setupStates.delete([...setupStates][0]);
      return setupPage(
        origin,
        state,
        `Slop local dev ${randomBytes(2).toString("hex")}`,
        app,
      );
    }
    if (url.pathname === "/__dev/setup/callback") {
      // GitHub sends the browser back with a one-time code and our state.
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (!setupStates.delete(state) || !/^[A-Za-z0-9]{10,64}$/u.test(code))
        return setupFailedPage("The setup link was not valid. Start again.");
      try {
        app = await convertManifest(code);
        writeFileSync(appFile, JSON.stringify(app), { mode: 0o600 });
        identityEnv.GITHUB_APP_CLIENT_ID = app.clientId;
        identityEnv.GITHUB_APP_CLIENT_SECRET = app.clientSecret;
        return setupDonePage(origin, app);
      } catch (error) {
        return setupFailedPage(
          error instanceof Error ? error.message : "Setup failed.",
        );
      }
    }
    if (url.pathname.startsWith("/v1/")) {
      if (app === null)
        return Response.json(
          { error: "github_app_missing", setup: `${origin}/__dev/setup` },
          { status: 503 },
        );
      return identity(request);
    }
    if (url.pathname.startsWith("/api/"))
      return onRequest({
        request,
        env: apiEnv,
        waitUntil: () => {},
      } as unknown as Parameters<typeof onRequest>[0]);
    return new Response("Not found", { status: 404 });
  },
});
process.stdout.write(
  `dev-backend ready on http://127.0.0.1:${server.port}\n  serves ${origin}\n  GitHub App callback: ${origin}/v1/oauth/callback\n  data: .slop-dev/slop.sqlite\n${
    app
      ? ""
      : `  NEXT: open ${origin}/__dev/setup to create the GitHub App (once).\n`
  }`,
);
process.on("SIGINT", () => {
  server.stop(true);
  sqlite.close();
  process.exit(0);
});
