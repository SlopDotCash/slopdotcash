import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { PaymentDeployment } from "./deployment-types";
import { ingestPaymentEvent, type PaymentsWorkerEnvironment } from "./index";
import type { ScanEvent } from "./scanner";

// Actual ingestion and ledger-cache entrypoints over migrated SQLite. Retained
// event fixtures stand for already-verified evidence; these tests do not prove
// a chain receipt. Any unexpected provider call is trapped before networking.
const address = `0x${"1".repeat(40)}`;
const hash = `0x${"2".repeat(64)}`;
const message: ScanEvent = { projectId: "ingestion", network: "base-sepolia",
  transactionId: hash, eventIndex: 0, kind: "reserved", obligationId: `0x${"3".repeat(64)}` };
const deployment = {
  projectId: message.projectId, network: message.network, chain: "base", vault: address,
  asset: address, owner: address, identityAuthority: address, feeRecipient: address,
  codeSha256: "4".repeat(64), bindingDelaySeconds: "0", chainId: "84532",
  factory: address, factoryCodeSha256: "5".repeat(64), registrar: address,
} as PaymentDeployment;
const now = new Date("2026-11-09T00:00:00.000Z");
function fixture(cached = false, changed: Record<string, unknown> = {}) {
  const payments = sqliteD1(), registry = sqliteD1();
  const queries: string[] = [], registryQueries: string[] = [];
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("fixture requires fresh provider evidence");
  }) as typeof fetch;
  const evidence = { ...message, blockId: `0x${"6".repeat(64)}`, chain: "base",
    vault: address, githubUserId: "123", grossMicro: "100", feeMicro: "2",
    netMicro: "98", sourceDigest: "7".repeat(64), assetAddress: address,
    assetDecimals: 6, ...changed };
  if (cached) payments.sqlite.query("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
    .run(message.network, message.transactionId, message.eventIndex, evidence.blockId,
      message.kind, message.obligationId, JSON.stringify(evidence), now.toISOString());
  const paymentsDb: typeof payments.db = {
    prepare(sql) { queries.push(sql); return payments.db.prepare(sql); },
    batch: (statements) => payments.db.batch(statements),
  };
  const registryDb: typeof registry.db = {
    prepare(sql) { registryQueries.push(sql); return registry.db.prepare(sql); },
    batch: (statements) => registry.db.batch(statements),
  };
  const env: PaymentsWorkerEnvironment = {
    PAYMENTS_DB: paymentsDb,
    REGISTRY_DB: registryDb,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: '{"base-sepolia":"https://event-ingestion.invalid"}',
  };
  return { env, payments, queries, registryQueries, providerCalls: () => providerCalls,
    close() { globalThis.fetch = originalFetch; payments.sqlite.close(); registry.sqlite.close(); } };
}

test.each([
  ["null", null],
  ["negative index", { ...message, eventIndex: -1 }],
  ["unsafe index", { ...message, eventIndex: Number.MAX_SAFE_INTEGER + 1 }],
  ["unknown kind", { ...message, kind: "submitted" }],
] as const)("ingestion refuses %s before any database or provider call", async (_label, value) => {
  const f = fixture();
  try {
    await expect(ingestPaymentEvent(f.env, value as unknown as ScanEvent, now, [deployment]))
      .rejects.toThrow("Invalid chain event request");
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test.each([0, 2])("ingestion requires exactly one reviewed match, not %s", async (count) => {
  const f = fixture();
  try {
    await expect(ingestPaymentEvent(f.env, message, now, Array(count).fill(deployment)))
      .rejects.toThrow("Reviewed deployment unavailable or ambiguous");
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test.each([
  ["base", "3".repeat(64)],
  ["base", `0x${"A".repeat(64)}`],
  ["solana", `0x${"3".repeat(64)}`],
] as const)("ingestion checks canonical %s obligation %s", async (chain, obligationId) => {
  const f = fixture();
  try {
    await expect(ingestPaymentEvent(f.env, { ...message, obligationId }, now, [{ ...deployment, chain }]))
      .rejects.toThrow("Noncanonical obligation identity");
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test.each(["{", "null", "{}"])('bad RPC configuration "%s" blocks even retained evidence', async (value) => {
  const f = fixture(true);
  f.env.PAYMENT_RPC_URLS = value;
  try {
    await expect(ingestPaymentEvent(f.env, message, now, [deployment])).rejects.toThrow();
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test("missing EVM review fields block retained evidence before the ledger", async () => {
  const f = fixture(true);
  try {
    await expect(ingestPaymentEvent(f.env, message, now, [{ ...deployment, factory: "" }]))
      .rejects.toThrow("Reviewed chain deployment incomplete");
    expect(f.queries).toEqual([]);
  } finally { f.close(); }
});

test("invalid chain ID conversion is not a cached-event success", async () => {
  const f = fixture(true);
  try {
    await expect(ingestPaymentEvent(f.env, message, now, [{ ...deployment, chainId: "invalid" }]))
      .rejects.toThrow();
    expect(f.queries).toEqual([]);
  } finally { f.close(); }
});

test.each(["{}", "{"])('Solana genesis configuration "%s" is required before indexing', async (genesis) => {
  const f = fixture();
  const solana = { ...deployment, chain: "solana", network: "solana-devnet",
    programId: "program", projectPda: "project", networkDomain: "1",
    rotationDelaySeconds: "0", rotationAuthority: "authority" } as PaymentDeployment;
  f.env.PAYMENT_RPC_URLS = '{"solana-devnet":"https://event-ingestion.invalid"}';
  f.env.PAYMENT_SOLANA_GENESIS = genesis;
  try {
    await expect(ingestPaymentEvent(f.env, { ...message, network: solana.network, obligationId: "3".repeat(64) }, now, [solana]))
      .rejects.toThrow();
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test("invalid observation time refuses before ledger cache access", async () => {
  const f = fixture(true);
  try {
    await expect(ingestPaymentEvent(f.env, message, new Date(NaN), [deployment])).rejects.toThrow();
    expect(f.queries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test.each([undefined, "security-bounty"] as const)("exact retained evidence is reused in %s scope", async (scope) => {
  const f = fixture(true);
  f.env.PAYMENT_SCOPE = scope;
  const before = f.payments.sqlite.query("SELECT * FROM payment_events").get();
  try {
    await ingestPaymentEvent(f.env, message, now, [deployment]);
    expect(f.queries).toHaveLength(1);
    expect(f.queries[0]).toContain("SELECT kind,obligation_id,evidence_json");
    expect(f.registryQueries).toEqual([]);
    expect(f.providerCalls()).toBe(0);
    expect(f.payments.sqlite.query("SELECT * FROM payment_events").get()).toEqual(before);
  } finally { f.close(); }
});

test.each([
  ["kind", "paid"], ["transactionId", `0x${"8".repeat(64)}`],
  ["eventIndex", 1], ["obligationId", `0x${"9".repeat(64)}`],
  ["projectId", "other-project"], ["network", "other-network"],
  ["vault", `0x${"a".repeat(40)}`],
] as const)("retained %s mismatch requires fresh evidence", async (key, value) => {
  const f = fixture(true, { [key]: value });
  const before = f.payments.sqlite.query("SELECT * FROM payment_events").get();
  try {
    await expect(ingestPaymentEvent(f.env, message, now, [deployment])).rejects.toThrow();
    expect(f.providerCalls()).toBe(1);
    expect(f.payments.sqlite.query("SELECT * FROM payment_events").get()).toEqual(before);
  } finally { f.close(); }
});
