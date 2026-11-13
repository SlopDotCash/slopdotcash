// The points import and API: pointsSql batches applied to the real migrations
// and read back through the points API. Each batch keeps the permanent history
// prefix and publishes whole or not at all.
// Member reads fail closed and report no points the program has ended.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handlePointsApi } from "../backend/points/handler";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { PublishedPenalty } from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assertPointsJournal,
  emptyPointsJournal,
  latestPoints,
  type PointAward,
  type PointsJournal,
  pointKey,
  pointMembers,
  pointRevisionId,
  reconcilePointPenalties,
} from "../src/lib/points";
import { penaltyDeductions } from "../src/lib/score-penalties";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import {
  applyRetainedHistoryBatch,
  pointsSql,
  retiredEvaluatorAwards,
} from "./generate-points";

afterEach(() => setSystemTime());

function retainedPointAward(
  sourceId: string,
  amount: number,
  penalty: boolean,
  number: number,
  occurredAt = GENERATED_AT,
): PointAward {
  const actor = { id: PENALIZED_AUTHOR.id, login: PENALIZED_AUTHOR.login };
  return {
    key: pointKey(
      "asi",
      actor.id,
      penalty ? "slopbot-penalty" : "merged-pull-request",
      sourceId,
    ),
    actor,
    projectId: "asi",
    category: penalty ? "slopbot-penalty" : "merged-pull-request",
    amount,
    occurredAt,
    sourceId,
    sourceUrl: `https://github.com/SlopDotCash/asi/pull/${number}`,
    workUnitId: penalty ? `${sourceId}:penalty` : sourceId,
    provisional: false,
  };
}

test("a valid retained debit journal refuses an inexact negative Points total", () => {
  let journal = appendPointAwards(
    emptyPointsJournal(GENERATED_AT),
    [retainedPointAward("PR_retained_earned", 1, false, 100)],
    "a".repeat(64),
    "slop-score-v2",
    GENERATED_AT,
  );
  for (const number of [101, 102]) {
    const sourceId = `PR_retained_debit_${number}`;
    const debit = retainedPointAward(
      sourceId,
      -Number.MAX_SAFE_INTEGER,
      true,
      number,
    );
    journal = appendPointAwards(
      journal,
      [debit],
      "b".repeat(64),
      "slopbot-penalties-v1",
      GENERATED_AT,
      new Map([
        [
          debit.key,
          {
            sourceId,
            effectiveAt: GENERATED_AT,
            reason: "Retained debit evidence",
          },
        ],
      ]),
      new Map([
        [
          debit.key,
          {
            category: "spam",
            debit: Number.MAX_SAFE_INTEGER,
            reversedAt: null,
            reversal: null,
          },
        ],
      ]),
    );
  }
  // Every retained amount and its revision hash is valid. The signed total
  // is not representable by the public Number schema and must not be rounded.
  expect(() => assertPointsJournal(journal)).not.toThrow();
  expect(() => pointMembers(journal)).toThrow("Points total overflow");
});

test("safe penalties in three project scopes refuse an inexact actor total", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const events = [0, 1, 2].map((index) => ({
    actor: PENALIZED_AUTHOR,
    repository: `https://github.com/example/project-${index}`,
    occurredAt: GENERATED_AT,
    scoreThirds: maximum,
    points: maximum / 3,
  }));
  const penalties: PublishedPenalty[] = events.map((event, index) => ({
    id: `PR_scoped_debit_${index}:penalty`,
    actor: event.actor,
    repository: event.repository,
    occurredAt: event.occurredAt,
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: maximum,
    source: {
      id: `PR_scoped_debit_${index}`,
      kind: "pull-request",
      number: 200 + index,
      title: "Closed fixture",
      url: `${event.repository}/pull/${200 + index}`,
    },
  }));
  const projectOf = (repository: string) => repository;
  for (const [index, event] of events.entries()) {
    const result = penaltyDeductions([event], [penalties[index]], projectOf);
    expect(result.byActor.get(PENALIZED_AUTHOR.id)).toBe(maximum);
    expect(result.byPenalty.get(penalties[index].id)).toBe(maximum);
  }
  // Every scope is exact by itself. The public actor total must not round
  // the sum of the three independently applicable debits.
  expect(() => penaltyDeductions(events, penalties, projectOf)).toThrow(
    "Penalty total overflow",
  );
});

test("a safe lifetime Points total still refuses an inexact monthly subtotal", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  let journal = appendPointAwards(
    emptyPointsJournal(GENERATED_AT),
    [
      retainedPointAward(
        "PR_monthly_boundary_earned",
        maximum,
        false,
        300,
        "2026-10-20T00:00:00.000Z",
      ),
    ],
    "a".repeat(64),
    "slop-score-v2",
    GENERATED_AT,
  );
  for (const [index, amount] of [maximum, 2].entries()) {
    const sourceId = `PR_monthly_boundary_debit_${index}`;
    const debit = retainedPointAward(
      sourceId,
      -amount,
      true,
      301 + index,
      "2026-11-10T00:00:00.000Z",
    );
    journal = appendPointAwards(
      journal,
      [debit],
      "b".repeat(64),
      "slopbot-penalties-v1",
      GENERATED_AT,
      new Map([
        [
          debit.key,
          {
            sourceId,
            effectiveAt: GENERATED_AT,
            reason: "Retained debit evidence",
          },
        ],
      ]),
      new Map([
        [
          debit.key,
          { category: "spam", debit: amount, reversedAt: null, reversal: null },
        ],
      ]),
    );
  }
  // This constructed retained history is schema-valid. Its lifetime total
  // is exactly -2, but November's negative subtotal is outside safe Number.
  expect(() => assertPointsJournal(journal)).not.toThrow();
  expect(pointMembers(journal, "2026-10")).toMatchObject([
    { total: -2, monthly: maximum },
  ]);
  expect(() => pointMembers(journal, "2026-11")).toThrow(
    "Points total overflow",
  );
});

function checkpoint(): PointsJournal {
  return JSON.parse(readFileSync("data/points/history.json", "utf8"));
}

function retainedModelStates() {
  const directory = mkdtempSync(join(tmpdir(), "slop-retained-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/points/points_retained_provenance.qnt",
        "--backend=typescript",
        "--seed=1",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    return Object.fromEntries(
      readdirSync(directory).map((file) => {
        const name = /^trace-(.*)-\d+\.json$/u.exec(file)?.[1];
        if (!name) throw new Error(`Unexpected Quint trace ${file}`);
        const trace = JSON.parse(
          readFileSync(join(directory, file), "utf8"),
          (_key, value) =>
            value && typeof value === "object" && "#bigint" in value
              ? Number(value["#bigint"])
              : value,
        ) as {
          states: {
            s: { amount: number; eligible: boolean; history: unknown[] };
          }[];
        };
        const state = trace.states.at(-1)?.s;
        if (!state) throw new Error(`Missing Quint state for ${name}`);
        return [name, state];
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

test("Quint retained-award traces preserve recovery and explicit decisions through Points imports", async () => {
  const model = retainedModelStates();
  const history = checkpoint();
  const prefix = { ...history, revisions: history.revisions.slice(0, 3) };
  // The fixture registry lists eliza, as production does again since 19 October.
  const award = (sourceId: string, review: number, amount: number) => ({
    key: pointKey(
      "eliza",
      PENALIZED_AUTHOR.id,
      "evaluated-contribution",
      sourceId,
    ),
    actor: { id: PENALIZED_AUTHOR.id, login: PENALIZED_AUTHOR.login },
    projectId: "eliza",
    category: "evaluated-contribution" as const,
    amount,
    occurredAt: "2026-08-21T06:52:26.000Z",
    sourceId,
    sourceUrl: `https://github.com/elizaOS/eliza/pull/23364#pullrequestreview-${review}`,
    workUnitId: `wu_eliza_${sourceId.toLowerCase()}`,
    provisional: false,
  });
  const retired = award("PRR_retired", 4990521102, 240);
  const current = award("PRR_current", 5990521102, 80);
  const amountOf = (journal: PointsJournal, key: string) =>
    latestPoints(journal).get(key)?.award.amount;
  const matchesModel = (journal: PointsJournal, scenario: string) => {
    const expected = model[scenario];
    if (!expected) throw new Error(`Missing Quint scenario ${scenario}`);
    expect({
      amount: amountOf(journal, retired.key),
      eligible: retiredEvaluatorAwards(journal).some(
        (candidate) => candidate.key === retired.key,
      ),
      revisions: journal.revisions.filter(
        (revision) => revision.award.key === retired.key,
      ).length,
    }).toEqual({
      amount: expected.amount === 2 ? 240 : expected.amount === 1 ? 90 : 0,
      eligible: expected.eligible,
      revisions: expected.history.length,
    });
  };
  // The retained batch recorded this award before the move retired its manifest.
  const beforeMove = appendPointAwards(
    prefix,
    [retired],
    "a".repeat(64),
    "slop-score-v2",
    "2026-09-26T16:43:16.991Z",
  );
  // A later manifest, then a run in which no file supplies either award.
  const run = applyRetainedHistoryBatch(
    appendPointAwards(
      beforeMove,
      [current],
      "b".repeat(64),
      "slop-score-v2",
      "2026-10-26T00:00:00.000Z",
    ),
    [],
    "c".repeat(64),
    "2026-10-27T00:00:00.000Z",
  );
  expect(amountOf(run, retired.key)).toBe(240);
  expect(amountOf(run, current.key)).toBe(0);
  matchesModel(run, "historicalOmittedTest");
  // Production already recorded the zero on 20 October: one successor restores it.
  const zeroed = appendPointAwards(
    beforeMove,
    [{ ...retired, amount: 0 }],
    "782097740ab32fa43352c9b7d43b34cc4586f8611068c40a9cddcc58edc9aa37",
    "slop-score-v2",
    "2026-10-20T05:30:25.870Z",
  );
  // A later explicit maintainer decision can confirm the same zero amount.
  // Its durable provenance must replace the historical incident's exemption.
  const confirmedZero = applyRetainedHistoryBatch(
    zeroed,
    [{ ...retired, amount: 0 }],
    "d".repeat(64),
    "2026-10-26T00:00:00.000Z",
  );
  const afterConfirmedZeroRemoval = applyRetainedHistoryBatch(
    confirmedZero,
    [],
    "e".repeat(64),
    "2026-10-27T00:00:00.000Z",
  );
  expect(amountOf(afterConfirmedZeroRemoval, retired.key)).toBe(0);
  matchesModel(afterConfirmedZeroRemoval, "explicitZeroEndsRecoveryTest");
  const explicitApi = startPointsApi();
  try {
    explicitApi.apply(zeroed);
    explicitApi.apply(confirmedZero);
    explicitApi.apply(afterConfirmedZeroRemoval);
    explicitApi.apply(afterConfirmedZeroRemoval);
    const response = await explicitApi.read("/journal");
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.revisions.at(-1).award.amount).toBe(0);
    expect(page.revisions.at(-1).sourceDigest).toBe("d".repeat(64));
    expect(page.total).toBe(confirmedZero.revisions.length);
    expect(
      explicitApi.db.query("SELECT COUNT(*) AS n FROM points_staging").get(),
    ).toEqual({ n: 0 });
  } finally {
    explicitApi.close();
  }
  const restored = applyRetainedHistoryBatch(
    zeroed,
    [],
    "e".repeat(64),
    "2026-10-27T00:00:00.000Z",
  );
  expect(restored.revisions.slice(0, zeroed.revisions.length)).toEqual(
    zeroed.revisions,
  );
  expect(restored.revisions.length).toBe(zeroed.revisions.length + 1);
  expect(restored.revisions.at(-1)).toMatchObject({
    previous: zeroed.revisions.at(-1)?.id,
    award: retired,
  });
  matchesModel(restored, "recoverIncidentTest");
  expect(
    applyRetainedHistoryBatch(
      restored,
      [],
      "e".repeat(64),
      "2026-10-27T00:00:00.000Z",
    ).revisions,
  ).toEqual(restored.revisions);
  matchesModel(
    applyRetainedHistoryBatch(
      restored,
      [],
      "f".repeat(64),
      "2026-10-28T00:00:00.000Z",
    ),
    "recoveryReplayTest",
  );
  // A new batch digest must not re-zero the recovered award or append again.
  expect(
    applyRetainedHistoryBatch(
      restored,
      [],
      "f".repeat(64),
      "2026-10-28T00:00:00.000Z",
    ).revisions,
  ).toEqual(restored.revisions);
  // A subsequent explicit correction (even the same amount) adopts the award.
  // Removing its manifest must revoke it, and recovery must not undo that zero.
  for (const amount of [90, retired.amount]) {
    const adopted = applyRetainedHistoryBatch(
      restored,
      [{ ...retired, amount }],
      "a".repeat(64),
      "2026-10-28T01:00:00.000Z",
    );
    expect(amountOf(adopted, retired.key)).toBe(amount);
    expect(adopted.revisions.length).toBe(restored.revisions.length + 1);
    const revoked = applyRetainedHistoryBatch(
      adopted,
      [],
      "b".repeat(64),
      "2026-10-28T02:00:00.000Z",
    );
    expect(amountOf(revoked, retired.key)).toBe(0);
    if (amount === retired.amount)
      matchesModel(revoked, "sameAmountAdoptionThenRevocationTest");
    expect(
      applyRetainedHistoryBatch(
        revoked,
        [],
        "c".repeat(64),
        "2026-10-28T03:00:00.000Z",
      ).revisions,
    ).toEqual(revoked.revisions);
  }
  // Other zero batches, including the same digest at another time, are not
  // evidence of this incident and must keep their own outcome.
  for (const [digest, at] of [
    ["a".repeat(64), "2026-10-20T05:30:25.870Z"],
    [
      "782097740ab32fa43352c9b7d43b34cc4586f8611068c40a9cddcc58edc9aa37",
      "2026-10-26T00:00:00.000Z",
    ],
  ]) {
    const otherZero = appendPointAwards(
      beforeMove,
      [{ ...retired, amount: 0 }],
      digest,
      "slop-score-v2",
      at,
    );
    expect(
      amountOf(
        applyRetainedHistoryBatch(
          otherZero,
          [],
          "c".repeat(64),
          "2026-10-28T00:00:00.000Z",
        ),
        retired.key,
      ),
    ).toBe(0);
    matchesModel(
      applyRetainedHistoryBatch(
        otherZero,
        [],
        "c".repeat(64),
        "2026-10-28T00:00:00.000Z",
      ),
      "unrelatedZeroNeverRecoveredTest",
    );
  }
  const adoptedOnce = applyRetainedHistoryBatch(
    beforeMove,
    [retired],
    "b".repeat(64),
    "2026-10-26T00:00:00.000Z",
  );
  matchesModel(
    applyRetainedHistoryBatch(
      adoptedOnce,
      [retired],
      "b".repeat(64),
      "2026-10-27T00:00:00.000Z",
    ),
    "adoptedReplayTest",
  );
  const coverage = prefix.coverage[0];
  if (!coverage) throw new Error("Missing real Points coverage fixture");
  const snapshotOwned = appendPointAwards(
    {
      ...prefix,
      coverage: [...prefix.coverage, { ...coverage, digest: "a".repeat(64) }],
    },
    [retired],
    "a".repeat(64),
    "slop-score-v2",
    "2026-10-26T00:00:00.000Z",
  );
  const snapshotAdopted = applyRetainedHistoryBatch(
    snapshotOwned,
    [retired],
    "b".repeat(64),
    "2026-10-27T00:00:00.000Z",
  );
  matchesModel(
    applyRetainedHistoryBatch(
      snapshotAdopted,
      [],
      "c".repeat(64),
      "2026-10-28T00:00:00.000Z",
    ),
    "snapshotAdoptionThenRevocationTest",
  );
  // The restored successor imports onto the published zero without a branch.
  const api = startPointsApi();
  try {
    api.apply(zeroed);
    api.apply(restored);
    const response = await api.read("/journal");
    const page = await response.json();
    expect(page.total).toBe(restored.revisions.length);
    expect(page.revisions.at(-1).award.amount).toBe(240);
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

test("a penalty batch preserves the journal prefix, caps the month's total debit and replays once", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const feed = Array.from({ length: 20 }, (_, index) => ({
    itemNodeId: `PR_batch_${index}`,
    authorGithubId: "42",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 3,
    period: "2026-11",
    recordedAt: `2026-11-10T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
  const input = penaltyScoreInput(feed);
  const closed = input.closedUnmergedPullRequests?.[0];
  if (!closed) throw new Error("Missing closed-source fixture");
  input.closedUnmergedPullRequests = feed.map((row, index) => ({
    ...closed,
    id: row.itemNodeId,
    number: 20000 + index,
    url: `https://github.com/SlopDotCash/asi/pull/${20000 + index}`,
  }));
  const snapshot = createLeaderboardSnapshot(input);
  const work = applyPointsSnapshot(
    checkpoint(),
    createLeaderboardSnapshot({ ...input, penalties: [] }),
    "b".repeat(64),
    GENERATED_AT,
  );
  const member = pointMembers(work).find(
    (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
  );
  if (!member) throw new Error("Missing accepted-work fixture");
  const available = member.monthly;
  const corrected = reconcilePointPenalties(
    work,
    "a".repeat(64),
    GENERATED_AT,
    snapshot,
  );
  expect(corrected.revisions.slice(0, work.revisions.length)).toEqual(
    work.revisions,
  );
  const appended = corrected.revisions.slice(work.revisions.length);
  expect(appended).toHaveLength(20);
  expect(
    appended.reduce((sum, revision) => sum + revision.award.amount, 0),
  ).toBe(-Math.min(available, 600));
  expect(
    reconcilePointPenalties(corrected, "a".repeat(64), GENERATED_AT, snapshot),
  ).toBe(corrected);
  const api = startPointsApi();
  try {
    api.apply(corrected);
    const response = await api.read("/journal?after=0");
    expect(response.status).toBe(200);
    const page = (await response.json()) as { total: number };
    expect(page.total).toBe(corrected.revisions.length);
  } finally {
    api.close();
  }
});
