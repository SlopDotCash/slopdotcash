// The points import and API: pointsSql batches applied to the real migrations
// and read back through the points API. Each batch keeps the permanent history
// prefix and publishes whole or not at all.
// Member reads fail closed and report no points the program has ended.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handlePointsApi } from "../backend/points/handler";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  type PointsJournal,
  pointKey,
  pointRevisionId,
  reconcilePointPenalties,
} from "../src/lib/points";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import { sha256Hex } from "../workers/identity/crypto";
import { pointsSql } from "./generate-points";

afterEach(() => setSystemTime());

function checkpoint(): PointsJournal {
  return JSON.parse(readFileSync("data/points/history.json", "utf8"));
}

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function startPointsApi(migrations = MIGRATIONS) {
  const { db: adapter, sqlite: db } = sqliteD1(migrations);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      return handlePointsApi(
        new Request(`https://slop.cash${url.pathname}${url.search}`),
        {
          db: adapter,
          rateLimitSecret: "unused-read-only-test",
          identity: {
            async fetch() {
              throw new Error("Identity must not be called");
            },
          },
        },
      );
    },
  });
  return {
    db,
    read: (path: string) => fetch(new URL(`/api/v1/points${path}`, server.url)),
    apply(journal: PointsJournal) {
      db.transaction(() => {
        for (const statement of pointsSql(journal).trim().split("\n"))
          db.exec(statement);
      })();
    },
    close() {
      server.stop(true);
      db.close();
    },
  };
}

test("journal debit corrections preserve the checkpoint, other months, projects and payout recognition", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const history = checkpoint();
  const prefix = { ...history, revisions: history.revisions.slice(0, 3) };
  const snapshot = createLeaderboardSnapshot(
    penaltyScoreInput([
      {
        itemNodeId: "PR_local",
        authorGithubId: "42",
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 3,
        period: "2026-11",
        recordedAt: "2026-11-10T00:00:00.000Z",
      },
    ]),
  );
  let journal = applyPointsSnapshot(
    prefix,
    snapshot,
    "a".repeat(64),
    GENERATED_AT,
  );
  const accepted = journal.revisions.find(
    (r) => r.award.sourceId === "PR_november",
  )!.award;
  const payoutId = `payout:2026-11:${PENALIZED_AUTHOR.id}`;
  journal = appendPointAwards(
    journal,
    [
      {
        ...accepted,
        key: pointKey("asi", accepted.actor.id, "payout-received", payoutId),
        category: "payout-received",
        amount: 25,
        sourceId: payoutId,
        workUnitId: payoutId,
        sourceUrl: "https://slop.cash/cycles/asi/2026-11",
        provisional: false,
      },
    ],
    "b".repeat(64),
    "verified-payout-v1",
    GENERATED_AT,
  );
  journal = appendPointAwards(
    journal,
    [
      {
        ...accepted,
        key: pointKey(
          "eliza",
          accepted.actor.id,
          accepted.category,
          "PR_other",
        ),
        projectId: "eliza",
        sourceId: "PR_other",
        workUnitId: "other-project",
        amount: 70,
        sourceUrl: "https://github.com/elizaOS/eliza/pull/991",
      },
    ],
    "c".repeat(64),
    "slop-score-v2",
    GENERATED_AT,
  );
  journal = reconcilePointPenalties(journal, "d".repeat(64), GENERATED_AT);
  const api = startPointsApi();
  try {
    api.apply(prefix);
    const oldRows = api.db
      .query("SELECT id,payload FROM points_revisions ORDER BY rowid")
      .all();
    api.apply(journal);
    // New accepted earnings consume only the unused part of the same monthly debit.
    journal = appendPointAwards(
      journal,
      [
        {
          ...accepted,
          key: pointKey(
            "asi",
            accepted.actor.id,
            accepted.category,
            "PR_later",
          ),
          sourceId: "PR_later",
          workUnitId: "later-work",
          amount: 20,
          sourceUrl: "https://github.com/SlopDotCash/asi/pull/992",
        },
      ],
      "e".repeat(64),
      "slop-score-v2",
      GENERATED_AT,
    );
    journal = reconcilePointPenalties(journal, "f".repeat(64), GENERATED_AT);
    api.apply(journal);
    // The real import boundary refuses a forged positive debit without writes.
    const forged = structuredClone(journal);
    const forgedDebit = forged.revisions.filter((r) => r.penalty).at(-1)!;
    forgedDebit.award.amount = 1;
    const { id: _oldId, ...contents } = forgedDebit;
    forgedDebit.id = pointRevisionId(contents);
    const beforeRefusal = api.db
      .query("SELECT id,payload FROM points_revisions ORDER BY rowid")
      .all();
    expect(() => api.apply(forged)).toThrow("Invalid point award");
    expect(
      api.db
        .query("SELECT id,payload FROM points_revisions ORDER BY rowid")
        .all(),
    ).toEqual(beforeRefusal);
    api.apply(reconcilePointPenalties(journal, "f".repeat(64), GENERATED_AT));
    expect(
      api.db
        .query("SELECT id,payload FROM points_revisions ORDER BY rowid LIMIT 3")
        .all(),
    ).toEqual(oldRows);
    expect(
      api.db.query("SELECT COUNT(*) AS n FROM points_revisions").get(),
    ).toEqual({ n: journal.revisions.length });
  } finally {
    api.close();
  }
});

test("points publication retains the exact permanent history prefix", async () => {
  const history = checkpoint();
  const first = { ...history, revisions: history.revisions.slice(0, 2) };
  const next = {
    ...history,
    generatedAt: new Date(Date.parse(history.generatedAt) + 1000).toISOString(),
    revisions: history.revisions.slice(0, 3),
  };
  const reordered = {
    ...next,
    revisions: [next.revisions[1], next.revisions[0], next.revisions[2]],
  };
  const migration = "0037_points_batch_prefix.sql";
  const api = startPointsApi(MIGRATIONS.filter((path) => path !== migration));
  const { db } = api;
  const readJournal = async () => {
    const response = await api.read("/journal");
    expect(response.status).toBe(200);
    const { batch, next: cursor, total, ...journal } = await response.json();
    expect(cursor).toBeNull();
    expect(total).toBe(journal.revisions.length);
    expect(sha256(journal)).toBe(batch);
    return journal;
  };
  const rows = () =>
    db.query("SELECT id,payload FROM points_revisions ORDER BY rowid").all();
  try {
    api.apply(first);
    const permanent = rows();
    expect((await readJournal()).revisions).toEqual(first.revisions);
    // Upgrade an already populated database, as the release workflow does.
    db.exec(readFileSync(`migrations/${migration}`, "utf8"));
    // Each candidate is a valid journal; only its relationship to D1 differs.
    expect(() => api.apply(reordered)).toThrow("divergent points batch");
    expect(rows()).toEqual(permanent);
    expect(db.query("SELECT COUNT(*) AS n FROM points_batches").get()).toEqual({
      n: 1,
    });
    expect((await readJournal()).revisions).toEqual(first.revisions);
    api.apply(next);
    expect((await readJournal()).revisions).toEqual(next.revisions);
    expect(rows().map((row) => (row as { id: string }).id)).toEqual(
      next.revisions.map((revision) => revision.id),
    );
    expect(() => api.apply(next)).not.toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM points_staging").get()).toEqual({
      n: 0,
    });
  } finally {
    api.close();
  }
});

// Every snapshot application adds one coverage entry per repository, so the
// production coverage only grows. 700 entries is about 120 KB of JSON.
function journalWithCoverage(entries: number): PointsJournal {
  const history = checkpoint();
  const repositories = history.coverage.map((c) => c.repository);
  return {
    ...history,
    revisions: history.revisions.slice(0, 3),
    coverage: Array.from({ length: entries }, (_, i) => ({
      repository: repositories[i % repositories.length],
      from: "2026-09-01T00:00:00.000Z",
      to: new Date(
        Date.parse("2026-09-21T00:00:00.000Z") + i * 60000,
      ).toISOString(),
      digest: createHash("sha256").update(String(i)).digest("hex"),
    })),
  };
}

test("a staged coverage list is served whole and an incomplete one publishes nothing", async () => {
  const journal = journalWithCoverage(700);
  const api = startPointsApi();
  const { db } = api;
  const statements = pointsSql(journal).trim().split("\n");
  const count = (table: string) =>
    db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  try {
    // A statement-by-statement executor can lose one upload and still run the
    // batch statement; that batch must fail instead of recording less coverage.
    const isRecord = (s: string) => s.startsWith("INSERT INTO points_batches(");
    const record = statements.filter(isRecord);
    expect(record).toHaveLength(1);
    const lost = statements.findLastIndex((s) =>
      s.startsWith("INSERT INTO points_coverage_staging("),
    );
    expect(lost).toBeGreaterThan(-1);
    for (const [i, statement] of statements.entries())
      if (i !== lost && !isRecord(statement)) db.exec(statement);
    expect(() => db.exec(record.join("\n"))).toThrow();
    expect(count("points_batches")).toEqual({ n: 0 });
    expect(count("points_revisions")).toEqual({ n: 0 });

    api.apply(journal);
    const response = await api.read("/journal");
    expect(response.status).toBe(200);
    const { batch, next, total, ...served } = await response.json();
    expect(next).toBeNull();
    expect(total).toBe(journal.revisions.length);
    expect(served).toEqual(journal);
    expect(sha256(served)).toBe(batch);
    expect(count("points_staging")).toEqual({ n: 0 });
    expect(count("points_coverage_staging")).toEqual({ n: 0 });

    // Replaying a recorded batch changes nothing and leaves no staged rows.
    api.apply(journal);
    expect(count("points_batches")).toEqual({ n: 1 });
    expect(count("points_coverage_staging")).toEqual({ n: 0 });
  } finally {
    api.close();
  }
});

test("journal reads select the complete prefix before generation-time tie breakers", async () => {
  const history = checkpoint();
  for (const offset of [0, 1000]) {
    const api = startPointsApi();
    try {
      const old = {
        ...history,
        generatedAt: new Date(
          Date.parse(history.generatedAt) + offset,
        ).toISOString(),
        revisions: history.revisions.slice(0, 2),
      };
      const next = { ...history, revisions: history.revisions.slice(0, 3) };
      api.apply(old);
      const before = await (await api.read("/journal")).json();
      api.apply(next);
      const response = await api.read("/journal");
      const page = await response.json();
      expect(response.status).toBe(200);
      expect(page.total).toBe(3);
      expect(page.revisions).toEqual(next.revisions);
      expect(page.batch).toBe(sha256(next));
      expect(
        (await api.read(`/journal?batch=${before.batch}&after=1`)).status,
      ).toBe(409);
      const refresh = {
        ...next,
        generatedAt: new Date(
          Date.parse(history.generatedAt) + 2000,
        ).toISOString(),
      };
      api.apply(refresh);
      expect((await (await api.read("/journal")).json()).generatedAt).toBe(
        refresh.generatedAt,
      );
    } finally {
      api.close();
    }
  }
});

test("member lookups fail closed when a stale public login collides with a private member", async () => {
  const api = startPointsApi();
  const { db } = api;
  const readMember = async (login: string) => {
    const response = await api.read(
      `/member?login=${encodeURIComponent(login)}`,
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  try {
    const insertMember = db.prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,?)",
    );
    insertMember.run(
      "MDQ6VXNlcjE=",
      "1",
      "alice",
      "2026-10-01T00:00:00.000Z",
      1,
    );

    expect(await readMember("alice")).toEqual({
      actor: { id: "MDQ6VXNlcjE=", login: "alice" },
      joinedAt: "2026-10-01T00:00:00.000Z",
      public: true,
      welcome: 5,
      socialPoints: 0,
    });

    // A second actor now owns the handle "Alice" and joins with private visibility.
    insertMember.run(
      "MDQ6VXNlcjI=",
      "2",
      "Alice",
      "2026-10-03T00:00:00.000Z",
      0,
    );

    expect(await readMember("alice")).toBeNull();
    expect(await readMember("Alice")).toBeNull();

    // Once the first actor refreshes their renamed handle, the private owner still stays private.
    db.prepare("UPDATE points_members SET login=? WHERE actor_id=?").run(
      "alice2",
      "MDQ6VXNlcjE=",
    );
    expect(await readMember("alice")).toBeNull();
    expect(await readMember("alice2")).toEqual({
      actor: { id: "MDQ6VXNlcjE=", login: "alice2" },
      joinedAt: "2026-10-01T00:00:00.000Z",
      public: true,
      welcome: 5,
      socialPoints: 0,
    });

    // Welcome points ended on 24 October 2026; a later join reports none.
    insertMember.run(
      "MDQ6VXNlcjM=",
      "3",
      "carol",
      "2026-10-24T00:00:00.000Z",
      1,
    );
    expect(await readMember("carol")).toEqual({
      actor: { id: "MDQ6VXNlcjM=", login: "carol" },
      joinedAt: "2026-10-24T00:00:00.000Z",
      public: true,
      welcome: 0,
      socialPoints: 0,
    });
  } finally {
    api.close();
  }
});

test("X-connection awards recorded from 24 October 2026 report no points", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const token = "s".repeat(48);
  const read = async (path: string) =>
    (
      await handlePointsApi(
        new Request(`https://slop.cash/api/v1/points${path}`, {
          headers: { cookie: `__Host-slop_points=${token}` },
        }),
        {
          db,
          rateLimitSecret: "unused-read-only-test",
          identity: {
            async fetch() {
              throw new Error("Identity must not be called");
            },
          },
          now: () => new Date("2026-10-25T00:00:00.000Z"),
        },
      )
    ).json();
  try {
    const join = (actor: string, id: string, login: string, at: string) =>
      sqlite
        .prepare(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
        )
        .run(actor, id, login, at);
    const connectX = (actor: string, xId: string, at: string) => {
      sqlite
        .prepare(
          "INSERT INTO points_x_claims(x_id,actor_id,claimed_at) VALUES(?,?,?)",
        )
        .run(xId, actor, at);
      sqlite
        .prepare(
          "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) VALUES(?,?,?,10)",
        )
        .run(actor, xId, at);
    };
    // A historical award stays. Production still recorded X awards on 24
    // October (the last fixture copies one such award's timestamp).
    join("MDQ6VXNlcjE=", "1", "alice", "2026-10-01T00:00:00.000Z");
    connectX("MDQ6VXNlcjE=", "9001", "2026-10-23T23:59:59.999Z");
    join("MDQ6VXNlcjI=", "2", "bob", "2026-10-01T00:00:00.000Z");
    connectX("MDQ6VXNlcjI=", "9002", "2026-10-24T00:00:00.000Z");
    join("MDQ6VXNlcjM=", "3", "carol", "2026-10-24T09:00:00.000Z");
    connectX("MDQ6VXNlcjM=", "9003", "2026-10-24T10:06:03.523Z");
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run(await sha256Hex(token), "MDQ6VXNlcjI=", "2026-10-25T01:00:00.000Z");

    const totals = (member: { welcome: number; socialPoints: number }) => [
      member.welcome,
      member.socialPoints,
    ];
    expect({
      alice: totals(await read("/member?login=alice")),
      bob: totals(await read("/member?login=bob")),
      carol: totals(await read("/member?login=carol")),
      me: totals(await read("/me")),
    }).toEqual({
      alice: [5, 10],
      bob: [5, 0],
      carol: [0, 0],
      me: [5, 0],
    });
    const { people } = (await read("/people")) as {
      people: {
        actor: { login: string };
        welcome: number;
        socialPoints: number;
      }[];
    };
    expect(
      Object.fromEntries(people.map((p) => [p.actor.login, totals(p)])),
    ).toEqual({ alice: [5, 10], bob: [5, 0], carol: [0, 0] });
  } finally {
    sqlite.close();
  }
});
