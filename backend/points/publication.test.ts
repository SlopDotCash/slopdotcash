// PRD section 3: publication happens on authenticated sign-in, never a read.
import { expect, test } from "bun:test";
import { ME, seedAccountClosure } from "../../tests/account-closure-fixture";
import { handlePointsApi } from "./handler";

const NOW = "2026-10-26T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;

async function harness() {
  const { db, sqlite, tokens } = await seedAccountClosure();
  sqlite.exec(`
    UPDATE points_members SET public=0 WHERE actor_id='${ME.actor}';
    UPDATE points_x_links SET public=0 WHERE actor_id='${ME.actor}';
    UPDATE points_sessions SET expires_at='2026-10-26T13:00:00.000Z';
  `);
  const identity = { actor: ME.actor, github: ME.github, login: ME.login };
  const call = (
    path: string,
    body?: unknown,
    token: string | null = tokens.me,
  ) =>
    handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { cookie: `__Host-slop_points=${token}` } : {}),
          ...(body === undefined
            ? {}
            : {
                origin: "https://slop.cash",
                "content-type": "application/json",
              }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {
        db,
        now: () => new Date(NOW),
        rateLimitSecret: "fixture-publication-secret".repeat(3),
        identity: {
          fetch: async () =>
            Response.json({
              audience: "slop-points-web",
              githubActorId: identity.github,
              githubNodeId: identity.actor,
              githubLogin: identity.login,
            }),
        },
      },
    );
  const snapshot = (except: string[] = []) =>
    Object.fromEntries(
      (
        sqlite
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[]
      )
        .filter(({ name }) => !except.includes(name))
        .map(({ name }) => [
          name,
          sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
        ]),
    );
  return { sqlite, identity, call, snapshot };
}

test("only sign-in publishes an existing private membership and connected X link", async () => {
  const { sqlite, call, snapshot } = await harness();
  try {
    const beforeReads = snapshot();
    expect((await (await call("me")).json()).public).toBe(false);
    expect((await (await call("x/me")).json()).account.public).toBe(0);
    expect(
      await (await call(`member?login=${ME.login}`, undefined, null)).json(),
    ).toBeNull();
    expect(
      await (await call(`x/profile?actor=${ME.actor}`, undefined, null)).json(),
    ).toBeNull();
    expect(
      (await (await call("people", undefined, null)).json()).people,
    ).not.toContainEqual(
      expect.objectContaining({
        actor: expect.objectContaining({ id: ME.actor }),
      }),
    );
    expect(snapshot()).toEqual(beforeReads);

    const preserved = [
      "points_members",
      "points_x_links",
      "points_sessions",
      "identity_rate_limits",
    ];
    const before = snapshot(preserved);
    const membership = sqlite
      .query("SELECT * FROM points_members WHERE actor_id=?")
      .get(ME.actor);
    const link = sqlite
      .query("SELECT * FROM points_x_links WHERE actor_id=?")
      .get(ME.actor);
    const signedIn = await call(
      "join",
      { assertion: ASSERTION, public: false },
      null,
    );
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({
      actor: { id: ME.actor, login: ME.login },
      public: true,
      welcome: 5,
      socialPoints: 10,
    });
    expect(signedIn.headers.get("set-cookie")).toContain("Max-Age=3600");
    expect(
      sqlite
        .query("SELECT * FROM points_members WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ ...(membership as object), public: 1 });
    expect(
      sqlite
        .query("SELECT * FROM points_x_links WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ ...(link as object), public: 1 });
    expect(snapshot(preserved)).toEqual(before);
    expect(
      await (await call(`x/profile?actor=${ME.actor}`, undefined, null)).json(),
    ).toMatchObject({ id: "77", username: "closing_x" });
  } finally {
    sqlite.close();
  }
});

for (const failure of ["link", "session"] as const) {
  test(`sign-in publication rolls back when the ${failure} write fails`, async () => {
    const { sqlite, call, snapshot } = await harness();
    try {
      const before = snapshot(["identity_rate_limits"]);
      sqlite.exec(
        failure === "link"
          ? "CREATE TRIGGER fail_publication BEFORE UPDATE OF public ON points_x_links BEGIN SELECT RAISE(ABORT, 'fixture link write failed'); END"
          : "CREATE TRIGGER fail_publication BEFORE INSERT ON points_sessions BEGIN SELECT RAISE(ABORT, 'fixture session write failed'); END",
      );
      const failed = await call(
        "join",
        { assertion: ASSERTION, public: false },
        null,
      );
      expect(failed.status).toBe(503);
      expect(failed.headers.get("set-cookie")).toBeNull();
      expect(snapshot(["identity_rate_limits"])).toEqual(before);
      sqlite.exec("DROP TRIGGER fail_publication");
      expect(
        (await call("join", { assertion: ASSERTION, public: false }, null))
          .status,
      ).toBe(200);
      expect((await (await call("me")).json()).public).toBe(true);
      expect((await (await call("x/me")).json()).account.public).toBe(1);
    } finally {
      sqlite.close();
    }
  });
}

test("sign-in cannot publish another numeric identity's existing membership or X link", async () => {
  const { sqlite, identity, call, snapshot } = await harness();
  try {
    const before = snapshot(["identity_rate_limits"]);
    identity.github = "999999";
    const refused = await call(
      "join",
      { assertion: ASSERTION, public: true },
      null,
    );
    expect(refused.status).toBe(503);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(snapshot(["identity_rate_limits"])).toEqual(before);
  } finally {
    sqlite.close();
  }
});

test("new memberships are public and sign-in never recreates a disconnected X link", async () => {
  const { sqlite, identity, call, snapshot } = await harness();
  try {
    expect((await call("x/disconnect", {})).status).toBe(200);
    expect(
      (await call("join", { assertion: ASSERTION, public: false }, null))
        .status,
    ).toBe(200);
    expect(await (await call("x/me")).json()).toMatchObject({ account: null });
    const before = snapshot([
      "points_members",
      "points_sessions",
      "identity_rate_limits",
    ]);
    identity.actor = "U_new_public";
    identity.github = "999999";
    identity.login = "new-public";
    const joined = await call(
      "join",
      { assertion: ASSERTION, public: false },
      null,
    );
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({
      actor: { id: identity.actor },
      public: true,
      welcome: 0,
      socialPoints: 0,
    });
    expect(
      snapshot(["points_members", "points_sessions", "identity_rate_limits"]),
    ).toEqual(before);
  } finally {
    sqlite.close();
  }
});

test("legacy hide requests fail explicitly without changing either public record", async () => {
  const { sqlite, call, snapshot } = await harness();
  try {
    expect(
      (await call("join", { assertion: ASSERTION, public: false }, null))
        .status,
    ).toBe(200);
    const before = snapshot(["identity_rate_limits"]);
    for (const path of ["visibility", "x/visibility"]) {
      const response = await call(path, { public: false });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "public_visibility_required",
      });
    }
    expect(snapshot(["identity_rate_limits"])).toEqual(before);
  } finally {
    sqlite.close();
  }
});
