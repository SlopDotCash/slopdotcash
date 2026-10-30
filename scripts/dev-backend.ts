/**
 * Local development backend: the real identity Worker and the real API on a
 * local SQLite database. GitHub sign-in is real, and it returns to the local
 * dev server, not to slop.cash. Vite starts this automatically during local
 * development. This script is never deployed and listens on 127.0.0.1 only.
 *
 * Sign-in uses the production identity service with a single-use handoff.
 * No GitHub App credentials are needed locally.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { isLocalDevelopmentOrigin } from "../src/lib/deployment";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import { D1IdentityPersistence } from "../workers/identity/persistence";
import { routeRepositoryAccess } from "../workers/slopbot/repository-access";
import { localNotify } from "./dev-backend-notify";
import { devIdentityBridge } from "./dev-identity-bridge";

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
// Use only a contributor-owned test App, as for `wrangler dev`. Running the
// real read-only Slopbot routes keeps installation and authority checks intact.
const slopbotVars = readVars(resolve("workers/slopbot/.dev.vars"));
const slopbotAppId = process.env.SLOPBOT_APP_ID || slopbotVars.SLOPBOT_APP_ID;
const slopbotPrivateKey =
  process.env.SLOPBOT_APP_PRIVATE_KEY || slopbotVars.SLOPBOT_APP_PRIVATE_KEY;
if (Boolean(slopbotAppId) !== Boolean(slopbotPrivateKey))
  fail("Set both SLOPBOT_APP_ID and SLOPBOT_APP_PRIVATE_KEY for your test App");
const slopbot =
  slopbotAppId && slopbotPrivateKey
    ? {
        async fetch(request: Request) {
          return (
            routeRepositoryAccess(request, {
              SLOPBOT_APP_ID: slopbotAppId,
              SLOPBOT_APP_PRIVATE_KEY: slopbotPrivateKey.replaceAll(
                "\\n",
                "\n",
              ),
            }) ?? new Response("Not found", { status: 404 })
          );
        },
      }
    : undefined;

const origin = process.env.SLOP_DEV_ORIGIN ?? "http://localhost:4466";
if (!isLocalDevelopmentOrigin(origin))
  fail("SLOP_DEV_ORIGIN must look like http://localhost:4466");
const port = Number(process.env.SLOP_DEV_BACKEND_PORT ?? 4477);

// One database file keeps sessions across restarts. Migrations are tracked here
// because the test adapter does not track them.
mkdirSync(".slop-dev", { recursive: true });

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
const identity = devIdentityBridge(origin, new D1IdentityPersistence(db));
const apiEnv = {
  SLOP_DB: db,
  PAYMENTS_ALLOWED_ORIGIN: origin,
  TRACE_AUTH_SECRET: setting("TRACE_AUTH_SECRET") ?? secret(),
  SLOP_IDENTITY: { fetch: identity },
  SLOPBOT: slopbot,
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
  // Optional local X OAuth; its callback remains on this local origin.
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
    if (url.pathname === "/__dev/health") return Response.json({ origin });
    if (url.pathname.startsWith("/v1/")) return identity(request);
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
  `dev-backend ready on http://127.0.0.1:${server.port}\n  serves ${origin}\n  sign-in: Slop production GitHub App\n  data: .slop-dev/slop.sqlite\n`,
);
const stop = () => {
  server.stop(true);
  sqlite.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
