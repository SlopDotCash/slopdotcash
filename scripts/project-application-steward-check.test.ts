// The steward check of self-service project creation through the production
// Pages Function: the steward must be the account GitHub reports as the repository
// owner, by login and node id, not only by numeric id.
import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { sha256Hex } from "../workers/identity/crypto";

const ORIGIN = "https://slop.cash";
const SESSION = "t".repeat(48);

const OWNER = {
  id: 987654321,
  node_id: "U_example",
  login: "example",
  type: "User",
};
const REPOSITORY = {
  id: 123456789,
  node_id: "R_example",
  full_name: "example/open-registry",
  private: false,
  owner: OWNER,
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function submit(github: Record<string, unknown>) {
  const { db, sqlite } = sqliteD1(
    readdirSync(resolve(import.meta.dir, "..", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite.exec(
    `INSERT INTO points_members (actor_id, github_id, login, joined_at, public)
     VALUES ('act_1', '987654321', 'example', '2026-10-01T00:00:00.000Z', 0)`,
  );
  sqlite
    .prepare(
      "INSERT INTO points_sessions (token_hash, actor_id, expires_at) VALUES (?, 'act_1', '2099-01-01T00:00:00.000Z')",
    )
    .run(await sha256Hex(SESSION));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return url === "https://api.github.com/repos/example/open-registry"
      ? Response.json(REPOSITORY)
      : Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
  const base = applicationManifest("open-registry", "example/open-registry");
  const steward = base.steward as Record<string, unknown>;
  const manifest = {
    ...base,
    steward: {
      ...steward,
      kind: "individual",
      github: {
        actorId: String(OWNER.id),
        nodeId: OWNER.node_id,
        login: OWNER.login,
        type: "User",
        profileUrl: `https://github.com/${OWNER.login}`,
        ...github,
      },
    },
  };
  const response = await onRequest({
    request: new Request(`${ORIGIN}/api/v1/projects`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: `__Host-slop_points=${SESSION}`,
      },
      body: JSON.stringify({ manifest }),
    }),
    env: { SLOP_DB: db, ADMIN_GITHUB_IDS: "900000001" } as never,
  });
  const body = (await response.json()) as {
    setup?: { checks: { authority: { message: string } } };
    error?: string;
    message?: string;
  };
  const stored = sqlite
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .get() as { count: number };
  return { status: response.status, body, stored: stored.count };
}

const MISMATCH = {
  error: "invalid_manifest",
  message: "Repository or steward facts do not match GitHub",
};

test("the repository owner is accepted as steward, in any login case", async () => {
  const exact = await submit({});
  expect(exact.status).toBe(201);
  expect(exact.body.setup?.checks.authority.message).toBe(
    "@example owns example/open-registry.",
  );

  // GitHub logins are case-insensitive.
  const cased = await submit({
    login: "Example",
    profileUrl: "https://github.com/Example",
  });
  expect(cased.status).toBe(201);
});

test("another account's login with the owner's id is refused", async () => {
  const { status, body, stored } = await submit({
    login: "microsoft",
    profileUrl: "https://github.com/microsoft",
  });
  expect(status).toBe(422);
  expect(body).toMatchObject(MISMATCH);
  expect(stored).toBe(0);
});

test("another account's node id with the owner's id is refused", async () => {
  const { status, body, stored } = await submit({
    nodeId: "MDEyOk9yZ2FuaXphdGlvbjY4OTg0Mzc=",
  });
  expect(status).toBe(422);
  expect(body).toMatchObject(MISMATCH);
  expect(stored).toBe(0);
});
