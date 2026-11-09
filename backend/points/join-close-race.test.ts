import { expect, test } from "bun:test";
import { ME, seedAccountClosure } from "../../tests/account-closure-fixture";
import type { PointsDependencies } from "./dependencies";
import { handlePointsApi, sessionGithubActor } from "./handler";

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

function dependencies(db: PointsDependencies["db"]): PointsDependencies {
  return {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-account-completion-secret".repeat(3),
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
}

function joinRequest() {
  return new Request("https://slop.cash/api/v1/points/join", {
    method: "POST",
    headers: {
      origin: "https://slop.cash",
      "content-type": "application/json",
    },
    body: JSON.stringify({ assertion: ASSERTION, public: false }),
  });
}

function closeRequest(token: string) {
  return new Request("https://slop.cash/api/v1/points/account/close", {
    method: "POST",
    headers: {
      cookie: `__Host-slop_points=${token}`,
      origin: "https://slop.cash",
      "content-type": "application/json",
    },
    body: JSON.stringify({ login: ME.login }),
  });
}

// Source-authored completion regressions; not executed during this refinement.
test("a lost join batch reply retains publication and an undisclosed session", async () => {
  const { db, sqlite } = await seedAccountClosure(NOW);
  try {
    sqlite
      .prepare("UPDATE points_members SET public=0 WHERE actor_id=?")
      .run(ME.actor);
    sqlite
      .prepare("UPDATE points_x_links SET public=0 WHERE actor_id=?")
      .run(ME.actor);
    const before = sqlite
      .query("SELECT count(*) n FROM points_sessions WHERE actor_id=?")
      .get(ME.actor) as { n: number };
    let committed = false;
    const lostReply = {
      prepare: db.prepare.bind(db),
      async batch(statements: Parameters<typeof db.batch>[0]) {
        await db.batch(statements);
        committed = true;
        throw new Error("fixture join reply lost after commit");
      },
    } as typeof db;
    const response = await handlePointsApi(
      joinRequest(),
      dependencies(lostReply),
    );
    expect(committed).toBe(true);
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      sqlite
        .query("SELECT public FROM points_members WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ public: 1 });
    expect(
      sqlite
        .query("SELECT public FROM points_x_links WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ public: 1 });
    expect(
      sqlite
        .query("SELECT count(*) n FROM points_sessions WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ n: before.n + 1 });
  } finally {
    sqlite.close();
  }
});

for (const stage of ["before-read", "after-read"] as const) {
  test(`closure ${stage} of the join response leaves its returned cookie invalid`, async () => {
    const { db, sqlite, tokens } = await seedAccountClosure(NOW);
    try {
      sqlite
        .prepare("UPDATE points_members SET public=0 WHERE actor_id=?")
        .run(ME.actor);
      let closed = false;
      const completeClosure = async () => {
        const response = await handlePointsApi(
          closeRequest(tokens.me),
          dependencies(db),
        );
        expect(response.status).toBe(200);
        closed = true;
      };
      const racingDb = {
        batch: db.batch.bind(db),
        prepare(sql: string) {
          const statement = db.prepare(sql);
          if (!sql.includes("FROM points_members m WHERE actor_id=?"))
            return statement;
          const wrap = (current: typeof statement): typeof statement => ({
            ...current,
            bind: (...values: unknown[]) => wrap(current.bind(...values)),
            async first<T>() {
              if (stage === "before-read") await completeClosure();
              const result = await current.first<T>();
              if (stage === "after-read") await completeClosure();
              return result;
            },
          });
          return wrap(statement);
        },
      } as typeof db;
      const response = await handlePointsApi(
        joinRequest(),
        dependencies(racingDb),
      );
      expect(closed).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        public: stage === "after-read",
      });
      const cookie = response.headers.get("set-cookie");
      expect(cookie).toContain("Max-Age=3600");
      expect(
        await sessionGithubActor(
          new Request("https://slop.cash/api/v1/points/me", {
            headers: { cookie: cookie!.split(";")[0] },
          }),
          db,
          NOW,
        ),
      ).toBeNull();
      expect(
        sqlite
          .query("SELECT public,closed_at FROM points_members WHERE actor_id=?")
          .get(ME.actor),
      ).toEqual({ public: 0, closed_at: NOW });
      expect(
        sqlite
          .query("SELECT count(*) n FROM points_sessions WHERE actor_id=?")
          .get(ME.actor),
      ).toEqual({ n: 0 });
    } finally {
      sqlite.close();
    }
  });
}

test("a lost closure batch reply leaves all sessions revoked and retry signed out", async () => {
  const { db, sqlite, tokens } = await seedAccountClosure(NOW);
  try {
    const lostReply = {
      prepare: db.prepare.bind(db),
      async batch(statements: Parameters<typeof db.batch>[0]) {
        await db.batch(statements);
        throw new Error("fixture closure reply lost after commit");
      },
    } as typeof db;
    const response = await handlePointsApi(
      closeRequest(tokens.me),
      dependencies(lostReply),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      sqlite
        .query("SELECT public,closed_at FROM points_members WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ public: 0, closed_at: NOW });
    expect(
      sqlite
        .query("SELECT count(*) n FROM points_sessions WHERE actor_id=?")
        .get(ME.actor),
    ).toEqual({ n: 0 });
    expect(
      (await handlePointsApi(closeRequest(tokens.me), dependencies(db))).status,
    ).toBe(401);
  } finally {
    sqlite.close();
  }
});
