import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { handlePointsApi } from "../backend/points/handler";
import type { D1Database } from "../backend/trace/cloudflare-persistence";
import type { PointsJournal } from "../src/lib/points";
import { pointsSql } from "./generate-points";

test("journal reads select the complete prefix before generation-time tie breakers", async () => {
  const checkpoint = JSON.parse(
    readFileSync("data/points/history.json", "utf8"),
  ) as PointsJournal;
  for (const offset of [0, 1000]) {
    const db = new Database(":memory:");
    for (const file of readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort())
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    const apply = (journal: PointsJournal) => {
      db.transaction(() => {
        for (const sql of pointsSql(journal).trim().split("\n")) db.exec(sql);
      })();
    };
    const adapter = {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        let args: (string | number)[] = [];
        return {
          bind(...values: (string | number)[]) {
            args = values;
            return this;
          },
          async first() {
            return statement.get(...args);
          },
        };
      },
    } as unknown as D1Database;
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
    const read = (search = "") =>
      fetch(new URL(`/api/v1/points/journal${search}`, server.url));
    try {
      const old = {
        ...checkpoint,
        generatedAt: new Date(
          Date.parse(checkpoint.generatedAt) + offset,
        ).toISOString(),
        revisions: checkpoint.revisions.slice(0, 2),
      };
      const next = {
        ...checkpoint,
        revisions: checkpoint.revisions.slice(0, 3),
      };
      apply(old);
      const before = await (await read()).json();
      apply(next);
      const response = await read();
      const page = await response.json();
      expect(response.status).toBe(200);
      expect(page.total).toBe(3);
      expect(page.revisions).toEqual(next.revisions);
      expect(page.batch).toBe(
        createHash("sha256").update(JSON.stringify(next)).digest("hex"),
      );
      expect((await read(`?batch=${before.batch}&after=1`)).status).toBe(409);
      const refresh = {
        ...next,
        generatedAt: new Date(
          Date.parse(checkpoint.generatedAt) + 2000,
        ).toISOString(),
      };
      apply(refresh);
      expect((await (await read()).json()).generatedAt).toBe(
        refresh.generatedAt,
      );
    } finally {
      server.stop(true);
      db.close();
    }
  }
});
