// spec/slopbot/review.md, "Story: Review registered work and preserve incomplete outcomes"; spec/slopbot/review.md, "Each provider step first rechecks the live registry"; spec/slopbot/review.md, "Each call is recorded free, and only a Surplus spending denial blocks the route"; spec/slopbot/reviewCap.md, "A review admits its item before any call, and a full month refuses only a new item"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { isoNow } from "@repo/platform/clock";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Denial } from "../../gen/slopbot__budgetBlocks.ts";
import type { Driver, Options } from "../../gen/slopbot__review.conformance.ts";
import type { CallRecord as ModelCall, Event, Review } from "../../gen/slopbot__review.ts";
import type { Route } from "../../gen/slopbot__routing.ts";
import type { ReviewJob } from "../../src/jobs/job.vibe";
import type { ReviewRow } from "../../src/lease/writes.vibe";
import { admitMonth } from "../../src/review/cap.vibe";
import { type Attempt, type ReviewView, admitAttempt, bindAttempt, blockAttempt, completeAttempt, finishAttempt, keepCalls, openAttempt, recheckAttempt, recordAttemptCall, refuseAttempt, reviewView, skipAttemptStep, startCalls } from "../../src/review/store.vibe";
import { type CallRecord, budgetExhausted, stepOf, triageRoute } from "../../src/route/route.vibe";
import { settled } from "../support/settled.ts";

const mf = startWorker({ d1: { SLOPBOT_DB: "review-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const offsetSeconds = 1_800_000_000;
const clockAt = (seconds: number) => (offsetSeconds + seconds) * 1000;
const clock = settableClock(clockAt(1));
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

let generation = 0;
let tokens = 0;
let attempt: Attempt | undefined;
let remembered: Denial | undefined;
let boundRoute: Route = "AdvisoryReview";

const reviewKey = () => `review-g${generation}`;
const repositoryId = () => 6_600_000 + generation;

function row(): ReviewRow {
  return { reviewKey: reviewKey(), installationId: 1, repositoryId: repositoryId(), itemKind: "issue", itemNumber: 1, itemNodeId: `I_review_g${generation}`, authorId: 5_600_000 + generation, revision: "r", contentDigest: "c", policyDigest: "p" };
}

function job(): ReviewJob {
  return { kind: "review", deliveryId: `review-delivery-g${generation}`, installationId: 1, repositoryId: repositoryId(), owner: "ada", repo: "widgets", itemKind: "issue", number: 1 };
}

function routeCall(call: ModelCall): CallRecord {
  const step = stepOf(call.provider);
  return {
    routeStep: triageRoute.indexOf(call.provider) + 1,
    gateway: step.gateway,
    requestedModel: step.model,
    servedModel: call.servedModel === "" ? null : call.servedModel,
    priceKey: step.priceKey,
    outcome: call.outcome === "CallOk" ? "ok" : "failed",
    failure: call.outcome === "CallOk" ? null : call.outcome === "CallBudgetDenied" ? budgetExhausted : "provider call failed",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    providerCostMicroUsd: call.known ? call.amount : null,
    providerRequestId: null,
  };
}

function denialOf(call: ModelCall, resetAt: number): Denial {
  const at = resetAt > 0 ? clockAt(resetAt) : 0;
  if (call.provider === "OrbioSonnet") return { source: "OrbioFailure", resetAt: at, orbioServed: false };
  return { source: call.outcome === "CallBudgetDenied" ? "SurplusSpendingDenial" : "SurplusOtherFailure", resetAt: at, orbioServed: false };
}

async function admission(alreadyAdmitted: boolean, usedThisMonth: number) {
  const now = await runtime.runPromise(isoNow());
  const month = now.slice(0, 7);
  const others = alreadyAdmitted ? Math.max(usedThisMonth - 1, 0) : usedThisMonth;
  await db.batch([
    db.prepare("DELETE FROM slopbot_review_month_starts WHERE repository_id = ?").bind(repositoryId()),
    db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT INTO slopbot_review_month_starts (repository_id, month, item_kind, item_number, started_at) SELECT ?, ?, 'pull_request', 100000 + i, ? FROM n WHERE ? > 0").bind(others, repositoryId(), month, now, others),
    db.prepare("INSERT INTO slopbot_review_month_starts (repository_id, month, item_kind, item_number, started_at) SELECT ?, ?, 'issue', 1, ? WHERE ?").bind(repositoryId(), month, now, alreadyAdmitted ? 1 : 0),
  ]);
  return runtime.runPromise(admitMonth({ repositoryId: repositoryId(), itemKind: "issue", number: 1 }));
}

async function opened(route: Route) {
  tokens += 1;
  const result = await runtime.runPromise(openAttempt(row(), job(), { token: `review-token-${generation}-${tokens}`, route }).pipe(
    Effect.catchTag("ReviewBusy", () => Effect.succeed({ kind: "busy" as const })),
  ));
  if (result.kind !== "claimed") return undefined;
  attempt = result.attempt;
  remembered = undefined;
  return result.attempt;
}

function rememberDenial(denial: Denial) {
  return Effect.sync(() => {
    if (denial.source === "SurplusSpendingDenial" && !denial.orbioServed) remembered = denial;
  });
}

function settledStep<E, R>(held: Attempt, step: Effect.Effect<string, E, R>) {
  return Effect.gen(function* () {
    const status = yield* step;
    const denial = remembered;
    if (status === "BudgetBlocked" && denial !== undefined) yield* blockAttempt(held, denial);
    if (status === "RetryableFailure") yield* finishAttempt(held, "failed", { skipReason: "Error: every model route step failed" });
  });
}

async function dispatch(event: Event) {
  if (event.type === "elapse") {
    if (event.seconds <= 0) return "refused" as const;
    clock.advance(event.seconds * 1000);
    return "accepted" as const;
  }
  if (event.type === "bindSource" || event.type === "retry") {
    const { phase } = await runtime.runPromise(reviewView(reviewKey()));
    const delivers = event.type === "bindSource" ? phase === "absent" : phase === "failed" || phase === "blocked";
    if (!delivers) return "refused" as const;
    const route = event.type === "bindSource" ? event.route : boundRoute;
    const held = await opened(route);
    if (held === undefined) return "refused" as const;
    if (event.type === "retry") return "accepted" as const;
    boundRoute = event.route;
    return settled(bindAttempt(held, event.route, event.source).pipe(
      Effect.flatMap((bound) => bound.status === "Skipped" ? finishAttempt(held, "skipped", { skipReason: "review source binding failed" }) : Effect.void),
    ), runtime);
  }
  const held = attempt;
  if (held === undefined) return "refused" as const;
  switch (event.type) {
    case "start":
      remembered = undefined;
      return settled(startCalls(held, "Triage"), runtime);
    case "startConfirm":
      remembered = undefined;
      return settled(startCalls(held, "Confirm"), runtime);
    case "recheckRegistry":
      return settled(settledStep(held, recheckAttempt(held, event.registry)), runtime);
    case "skipMissingCredential":
      return settled(settledStep(held, skipAttemptStep(held)), runtime);
    case "recordCall": {
      const call = routeCall(event.call);
      const denial = denialOf(event.call, event.resetAt);
      const recorded = recordAttemptCall(held, event.call.kind, event.call.provider, call, event.call.verdict, denial).pipe(
        Effect.tap(() => keepCalls(held, event.call.kind, [call])),
        Effect.tap(() => rememberDenial(denial)),
      );
      return settled(settledStep(held, recorded), runtime);
    }
    case "finish":
      return settled(completeAttempt(held, {}, event.unreviewed), runtime);
    case "admitMonthly":
      return settled(admitAttempt(held, await admission(event.alreadyAdmitted, event.usedThisMonth)), runtime);
    case "refuseMonthlyCap": {
      const refused = refuseAttempt(held, await admission(event.alreadyAdmitted, event.usedThisMonth));
      return settled(refused.pipe(Effect.flatMap(() => finishAttempt(held, "skipped", { skipReason: "monthly-review-cap" }))), runtime);
    }
  }
}

function view(state: Review): ReviewView {
  const phases = { Skipped: "skipped", InFlight: "running", Answered: "running", RetryableFailure: "failed", BudgetBlocked: "blocked", Limited: "completed", Complete: "completed" } as const;
  return {
    phase: state.status === "Queued" ? (state.bound ? "running" : "absent") : phases[state.status],
    calls: state.calls.map((call) => [call.kind, call.provider, call.outcome] as const),
  };
}

export const driver: Driver<ReviewView> & AsyncDisposable = {
  reset: () => {
    generation++;
    attempt = undefined;
    remembered = undefined;
    boundRoute = "AdvisoryReview";
    clock.set(clockAt(1));
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: () => runtime.runPromise(reviewView(reviewKey())),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReviewView> = { keys: ["review"], view, walks: 4, steps: 14 };
