import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PointsJournal } from "../src/lib/points";
import { loadPublishedPoints } from "./generate-points";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

for (const failure of ["transient", "persistent", "different-error"] as const) {
  test(`published Points history ${failure} refusal preserves history`, async () => {
    const journal: PointsJournal = JSON.parse(
      readFileSync("data/points/history.json", "utf8"),
    );
    journal.revisions = journal.revisions.slice(0, 3);
    const shards = Array.from({ length: 16 }, (_, i) => {
      const rows = journal.revisions
        .map((revision, sequence) => ({ sequence, revision }))
        .filter(({ revision }) =>
          revision.award.key.startsWith(i.toString(16)),
        );
      const text = `${JSON.stringify(rows)}\n`;
      return {
        text,
        path: `/data/points/${i.toString(16)}.json`,
        sha256: digest(text),
        count: rows.length,
      };
    });
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
        if (url.pathname === "/data/points.json")
          return Response.json({
            schemaVersion: "1",
            ruleVersion: journal.ruleVersion,
            generatedAt: journal.generatedAt,
            coverage: journal.coverage,
            revisionCount: journal.revisions.length,
            shards: shards.map(({ text: _text, ...metadata }) => metadata),
          });
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
