// PRD section 3: run the real OAuth routes and database, with controlled X responses.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import { handlePointsApi, type PointsDependencies } from "./handler";

test("X connection and reconnect reserve identity without granting points", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const now = "2026-10-24T00:00:00.000Z";
  const token = "s".repeat(48);
  const deps: PointsDependencies = {
    db,
    rateLimitSecret: "fixture-secret".repeat(4),
    identity: { fetch: async () => new Response(null, { status: 500 }) },
    now: () => new Date(now),
    x: { clientId: "fixture-client", clientSecret: "fixture-secret" },
    xFetch: async (url) => {
      if (url.endsWith("/2/oauth2/token"))
        return Response.json({
          access_token: "fixture-access",
          token_type: "bearer",
        });
      if (url.endsWith("/2/users/me"))
        return Response.json({
          data: { id: "123456789", username: "fixture_user" },
        });
      if (url.endsWith("/2/oauth2/revoke"))
        return Response.json({ revoked: true });
      throw new Error(`Unexpected X endpoint: ${url}`);
    },
  };
  try {
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run("U_fixture", "1234", "fixture", now);
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run(await sha256Hex(token), "U_fixture", "2026-10-24T01:00:00.000Z");
    const call = (path: string, body?: unknown, flowCookie = "") =>
      handlePointsApi(
        new Request(`https://slop.cash/api/v1/points/x/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            cookie: `__Host-slop_points=${token}; ${flowCookie}`,
            origin: "https://slop.cash",
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.7",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        deps,
      );
    const connect = async (historical = false, oldPrivateFlow = false) => {
      const start = await call("start", { public: !oldPrivateFlow });
      expect(start.status).toBe(200);
      expect(sqlite.prepare("SELECT public FROM points_x_flows").all()).toEqual(
        [{ public: 1 }],
      );
      // A flow created before the policy change still completes publicly.
      if (oldPrivateFlow) sqlite.exec("UPDATE points_x_flows SET public=0");
      const { authorizationUrl } = (await start.json()) as {
        authorizationUrl: string;
      };
      const state = new URL(authorizationUrl).searchParams.get("state");
      const cookie = start.headers.get("set-cookie")?.split(";")[0] ?? "";
      const result = await call(
        `callback?state=${state}&code=fixture-code`,
        undefined,
        cookie,
      );
      expect(result.headers.get("location")).toBe("/points?x=connected");
      expect(
        sqlite.prepare("SELECT x_id,actor_id FROM points_x_claims").all(),
      ).toEqual([{ x_id: "123456789", actor_id: "U_fixture" }]);
      expect(
        sqlite.prepare("SELECT x_id,username,public FROM points_x_links").all(),
      ).toEqual([{ x_id: "123456789", username: "fixture_user", public: 1 }]);
      expect(
        sqlite.prepare("SELECT points,awarded_at FROM points_x_awards").all(),
      ).toEqual(
        historical
          ? [{ points: 10, awarded_at: "2026-10-01T00:00:00.000Z" }]
          : [],
      );
    };
    await connect(false, true);
    expect((await call("disconnect", {})).status).toBe(200);
    await connect();
    // A historical award is retained through disconnect and reconnect.
    sqlite
      .prepare(
        "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) VALUES(?,?,?,10)",
      )
      .run("U_fixture", "123456789", "2026-10-01T00:00:00.000Z");
    expect((await call("disconnect", {})).status).toBe(200);
    await connect(true);
    expect(
      sqlite.prepare("SELECT points,awarded_at FROM points_x_awards").all(),
    ).toEqual([{ points: 10, awarded_at: "2026-10-01T00:00:00.000Z" }]);
    expect(sqlite.prepare("SELECT x_id FROM points_x_claims").all()).toEqual([
      { x_id: "123456789" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("a malformed X request body is a client error, not a server outage", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const token = "m".repeat(48);
  const now = "2026-10-26T12:00:00.000Z";
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
    )
    .run("U_fixture", "1234", "fixture", now);
  sqlite
    .prepare(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    )
    .run(await sha256Hex(token), "U_fixture", "2026-10-26T13:00:00.000Z");
  const deps: PointsDependencies = {
    db,
    rateLimitSecret: "fixture-secret".repeat(4),
    identity: { fetch: async () => new Response(null, { status: 500 }) },
    now: () => new Date(now),
    x: { clientId: "fixture-client", clientSecret: "fixture-secret" },
    xFetch: async () => Response.json({}),
  };
  const raw = (path: string, body: string) =>
    handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/x/${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${token}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body,
      }),
      deps,
    );
  try {
    for (const body of ["null", "{", "[]"])
      for (const path of ["start", "visibility"])
        expect({ path, body, status: (await raw(path, body)).status }).toEqual({
          path,
          body,
          status: 400,
        });
  } finally {
    sqlite.close();
  }
});
