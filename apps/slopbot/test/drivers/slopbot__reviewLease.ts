// spec/slopbot/reviewLease.md, "Story: Claim a review and allow only its current owner to finish"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__reviewLease.conformance.ts";
import type { ClaimStatus, Event, PriorStart, ReviewLease } from "../../gen/slopbot__reviewLease.ts";
import type { AuthorSlots } from "../../gen/slopbot__routing.ts";
import { type ReviewClaim, assertCallClaim, claimReview, finishReview, leaseView } from "../../src/lease/store.vibe";
import type { Finished, ReviewRow } from "../../src/lease/writes.vibe";
import { recordCalls } from "../../src/route/calls.vibe";
import type { CallRecord } from "../../src/route/route.vibe";
import { settled } from "../support/settled.ts";

const mf = startWorker({ d1: { SLOPBOT_DB: "lease-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(0);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

type Observed = Pick<ReviewLease, "status" | "token" | "now" | "expires" | "callRecorded" | "close">;

const finished: Partial<Record<ClaimStatus, Finished>> = { Completed: "completed", Failed: "failed", Skipped: "skipped" };
const slotStatuses = { SlotRunning: "running", SlotCompleted: "completed", SlotFailed: "failed", SlotSkipped: "skipped" } as const;

let generation = 0;
let lastToken = 0;
const tokens = new Map<number, { readonly text: string; readonly start: PriorStart }>();

const repository = () => 6_500_000 + generation;
const author = () => 5_500_000 + generation;
const reviewKey = () => `lease-g${generation}`;
const at = () => new Date(clock.now()).toISOString();
const row = (): ReviewRow => ({ reviewKey: reviewKey(), installationId: 1, repositoryId: repository(), itemKind: "issue", itemNumber: 1, itemNodeId: `I_lease_g${generation}`, authorId: author(), revision: "r", contentDigest: "c", policyDigest: "p" });

const leaseCall: CallRecord = {
  routeStep: 1, gateway: "orbio", requestedModel: "anthropic/claude-sonnet-5.5", servedModel: null, priceKey: "orbio/anthropic/claude-sonnet-5.5",
  outcome: "ok", failure: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerCostMicroUsd: null, providerRequestId: null,
};

function handle(token: number): ReviewClaim {
  const held = tokens.get(token);
  return { reviewKey: reviewKey(), token: held?.text ?? `lease-never-${generation}-${token}`, start: held?.start ?? "First" };
}

async function seedSlots(slots: AuthorSlots) {
  await db.prepare("DELETE FROM slopbot_reviews WHERE review_key LIKE ?").bind(`${reviewKey()}-other-%`).run();
  for (const slot of slots.slots) {
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
    await db.prepare(`INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, created_at, completed_at, claim_token, lease_expires_at)
      VALUES (?, 1, ?, 'issue', ?, ?, ?, 'r', 'c', 'p', ?, ?, ?, ?, ?)`)
      .bind(`${reviewKey()}-other-${slot.key}`, repository(), 100 + slot.key, `I_lease_g${generation}_${slot.key}`, author(), slotStatuses[slot.status], at(),
        slot.status === "SlotCompleted" ? iso(slot.completedAt) : null, slot.status === "SlotRunning" ? `other-${slot.key}` : null, slot.status === "SlotRunning" ? iso(slot.leaseUntil) : null)
      .run();
  }
}

async function claimed(event: Extract<Event, { type: "claim" }>) {
  if (event.token <= 0 || event.token <= lastToken) return "refused" as const;
  await seedSlots(event.slots);
  const text = `lease-token-${generation}-${event.token}`;
  const history = event.slots.established ? { repository: repository(), author: author(), mergedPulls: [1] } : undefined;
  const result = await runtime.runPromise(claimReview(row(), { token: text, route: event.route, expiresAt: event.expires, ...(history === undefined ? {} : { history }) }).pipe(
    Effect.catchTag("ReviewBusy", () => Effect.succeed({ kind: "busy" as const })),
  ));
  if (result.kind !== "claimed") return "refused" as const;
  lastToken = event.token;
  tokens.set(event.token, { text, start: result.claim.start });
  return "accepted" as const;
}

async function closed(observed: Extract<Event, { type: "observeClose" }>["observed"]) {
  const { lease } = await runtime.runPromise(leaseView(reviewKey()));
  const reconciling = tokens.get(lastToken)?.start === "Reconcile";
  if (observed === "PendingClose" && lease.close !== "PendingClose" && lease.status === "Running" && !reconciling) {
    await db.prepare(`INSERT INTO slopbot_close_attempts (attempt_id, review_key, repository_id, project_id, item_node_id, author_id, revision, recovery_json, penalty_eligible, state, created_at)
      VALUES (?, ?, ?, 'lease-project', ?, ?, 'r', '{}', 0, 'pending', ?)`).bind(`lease-attempt-${generation}-${clock.now()}`, reviewKey(), repository(), row().itemNodeId, author(), at()).run();
    return "accepted" as const;
  }
  if (lease.close !== "PendingClose" || (observed !== "ConfirmedClose" && observed !== "RejectedClose")) return "refused" as const;
  await db.prepare(observed === "ConfirmedClose"
    ? "UPDATE slopbot_close_attempts SET state = 'confirmed', closed_at = ? WHERE review_key = ? AND state = 'pending'"
    : "UPDATE slopbot_close_attempts SET state = 'rejected', rejected_at = ? WHERE review_key = ? AND state = 'pending'").bind(at(), reviewKey()).run();
  return "accepted" as const;
}

async function dispatch(event: Event) {
  switch (event.type) {
    case "observeTime":
      if (event.time * 1000 < clock.now()) return "refused" as const;
      clock.set(event.time * 1000);
      return "accepted" as const;
    case "claim":
      return claimed(event);
    case "observeClose":
      return closed(event.observed);
    case "recordCall": {
      return settled(assertCallClaim(handle(event.token)).pipe(Effect.andThen(recordCalls(reviewKey(), 1, "triage", [leaseCall]))), runtime);
    }
    case "finish": {
      const status = finished[event.status];
      if (status === undefined) return "refused" as const;
      return settled(finishReview(handle(event.token), status, {}), runtime);
    }
  }
}

async function observed(): Promise<Observed> {
  const { lease, claimToken } = await runtime.runPromise(leaseView(reviewKey()));
  const token = [...tokens].find(([, held]) => held.text === claimToken)?.[0] ?? 0;
  return { status: lease.status, token, now: lease.now, expires: lease.expires, callRecorded: lease.callRecorded, close: lease.close };
}

function view(state: ReviewLease): Observed {
  return { status: state.status, token: state.token, now: state.now, expires: state.expires, callRecorded: state.callRecorded, close: state.close };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    lastToken = 0;
    tokens.clear();
    clock.set(0);
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["review"], view, walks: 4, steps: 14 };
