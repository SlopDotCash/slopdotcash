/** One due job whose queue send fails must not stop the rest of the drain:
 * the remaining holds and appeals are still queued and checkpointed, the
 * failure is reported after the loop, and the failed job keeps its old
 * queued_at so a later run selects it again (PRD section 5).
 */
import { expect, test } from "bun:test";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { dispatchDueAppeals } from "./appeals";
import type { Job } from "./contracts";
import { dispatchMaintainerHolds } from "./maintainer-holds";

const OPENED = "2026-10-01T00:00:00.000Z";

function keyOf(job: Job): string {
  return job.kind === "appeal_due"
    ? job.appealKey
    : job.kind === "maintainer_hold"
      ? job.reviewKey
      : "";
}

function fakeQueue(failing: { key: string | null }) {
  const sent: string[] = [];
  return {
    sent,
    queue: {
      async send(job: Job): Promise<void> {
        if (keyOf(job) === failing.key)
          throw new Error("queue send unavailable");
        sent.push(keyOf(job));
      },
    },
  };
}

function seedAppeal(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  key: string,
  dueAt: string,
) {
  const job = {
    kind: "appeal_due",
    appealKey: key,
    deliveryId: `appeal-due:${key}`,
    installationId: 1,
    repositoryId: 99,
    owner: "octo",
    repo: "demo",
    itemKind: "pull_request",
    number: 7,
  };
  sqlite.run(
    "INSERT INTO slopbot_appeals(appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at) VALUES (?,?,?,?,?,?,?)",
    [key, 99, `PR_${key}`, "42", JSON.stringify(job), OPENED, dueAt],
  );
}

async function queuedAt(
  db: ReturnType<typeof sqliteD1>["db"],
  table: "slopbot_appeals" | "slopbot_maintainer_holds",
  keyColumn: "appeal_key" | "review_key",
  key: string,
) {
  const row = await db
    .prepare(`SELECT queued_at FROM ${table} WHERE ${keyColumn}=?`)
    .bind(key)
    .first<{ queued_at: string | null }>();
  return row?.queued_at ?? null;
}

test("a failed appeal send does not stop the other due appeals", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  seedAppeal(sqlite, "appeal:1", "2026-10-08T00:00:00.000Z");
  seedAppeal(sqlite, "appeal:2", "2026-10-09T00:00:00.000Z");
  seedAppeal(sqlite, "appeal:3", "2026-10-10T00:00:00.000Z");
  const failing = { key: "appeal:1" as string | null };
  const { sent, queue } = fakeQueue(failing);

  const failure = await dispatchDueAppeals(db, queue).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBeInstanceOf(Error);
  expect(((failure as AggregateError).errors[0] as Error).message).toBe(
    "queue send unavailable",
  );
  // The two later appeals were still queued and checkpointed.
  expect(sent).toEqual(["appeal:2", "appeal:3"]);
  expect(
    await queuedAt(db, "slopbot_appeals", "appeal_key", "appeal:1"),
  ).toBeNull();
  expect(
    await queuedAt(db, "slopbot_appeals", "appeal_key", "appeal:2"),
  ).not.toBeNull();
  expect(
    await queuedAt(db, "slopbot_appeals", "appeal_key", "appeal:3"),
  ).not.toBeNull();

  // The next run selects only the failed appeal: the others were
  // checkpointed within the requeue window.
  failing.key = null;
  await dispatchDueAppeals(db, queue);
  expect(sent).toEqual(["appeal:2", "appeal:3", "appeal:1"]);
  expect(
    await queuedAt(db, "slopbot_appeals", "appeal_key", "appeal:1"),
  ).not.toBeNull();
});

test("a failed hold send does not stop the other due holds", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const seedHold = (key: string, dueAt: string) => {
    sqlite.run(
      "INSERT INTO slopbot_reviews(review_key,installation_id,repository_id,item_kind,item_number,item_node_id,author_id,revision,content_digest,policy_digest,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        key,
        1,
        99,
        "pull_request",
        7,
        `PR_${key}`,
        42,
        "rev-1",
        "digest",
        "policy",
        "completed",
        OPENED,
      ],
    );
    const job = {
      kind: "maintainer_hold",
      reviewKey: key,
      deliveryId: `hold:${key}`,
      installationId: 1,
      repositoryId: 99,
      owner: "octo",
      repo: "demo",
      itemKind: "pull_request",
      number: 7,
    };
    sqlite.run(
      "INSERT INTO slopbot_maintainer_holds(review_key,job_json,item_node_id,revision,category,held_at,due_at) VALUES (?,?,?,?,?,?,?)",
      [
        key,
        JSON.stringify(job),
        `PR_${key}`,
        "rev-1",
        "busywork",
        OPENED,
        dueAt,
      ],
    );
  };
  seedHold("hold:1", "2026-10-08T00:00:00.000Z");
  seedHold("hold:2", "2026-10-09T00:00:00.000Z");
  const failing = { key: "hold:1" as string | null };
  const { sent, queue } = fakeQueue(failing);

  const failure = await dispatchMaintainerHolds(db, queue).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AggregateError);
  expect(((failure as AggregateError).errors[0] as Error).message).toBe(
    "queue send unavailable",
  );
  expect(sent).toEqual(["hold:2"]);
  expect(
    await queuedAt(db, "slopbot_maintainer_holds", "review_key", "hold:1"),
  ).toBeNull();
  expect(
    await queuedAt(db, "slopbot_maintainer_holds", "review_key", "hold:2"),
  ).not.toBeNull();
});
