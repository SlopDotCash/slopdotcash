/** #1411 B12: a blocked value outcome backs off instead of retrying at a flat
 * hour forever. The outcome stays retryable — this change bounds the cadence and
 * records a per-delivery attempt count; it does not make a delivery terminal,
 * and a transient `retry` keeps its one-hour cadence (PRD section 5).
 */
import { expect, test } from "bun:test";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { recordDelivery } from "./persistence";
import {
  claimValueRequest,
  finishValueRequest,
  nextValueRetryAt,
  resumeParkedValueRequests,
} from "./value-processing";

const HOUR = 60 * 60 * 1000;
const received = "2026-10-27T00:00:00.000Z";
const job = {
  deliveryId: "backoff-delivery",
  installationId: 1,
  repositoryId: 424242,
  owner: "backoff",
  repo: "queue",
  number: 7,
};
/** A second delivery of the same PR, settled by the same outcome. */
const sibling = { ...job, deliveryId: "backoff-sibling" };

type Queue = ReturnType<typeof sqliteD1>;
interface ProcessingRow {
  attempts: number;
  state: string;
  outcome: string | null;
  retry_at: string | null;
}

const database = () => sqliteD1(MIGRATIONS);

const row = (queue: Queue, deliveryId: string) =>
  queue.db
    .prepare(
      "SELECT attempts,state,outcome,retry_at FROM slopbot_value_processing WHERE delivery_id=?",
    )
    .bind(deliveryId)
    .first<ProcessingRow>();

async function seed(queue: Queue, jobs = [job]) {
  // The subject here is retry scheduling, not intake authority: the delivery
  // rows are the ones the consumer would have recorded, and the request rows
  // are written directly so these cases do not need a registered project.
  for (const entry of jobs) {
    await recordDelivery(queue.db, entry.deliveryId, "pull_request");
    queue.sqlite.run(
      "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES (?,?,?,?,?,?,?)",
      [
        entry.deliveryId,
        entry.installationId,
        entry.repositoryId,
        entry.owner,
        entry.repo,
        entry.number,
        received,
      ],
    );
  }
}

test("a blocked outcome backs off per attempt and records the count", async () => {
  const queue = database();
  await seed(queue);
  let at = new Date("2026-10-28T00:00:00.000Z");
  const expected = [
    HOUR,
    2 * HOUR,
    4 * HOUR,
    8 * HOUR,
    16 * HOUR,
    24 * HOUR,
    24 * HOUR,
  ];
  for (const [index, delay] of expected.entries()) {
    const claim = await claimValueRequest(queue.db, job.deliveryId, at);
    if (!claim) throw new Error("claim was refused before its retry time");
    const retryAt = await nextValueRetryAt(
      queue.db,
      job.deliveryId,
      "source-incomplete",
      at,
    );
    expect(retryAt.getTime() - at.getTime()).toBe(delay);
    await finishValueRequest(queue.db, claim, "source-incomplete", retryAt, at);
    const current = await row(queue, job.deliveryId);
    expect(current?.state).toBe("waiting");
    expect(current?.outcome).toBe("source-incomplete");
    expect(current?.attempts).toBe(index + 1);
    expect(current?.retry_at).toBe(retryAt.toISOString());
    at = retryAt;
  }
});

test("a transient failure keeps the one-hour cadence", async () => {
  const queue = database();
  await seed(queue);
  let at = new Date("2026-10-28T00:00:00.000Z");
  // Two blocked attempts first, so a backed-off delivery would wait 4 hours.
  for (const _ of [0, 1]) {
    const claim = await claimValueRequest(queue.db, job.deliveryId, at);
    if (!claim) throw new Error("claim was refused");
    const retryAt = await nextValueRetryAt(
      queue.db,
      job.deliveryId,
      "authority",
      at,
    );
    await finishValueRequest(queue.db, claim, "authority", retryAt, at);
    at = retryAt;
  }
  expect((await row(queue, job.deliveryId))?.attempts).toBe(2);
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  const retryAt = await nextValueRetryAt(queue.db, job.deliveryId, "retry", at);
  expect(retryAt.getTime() - at.getTime()).toBe(HOUR);
  await finishValueRequest(queue.db, claim, "retry", retryAt, at);
  const current = await row(queue, job.deliveryId);
  expect(current?.outcome).toBe("retry");
  expect(current?.retry_at).toBe(retryAt.toISOString());
  // A transient failure must not advance the count, or an outage would push a
  // later block to the cap on its own.
  expect(current?.attempts).toBe(2);
  // ...and the next block resumes the ladder from that count: attempt 3 of the
  // sequence, four hours, not the day cap.
  at = retryAt;
  const nextClaim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!nextClaim) throw new Error("claim was refused");
  const nextRetryAt = await nextValueRetryAt(
    queue.db,
    job.deliveryId,
    "authority",
    at,
  );
  expect(nextRetryAt.getTime() - at.getTime()).toBe(4 * HOUR);
});

test("a large blocked count still resolves to the day cap", async () => {
  const queue = database();
  await seed(queue);
  const at = new Date("2026-10-28T00:00:00.000Z");
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  // 64 blocked attempts: the doubling runs far past a day and only the cap keeps
  // the delay finite, so this pins the cap against a rewrite that drops it.
  queue.sqlite.run(
    "UPDATE slopbot_value_processing SET state='waiting',attempts=64,retry_at=? WHERE delivery_id=?",
    [new Date(at.getTime() - 1000).toISOString(), job.deliveryId],
  );
  const nextClaim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!nextClaim) throw new Error("claim was refused");
  const retryAt = await nextValueRetryAt(
    queue.db,
    job.deliveryId,
    "source-incomplete",
    at,
  );
  expect(retryAt.getTime() - at.getTime()).toBe(24 * HOUR);
  await finishValueRequest(
    queue.db,
    nextClaim,
    "source-incomplete",
    retryAt,
    at,
  );
  expect((await row(queue, job.deliveryId))?.attempts).toBe(65);
});

test("a re-claim before the retry time is refused, and allowed at it", async () => {
  const queue = database();
  await seed(queue);
  const at = new Date("2026-10-28T00:00:00.000Z");
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  const retryAt = await nextValueRetryAt(
    queue.db,
    job.deliveryId,
    "authority",
    at,
  );
  await finishValueRequest(queue.db, claim, "authority", retryAt, at);
  expect(
    await claimValueRequest(
      queue.db,
      job.deliveryId,
      new Date(retryAt.getTime() - 1),
    ),
  ).toBeNull();
  expect(
    await claimValueRequest(queue.db, job.deliveryId, retryAt),
  ).not.toBeNull();
});

test("a terminal finish keeps the count it reached and clears the retry time", async () => {
  const queue = database();
  await seed(queue);
  let at = new Date("2026-10-28T00:00:00.000Z");
  for (const _ of [0, 1]) {
    const claim = await claimValueRequest(queue.db, job.deliveryId, at);
    if (!claim) throw new Error("claim was refused");
    const retryAt = await nextValueRetryAt(
      queue.db,
      job.deliveryId,
      "source-incomplete",
      at,
    );
    await finishValueRequest(queue.db, claim, "source-incomplete", retryAt, at);
    at = retryAt;
  }
  expect((await row(queue, job.deliveryId))?.attempts).toBe(2);
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  await finishValueRequest(queue.db, claim, "published", null, at);
  const current = await row(queue, job.deliveryId);
  expect(current?.state).toBe("completed");
  expect(current?.outcome).toBe("published");
  expect(current?.retry_at).toBeNull();
  expect(current?.attempts).toBe(2);
  expect(
    await claimValueRequest(
      queue.db,
      job.deliveryId,
      new Date(at.getTime() + HOUR),
    ),
  ).toBeNull();
});

test("a settled sibling delivery is not credited with the claimed delivery's attempts", async () => {
  const queue = database();
  await seed(queue, [job, sibling]);
  const at = new Date("2026-10-28T00:00:00.000Z");
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  const retryAt = await nextValueRetryAt(
    queue.db,
    job.deliveryId,
    "source-incomplete",
    at,
  );
  await finishValueRequest(queue.db, claim, "source-incomplete", retryAt, at);
  expect((await row(queue, job.deliveryId))?.attempts).toBe(1);
  const settled = await row(queue, sibling.deliveryId);
  expect(settled?.state).toBe("waiting");
  expect(settled?.outcome).toBe("source-incomplete");
  expect(settled?.attempts).toBe(0);
});

// A paused or retired project parks its requests: no retry time and no hourly
// claim, until the live registry shows the repository active again.
test("a parked request is never claimed until its project is active again", async () => {
  const queue = database();
  await seed(queue, [job, sibling]);
  const at = new Date("2026-10-28T00:00:00.000Z");
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  await expect(
    finishValueRequest(
      queue.db,
      claim,
      "parked",
      new Date(at.getTime() + HOUR),
      at,
    ),
  ).rejects.toThrow("retry time does not match");
  await finishValueRequest(queue.db, claim, "parked", null, at);
  for (const deliveryId of [job.deliveryId, sibling.deliveryId])
    expect(await row(queue, deliveryId)).toEqual({
      attempts: 0,
      state: "waiting",
      outcome: "parked",
      retry_at: null,
    });
  // A year of schedules claims nothing while the project stays paused.
  const later = new Date(at.getTime() + 365 * 24 * HOUR);
  const checked: unknown[] = [];
  expect(
    await resumeParkedValueRequests(
      queue.db,
      async (repository) => {
        checked.push(repository);
        return false;
      },
      later,
    ),
  ).toBe(0);
  expect(checked).toEqual([
    { owner: job.owner, repo: job.repo, repositoryId: job.repositoryId },
  ]);
  expect(await claimValueRequest(queue.db, job.deliveryId, later)).toBeNull();
  // Reactivation gives every parked delivery of the repository a retry time.
  expect(
    await resumeParkedValueRequests(queue.db, async () => true, later),
  ).toBe(2);
  expect((await row(queue, job.deliveryId))?.retry_at).toBe(
    later.toISOString(),
  );
  // A resumed row is not selected again by the next sweep.
  expect(
    await resumeParkedValueRequests(queue.db, async () => true, later),
  ).toBe(0);
  expect(
    await claimValueRequest(queue.db, job.deliveryId, later),
  ).not.toBeNull();
});

test("a missing pull request is a terminal, recorded outcome", async () => {
  const queue = database();
  await seed(queue);
  const at = new Date("2026-10-28T00:00:00.000Z");
  const claim = await claimValueRequest(queue.db, job.deliveryId, at);
  if (!claim) throw new Error("claim was refused");
  await finishValueRequest(queue.db, claim, "missing", null, at);
  expect(await row(queue, job.deliveryId)).toEqual({
    attempts: 0,
    state: "completed",
    outcome: "missing",
    retry_at: null,
  });
  expect(
    await claimValueRequest(
      queue.db,
      job.deliveryId,
      new Date(at.getTime() + 365 * 24 * HOUR),
    ),
  ).toBeNull();
});

test("the parked sweep rotates so every parked repository is rechecked", async () => {
  const queue = database();
  const jobs = Array.from({ length: 25 }, (_, i) => ({
    ...job,
    deliveryId: `parked-${i}`,
    repositoryId: 1000 + i,
    repo: `queue-${i}`,
  }));
  await seed(queue, jobs);
  const at = new Date("2026-10-28T00:00:00.000Z");
  for (const entry of jobs) {
    const claim = await claimValueRequest(queue.db, entry.deliveryId, at);
    if (!claim) throw new Error("claim was refused");
    await finishValueRequest(queue.db, claim, "parked", null, at);
  }
  const sweep = async (minute: number, active = new Set<number>()) => {
    const checked: number[] = [];
    const resumed = await resumeParkedValueRequests(
      queue.db,
      async ({ repositoryId }) => {
        checked.push(repositoryId);
        return active.has(repositoryId);
      },
      new Date(at.getTime() + minute * 60_000),
    );
    return { checked, resumed };
  };
  const first = await sweep(5);
  expect(first.checked).toHaveLength(20);
  // The second run starts with the five repositories past the first cutoff.
  const second = await sweep(10, new Set([1024]));
  expect(second.checked.slice(0, 5).sort()).toEqual([
    1020, 1021, 1022, 1023, 1024,
  ]);
  expect(second.resumed).toBe(1);
  expect(new Set([...first.checked, ...second.checked]).size).toBe(25);
  // The third run continues with the least recently checked repositories:
  // the five from the first run that the second did not reach.
  const third = await sweep(15);
  expect(third.checked.slice(0, 5)).toEqual(first.checked.slice(15, 20));
  expect(third.checked).not.toContain(1024);
});
