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
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { sessionGithubActor } from "../backend/points/handler";
import { onRequest } from "../functions/api/v1/[[path]]";
import { isLocalDevelopmentOrigin } from "../src/lib/deployment";
import { HISTORICAL_PROJECTS } from "../src/lib/projects.mjs";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import { D1IdentityPersistence } from "../workers/identity/persistence";
import { routeRepositoryAccess } from "../workers/slopbot/repository-access";
import { localNotify } from "./dev-backend-notify";
import { devIdentityBridge } from "./dev-identity-bridge";
import { devMailCapture } from "./dev-mail-capture";
import { devDataDirectory } from "./dev-private-paths";
import { devPrivateStorage } from "./dev-private-storage";
import { syncDevProjectRegistry } from "./dev-project-registry";

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
const localVars = readVars(resolve(".dev.vars"));
const setting = (name: string) =>
  process.env[name] || localVars[name] || identityVars[name];

const origin = process.env.SLOP_DEV_ORIGIN ?? "http://localhost:4466";
if (!isLocalDevelopmentOrigin(origin))
  fail("SLOP_DEV_ORIGIN must look like http://localhost:4466");
const port = Number(process.env.SLOP_DEV_BACKEND_PORT ?? 4477);

// One database file keeps sessions across restarts. Migrations are tracked here
// because the test adapter does not track them.
const dataDirectory = devDataDirectory(
  process.cwd(),
  process.env.SLOP_DEV_DATA_DIR,
);
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
function privatePermissions(path: string) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    fail("Private local storage must not contain symbolic links");
  chmodSync(path, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory())
    for (const entry of readdirSync(path))
      privatePermissions(resolve(path, entry));
}
chmodSync(dataDirectory, 0o700);
for (const name of [
  "slop.sqlite",
  "slop.sqlite-wal",
  "slop.sqlite-shm",
  "private-r2",
  "mail-capture",
  "notify.key",
]) {
  const path = resolve(dataDirectory, name);
  if (existsSync(path)) privatePermissions(path);
}

const { db, sqlite } = sqliteD1([], resolve(dataDirectory, "slop.sqlite"));
chmodSync(resolve(dataDirectory, "slop.sqlite"), 0o600);
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
syncDevProjectRegistry(
  sqlite,
  HISTORICAL_PROJECTS,
  JSON.parse(
    readFileSync(resolve("src/lib/project-revisions.generated.json"), "utf8"),
  ),
);

const secret = () => randomBytes(32).toString("base64url");
const identity = devIdentityBridge(origin, new D1IdentityPersistence(db));
const storage = await devPrivateStorage(resolve(dataDirectory, "private-r2"));
const background = new Set<Promise<unknown>>();
const appId = setting("SLOPBOT_APP_ID");
const appKey = setting("SLOPBOT_APP_PRIVATE_KEY");
const notifyKeyFile = resolve(dataDirectory, "notify.key");
if (!existsSync(notifyKeyFile)) {
  const value =
    setting("NOTIFY_UNSUBSCRIBE_KEY") ?? randomBytes(32).toString("hex");
  writeFileSync(notifyKeyFile, value, { mode: 0o600, flag: "wx" });
}
const unsubscribeKey = readFileSync(notifyKeyFile, "utf8").trim();
if (!/^[a-f0-9]{64}$/u.test(unsubscribeKey))
  fail("Local notification key is invalid");
chmodSync(notifyKeyFile, 0o600);
const mailCapture = devMailCapture(
  resolve(dataDirectory, "mail-capture"),
  origin,
);
const notify = localNotify(
  (githubId) =>
    (
      sqlite
        .query("SELECT login FROM points_members WHERE github_id=?")
        .get(githubId) as { login: string } | null
    )?.login,
  {
    db,
    now: () => new Date(),
    inboxUrl: `${origin}/inbox`,
    unsubscribeKey,
    capture: mailCapture.capture,
  },
);
const apiEnv = {
  PAYMENT_RPC_URLS: setting("PAYMENT_RPC_URLS"),
  SOLANA_RECOVERY_RPC_URL: setting("SOLANA_RECOVERY_RPC_URL"),
  SLOP_LOCAL_SOLANA_GENESIS: setting("SLOP_LOCAL_SOLANA_GENESIS"),
  REWARD_RPC_BASE: setting("REWARD_RPC_BASE"),
  REWARD_RPC_ETHEREUM: setting("REWARD_RPC_ETHEREUM"),
  REWARD_RPC_ROBINHOOD: setting("REWARD_RPC_ROBINHOOD"),
  REWARD_RPC_SOLANA: setting("REWARD_RPC_SOLANA"),
  SLOP_DB: db,
  PAYMENTS_ALLOWED_ORIGIN: origin,
  TRACE_AUTH_SECRET: setting("TRACE_AUTH_SECRET") ?? secret(),
  SLOP_IDENTITY: { fetch: identity },
  PRIVATE_TRACES: storage.bucket,
  SLOP_PRIVATE_INTAKE_MODE: setting("SLOP_PRIVATE_INTAKE_MODE") ?? "on",
  SURPLUS_API_KEY: setting("SURPLUS_API_KEY"),
  ...(appId && appKey
    ? {
        SLOPBOT: {
          fetch: async (request: Request) =>
            (await routeRepositoryAccess(request, {
              SLOPBOT_APP_ID: appId,
              SLOPBOT_APP_PRIVATE_KEY: appKey,
            })) ?? new Response(null, { status: 404 }),
        },
      }
    : {}),
  GITHUB_INTAKE_APP_ID: setting("GITHUB_INTAKE_APP_ID"),
  GITHUB_INTAKE_APP_PRIVATE_KEY: setting("GITHUB_INTAKE_APP_PRIVATE_KEY"),
  GITHUB_INTAKE_APP_CLIENT_ID: setting("GITHUB_INTAKE_APP_CLIENT_ID"),
  GITHUB_INTAKE_APP_CLIENT_SECRET: setting("GITHUB_INTAKE_APP_CLIENT_SECRET"),
  SLOP_INTAKE_GRANT_KEY: setting("SLOP_INTAKE_GRANT_KEY"),
  SLOP_NOTIFY: notify,
  ADMIN_GITHUB_IDS: setting("ADMIN_GITHUB_IDS"),
  SLOP_GITHUB_READ_TOKEN: setting("SLOP_GITHUB_READ_TOKEN"),
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
    if (url.pathname === "/__dev/health")
      return Response.json({
        origin,
        privateIntake: true,
        email: "local-capture",
      });
    if (url.pathname === "/__dev/mail") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const actor = await sessionGithubActor(
        request,
        db,
        new Date().toISOString(),
      );
      return actor
        ? mailCapture.view(actor.githubId)
        : new Response("Sign in to view local mail.", { status: 401 });
    }
    if (url.pathname.startsWith("/v1/")) return identity(request);
    if (url.pathname.startsWith("/api/"))
      return onRequest({
        request,
        env: apiEnv,
        waitUntil(promise: Promise<unknown>) {
          background.add(promise);
          void promise
            .catch(() => {
              console.error(
                "Local background work failed; check the operation's retry state.",
              );
            })
            .finally(() => background.delete(promise));
        },
      } as unknown as Parameters<typeof onRequest>[0]);
    return new Response("Not found", { status: 404 });
  },
});
process.stdout.write(
  `dev-backend ready on http://127.0.0.1:${server.port}\n  serves ${origin}\n  sign-in: Slop production GitHub App\n  data: .slop-dev/slop.sqlite\n`,
);
const stop = async () => {
  clearInterval(mailTimer);
  server.stop(true);
  await Promise.race([
    Promise.allSettled([...background]),
    new Promise((done) => setTimeout(done, 5000)),
  ]);
  await storage.close();
  sqlite.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let dispatching = false;
const mailTimer = setInterval(() => {
  if (dispatching) return;
  dispatching = true;
  const task = notify
    .dispatch()
    .catch(() =>
      console.error(
        "Local mail dispatch failed; queued notices remain retryable.",
      ),
    )
    .finally(() => {
      background.delete(task);
      dispatching = false;
    });
  background.add(task);
}, 5000);
