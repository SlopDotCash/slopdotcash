// PRD 7: recovering a journal retains every completed source census, even
// when a refresh changed no award and Pages still serves the previous build.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { handlePointsApi } from "../backend/points/handler";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  applyPointsSnapshot,
  assertPointsJournal,
  type PointsJournal,
} from "../src/lib/points";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { loadPublishedPoints, pointsSql } from "./generate-points";

afterEach(() => setSystemTime());
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function refreshedJournals() {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const initialSnapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
  const initial = applyPointsSnapshot(
    empty,
    initialSnapshot,
    hash(JSON.stringify(initialSnapshot)),
    GENERATED_AT,
  );
  const time = new Date(Date.parse(GENERATED_AT) + 3_600_000).toISOString();
  const refresh = createLeaderboardSnapshot(penaltyScoreInput([], time));
  const checkpoint = applyPointsSnapshot(
    initial,
    refresh,
    hash(JSON.stringify(refresh)),
    time,
  );
  return { initial, checkpoint };
}

for (const newer of ["checkpoint", "pages"] as const) {
  test(`online recovery retains coverage from the newer ${newer} without new awards`, async () => {
    const { initial, checkpoint } = refreshedJournals();
    expect(checkpoint.revisions).toEqual(initial.revisions);
    expect(checkpoint.coverage.length).toBeGreaterThan(initial.coverage.length);
    const stored = newer === "checkpoint" ? checkpoint : initial;
    const published = newer === "checkpoint" ? initial : checkpoint;
    const before = JSON.stringify({ stored, published });
    const { db, sqlite } = sqliteD1();
    const shards = Array.from({ length: 16 }, (_, index) => {
      const rows = published.revisions
        .map((revision, sequence) => ({ revision, sequence }))
        .filter(({ revision }) =>
          revision.award.key.startsWith(index.toString(16)),
        );
      const text = `${JSON.stringify(rows)}\n`;
      return {
        text,
        path: `/data/points/${index.toString(16)}.json`,
        sha256: hash(text),
        count: rows.length,
      };
    });
    const index = {
      schemaVersion: "1",
      ruleVersion: published.ruleVersion,
      generatedAt: published.generatedAt,
      coverage: published.coverage,
      revisionCount: published.revisions.length,
      shards: shards.map(({ text: _text, ...metadata }) => metadata),
    };
    const originalFetch = globalThis.fetch;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/points/journal")
          return handlePointsApi(
            new Request(`https://slop.cash${url.pathname}${url.search}`),
            {
              db,
              rateLimitSecret: "unused-public-read-fixture",
              identity: {
                fetch: async () => {
                  throw new Error("No identity call is expected");
                },
              },
            },
          );
        if (url.pathname === "/data/points.json") return Response.json(index);
        const shard = shards.find((row) => row.path === url.pathname);
        return shard
          ? new Response(shard.text)
          : new Response(null, { status: 404 });
      },
    });
    globalThis.fetch = ((input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://slop.cash")
        throw new Error("Unexpected external request");
      return originalFetch(
        new URL(url.pathname + url.search, server.url),
        init,
      );
    }) as typeof fetch;
    try {
      sqlite.transaction(() => {
        for (const statement of pointsSql(stored).trim().split("\n"))
          sqlite.exec(statement);
      })();
      const recovered = await loadPublishedPoints(false, async () => {});
      assertPointsJournal(recovered);
      expect(recovered.revisions).toEqual(checkpoint.revisions);
      expect(recovered.coverage).toEqual(checkpoint.coverage);
      expect(recovered.generatedAt).toBe(checkpoint.generatedAt);
      expect(JSON.stringify({ stored, published })).toBe(before);
      // The combined result can itself be checkpointed and served byte-exactly.
      sqlite.transaction(() => {
        for (const statement of pointsSql(recovered).trim().split("\n"))
          sqlite.exec(statement);
      })();
      const response = await originalFetch(
        new URL("/api/v1/points/journal", server.url),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.coverage).toEqual(checkpoint.coverage);
      expect(body.batch).toBe(hash(JSON.stringify(recovered)));
      expect(body.revisions).toEqual(checkpoint.revisions);
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
      sqlite.close();
    }
  });
}
