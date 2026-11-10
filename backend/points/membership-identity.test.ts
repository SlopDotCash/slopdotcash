/**
 * PRD section 3: keep the permanent GitHub identity and membership together
 * when GitHub returns another global node id spelling for the same numeric user.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { PointsDependencies } from "./dependencies";
import { handlePointsApi } from "./handler";

const NOW = "2026-11-06T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"n".repeat(48)}`;
const GITHUB = "91001";
const LOGIN = "Node-Spelling";
const LEGACY_NODE = "MDQ6VXNlcjkxMDAx";
const CURRENT_NODE = "U_kgDOAAFjeQ";
/** A genuine current-form node id for `id`: `U_` + base64url of `[0, id]`. */
function current(id: bigint): string {
  const width = id <= 0xff_ff_ff_fn ? 4 : 8;
  const bytes = new Uint8Array(3 + width);
  bytes.set([0x92, 0x00, width === 4 ? 0xce : 0xcf]);
  let rest = id;
  for (let i = width - 1; i >= 0; i--) {
    bytes[3 + i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return `U_${btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "")}`;
}

async function emptyPointsDb() {
  return sqliteD1(
    readdirSync(new URL("../../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
}

function depsFor(
  db: PointsDependencies["db"],
  nodeId: string,
): PointsDependencies {
  return {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-membership-identity-secret".repeat(2),
    identity: {
      fetch: async () =>
        Response.json({
          audience: "slop-points-web",
          githubActorId: GITHUB,
          githubNodeId: nodeId,
          githubLogin: LOGIN,
        }),
    },
  };
}

function joinRequest(reopen?: true) {
  return new Request("https://slop.cash/api/v1/points/join", {
    method: "POST",
    headers: {
      origin: "https://slop.cash",
      "content-type": "application/json",
    },
    body: JSON.stringify(
      reopen
        ? { assertion: ASSERTION, public: true, reopen: true }
        : { assertion: ASSERTION, public: true },
    ),
  });
}

test("join reuses the stored actor id when GitHub returns another node spelling", async () => {
  const { db, sqlite } = await emptyPointsDb();
  try {
    const first = await handlePointsApi(
      joinRequest(),
      depsFor(db, LEGACY_NODE),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      actor: { id: LEGACY_NODE, login: LOGIN },
      public: true,
    });
    expect(first.headers.get("set-cookie")).toContain("__Host-slop_points=");

    const second = await handlePointsApi(
      joinRequest(),
      depsFor(db, CURRENT_NODE),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      actor: { id: LEGACY_NODE, login: LOGIN },
      public: true,
    });
    expect(second.headers.get("set-cookie")).toContain("__Host-slop_points=");

    expect(
      sqlite
        .query(
          "SELECT actor_id, github_id, login, COUNT(*) OVER () AS n FROM points_members WHERE github_id=?",
        )
        .get(GITHUB),
    ).toEqual({
      actor_id: LEGACY_NODE,
      github_id: GITHUB,
      login: LOGIN,
      n: 1,
    });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM points_members WHERE actor_id=?")
        .get(CURRENT_NODE),
    ).toEqual({ n: 0 });
  } finally {
    sqlite.close();
  }
});

test("join with the legacy spelling still works after the current spelling signed in first", async () => {
  const { db, sqlite } = await emptyPointsDb();
  try {
    expect(
      (await handlePointsApi(joinRequest(), depsFor(db, CURRENT_NODE))).status,
    ).toBe(200);
    const again = await handlePointsApi(
      joinRequest(),
      depsFor(db, LEGACY_NODE),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      actor: { id: CURRENT_NODE, login: LOGIN },
    });
    expect(
      sqlite
        .query("SELECT actor_id FROM points_members WHERE github_id=?")
        .get(GITHUB),
    ).toEqual({ actor_id: CURRENT_NODE });
  } finally {
    sqlite.close();
  }
});

test("join rejects a new membership whose node id names a different numeric user", async () => {
  const { db, sqlite } = await emptyPointsDb();
  try {
    // B9: the asserted node names user 12345 while the numeric id is 91001.
    // A new member must not be written with a mismatched node/numeric pair.
    const refused = await handlePointsApi(
      joinRequest(),
      depsFor(db, current(12345n)),
    );
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "invalid_identity" });
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM points_members").get(),
    ).toEqual({ n: 0 });
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM points_sessions").get(),
    ).toEqual({ n: 0 });
  } finally {
    sqlite.close();
  }
});

test("a closed membership stays closed under a new node spelling without reopen", async () => {
  const { db, sqlite } = await emptyPointsDb();
  try {
    expect(
      (await handlePointsApi(joinRequest(), depsFor(db, LEGACY_NODE))).status,
    ).toBe(200);
    sqlite
      .prepare(
        "UPDATE points_members SET closed_at=?, public=0 WHERE github_id=?",
      )
      .run(NOW, GITHUB);

    const refused = await handlePointsApi(
      joinRequest(),
      depsFor(db, CURRENT_NODE),
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: "account_closed",
      closedAt: NOW,
    });
    expect(refused.headers.get("set-cookie")).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("reopen under a new node spelling restores the original actor id", async () => {
  const { db, sqlite } = await emptyPointsDb();
  try {
    expect(
      (await handlePointsApi(joinRequest(), depsFor(db, LEGACY_NODE))).status,
    ).toBe(200);
    sqlite
      .prepare(
        "UPDATE points_members SET closed_at=?, public=0, login=? WHERE github_id=?",
      )
      .run(NOW, "Old-Login", GITHUB);

    const reopened = await handlePointsApi(
      joinRequest(true),
      depsFor(db, CURRENT_NODE),
    );
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({
      actor: { id: LEGACY_NODE, login: LOGIN },
      public: true,
    });
    expect(
      sqlite
        .query(
          "SELECT actor_id, login, public, closed_at FROM points_members WHERE github_id=?",
        )
        .get(GITHUB),
    ).toEqual({
      actor_id: LEGACY_NODE,
      login: LOGIN,
      public: 1,
      closed_at: null,
    });
  } finally {
    sqlite.close();
  }
});
