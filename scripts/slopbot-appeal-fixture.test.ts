import { expect, test } from "bun:test";
import {
  appealSeedSql,
  runAppealFixtureSql,
} from "../tests/slopbot-appeal-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";

const KEY = "appeal:fixture's-retry";
const AT = "2026-11-13T12:00:00.000Z";
const busy = () =>
  Object.assign(new Error("fixture command failed"), {
    status: 1,
    stderr: Buffer.from(
      "e = workerd/util/sqlite.c++:867: failed: SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY\n",
    ),
  });

for (const partial of [true, false])
  test(`appeal seed replays once after ${partial ? "only the appeal" : "both rows"} committed`, async () => {
    const { sqlite } = sqliteD1();
    const waits: number[] = [];
    let attempts = 0;
    try {
      await runAppealFixtureSql("/disposable-fixture", appealSeedSql(KEY, AT), {
        execute: (args) => {
          expect(args.slice(1, 5)).toEqual([
            "d1",
            "execute",
            "slop-private",
            "--local",
          ]);
          expect(args).not.toContain("--remote");
          const sql = args[args.length - 1];
          attempts++;
          if (attempts === 1) {
            sqlite.exec(partial ? sql.slice(0, sql.indexOf(";") + 1) : sql);
            throw busy();
          }
          sqlite.exec(sql);
        },
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      });
      expect(attempts).toBe(2);
      expect(waits).toEqual([100]);
      expect(
        sqlite.query("SELECT appeal_key, opened_at FROM slopbot_appeals").all(),
      ).toEqual([{ appeal_key: KEY, opened_at: AT }]);
      expect(
        sqlite
          .query("SELECT event_key, recipient_github_id FROM notifications")
          .all(),
      ).toEqual([
        { event_key: `slopbot-${KEY}`, recipient_github_id: "900000004" },
      ]);
    } finally {
      sqlite.close();
    }
  });

test("local SQLite lock retry stops after four attempts", async () => {
  let attempts = 0;
  const waits: number[] = [];
  await expect(
    runAppealFixtureSql("/disposable-fixture", "SELECT 1", {
      execute: () => {
        attempts++;
        throw busy();
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
  ).rejects.toThrow("stayed locked after four attempts");
  expect(attempts).toBe(4);
  expect(waits).toEqual([100, 200, 400]);
});

test("a non-lock SQL failure propagates without retry", async () => {
  const failure = Object.assign(new Error("invalid fixture SQL"), {
    status: 1,
    stderr: Buffer.from("[ERROR] UNIQUE constraint failed\n"),
  });
  let attempts = 0;
  let waits = 0;
  await expect(
    runAppealFixtureSql("/disposable-fixture", "SELECT 1", {
      execute: () => {
        attempts++;
        throw failure;
      },
      wait: async () => {
        waits++;
      },
    }),
  ).rejects.toBe(failure);
  expect(attempts).toBe(1);
  expect(waits).toBe(0);
});

test("busy text outside the exact stderr diagnostic does not retry", async () => {
  const failure = Object.assign(new Error("database is locked: SQLITE_BUSY"), {
    status: 1,
    stderr: Buffer.from(
      "[ERROR] another failure while reading a quoted SQLITE_BUSY value\n",
    ),
  });
  let attempts = 0;
  await expect(
    runAppealFixtureSql("/disposable-fixture", "SELECT 1", {
      execute: () => {
        attempts++;
        throw failure;
      },
      wait: async () => {
        throw new Error("Unexpected retry");
      },
    }),
  ).rejects.toBe(failure);
  expect(attempts).toBe(1);
});
