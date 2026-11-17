// spec/slopbot/spendAlerts.md, "Story: Keep one free cost ledger for every provider call"; spec/slopbot/spendAlerts.md, "Story: Email each crossed monthly milestone once"
import { Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__spendAlerts.conformance.ts";
import type { CallInput, Event, Spend } from "../../gen/slopbot__spendAlerts.ts";
import { recordCalls } from "../../src/route/calls.vibe";
import { type CallRecord, budgetExhausted, triageRoute } from "../../src/route/route.vibe";
import { claimFailureNotice, claimMilestone, monthNumber, recordFailureReceipt, recordMilestoneReceipt, spendIn } from "../../src/spend/store.vibe";

const clock = settableClock(Date.parse("2101-01-15T00:00:00.000Z"));
const mf = startWorker({ d1: { SLOPBOT_DB: "spend-alerts-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

const [orbioStep, surplusStep] = triageRoute;
let generation = 0;

function monthText(month: number) {
  return `${2100 + generation}-${String(month).padStart(2, "0")}`;
}

function modelMonth(month: number) {
  return month - monthNumber(monthText(1)) + 1;
}

function months(): [string, string] {
  return [monthText(1), monthText(2)];
}

async function seedHistory() {
  await db.prepare(`INSERT INTO slopbot_costs (review_key, installation_id, call_kind, route_step, provider, requested_model, served_model, outcome, failure,
      input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, price_version, cost_micro_usd, billed_micro_usdc, reconciliation, created_at)
    VALUES (?, 1, 'triage', 1, 'surplus', 'claude-sonnet-5.5', NULL, 'ok', NULL, 0, 0, 0, 0, '2026-10-09', 400000000, 25, 'estimated', ?)`)
    .bind(`spend-history-${generation}`, `${monthText(1)}-01T00:00:00.000Z`)
    .run();
}

function usageFor(estimate: number) {
  const remainder = estimate % 10;
  return { input: Math.floor(remainder / 2), output: Math.floor(estimate / 10), cacheRead: (remainder % 2) * 10, cacheWrite: 0 };
}

function callOf(c: CallInput): CallRecord {
  const step = c.provider === "Orbio" ? orbioStep : surplusStep;
  if (step === undefined) throw new Error("the triage route has no step for this provider");
  return {
    routeStep: 1,
    gateway: step.gateway,
    requestedModel: step.model,
    servedModel: null,
    priceKey: step.priceKey,
    outcome: c.failure === "NotFailed" ? "ok" : "failed",
    failure: c.failure === "NotFailed" ? null : c.failure === "BudgetExhausted" ? budgetExhausted : "provider returned HTTP 503",
    usage: usageFor(c.estimate),
    providerCostMicroUsd: c.providerReported ? c.reported : null,
    providerRequestId: null,
  };
}

async function callIdOf(call: number) {
  const ledger = await runtime.runPromise(spendIn(months()));
  return ledger.calls[call - 1]?.id ?? -1;
}

async function dispatched(event: Event) {
  switch (event.type) {
    case "recordCall":
      if (event.c.month < 1 || event.c.month > 12) return "refused" as const;
      clock.set(Date.parse(`${monthText(event.c.month)}-15T00:00:00.000Z`));
      return outcome(recordCalls(`spend-${generation}`, 1, "triage", [callOf(event.c)]), runtime);
    case "claimMilestone":
      return outcome(claimMilestone(monthText(event.month)), runtime);
    case "deliverMilestone":
      return outcome(recordMilestoneReceipt(monthText(event.month), event.threshold, event.accepted), runtime);
    case "claimFailure":
      return outcome(claimFailureNotice(await callIdOf(event.call)), runtime);
    case "deliverFailure":
      return outcome(recordFailureReceipt(await callIdOf(event.call), event.accepted), runtime);
    case "recordLowBalanceThreshold":
    case "noticeLowBalance":
      return "refused" as const;
  }
}

function view(state: Spend): Spend {
  return { ...state, costs: state.costs.map((cost) => (cost.historical ? { ...cost, failure: "NotFailed" } : cost)) };
}

export const driver: Driver<Spend> & AsyncDisposable = {
  reset: async () => {
    generation++;
    await seedHistory();
  },
  dispatch: (_key, event: Event) => dispatched(event),
  observe: async () => {
    const { spend } = await runtime.runPromise(spendIn(months()));
    return view({
      ...spend,
      costs: spend.costs.map((cost) => ({ ...cost, month: modelMonth(cost.month) })),
      alerts: spend.alerts.map((alert) => ({ ...alert, month: modelMonth(alert.month) })),
    });
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Spend> = { keys: ["ledger"], view, walks: 4, steps: 12 };
