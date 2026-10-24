import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { D1TransactionalDatabase as D1Database } from "../backend/d1";
import { handlePointsApi } from "../backend/points/handler";
import type { PointsJournal } from "../src/lib/points";
import { pointsSql } from "./generate-points";

function startPointsApi() {
  const db = new Database(":memory:");
  for (const file of readdirSync("migrations")
    .filter((p) => p.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
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
  return { db, server };
}

test("journal reads select the complete prefix before generation-time tie breakers", async () => {
  const checkpoint = JSON.parse(
    readFileSync("data/points/history.json", "utf8"),
  ) as PointsJournal;
  for (const offset of [0, 1000]) {
    const { db, server } = startPointsApi();
    const apply = (journal: PointsJournal) => {
      db.transaction(() => {
        for (const sql of pointsSql(journal).trim().split("\n")) db.exec(sql);
      })();
    };
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

test("member lookups fail closed when a stale public login collides with a private member", async () => {
  const { db, server } = startPointsApi();
  const readMember = async (login: string) => {
    const response = await fetch(
      new URL(
        `/api/v1/points/member?login=${encodeURIComponent(login)}`,
        server.url,
      ),
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
      welcome: 0,
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
      welcome: 0,
      socialPoints: 0,
    });
  } finally {
    server.stop(true);
    db.close();
  }
});
