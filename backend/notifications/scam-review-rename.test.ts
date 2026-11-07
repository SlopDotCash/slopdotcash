// A scam review notice names the account a moderator must review. The row
// stores the login GitHub reported at closure time; the member record is the
// canonical current login (the points handler refreshes it at sign-in), so
// after the author renames the inbox names the current login, not the frozen
// one — the old login may belong to someone else by then.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { parseNotificationsResponse } from "../../src/lib/notifications";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { notifySlopbotScamReview } from "./events";
import { handleNotificationsApi } from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const T = "2026-10-19T10:00:00.000Z";
const R = "2026-10-19T10:30:00.000Z";
const AUTHOR = "900000006";
const MODERATOR = "900000005";

function open(withMember = true) {
  const { db, sqlite } = sqliteD1(migrations);
  sqlite
    .prepare(
      `INSERT INTO slopbot_penalties (item_node_id,repository_id,project_id,author_github_id,category,
        table_version,debit_thirds,period,moderator_review,review_key,recorded_at)
       VALUES ('PR_alpha',1,'alpha',?,'scam','slopbot-penalties-v1',24,'2026-10',1,'review-1',?)`,
    )
    .run(AUTHOR, T);
  if (withMember)
    sqlite
      .prepare(
        `INSERT INTO points_members (actor_id,github_id,login,joined_at,public)
         VALUES ('U_author',?,'old-name',?,1)`,
      )
      .run(AUTHOR, T);
  return { db, sqlite };
}

async function writeNotice(db: unknown) {
  await (db as D1Database).batch([
    notifySlopbotScamReview(db as D1Database, {
      itemNodeId: "PR_alpha",
      authorLogin: "old-name",
      owner: "example",
      repo: "alpha",
      itemKind: "pull_request",
      number: 7,
      recipient: MODERATOR,
      at: R,
    }),
  ]);
}

async function listAsModerator(db: unknown) {
  const response = (await handleNotificationsApi(
    new Request("https://slop.cash/api/v1/notifications"),
    {
      db: db as never,
      sessionActor: async () => ({ githubId: MODERATOR }),
      now: () => new Date(R),
      moderatorGithubIds: new Set([MODERATOR]),
    },
  )) as Response;
  expect(response.status).toBe(200);
  return parseNotificationsResponse(await response.json());
}

describe("scam review notice after author rename", () => {
  test("the notice names the author's current login, not the frozen one", async () => {
    const { db, sqlite } = open();
    await writeNotice(db);
    // The author renames on GitHub; the canonical member record learns the
    // new login at their next sign-in (points handler upsert).
    sqlite
      .prepare("UPDATE points_members SET login='new-name' WHERE github_id=?")
      .run(AUTHOR);
    const body = await listAsModerator(db);
    const notice = body.notifications.find(
      (n) => n.kind === "slopbot_scam_review",
    );
    expect(notice).toBeDefined();
    expect(notice?.detail).toBe(
      "Review the account of @new-name after a scam closure on example/alpha#7.",
    );
  });

  test("without a rename the notice text is unchanged", async () => {
    const { db } = open();
    await writeNotice(db);
    const body = await listAsModerator(db);
    const notice = body.notifications.find(
      (n) => n.kind === "slopbot_scam_review",
    );
    expect(notice?.detail).toBe(
      "Review the account of @old-name after a scam closure on example/alpha#7.",
    );
  });

  test("an author with no member record keeps the stored notice text", async () => {
    const { db } = open(false);
    await writeNotice(db);
    const body = await listAsModerator(db);
    const notice = body.notifications.find(
      (n) => n.kind === "slopbot_scam_review",
    );
    expect(notice?.detail).toBe(
      "Review the account of @old-name after a scam closure on example/alpha#7.",
    );
  });
});
