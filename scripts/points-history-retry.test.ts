import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { handlePointsApi } from "../backend/points/handler";
import type { PointsJournal } from "../src/lib/points";
import { sqliteD1 } from "../tests/sqlite-d1";
import { loadPublishedPoints, pointsSql } from "./generate-points";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function projection(count = 3) {
  const journal: PointsJournal = JSON.parse(
    readFileSync("data/points/history.json", "utf8"),
  );
  journal.revisions = journal.revisions.slice(0, count);
  const shards = Array.from({ length: 16 }, (_, i) => {
    const rows = journal.revisions
      .map((revision, sequence) => ({ sequence, revision }))
      .filter(({ revision }) => revision.award.key.startsWith(i.toString(16)));
    const text = `${JSON.stringify(rows)}\n`;
    return {
      text,
      path: `/data/points/${i.toString(16)}.json`,
      sha256: digest(text),
      count: rows.length,
    };
  });
  const index = {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    coverage: journal.coverage,
    revisionCount: journal.revisions.length,
    shards: shards.map(({ text: _text, ...metadata }) => metadata),
  };
  return { journal, shards, index };
}

for (const scenario of [
  "rollover",
  "unchanged-corrupt",
  "changed-corrupt",
] as const) {
  test(`Points projection ${scenario} retains complete verified history`, async () => {
    const a = projection();
    const b = projection(4);
    const { db, sqlite } = sqliteD1();
    sqlite.transaction(() => sqlite.exec(pointsSql(a.journal)))();
    let indexReads = 0;
    let shardReads = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/points/journal")
          return (
            (await handlePointsApi(
              new Request(`https://slop.cash${url.pathname}${url.search}`),
              {
                db,
                rateLimitSecret: "unused-read-only-test",
                identity: {
                  async fetch() {
                    throw new Error("Identity must not be called");
                  },
                },
              },
            )) ?? new Response(null, { status: 404 })
          );
        if (url.pathname === "/data/points.json") {
          indexReads++;
          return Response.json(
            indexReads === 1 || scenario === "unchanged-corrupt"
              ? a.index
              : b.index,
          );
        }
        const selected = scenario === "unchanged-corrupt" ? a : b;
        const shard = selected.shards.find((s) => s.path === url.pathname);
        if (!shard) return new Response(null, { status: 404 });
        shardReads++;
        return new Response(shard.text + (scenario === "rollover" ? "" : " "));
      },
    });
    const originalFetch = globalThis.fetch;
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
      if (scenario === "rollover")
        expect(await loadPublishedPoints()).toEqual(b.journal);
      else
        await expect(loadPublishedPoints()).rejects.toThrow(
          "Points shard checksum mismatch",
        );
      expect(indexReads).toBe(2);
      expect(shardReads).toBe(scenario === "unchanged-corrupt" ? 16 : 32);
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
      sqlite.close();
    }
  });
}

for (const scenario of [
  "index-reset",
  "shard-reset",
  "body-reset",
  "persistent-reset",
  "reset-then-corrupt",
  "other-error",
] as const) {
  test(`Points projection transport ${scenario} preserves verified history`, async () => {
    const { journal, shards, index } = projection();
    const target =
      scenario === "index-reset"
        ? "https://slop.cash/data/points.json"
        : "https://slop.cash/data/points/1.json";
    const attempts: string[] = [];
    const waits: number[] = [];
    let indexReads = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/points/journal")
          return Response.json({
            ...journal,
            batch: digest(JSON.stringify(journal)),
            total: journal.revisions.length,
            next: null,
          });
        if (url.pathname === "/data/points.json") {
          indexReads++;
          return Response.json(index);
        }
        const shard = shards.find((part) => part.path === url.pathname);
        return shard
          ? new Response(
              shard.text +
                (scenario === "reset-then-corrupt" &&
                url.pathname === "/data/points/1.json"
                  ? " "
                  : ""),
            )
          : new Response(null, { status: 404 });
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://slop.cash")
        throw new Error("Unexpected external request");
      if (url.href === target) {
        attempts.push(url.href);
        if (
          scenario === "persistent-reset" ||
          scenario === "other-error" ||
          attempts.length <= (scenario === "shard-reset" ? 2 : 1)
        ) {
          const error = Object.assign(new Error("socket connection closed"), {
            code: scenario === "other-error" ? "OTHER_ERROR" : "ECONNRESET",
          });
          if (scenario !== "body-reset") throw error;
          let partial = false;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (partial) controller.error(error);
                else {
                  partial = true;
                  controller.enqueue(new TextEncoder().encode("["));
                }
              },
            }),
          );
        }
      }
      return originalFetch(
        new URL(url.pathname + url.search, server.url),
        init,
      );
    }) as typeof fetch;
    try {
      const result = loadPublishedPoints(false, async (milliseconds) => {
        waits.push(milliseconds);
      });
      if (scenario === "persistent-reset" || scenario === "other-error")
        await expect(result).rejects.toThrow("socket connection closed");
      else if (scenario === "reset-then-corrupt")
        await expect(result).rejects.toThrow("Points shard checksum mismatch");
      else expect(await result).toEqual(journal);
      const count =
        scenario === "other-error"
          ? 1
          : scenario === "shard-reset" || scenario === "persistent-reset"
            ? 3
            : 2;
      expect(attempts).toEqual(Array(count).fill(target));
      expect(waits).toEqual(Array(count - 1).fill(1000));
      expect(indexReads).toBe(scenario === "reset-then-corrupt" ? 2 : 1);
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
    }
  });
}

test("a refused Points projection waits for its outstanding shard retry", async () => {
  const { shards, index } = projection();
  const pendingShardStarted = Promise.withResolvers<void>();
  const releasePendingShard = Promise.withResolvers<void>();
  const pendingShardRetried = Promise.withResolvers<void>();
  const events: string[] = [];
  let pendingShardAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.origin !== "https://staging.slop.cash")
      throw new Error("Unexpected external request");
    if (url.pathname === "/api/v1/points/journal")
      return Response.json({ error: "points_not_published" }, { status: 503 });
    if (url.pathname === "/data/points.json") return Response.json(index);
    if (url.pathname === "/data/points/0.json")
      return new Response(null, { status: 404 });
    if (url.pathname === "/data/points/1.json") {
      pendingShardAttempts++;
      if (pendingShardAttempts === 1) {
        pendingShardStarted.resolve();
        await releasePendingShard.promise;
        throw Object.assign(new Error("socket connection closed"), {
          code: "ECONNRESET",
        });
      }
      events.push("outstanding shard retried");
      pendingShardRetried.resolve();
    }
    const shard = shards.find((part) => part.path === url.pathname);
    return shard
      ? new Response(shard.text)
      : new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    const result = loadPublishedPoints(
      false,
      async () => {},
      "https://staging.slop.cash",
    ).catch((error: unknown) => {
      events.push("read refused");
      return error;
    });
    await pendingShardStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releasePendingShard.resolve();
    await pendingShardRetried.promise;
    expect(await result).toEqual(
      new Error("Published points history unavailable"),
    );
    expect(events).toEqual(["outstanding shard retried", "read refused"]);
  } finally {
    releasePendingShard.resolve();
    globalThis.fetch = originalFetch;
  }
});

for (const failure of ["transient", "persistent", "different-error"] as const) {
  test(`published Points history ${failure} refusal preserves history`, async () => {
    const { journal, shards, index } = projection();
    const requests: string[] = [];
    const waits: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/points/journal") {
          requests.push(url.pathname + url.search);
          if (failure !== "transient" || requests.length < 3)
            return Response.json(
              {
                error:
                  failure === "different-error"
                    ? "points_not_published"
                    : "points_unavailable",
              },
              { status: 503 },
            );
          return Response.json({
            ...journal,
            batch: digest(JSON.stringify(journal)),
            total: journal.revisions.length,
            next: null,
          });
        }
        if (url.pathname === "/data/points.json") return Response.json(index);
        const shard = shards.find((entry) => entry.path === url.pathname);
        return shard
          ? new Response(shard.text)
          : new Response(null, { status: 404 });
      },
    });
    const originalFetch = globalThis.fetch;
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
      const result = loadPublishedPoints(false, async (milliseconds) => {
        waits.push(milliseconds);
      });
      if (failure === "transient") expect(await result).toEqual(journal);
      else
        await expect(result).rejects.toThrow(
          "Points history returned 503; refusing to discard history",
        );
      expect(requests).toEqual(
        Array(failure === "different-error" ? 1 : 3).fill(
          "/api/v1/points/journal?after=0",
        ),
      );
      expect(waits).toEqual(
        failure === "different-error" ? [] : [15000, 15000],
      );
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
    }
  });
}

for (const scenario of [
  "pages-only",
  "checkpoint",
  "corrupt-shard",
  "missing-shard",
  "missing-index",
  "bootstrap",
  "unavailable",
  "production-unpublished",
] as const) {
  test(`environment-local Points history: ${scenario}`, async () => {
    const { journal, shards, index } = projection();
    const requested: URL[] = [];
    const origin =
      scenario === "production-unpublished"
        ? "https://slop.cash"
        : "https://staging.slop.cash";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/v1/points/journal") {
          if (scenario === "checkpoint")
            return Response.json({
              ...journal,
              batch: digest(JSON.stringify(journal)),
              total: journal.revisions.length,
              next: null,
            });
          return Response.json(
            {
              error:
                scenario === "unavailable"
                  ? "points_unavailable"
                  : "points_not_published",
            },
            { status: 503 },
          );
        }
        if (url.pathname === "/data/points.json") {
          if (scenario === "bootstrap" || scenario === "missing-index")
            return new Response(null, { status: 404 });
          return Response.json(index);
        }
        const shard = shards.find((part) => part.path === url.pathname);
        if (scenario === "missing-shard" && shard === shards[0])
          return new Response(null, { status: 404 });
        return shard
          ? new Response(shard.text + (scenario === "corrupt-shard" ? " " : ""))
          : new Response(null, { status: 404 });
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input, init) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.origin !== origin)
        throw new Error("Cross-environment Points read");
      return originalFetch(
        new URL(url.pathname + url.search, server.url),
        init,
      );
    }) as typeof fetch;
    try {
      const result = loadPublishedPoints(
        scenario === "bootstrap" || scenario === "production-unpublished",
        async () => {},
        origin,
      );
      if (scenario === "pages-only" || scenario === "checkpoint")
        expect(await result).toEqual(journal);
      else if (scenario === "bootstrap") expect(await result).toBeNull();
      else await expect(result).rejects.toThrow();
      expect(requested.every((url) => url.origin === origin)).toBe(true);
      if (scenario === "unavailable") {
        expect(requested).toHaveLength(3);
        expect(
          requested.every((url) => url.pathname === "/api/v1/points/journal"),
        ).toBe(true);
      }
      if (scenario === "production-unpublished")
        expect(requested).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
    }
  });
}
