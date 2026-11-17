// spec/settlement/referralAccrual.md, "Filed records, first-use wallet pins and exact roots commit atomically"; spec/settlement/referralAccrual.md, "A complete immutable source snapshot is filed in ordinal-month order"; spec/settlement/referralAccrual.md, "Verified token units and approved reactivation precede dry-run accrual"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import type { D1Database } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__referralAccrual.conformance.ts";
import type { Amount } from "../../gen/settlement__money.ts";
import type { Accrual, AccrualRecord, Event, Payout, Wallet } from "../../gen/settlement__referralAccrual.ts";
import { fromAmount } from "../../src/kernels/amounts.ts";
import { type Book, abandonMonth, applyToBook, beginMonth, blankSetup, decodeLedgerEvent, fileMonth, openBook, reload } from "../../src/referrals/accrual.vibe";
import { isoOfDate, periodBounds, periodOf } from "../../src/referrals/periods.ts";
import type { Snapshot, SourceRow } from "../../src/referrals/source.vibe";

const SLOTS = 24;
const LEASE_MILLIS = 10 * 60 * 1000;
const DAY_MILLIS = 86_400_000;
const mf = startWorker({ d1: Object.fromEntries(Array.from({ length: SLOTS }, (_, slot) => [`LEDGER_${slot}`, `referral-accrual-conformance-${slot}`])) });
const clock = settableClock(Date.parse("2026-12-15T00:00:00.000Z"));
const projects = new Map(Array.from({ length: 20 }, (_, index) => [`project-${index + 1}`, index + 1] as const));
const runtimeOver = (db: D1Database) => ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

let slot = -1;
let db: D1Database | undefined;
let runtime: ReturnType<typeof runtimeOver> | undefined;
let book: Book | undefined;
const addresses = new Map<string, string>();
const names = new Map<string, string>();

const current = () => {
  if (db === undefined || runtime === undefined || book === undefined) throw new Error("the referral ledger driver was not reset");
  return { db, runtime, book };
};

const runOf = (leaseId: string) => (leaseId === "" ? "" : `rrun_${leaseId}`);

const addressOf = (wallet: string) => {
  if (wallet === "") return "";
  const known = addresses.get(wallet);
  if (known !== undefined) return known;
  const address = `0x${(addresses.size + 1).toString(16).padStart(40, "0")}`;
  addresses.set(wallet, address);
  names.set(address, wallet);
  return address;
};

const nameOf = (address: string) => names.get(address) ?? address;

async function arrangeLease(leaseId: string, held: boolean) {
  const { db } = current();
  await db.prepare("DELETE FROM referral_accrual_locks").run();
  if (leaseId !== "" && held)
    await db.prepare("INSERT INTO referral_accrual_locks (scope, run_id, expires_at) VALUES ('accrual', ?, ?)").bind(runOf(leaseId), new Date(clock.now() + LEASE_MILLIS).toISOString()).run();
}

async function seed(payout: Payout) {
  const { db } = current();
  await db.prepare("INSERT OR IGNORE INTO payment_obligations (id, project_id, github_user_id, network, chain, vault, asset_address, asset_decimals, gross_base, fee_base, source_digest, state, created_at, paid_transaction) VALUES (?, ?, '1', 'base-mainnet', 'base', ?, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6, ?, '0', ?, 'paid', ?, ?)")
    .bind(`obl-${payout.id}`, `project-${payout.project}`, `0x${"5".repeat(40)}`, fromAmount(payout.gross).toString(), payout.id.toString(16).padStart(64, "0"), isoOfDate(payout.paidAt), `tx-${payout.id}`)
    .run();
}

function sourceOf(state: Accrual, payout: Payout): SourceRow {
  const referrer = state.attributions.filter((entry) => entry.project === payout.project).at(-1)?.referrer ?? 0;
  return {
    obligationId: `obl-${payout.id}`,
    projectId: `project-${payout.project}`,
    referrerGithubId: String(referrer),
    referrerGithubLogin: `member-${referrer}`,
    network: "base-mainnet",
    paidTransaction: `tx-${payout.id}`,
    paidObservedAt: isoOfDate(payout.paidAt),
    firstPaidAt: isoOfDate(payout.firstPaidAt),
    grossBase: fromAmount(payout.gross).toString(),
    assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    assetSymbol: payout.stablecoin ? "USDC" : "unknown",
    stablecoin: payout.stablecoin,
    team: payout.team,
    banned: payout.banned,
    hold: payout.held ? "rhold_conformance: held by the operator" : undefined,
  };
}

async function attempt(next: Effect.Effect<Book, unknown, ManagedRuntime.ManagedRuntime.Services<ReturnType<typeof runtimeOver>>>) {
  const exit = await current().runtime.runPromiseExit(next);
  if (Exit.isSuccess(exit)) {
    book = exit.value;
    return "accepted" as const;
  }
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return "refused" as const;
  throw error;
}

async function send(event: Event, by: unknown) {
  const { book } = current();
  if (event.type === "startMonth") {
    const period = periodOf(event.period);
    if (period === undefined) throw new Error(`model period ${event.period} has no calendar month`);
    const bounds = periodBounds(period);
    clock.set(event.closed ? Date.parse(bounds.end) + DAY_MILLIS : Date.parse(bounds.start) + DAY_MILLIS);
    await arrangeLease(event.leaseId, event.leaseCurrent);
    for (const payout of event.payouts) await seed(payout);
    const snapshot: Snapshot = { period, rows: event.payouts.map((payout) => sourceOf(book.state, payout)), digest: event.sourceDigest, complete: event.complete, canonicalOrder: event.canonicalOrder };
    return attempt(beginMonth(book, snapshot, runOf(event.leaseId)));
  }
  if (event.type === "fileMonth") {
    await arrangeLease(event.leaseId, event.leaseCurrent);
    const wallets: Wallet[] = event.wallets.map((wallet) => ({ ...wallet, wallet: addressOf(wallet.wallet) }));
    return attempt(fileMonth(book, wallets, runOf(event.leaseId)));
  }
  if (event.type === "abandonMonth") {
    await arrangeLease(event.leaseId, event.leaseCurrent);
    return attempt(abandonMonth(book, runOf(event.leaseId)));
  }
  return attempt(applyToBook(book, event, typeof by === "string" ? by : ""));
}

function modelTerms(state: Accrual): Accrual {
  return {
    ...state,
    leaseRun: state.leaseRun.replace(/^rrun_/u, ""),
    filings: state.filings.map((filing) => ({ ...filing, entries: filing.entries.map((entry) => ({ ...entry, wallet: nameOf(entry.wallet) })) })),
    pins: state.pins.map((pin) => ({ ...pin, wallet: nameOf(pin.wallet) })),
  };
}

const units = (amount: Amount) => fromAmount(amount).toString();
const recordView = (record: AccrualRecord) => [record.payout.id, record.payout.project, record.payout.period, record.referrer, record.eligible, units(record.rate.numerator), units(record.computed), units(record.amount), record.outcome];
const project = (state: Accrual) => ({
  phase: state.phase,
  configured: state.configured,
  tokenUnit: units(state.tokenUnit),
  rates: state.rates.map((rate) => [rate.fromPeriod, units(rate.numerator), units(rate.denominator)]),
  attributions: state.attributions,
  nextPeriod: state.nextPeriod,
  activePeriod: state.activePeriod,
  sourceCount: state.sourceCount,
  leaseRun: state.leaseRun,
  pending: state.pending.map((payout) => payout.id),
  staged: state.staged.map(recordView),
  records: state.records.map(recordView),
  filings: state.filings.map((filing) => ({ period: filing.period, sourceCount: filing.sourceCount, recordCount: filing.recordCount, entries: filing.entries.map((entry) => [entry.actor, entry.wallet, units(entry.amount)]), total: units(filing.total) })),
  pins: state.pins,
});
type View = ReturnType<typeof project>;

export const driver: Driver<View> & AsyncDisposable = {
  reset: async () => {
    slot += 1;
    if (slot >= SLOTS) throw new Error(`the referral ledger driver has only ${SLOTS} fresh databases`);
    const binding = `LEDGER_${slot}`;
    const failed = (await migrate(mf, binding, migrationsDir)).find((applied) => applied.error !== undefined);
    if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
    await runtime?.dispose();
    db = await database(mf, binding);
    runtime = runtimeOver(db);
    addresses.clear();
    names.clear();
    clock.set(Date.parse("2026-12-15T00:00:00.000Z"));
    book = await runtime.runPromise(openBook(blankSetup(projects)));
  },
  dispatch: (_key, event, by) => send(event, by),
  receive: async (_key, raw, by) => {
    const decoded = await current().runtime.runPromiseExit(decodeLedgerEvent(raw));
    return Exit.isSuccess(decoded) ? send(decoded.value, by) : "refused";
  },
  observe: async () => {
    const { runtime, book } = current();
    return project(modelTerms(book.state.phase === "Collecting" ? book.state : (await runtime.runPromise(reload(book))).state));
  },
  [Symbol.asyncDispose]: async () => {
    await runtime?.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { keys: ["ledger"], walks: 0, view: project };
