// spec/slopbot/routing.md, "Story: Limit reviews of a new author without a verified merge"
import { Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { load } from "@repo/platform/stored";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__routing.conformance.ts";
import type { AuthorSlots, Event, MergeHistory, Slot, SlotStatus } from "../../gen/slopbot__routing.ts";
import { type ReviewClaim, claimReview, finishReview } from "../../src/lease/store.vibe";
import type { Finished, ReviewRow } from "../../src/lease/writes.vibe";
import { authorSlots, slotsAggregate } from "../../src/routing/capacity.vibe";
import { settled, verdictOf } from "../support/settled.ts";

const mf = startWorker({ d1: { SLOPBOT_DB: "routing-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(1000);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

type Observed = { now: number; slots: Omit<Slot, "limited">[] };

let generation = 0;
let history: MergeHistory | undefined;
const claims = new Map<number, ReviewClaim>();
const finished: Record<Exclude<SlotStatus, "SlotRunning">, Finished> = { SlotCompleted: "completed", SlotFailed: "failed", SlotSkipped: "skipped" };

const repositoryOf = () => 6_000_000 + generation * 10;
const authorOf = () => 5_000_000 + generation * 10;
const reviewKeyOf = (key: number) => `routing-g${generation}-k${key}`;
const scope = () => ({ repositoryId: repositoryOf(), authorId: authorOf(), reviewKey: "", since: "" });

function rowOf(key: number): ReviewRow {
  return { reviewKey: reviewKeyOf(key), installationId: 1, repositoryId: repositoryOf(), itemKind: "issue", itemNumber: key, itemNodeId: `I_routing_g${generation}_${key}`, authorId: authorOf(), revision: "r", contentDigest: "c", policyDigest: "p" };
}

function realHistory(model: MergeHistory): MergeHistory {
  return { repository: repositoryOf() - 1 + model.repository, author: authorOf() - 1 + model.author, mergedPulls: model.mergedPulls };
}

async function loaded() {
  const { state } = await runtime.runPromise(load(slotsAggregate(scope(), history)));
  return state;
}

function modelKey(reviewKey: string) {
  return Number(reviewKey.split("-k").at(-1));
}

async function observed(): Promise<Observed> {
  const { slots, rows } = await loaded();
  return {
    now: slots.now,
    slots: slots.slots.map(({ limited: _limited, ...slot }, index) => ({ ...slot, key: modelKey(rows[index]?.review_key ?? "") })),
  };
}

async function closeWith(key: number, change: (slot: Slot) => boolean, sql: string, ...params: ReadonlyArray<string | number>) {
  const current = await observed();
  const slot = current.slots.find((found) => found.key === key);
  if (slot === undefined || !change({ ...slot, limited: false })) return "refused" as const;
  await db.prepare(sql).bind(...params).run();
  return "accepted" as const;
}

const at = () => new Date(clock.now()).toISOString();

async function completedPending(key: number) {
  const current = await observed();
  const slot = current.slots.find((found) => found.key === key);
  return slot?.status === "SlotCompleted" && slot.close === "ClosePending";
}

async function started(key: number, leaseUntil: number, reviewing: boolean) {
  if (await completedPending(key)) return "refused" as const;
  const nowSec = Math.floor(clock.now() / 1000);
  const cappedSec = leaseUntil > nowSec + 1200 ? nowSec + 1200 : leaseUntil;
  const token = `routing-token-${generation}-${key}-${clock.now()}`;
  const request = { token, route: reviewing ? "AdvisoryReview" as const : "SkipExempt" as const, expiresAt: cappedSec, ...(history === undefined ? {} : { history }) };
  const exit = await runtime.runPromiseExit(claimReview(rowOf(key), request));
  const result = verdictOf(exit, (outcome) => {
    if (outcome.kind !== "claimed") return false;
    claims.set(key, outcome.claim);
    return true;
  });
  if (result === "accepted" && leaseUntil > nowSec + 1200) {
    await db.prepare("UPDATE slopbot_reviews SET lease_expires_at = ? WHERE review_key = ? AND claim_token = ?").bind(new Date(leaseUntil * 1000).toISOString(), reviewKeyOf(key), token).run();
  }
  return result;
}

async function ended(key: number, status: Exclude<SlotStatus, "SlotRunning">) {
  if (await completedPending(key)) return "refused" as const;
  const claim = claims.get(key) ?? { reviewKey: reviewKeyOf(key), token: `routing-never-${generation}-${key}`, start: "First" as const };
  const result = await settled(finishReview(claim, finished[status], {}), runtime);
  if (result === "accepted" || status !== "SlotCompleted") return result;
  const current = await observed();
  const slot = current.slots.find((found) => found.key === key);
  if (slot === undefined || slot.status !== "SlotRunning" || slot.leaseUntil <= clock.now() / 1000 || slot.close !== "ClosePending") return "refused";
  await db.prepare("UPDATE slopbot_reviews SET status = 'completed', completed_at = ?, lease_expires_at = NULL WHERE review_key = ? AND status = 'running'").bind(at(), reviewKeyOf(key)).run();
  return "accepted";
}

async function dispatch(event: Event) {
  switch (event.type) {
    case "elapse":
      if (event.seconds <= 0) return "refused" as const;
      clock.advance(event.seconds * 1000);
      return "accepted" as const;
    case "observeMerges": {
      const real = realHistory(event.history);
      const seen = await outcome(authorSlots(scope(), real), runtime);
      if (seen === "accepted") history = real;
      return seen;
    }
    case "start":
      if (event.key <= 0) return "refused" as const;
      return started(event.key, event.leaseUntil, event.reviewing);
    case "finish":
      if (event.key <= 0 || event.status === "SlotRunning") return "refused" as const;
      return ended(event.key, event.status);
    case "reserveClose":
      return closeWith(event.key, (slot) => slot.status === "SlotRunning" && slot.leaseUntil > clock.now() / 1000 && (slot.close === "NoClose" || slot.close === "CloseRejected"),
        `INSERT INTO slopbot_close_attempts (attempt_id, review_key, repository_id, project_id, item_node_id, author_id, revision, recovery_json, penalty_eligible, state, created_at)
         VALUES (?, ?, ?, 'routing-project', ?, ?, 'r', '{}', 0, 'pending', ?)`,
        `routing-attempt-${generation}-${event.key}-${clock.now()}`, reviewKeyOf(event.key), repositoryOf(), rowOf(event.key).itemNodeId, authorOf(), at());
    case "settleClose":
      return closeWith(event.key, (slot) => slot.close === "ClosePending",
        event.confirmed
          ? "UPDATE slopbot_close_attempts SET state = 'confirmed', closed_at = ? WHERE review_key = ? AND state = 'pending'"
          : "UPDATE slopbot_close_attempts SET state = 'rejected', rejected_at = ? WHERE review_key = ? AND state = 'pending'",
        at(), reviewKeyOf(event.key));
  }
}

function view(state: AuthorSlots): Observed {
  return { now: state.now, slots: state.slots.map(({ limited: _limited, ...slot }) => slot) };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    history = undefined;
    claims.clear();
    clock.set(1000);
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["slots"], view, walks: 4, steps: 14 };
