// PRD section 3: run the real OAuth routes and database, with controlled X responses.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import { handlePointsApi, type PointsDependencies } from "./handler";

const migrations = readdirSync("migrations")
  .filter((p) => p.endsWith(".sql"))
  .sort();
const discontinued = migrations.indexOf(
  "0080_points_participation_discontinued.sql",
);

test("X connection and reconnect reserve identity without granting points", async () => {
  // Build the database as it stood before participation points were
  // discontinued, record one historical connection award, then apply the
  // remaining migrations so the award is genuine history.
  const { db, sqlite } = sqliteD1(migrations.slice(0, discontinued));
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
    )
    .run("U_history", "4321", "history", "2026-09-01T00:00:00.000Z");
  sqlite
    .prepare(
      "INSERT INTO points_x_claims(x_id,actor_id,claimed_at) VALUES(?,?,?)",
    )
    .run("987654321", "U_history", "2026-10-01T00:00:00.000Z");
  sqlite
    .prepare(
      "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) VALUES(?,?,?,10)",
    )
    .run("U_history", "987654321", "2026-10-01T00:00:00.000Z");
  for (const migration of migrations.slice(discontinued))
    sqlite.exec(readFileSync(join("migrations", migration), "utf8"));
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
    const connect = async () => {
      const start = await call("start", { public: true });
      expect(start.status).toBe(200);
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
        sqlite
          .prepare(
            "SELECT x_id,actor_id FROM points_x_claims WHERE actor_id='U_fixture'",
          )
          .all(),
      ).toEqual([{ x_id: "123456789", actor_id: "U_fixture" }]);
      expect(
        sqlite.prepare("SELECT x_id,username FROM points_x_links").all(),
      ).toEqual([{ x_id: "123456789", username: "fixture_user" }]);
      expect(
        sqlite
          .prepare(
            "SELECT points FROM points_x_awards WHERE actor_id='U_fixture'",
          )
          .all(),
      ).toEqual([]);
    };
    await connect();
    expect((await call("disconnect", {})).status).toBe(200);
    await connect();
    // The database refuses any new connection award, even a direct write.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) VALUES(?,?,?,10)",
        )
        .run("U_fixture", "123456789", now),
    ).toThrow("X connection points are discontinued");
    // The historical award stays exactly as recorded.
    expect(
      sqlite
        .prepare("SELECT actor_id,points,awarded_at FROM points_x_awards")
        .all(),
    ).toEqual([
      {
        actor_id: "U_history",
        points: 10,
        awarded_at: "2026-10-01T00:00:00.000Z",
      },
    ]);
    expect(
      sqlite.prepare("SELECT x_id FROM points_x_claims ORDER BY x_id").all(),
    ).toEqual([{ x_id: "123456789" }, { x_id: "987654321" }]);
  } finally {
    sqlite.close();
  }
});
