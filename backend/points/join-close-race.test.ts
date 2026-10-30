import { expect, test } from "bun:test";
import { ME, seedAccountClosure } from "../../tests/account-closure-fixture";
import { handlePointsApi, type PointsDependencies } from "./handler";

const NOW = "2026-10-26T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;

test("join returns account_closed without a session when closure races its batch", async () => {
  const { db, sqlite } = await seedAccountClosure();
  try {
    let raced = false;
    const racingDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: Parameters<typeof db.batch>[0]) => {
        if (!raced) {
          raced = true;
          sqlite.exec(`
            UPDATE points_members SET closed_at='${NOW}', public=0 WHERE actor_id='${ME.actor}';
            DELETE FROM points_sessions WHERE actor_id='${ME.actor}';
          `);
        }
        return db.batch(statements);
      },
    } as typeof db;
    const deps: PointsDependencies = {
      db: racingDb,
      now: () => new Date(NOW),
      rateLimitSecret: "fixture-race-secret".repeat(4),
      identity: {
        fetch: async () =>
          Response.json({
            audience: "slop-points-web",
            githubActorId: ME.github,
            githubNodeId: ME.actor,
            githubLogin: ME.login,
          }),
      },
    };
    const response = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/join", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({ assertion: ASSERTION, public: true }),
      }),
      deps,
    );
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "account_closed",
      closedAt: NOW,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM points_sessions WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .query("SELECT public, closed_at FROM points_members WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ public: 0, closed_at: NOW });
  } finally {
    sqlite.close();
  }
});
