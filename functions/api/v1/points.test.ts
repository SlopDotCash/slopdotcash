import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { handlePointsApi } from "../../../backend/points/handler";
import type { D1Database } from "../../../backend/trace/cloudflare-persistence";
import {
  pointsSql,
  retainPublishedHistory,
} from "../../../scripts/generate-points";
import {
  appendPointAwards,
  awardForScore,
  emptyPointsJournal,
} from "../../../src/lib/points";
import { snapshotFixture } from "../../../tests/fixtures";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0002_slop_identity.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0008_points.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0004_identity_rate_limits.sql", "utf8"));
  const db: D1Database = {
    prepare(query) {
      let args: unknown[] = [];
      const s = {
        bind(...values: unknown[]) {
          args = values;
          return s;
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...(args as never[])) ??
            null) as T | null;
        },
        async run() {
          const r = sqlite.prepare(query).run(...(args as never[]));
          return { success: true, meta: { changes: Number(r.changes) } };
        },
      };
      return s;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  let calls = 0;
  const deps = {
    db,
    rateLimitSecret: "p".repeat(43),
    now: () => new Date("2026-09-21T12:00:00.000Z"),
    identity: {
      async fetch(request: Request) {
        expect(await request.json()).toEqual({ audience: "slop-points-web" });
        calls++;
        return Response.json({
          audience: "slop-points-web",
          githubActorId: "123",
          githubNodeId: "U_points",
          githubLogin: "points-user",
        });
      },
    },
  };
  return { sqlite, deps, calls: () => calls };
}
function post(
  path: string,
  body: unknown,
  cookie?: string,
  origin = "https://slop.cash",
) {
  return new Request(`https://slop.cash/api/v1/points/${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe("points persistence and joining", () => {
  it("awards welcome once, retains membership on signout, and binds visibility to the session", async () => {
    const { deps, sqlite } = setup();
    const body = {
      assertion: `slop_assert_v1_${"a".repeat(43)}`,
      public: false,
    };
    const first = await handlePointsApi(post("join", body), deps);
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await first.json()).welcome).toBe(5);
    const second = await handlePointsApi(post("join", body), deps);
    expect(second.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) n,SUM(welcome) total FROM points_members")
        .get(),
    ).toMatchObject({ n: 1, total: 5 });
    expect(
      (
        await handlePointsApi(
          post(
            "visibility",
            { public: true },
            cookie,
            "https://attacker.example",
          ),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handlePointsApi(
          post("visibility", { public: true }, cookie),
          deps,
        )
      ).status,
    ).toBe(200);
    const publicResult = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/member?login=points-user"),
      deps,
    );
    expect((await publicResult.json()).actor.id).toBe("U_points");
    await handlePointsApi(post("signout", {}, cookie), deps);
    const me = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/me", {
        headers: { cookie },
      }),
      deps,
    );
    expect(await me.json()).toBe(null);
    expect(() => sqlite.exec("DELETE FROM points_members")).toThrow(
      /uniqueness/,
    );
  });
  it("rejects client-selected awards and preserves journal rows across retry and correction", async () => {
    const { deps, sqlite, calls } = setup();
    expect(
      (
        await handlePointsApi(
          post("join", { actor: "other", amount: 500 }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(calls()).toBe(0);
    const now = "2026-09-21T12:00:00.000Z";
    const a = awardForScore(snapshotFixture().ledger[0]);
    let j = appendPointAwards(
      emptyPointsJournal(now),
      [a],
      "a".repeat(64),
      "slop-score-v2",
      now,
    );
    sqlite.exec(pointsSql(j));
    sqlite.exec(pointsSql(j));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 1 });
    j = appendPointAwards(
      j,
      [{ ...a, amount: a.amount + 60 }],
      "b".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    sqlite.exec(pointsSql(j));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 2 });
    expect(() => sqlite.exec("DELETE FROM points_revisions")).toThrow(
      /append-only/,
    );
    const result = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/journal"),
      deps,
    );
    const page = await result.json();
    expect(page.revisions).toEqual(j.revisions);
    expect(page.next).toBe(null);
  });
  it("keeps interrupted uploads invisible and commits a complete replacement atomically", () => {
    const { sqlite } = setup();
    const now = "2026-09-21T12:00:00.000Z";
    const a = awardForScore(snapshotFixture().ledger[0]);
    const initial = appendPointAwards(
      emptyPointsJournal(now),
      [a],
      "a".repeat(64),
      "slop-score-v2",
      now,
    );
    const sql = pointsSql(initial).trim().split("\n");
    sqlite.exec(sql[0]);
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 0 });
    const corrected = appendPointAwards(
      initial,
      [{ ...a, amount: a.amount + 60 }],
      "b".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    const replacement = pointsSql(corrected).trim().split("\n");
    sqlite.exec(replacement[0]);
    expect(() => sqlite.exec(replacement.at(-1)!)).toThrow(/incomplete/);
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 0 });
    expect(retainPublishedHistory(initial, corrected)).toEqual(corrected);
    expect(retainPublishedHistory(corrected, initial)).toEqual(corrected);
    const fork = appendPointAwards(
      initial,
      [{ ...a, amount: a.amount + 90 }],
      "c".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    expect(() => retainPublishedHistory(corrected, fork)).toThrow(/diverged/);
    sqlite.exec(pointsSql(corrected));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 2 });
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_batches").get(),
    ).toMatchObject({ n: 1 });
  });
});
