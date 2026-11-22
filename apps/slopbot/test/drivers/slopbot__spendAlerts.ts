// spec/slopbot/spendAlerts.md, "Story: Keep one free cost ledger for every provider call"; spec/slopbot/spendAlerts.md, "Story: Email each crossed monthly milestone once"; spec/slopbot/spendAlerts.md, "A failed call notice is sent only after its route settled, and a served or repeated failure is suppressed"
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
import { type CallFailure, type CallRecord, budgetExhausted, stepOf } from "../../src/route/route.vibe";
import { claimFailureNotice, claimMilestone, monthNumber, recordFailureReceipt, recordMilestoneReceipt, spendIn } from "../../src/spend/store.vibe";

const clock = settableClock(Date.parse("2101-01-15T00:00:00.000Z"));
const mf = startWorker({ d1: { SLOPBOT_DB: "spend-alerts-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

let generation = 0;
let recorded: Array<{ readonly job: number; readonly at: number; readonly month: number }> = [];

function originOf(month: number) {
  return Date.parse(`${monthText(month)}-15T00:00:00.000Z`);
}

function monthText(month: number) {
  return `${2100 + generation}-${String(month).padStart(2, "0")}`;
}

function modelMonth(month: number) {
  return month - monthNumber(monthText(1)) + 1;
}

function monthStart(month: number) {
  return Date.parse(`${monthText(month)}-01T00:00:00.000Z`);
}

function jobKey(job: number) {
  return `spend-${generation}-job${job}`;
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

function failureOf(c: CallInput): CallFailure | null {
  if (c.failure === "NotFailed") return null;
  if (c.failure === "BudgetExhausted") return budgetExhausted;
  return `provider returned HTTP ${Number(c.cause.slice(c.cause.lastIndexOf(" ") + 1))}`;
}

function callOf(c: CallInput): CallRecord {
  const step = stepOf(c.provider === "Orbio" ? "OrbioSonnet" : "SurplusSonnet");
  return {
    routeStep: 1,
    gateway: step.gateway,
    requestedModel: c.model,
    servedModel: null,
    priceKey: step.priceKey,
    outcome: c.failure === "NotFailed" ? "ok" : "failed",
    failure: failureOf(c),
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
    case "recordCall": {
      if (event.c.month < 1 || event.c.month > 12) return "refused" as const;
      clock.set(originOf(event.c.month) + event.c.at * 1000);
      const result = await outcome(recordCalls(jobKey(event.c.job), 1, "triage", [callOf(event.c)]), runtime);
      if (result === "accepted") recorded = [...recorded, { job: event.c.job, at: event.c.at, month: event.c.month }];
      return result;
    }
    case "claimMilestone":
      return outcome(claimMilestone(monthText(event.month)), runtime);
    case "deliverMilestone":
      return outcome(recordMilestoneReceipt(monthText(event.month), event.threshold, event.accepted), runtime);
    case "claimFailure":
      clock.set(originOf(recorded[event.call - 2]?.month ?? 1) + event.now * 1000);
      return outcome(claimFailureNotice(await callIdOf(event.call)), runtime);
    case "deliverFailure":
      clock.set(originOf(recorded[event.call - 2]?.month ?? 1) + event.now * 1000);
      return outcome(recordFailureReceipt(await callIdOf(event.call), event.accepted), runtime);
  }
}

function view(state: Spend): Spend {
  return {
    ...state,
    costs: state.costs.map((cost) => (cost.historical ? { ...cost, failure: "NotFailed", job: 0, model: "", cause: "", at: 0 } : cost)),
  };
}

export const driver: Driver<Spend> & AsyncDisposable = {
  reset: async () => {
    generation++;
    recorded = [];
    await db.prepare("UPDATE slopbot_provider_failure_notices SET claimed_at = ? WHERE claimed_at IS NULL").bind(new Date(monthStart(1)).toISOString()).run();
    await seedHistory();
  },
  dispatch: (_key, event: Event) => dispatched(event),
  observe: async () => {
    const { spend } = await runtime.runPromise(spendIn(months()));
    return view({
      ...spend,
      costs: spend.costs.map((cost, index) => {
        const call = recorded[index - 1];
        return { ...cost, month: modelMonth(cost.month), job: call?.job ?? 0, at: call?.at ?? 0 };
      }),
      failures: spend.failures.map((notice) => ({ ...notice, recordedAt: notice.recordedAt === 0 ? 0 : notice.recordedAt - Math.floor(originOf(recorded[notice.call - 2]?.month ?? 1) / 1000) })),
      alerts: spend.alerts.map((alert) => ({ ...alert, month: modelMonth(alert.month) })),
    });
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Spend> = { keys: ["ledger"], view, walks: 4, steps: 12 };
