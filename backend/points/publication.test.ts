// PRD section 3: publication happens on authenticated sign-in, never a read.
import { expect, test } from "bun:test";
import { ME, seedAccountClosure } from "../../tests/account-closure-fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import { handleIdentityRequest } from "../../workers/identity/handler";
import { D1IdentityPersistence } from "../../workers/identity/persistence";
import { handlePointsApi, type PointsDependencies } from "./handler";

const NOW = "2026-10-26T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;

async function harness(identityService?: PointsDependencies["identity"]) {
  const { db, sqlite, tokens } = await seedAccountClosure();
  sqlite.exec(`
    UPDATE points_members SET public=0 WHERE actor_id='${ME.actor}';
    UPDATE points_x_links SET public=0 WHERE actor_id='${ME.actor}';
    UPDATE points_sessions SET expires_at='2026-10-26T13:00:00.000Z';
  `);
  const identity = { actor: ME.actor, github: ME.github, login: ME.login };
  const deps: PointsDependencies = {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-publication-secret".repeat(3),
    identity: identityService ?? {
      fetch: async () =>
        Response.json({
          audience: "slop-points-web",
          githubActorId: identity.github,
          githubNodeId: identity.actor,
          githubLogin: identity.login,
        }),
    },
  };
  const request = (path: string, body: string, token: string | null) =>
    new Request(`https://slop.cash/api/v1/points/${path}`, {
      method: "POST",
      headers: {
        ...(token ? { cookie: `__Host-slop_points=${token}` } : {}),
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body,
    });
  const call = (
    path: string,
    body?: unknown,
    token: string | null = tokens.me,
  ) =>
    handlePointsApi(
      body === undefined
        ? new Request(`https://slop.cash/api/v1/points/${path}`, {
            headers: token ? { cookie: `__Host-slop_points=${token}` } : {},
          })
        : request(path, JSON.stringify(body), token),
      deps,
    );
  /** The same POST with bytes the client chose, so the body can be malformed. */
  const raw = (path: string, body: string) =>
    handlePointsApi(request(path, body, tokens.me), deps);
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
  return { sqlite, identity, call, raw, snapshot };
}

test("an identity storage outage leaves publication untouched and does not expire the assertion", async () => {
  const identity = sqliteD1();
  const persistence = new D1IdentityPersistence(identity.db);
  const expired = `slop_assert_v1_${"e".repeat(48)}`;
  const otherAudience = `slop_assert_v1_${"t".repeat(48)}`;
  for (const [token, audience, expiresAt] of [
    [ASSERTION, "slop-points-web", "2026-10-26T12:01:00.000Z"],
    [expired, "slop-points-web", "2026-10-26T11:59:00.000Z"],
    [otherAudience, "private-trace-api", "2026-10-26T12:01:00.000Z"],
  ] as const)
    await persistence.createAssertion({
      tokenHash: await sha256Hex(token),
      githubActorId: ME.github,
      githubLogin: ME.login,
      githubNodeId: ME.actor,
      audience,
      createdAt: "2026-10-26T11:59:30.000Z",
      expiresAt,
      consumedAt: null,
    });
  let workerStatus = 0;
  const { sqlite, call, snapshot } = await harness({
    async fetch(request) {
      const response = await handleIdentityRequest(request, {
        persistence,
        stateEncryptionSecret: "unused-by-assertion-consumption",
        assertionSecret: "unused-by-assertion-consumption",
        githubClientId: "local-publication-fixture",
        now: () => new Date(NOW),
        randomToken: () => "unused-by-assertion-consumption",
        resolveGithubIdentity: async () => null,
      });
      workerStatus = response.status;
      return response;
    },
  });
  try {
    const before = snapshot(["identity_rate_limits"]);
    identity.sqlite.exec("PRAGMA query_only = ON");
    const unavailable = await call(
      "join",
      { assertion: ASSERTION, public: true },
      null,
    );
    expect(workerStatus).toBe(500);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "points_unavailable" });
    expect(snapshot(["identity_rate_limits"])).toEqual(before);
    expect(
      identity.sqlite
        .query("SELECT consumed_at FROM identity_assertions WHERE token_hash=?")
        .get(await sha256Hex(ASSERTION)),
    ).toEqual({ consumed_at: null });

    identity.sqlite.exec("PRAGMA query_only = OFF");
    for (const assertion of [expired, otherAudience]) {
      const refused = await call("join", { assertion, public: true }, null);
      expect(workerStatus).toBe(401);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: "identity_expired" });
    }
    expect(snapshot(["identity_rate_limits"])).toEqual(before);

    const joined = await call(
      "join",
      { assertion: ASSERTION, public: true },
      null,
    );
    expect(joined.status).toBe(200);
    expect(workerStatus).toBe(200);
    expect(joined.headers.get("set-cookie")).toContain("Secure; HttpOnly");
    expect(
      identity.sqlite
        .query("SELECT consumed_at FROM identity_assertions WHERE token_hash=?")
        .get(await sha256Hex(ASSERTION)),
    ).toEqual({ consumed_at: NOW });
    const after = snapshot(["identity_rate_limits"]);
    const replay = await call(
      "join",
      { assertion: ASSERTION, public: true },
      null,
    );
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: "identity_expired" });
    expect(snapshot(["identity_rate_limits"])).toEqual(after);
  } finally {
    identity.sqlite.close();
    sqlite.close();
  }
});

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

test("a malformed or non-object body is a client error, not a server outage", async () => {
  let identityCalls = 0;
  const { sqlite, raw, snapshot } = await harness({
    async fetch(request) {
      identityCalls += 1;
      return handleIdentityRequest(request, {
        persistence: new D1IdentityPersistence(sqliteD1().db),
        stateEncryptionSecret: "unused-by-assertion-consumption",
        assertionSecret: "unused-by-assertion-consumption",
        githubClientId: "local-publication-fixture",
        now: () => new Date(NOW),
        randomToken: () => "unused-by-assertion-consumption",
        resolveGithubIdentity: async () => null,
      });
    },
  });
  try {
    const before = snapshot(["identity_rate_limits"]);
    // `null` and truncated JSON both reach the handler; neither is a database
    // or identity failure, so the reply must not be the 503 that asks a retry.
    for (const body of ["null", "{", "[]", "5"]) {
      for (const path of [
        "join",
        "sessions/revoke",
        "account/close",
        "visibility",
      ]) {
        const response = await raw(path, body);
        expect({ path, body, status: response.status }).toEqual({
          path,
          body,
          status: 400,
        });
      }
    }
    // The identity service is never asked, so no assertion is consumed.
    expect(identityCalls).toBe(0);
    expect(snapshot(["identity_rate_limits"])).toEqual(before);
  } finally {
    sqlite.close();
  }
});
