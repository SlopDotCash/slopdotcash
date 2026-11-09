import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import worker, { syncRegistryVaults, type PaymentsWorkerEnvironment } from "./index";

// Real parent and child entrypoints, with separate migrated registry/payments
// databases. Empty collections never reach an executor or chain. Injected SQL
// failures test orchestration, not provider, signer or settlement correctness.
type Stage = "recovery" | "reconcile" | "coordinator" | "commit" | "dispatch";
function stageOf(sql: string): Stage | null {
  if (sql.includes("json_object('idempotencyKey'")) return "recovery";
  if (sql.includes("a.state IN ('submitted','unknown') AND a.transaction_id IS NOT NULL")) return "reconcile";
  if (sql.includes("FROM monthly_reward_bases b")) return "coordinator";
  if (sql.trimStart().startsWith("WITH pending AS")) return "commit";
  if (sql.includes("FROM payment_outbox b JOIN")) return "dispatch";
  return null;
}
function fixture(failedStages: readonly Stage[] = []) {
  const registry = sqliteD1();
  const payments = sqliteD1();
  const stages: Stage[] = [];
  let registryReads = 0;
  const registryDb: typeof registry.db = {
    prepare(sql) {
      if (sql.includes("FROM projects ORDER BY id")) registryReads += 1;
      return registry.db.prepare(sql);
    },
    batch: (statements) => registry.db.batch(statements),
  };
  const paymentsDb: typeof payments.db = {
    prepare(sql) {
      const stage = stageOf(sql);
      if (stage) {
        stages.push(stage);
        if (failedStages.includes(stage)) throw new Error(`injected ${stage}`);
      }
      return payments.db.prepare(sql);
    },
    batch: (statements) => payments.db.batch(statements),
  };
  const env: PaymentsWorkerEnvironment = {
    REGISTRY_DB: registryDb,
    PAYMENTS_DB: paymentsDb,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}',
    EVM_PAYMENT_EXECUTOR: { async fetch() { throw new Error("empty collections must not reach executor"); } },
  };
  return {
    env, stages, registryReads: () => registryReads,
    close() { registry.sqlite.close(); payments.sqlite.close(); },
  };
}
const allStages: Stage[] = ["recovery", "reconcile", "coordinator", "commit", "dispatch"];
async function scheduledError(env: PaymentsWorkerEnvironment) {
  try {
    await worker.scheduled({}, env);
    throw new Error("Expected scheduled aggregate error");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    return error as AggregateError;
  }
}

test("invalid served networks abort before registry or child work", async () => {
  const f = fixture();
  f.env.PAYMENT_NETWORKS = "[]";
  try {
    await expect(worker.scheduled({}, f.env)).rejects.toThrow("PAYMENT_NETWORKS");
    expect(f.registryReads()).toBe(0);
    expect(f.stages).toEqual([]);
  } finally { f.close(); }
});

test("a registry read exception aborts before child work", async () => {
  const f = fixture();
  const original = f.env.REGISTRY_DB;
  f.env.REGISTRY_DB = {
    prepare() { throw new Error("registry unavailable"); },
    batch: (statements) => original.batch(statements),
  };
  try {
    await expect(worker.scheduled({}, f.env)).rejects.toThrow("registry unavailable");
    expect(f.stages).toEqual([]);
  } finally { f.close(); }
});

test("malformed RPC JSON aborts after registry observation and before child work", async () => {
  const f = fixture();
  f.env.PAYMENT_RPC_URLS = "{";
  try {
    await expect(worker.scheduled({}, f.env)).rejects.toBeInstanceOf(SyntaxError);
    expect(f.registryReads()).toBe(1);
    expect(f.stages).toEqual([]);
  } finally { f.close(); }
});

test("sync returns an empty-registry failure for the scheduler to report", async () => {
  const f = fixture();
  try {
    const result = await syncRegistryVaults(f.env);
    expect(result.deployments).toEqual([]);
    expect(result.rpcUrls).toEqual({});
    expect(result.failures).toHaveLength(1);
    expect(String(result.failures[0])).toContain("no escrow deployment for served network base-sepolia");
    expect(f.stages).toEqual([]);
  } finally { f.close(); }
});

test("every scheduled child runs in order after earlier SQL failures", async () => {
  const f = fixture(allStages);
  try {
    const error = await scheduledError(f.env);
    expect(f.stages).toEqual(allStages);
    expect(error.message).toBe("Payment worker failures");
    expect(error.errors).toHaveLength(6);
    expect(String(error.errors[0])).toContain("no escrow deployment for served network");
    expect(error.errors.slice(1).map((failure) => failure.message))
      .toEqual(allStages.map((stage) => `injected ${stage}`));
  } finally { f.close(); }
});

test("empty collections still run every ordinary child before reporting registry failure", async () => {
  const f = fixture();
  try {
    const error = await scheduledError(f.env);
    expect(f.stages).toEqual(allStages);
    // Commitment execution re-reads the authoritative registry and retains
    // its own empty-deployment failure, separate from initial synchronization.
    expect(f.registryReads()).toBe(2);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[1]).toBeInstanceOf(AggregateError);
    expect(error.errors[1].message).toBe("Monthly commitment failures");
  } finally { f.close(); }
});

test("malformed later-stage configuration does not stop dispatch", async () => {
  const f = fixture();
  f.env.PAYMENT_SOLANA_GENESIS = "{";
  f.env.MONTHLY_PAYMENT_SCHEDULE = "{";
  try {
    const error = await scheduledError(f.env);
    expect(f.stages).toEqual(["recovery", "dispatch"]);
    expect(error.errors).toHaveLength(4);
    expect(error.errors[1]).toBeInstanceOf(SyntaxError);
    expect(error.errors[2].message).toContain("MONTHLY_PAYMENT_SCHEDULE");
    expect(error.errors[3].message).toContain("MONTHLY_PAYMENT_SCHEDULE");
  } finally { f.close(); }
});

test("security scope skips both monthly jobs without suppressing dispatch", async () => {
  const f = fixture();
  f.env.PAYMENT_SCOPE = "security-bounty";
  f.env.MONTHLY_PAYMENT_SCHEDULE = "{";
  try {
    const error = await scheduledError(f.env);
    expect(f.stages).toEqual(["recovery", "reconcile", "dispatch"]);
    expect(f.registryReads()).toBe(1);
    expect(error.errors).toHaveLength(1);
  } finally { f.close(); }
});
