/** Local acceptance server. Only the external GitHub identity response is synthetic. */
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { deploymentOrigins, deploymentTier } from "../src/lib/deployment";
import {
  ME,
  OTHER,
  seedAccountClosure,
} from "../tests/account-closure-fixture";
import { randomToken } from "../workers/identity/crypto";
import { handleIdentityRequest } from "../workers/identity/handler";
import { D1IdentityPersistence } from "../workers/identity/persistence";

const tier = deploymentTier(process.env.VITE_SLOP_ENVIRONMENT);
const origins = deploymentOrigins(tier);

const { db, sqlite, tokens } = await seedAccountClosure(
  new Date().toISOString(),
  !process.argv.includes("--no-obligations"),
);
const identity = {
  tier,
  persistence: new D1IdentityPersistence(db),
  stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
  assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
  githubClientId: "Iv1.localfixture",
  now: () => new Date(),
  randomToken,
  resolveGithubIdentity: async (code: string) =>
    code === "local-identity-code" || code === "local-other-code"
      ? (() => {
          const actor = code === "local-identity-code" ? ME : OTHER;
          return {
            githubActorId: actor.github,
            githubNodeId: actor.actor,
            githubLogin: actor.login,
          };
        })()
      : null,
};
const env = {
  SLOP_ENVIRONMENT: tier,
  PAYMENTS_ALLOWED_ORIGIN: origins.site,
  SLOP_DB: db,
  TRACE_AUTH_SECRET: "local-fixture-rate-secret-".repeat(3),
  SLOP_IDENTITY: {
    fetch: (request: Request) => handleIdentityRequest(request, identity),
  },
};
const retained = [
  "wallet_claims",
  "payment_obligations",
  "security_cases",
  "points_x_claims",
  "points_telegram_claims",
];
const state = () => ({
  assertions: sqlite
    .query(
      "SELECT github_actor_id, consumed_at FROM identity_assertions ORDER BY created_at",
    )
    .all(),
  retained: Object.fromEntries(
    retained.map((table) => [
      table,
      sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  ),
  sessions: sqlite
    .query("SELECT actor_id FROM points_sessions ORDER BY actor_id")
    .all(),
  member: sqlite
    .query("SELECT public,closed_at FROM points_members WHERE actor_id=?")
    .get(ME.actor),
  preferences: sqlite
    .query(
      "SELECT enabled FROM notification_email_preferences WHERE github_id=?",
    )
    .get(ME.github),
  connections: sqlite
    .query(
      "SELECT actor_id FROM points_x_links UNION ALL SELECT actor_id FROM points_telegram_links",
    )
    .all(),
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture/state") return Response.json(state());
    const isIdentity = url.pathname.startsWith("/identity/");
    const path = url.pathname.replace(/^\/(identity|site)/u, "") + url.search;
    const canonical = new Request(
      (isIdentity ? origins.identity : origins.site) + path,
      request,
    );
    if (isIdentity) return handleIdentityRequest(canonical, identity);
    if (path.startsWith("/api/"))
      return onRequest({
        request: canonical,
        env,
        waitUntil: () => {},
      } as unknown as Parameters<typeof onRequest>[0]);
    const file = Bun.file(
      resolve("dist", `.${new URL(canonical.url).pathname}`),
    );
    return new Response(
      (await file.exists()) ? file : Bun.file(resolve("dist/index.html")),
    );
  },
});
process.stdout.write(
  `${JSON.stringify({
    url: `http://127.0.0.1:${server.port}`,
    token: tokens.me,
    otherToken: tokens.meOther,
    login: ME.login,
  })}\n`,
);
