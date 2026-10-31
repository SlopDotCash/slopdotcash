import { expect, test } from "bun:test";
import { ME, seedAccountClosure } from "../../tests/account-closure-fixture";
import { handlePointsApi, type PointsDependencies } from "./handler";

const NOW = "2026-10-26T12:00:00.000Z";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;

function deps(db: any): PointsDependencies {
  return {
    db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-race-secret".repeat(4),
    identity: { fetch: async () => Response.json({ audience: "slop-points-web", githubActorId: ME.github, githubNodeId: ME.actor, githubLogin: ME.login }) },
  };
}
const req = (body: unknown) => new Request("https://slop.cash/api/v1/points/join", {
  method: "POST", headers: { origin: "https://slop.cash", "content-type": "application/json" }, body: JSON.stringify(body),
});

test("PROBE reopen true on an already closed account", async () => {
  const { db, sqlite } = await seedAccountClosure();
  try {
    sqlite.exec(`UPDATE points_members SET closed_at='${NOW}', public=0 WHERE actor_id='${ME.actor}'; DELETE FROM points_sessions WHERE actor_id='${ME.actor}';`);
    const r = await handlePointsApi(req({ assertion: ASSERTION, public: true, reopen: true }), deps(db));
    console.log("plain reopen:", r.status, JSON.stringify(await r.json()));
    console.log("row:", JSON.stringify(sqlite.query("SELECT public, closed_at FROM points_members WHERE actor_id=?").get(ME.actor)));
  } finally { sqlite.close(); }
});

test("PROBE reopen true while a closure lands during the batch", async () => {
  const { db, sqlite } = await seedAccountClosure();
  try {
    let raced = false;
    const racing = {
      prepare: db.prepare.bind(db),
      batch: async (s: any) => {
        if (!raced) { raced = true; sqlite.exec(`UPDATE points_members SET closed_at='${NOW}', public=0 WHERE actor_id='${ME.actor}'; DELETE FROM points_sessions WHERE actor_id='${ME.actor}';`); }
        return db.batch(s);
      },
    } as typeof db;
    const r = await handlePointsApi(req({ assertion: ASSERTION, public: true, reopen: true }), deps(racing));
    console.log("raced reopen:", r.status, "cookie:", r.headers.get("set-cookie") ? "yes" : "no");
    console.log("row:", JSON.stringify(sqlite.query("SELECT public, closed_at FROM points_members WHERE actor_id=?").get(ME.actor)));
    console.log("sessions:", JSON.stringify(sqlite.query("SELECT COUNT(*) n FROM points_sessions WHERE actor_id=?").get(ME.actor)));
  } finally { sqlite.close(); }
});
