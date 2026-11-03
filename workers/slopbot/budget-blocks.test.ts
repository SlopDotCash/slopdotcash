/** One due budget block whose queue send fails must not stop the rest of
 * the resume: the later blocks are still queued and checkpointed, the
 * failure is reported after the loop, and the failed block keeps no
 * dispatch record so a later run selects it again (PRD section 5).
 *
 * Blocks are seeded through the production claim machinery — startReview
 * claims the review and recordBudgetBlock records the block — because
 * migration 0048 binds every block to a live review claim.
 */
import { expect, test } from "bun:test";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { recordBudgetBlock, resumeBudgetBlocks } from "./budget-blocks";
import type { Job } from "./contracts";
import { startReview } from "./persistence";

type ReviewJob = Extract<Job, { kind: "review" }>;

function reviewJob(number: number): ReviewJob {
  return {
    kind: "review",
    deliveryId: `delivery:${number}`,
    installationId: 1,
    repositoryId: 99,
    owner: "octo",
    repo: "demo",
    itemKind: "pull_request",
    number,
  };
}

function seedInstallation(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,'octo','Organization','2026-10-01T00:00:00.000Z')",
  );
}

async function seedBlockedReview(
  db: ReturnType<typeof sqliteD1>["db"],
  number: number,
  retryAt: string,
) {
  const reviewKey = `review:${number}`;
  const token = `token-${number}`;
  const started = await startReview(
    db,
    {
      reviewKey,
      installationId: 1,
      repositoryId: 99,
      itemKind: "pull_request",
      itemNumber: number,
      itemNodeId: `PR_${number}`,
      authorId: 42,
      revision: `rev-${number}`,
      contentDigest: `digest-${number}`,
      policyDigest: "policy",
    },
    token,
  );
  expect(started).toBe("new");
  await recordBudgetBlock(db, { reviewKey, token }, reviewJob(number), retryAt);
  // The migration 0048 finish trigger flips the claimed review to the
  // blocked failure state; without it the block would not be seeded.
  const review = await db
    .prepare(
      "SELECT status, skip_reason FROM slopbot_reviews WHERE review_key=?",
    )
    .bind(reviewKey)
    .first<{ status: string; skip_reason: string | null }>();
  expect(review?.status).toBe("failed");
  expect(review?.skip_reason).toBe("blocked: provider budget exhausted");
}

async function dispatchedNumbers(
  db: ReturnType<typeof sqliteD1>["db"],
): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT json_extract(b.job_json,'$.number') AS number
       FROM slopbot_budget_dispatches d
       JOIN slopbot_budget_blocks b ON b.id=d.block_id
       ORDER BY d.block_id`,
    )
    .all<{ number: number }>();
  return rows.results.map((row) => row.number);
}

function fakeQueue(failing: { number: number | null }) {
  const sent: number[] = [];
  return {
    sent,
    queue: {
      async send(job: Job): Promise<void> {
        if (job.kind !== "review") return;
        if (job.number === failing.number)
          throw new Error("queue send unavailable");
        sent.push(job.number);
      },
    },
  };
}

test("a failed budget block send does not stop the other due blocks", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  seedInstallation(sqlite);
  await seedBlockedReview(db, 11, "2026-11-01T00:00:00.000Z");
  await seedBlockedReview(db, 12, "2026-11-01T01:00:00.000Z");
  await seedBlockedReview(db, 13, "2026-11-01T02:00:00.000Z");
  const failing = { number: 11 as number | null };
  const { sent, queue } = fakeQueue(failing);

  const failure = await resumeBudgetBlocks(db, queue).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBeInstanceOf(Error);
  expect(((failure as AggregateError).errors[0] as Error).message).toBe(
    "queue send unavailable",
  );
  // The two later blocks were still queued and checkpointed.
  expect(sent).toEqual([12, 13]);
  expect(await dispatchedNumbers(db)).toEqual([12, 13]);

  // The next run selects only the failed block: it kept no dispatch
  // record, while the resumed blocks are not selected again.
  failing.number = null;
  const resumed = await resumeBudgetBlocks(db, queue);
  expect(resumed).toBe(1);
  expect(sent).toEqual([12, 13, 11]);
  expect(await dispatchedNumbers(db)).toEqual([11, 12, 13]);
});

test("a healthy run resumes every due block and reports the count", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  seedInstallation(sqlite);
  await seedBlockedReview(db, 21, "2026-11-01T00:00:00.000Z");
  await seedBlockedReview(db, 22, "2026-11-01T01:00:00.000Z");
  const failing = { number: null as number | null };
  const { sent, queue } = fakeQueue(failing);

  const resumed = await resumeBudgetBlocks(db, queue);
  expect(resumed).toBe(2);
  expect(sent).toEqual([21, 22]);
  expect(await dispatchedNumbers(db)).toEqual([21, 22]);

  // Nothing is due twice: a second run finds no undispatched blocks.
  expect(await resumeBudgetBlocks(db, queue)).toBe(0);
  expect(sent).toEqual([21, 22]);
});
