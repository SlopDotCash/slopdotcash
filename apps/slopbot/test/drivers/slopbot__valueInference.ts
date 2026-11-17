// spec/slopbot/valueInference.md, "Story: Claim a complete immutable source group"; spec/slopbot/valueInference.md, "Story: Hold paid attempts until exact usage reconciles"; spec/slopbot/valueInference.md, "Story: Publish under the current exact authority"
import { createHash, randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__valueInference.conformance.ts";
import type { Charge, Event, Provider, Retained, ValueInference } from "../../gen/slopbot__valueInference.ts";
import type { CallRecord } from "../../src/route/route.vibe";
import { type InferenceSession, inferenceState, nameAttempt, noteCall, noteResult, openInference, sendInference } from "../../src/value/inference/store.vibe";

const clock = settableClock(Date.UTC(2030, 0, 1));
const mf = startWorker({ d1: { SLOPBOT_DB: "value-inference-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto, clock.layer));

const refusals = new Set(["Rejected", "NotAnEvent", "InferenceRaced"]);
const steps: Readonly<Record<Provider, { readonly gateway: "orbio" | "surplus"; readonly model: string; readonly perEstimate: number }>> = {
  SurplusSonnet: { gateway: "surplus", model: "claude-sonnet-5.5", perEstimate: 10 },
  SurplusTerra: { gateway: "surplus", model: "gpt-6.1-terra", perEstimate: 20 },
  OrbioSonnet: { gateway: "orbio", model: "anthropic/claude-sonnet-5.5", perEstimate: 10 },
};
const tiers = ["micro", "small", "medium", "large", "xl", "exceptional"] as const;

let generation = 0;
let session: InferenceSession | undefined;
const hexes = new Map<string, string>();
const outputs = new Map<string, string>();

const hex = (text: string) => createHash("sha256").update(`${generation}:${text}`).digest("hex");
const monthText = (month: number) => `${2030 + generation}-${String(Math.min(12, Math.max(1, month))).padStart(2, "0")}`;
const monthNumber = (month: number) => Number(monthText(month).slice(0, 4)) * 12 + Number(monthText(month).slice(5, 7));

function mapped(text: string) {
  if (text === "") return "";
  const value = hex(text);
  hexes.set(value, text);
  return value;
}

function verdictOf(output: string, sizeBand: number) {
  return {
    status: "assessed",
    tier: tiers[Math.min(5, Math.max(0, sizeBand))],
    rationale: `conformance output ${output}`,
    dimensions: { alignment: "a", impact: "i", complexity: "c", verification: "v", maintenance: "m", overlap: "o" },
    evidenceUrls: [],
    relatedPullRequests: [],
    limitations: [],
    reviews: [],
  };
}

function outputDigest(output: string, sizeBand: number) {
  if (output === "") return "";
  const digest = createHash("sha256").update(JSON.stringify(verdictOf(output, sizeBand))).digest("hex");
  outputs.set(output, digest);
  hexes.set(digest, output);
  return digest;
}

function callOf(charge: Charge, routeStep: number): CallRecord {
  const step = steps[charge.provider];
  const ok = charge.result === "ValidResult";
  return {
    routeStep: routeStep + 1,
    gateway: step.gateway,
    requestedModel: step.model,
    servedModel: charge.seenModel === "" ? null : charge.seenModel,
    priceKey: `${step.gateway}/${step.model}`,
    outcome: ok ? "ok" : "failed",
    failure: ok ? null : charge.result === "BudgetDenial" ? "provider budget exhausted" : "provider call failed",
    usage: { input: 0, output: 0, cacheRead: charge.estimate * step.perEstimate, cacheWrite: 0 },
    providerCostMicroUsd: charge.known ? charge.actual : null,
    providerRequestId: null,
  };
}

function translated(event: Event): Event {
  switch (event.type) {
    case "setSource": return { ...event, key: mapped(event.key) };
    case "observe": return { ...event, month: monthNumber(event.month) };
    case "claim": return { ...event, inputDigest: mapped(event.inputDigest) };
    case "remoteReply": return { ...event, observedSource: mapped(event.observedSource) };
    case "recordCall": return { ...event, charge: { ...event.charge, output: outputDigest(event.charge.output, event.charge.sizeBand) } };
    case "publish": return { ...event, resultDigest: outputs.get(event.resultDigest) ?? mapped(event.resultDigest) };
    default: return event;
  }
}

function back(text: string) {
  return hexes.get(text) ?? text;
}

function backMonth(month: number) {
  for (let candidate = 1; candidate <= 12; candidate++) if (monthNumber(candidate) === month) return candidate;
  return month;
}

function retainedBack(retained: Retained): Retained {
  return { ...retained, key: back(retained.key), result: back(retained.result) };
}

function restored(state: ValueInference): ValueInference {
  return {
    ...state,
    month: backMonth(state.month),
    key: back(state.key),
    requests: state.requests.map((request) => ({ ...request, inputDigest: back(request.inputDigest), observedSource: back(request.observedSource) })),
    attempts: state.attempts.map((attempt) => ({ ...attempt, month: backMonth(attempt.month), allCalls: attempt.allCalls.map((call) => ({ ...call, output: back(call.output) })) })),
    retained: retainedBack(state.retained),
    published: retainedBack(state.published),
    occupied: [...state.occupied].sort((a, b) => a - b),
  };
}

async function settled<A, E>(effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return "accepted" as const;
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string" && refusals.has(error._tag)) return "refused" as const;
  throw error;
}

async function opened() {
  if (session === undefined) session = await runtime.runPromise(openInference(hex("inference"), 1));
  return session;
}

async function dispatch(event: Event) {
  const current = await opened();
  if (event.type === "observe") clock.set(Date.UTC(2030 + generation, Math.min(12, Math.max(1, event.month)) - 1, 1) + event.now * 1000);
  if (event.type === "admit") {
    const state = await runtime.runPromise(inferenceState(current));
    if (!state.attempts.some((attempt) => attempt.id === event.attemptId)) await runtime.runPromise(nameAttempt(current, event.attemptId, `value:${randomUUID()}`));
  }
  if (event.type === "retain") {
    const state = await runtime.runPromise(inferenceState(current));
    const attempt = state.attempts.find((candidate) => candidate.id === event.attemptId);
    const last = attempt?.allCalls.at(-1);
    if (last !== undefined) {
      const verdict = verdictOf(back(last.output), last.sizeBand);
      await runtime.runPromise(noteResult(current, event.attemptId, JSON.stringify({ verdict, calls: [], servedBy: null, blocked: false, inferredAt: new Date(clock.now()).toISOString() })));
    }
  }
  const sent = translated(event);
  const outcome = await settled(sendInference(current, sent));
  if (outcome === "accepted" && sent.type === "recordCall") {
    const state = await runtime.runPromise(inferenceState(current));
    const attempt = state.attempts.find((candidate) => candidate.id === sent.attemptId);
    const routeStep = attempt === undefined ? 0 : attempt.allCalls.length - 1;
    await runtime.runPromise(noteCall(current, sent.attemptId, callOf(sent.charge, routeStep)));
  }
  return outcome;
}

const neutralize = Effect.gen(function* () {
  yield* (yield* D1).run(sql`INSERT INTO slopbot_value_budget_reconciliations (attempt_id, call_count, recorded_micro_usd, reconciled_at)
    SELECT r.attempt_id, 0, 0, ${new Date(clock.now()).toISOString()} FROM slopbot_value_budget_reservations r
    WHERE NOT EXISTS (SELECT 1 FROM slopbot_value_budget_reconciliations c WHERE c.attempt_id = r.attempt_id)`);
});

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.runPromise(neutralize);
    generation++;
    session = undefined;
    hexes.clear();
    outputs.clear();
    clock.set(Date.UTC(2030 + generation, 0, 1));
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: async () => restored(await runtime.runPromise(inferenceState(await opened()))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["inference"], walks: 3, steps: 16 };
