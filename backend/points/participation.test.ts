// PRD section 11, owner decision of 24 October 2026 (D2): joining records no
// welcome award, historical membership rows stay exactly as recorded, and the
// database refuses any new participation award.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handlePointsApi } from "./handler";

const migrations = readdirSync("migrations")
  .filter((p) => p.endsWith(".sql"))
  .sort();
const discontinued = migrations.indexOf(
  "0080_points_participation_discontinued.sql",
);

test("joining after the discontinuation records no welcome award and keeps history", async () => {
  const { db, sqlite } = sqliteD1(migrations.slice(0, discontinued));
  try {
    // Two members joined before the discontinuation; one later closed.
    const insert = sqlite.prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,?)",
    );
    insert.run("U_early", "11", "early", "2026-09-01T00:00:00.000Z", 1);
    insert.run("U_closed", "12", "closed", "2026-09-02T00:00:00.000Z", 0);
    sqlite
      .prepare("UPDATE points_members SET closed_at=? WHERE actor_id=?")
      .run("2026-10-01T00:00:00.000Z", "U_closed");
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run("a".repeat(64), "U_early", "2026-10-24T01:00:00.000Z");
    const before = sqlite
      .prepare("SELECT rowid,* FROM points_members ORDER BY rowid")
      .all();
    expect(before).toEqual([
      expect.objectContaining({ actor_id: "U_early", welcome: 5 }),
      expect.objectContaining({ actor_id: "U_closed", welcome: 5 }),
    ]);
    for (const migration of migrations.slice(discontinued))
      sqlite.exec(readFileSync(join("migrations", migration), "utf8"));

    // Every historical row, row id and child reference survives unchanged.
    expect(
      sqlite.prepare("SELECT rowid,* FROM points_members ORDER BY rowid").all(),
    ).toEqual(before);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      sqlite.prepare("SELECT actor_id FROM points_sessions").all(),
    ).toEqual([{ actor_id: "U_early" }]);

    // A real sign-in creates a member with no welcome award.
    const now = "2026-10-24T00:00:00.000Z";
    const response = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/join", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: JSON.stringify({
          assertion: `slop_assert_v1_${"q".repeat(48)}`,
          public: true,
        }),
      }),
      {
        db,
        now: () => new Date(now),
        rateLimitSecret: "fixture-secret".repeat(4),
        identity: {
          fetch: async () =>
            Response.json({
              audience: "slop-points-web",
              githubActorId: "13",
              githubNodeId: "U_late",
              githubLogin: "late",
            }),
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: { id: "U_late", login: "late" },
      joinedAt: now,
      public: true,
      welcome: 0,
      socialPoints: 0,
    });
    expect(
      sqlite
        .prepare("SELECT welcome FROM points_members WHERE actor_id='U_late'")
        .get(),
    ).toEqual({ welcome: 0 });

    // The database refuses a new welcome award and any rewrite of history.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public,welcome) VALUES('U_new','14','new',?,0,5)",
        )
        .run(now),
    ).toThrow("welcome points are discontinued");
    expect(() =>
      sqlite
        .prepare("UPDATE points_members SET welcome=0 WHERE actor_id='U_early'")
        .run(),
    ).toThrow("immutable points membership");
    expect(() =>
      sqlite
        .prepare("DELETE FROM points_members WHERE actor_id='U_early'")
        .run(),
    ).toThrow("points membership preserves welcome uniqueness");
    expect(() =>
      sqlite
        .prepare("UPDATE points_members SET public=1 WHERE actor_id='U_closed'")
        .run(),
    ).toThrow("a closed account is not public");
  } finally {
    sqlite.close();
  }
});
