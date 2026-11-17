// spec/slopbot/review.md, "Story: Review registered work and preserve incomplete outcomes"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
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
import { type Attempt, type ReviewView, bindAttempt, blockAttempt, completeAttempt, finishAttempt, keepCalls, openAttempt, recheckAttempt, recordAttemptCall, reviewView, skipAttemptStep, startCalls } from "../../src/review/store.vibe";
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
  if (call.provider === "OrbioSonnet") return { source: "OrbioFailure", resetAt: at };
  return { source: call.outcome === "CallBudgetDenied" ? "SurplusSpendingDenial" : "SurplusOtherFailure", resetAt: at };
}

async function opened(route: Route) {
  tokens += 1;
  const result = await runtime.runPromise(openAttempt(row(), job(), { token: `review-token-${generation}-${tokens}`, route }).pipe(
    Effect.catchTag("ReviewBusy", () => Effect.succeed({ kind: "busy" as const })),
  ));
  if (result.kind !== "claimed") return undefined;
  attempt = result.attempt;
  return result.attempt;
}

function settledStep<E, R>(held: Attempt, step: Effect.Effect<string, E, R>, denial?: Denial) {
  return Effect.gen(function* () {
    const status = yield* step;
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
      return settled(startCalls(held, "Triage"), runtime);
    case "startConfirm":
      return settled(startCalls(held, "Confirm"), runtime);
    case "recheckRegistry":
      return settled(settledStep(held, recheckAttempt(held, event.registry)), runtime);
    case "skipMissingCredential":
      return settled(settledStep(held, skipAttemptStep(held)), runtime);
    case "recordCall": {
      const call = routeCall(event.call);
      const denial = denialOf(event.call, event.resetAt);
      const recorded = recordAttemptCall(held, event.call.kind, event.call.provider, call, event.call.verdict, denial).pipe(Effect.tap(() => keepCalls(held, event.call.kind, [call])));
      return settled(settledStep(held, recorded, denial), runtime);
    }
    case "finish":
      return settled(completeAttempt(held, {}, event.unreviewed), runtime);
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
