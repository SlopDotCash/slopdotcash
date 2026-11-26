// spec/fees/conversion.md, "A run needs the published Worker, a fresh run identity and a free or expired lease"; spec/fees/runtime.md, "Signing needs a live mode and owner-verified readiness for the exact wallet"; spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SqlValue } from "@repo/platform/bindings";
import { type ScheduledOutcome, type WorkerOptions, database, migrate, workerOptions } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Miniflare } from "miniflare";
import { type Hex, keccak256 } from "viem";

const converterCron = "* * * * *";
export const converterBinding = "FEE_DB";
export const converterDatabase = "slop-private";

export const converterLimits: Readonly<Record<string, string>> = {
  FEE_CONVERTER_MIN_VALUE_MICRO: "5000000",
  FEE_CONVERTER_GAS_MULTIPLE: "10",
  FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
  FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
  FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
  FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
  FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
    base: { perTransaction: "10000000000000000", perDay: "100000000000000000", additionalFeeReserve: "1000000000000" },
    ethereum: { perTransaction: "10000000000000000", perDay: "100000000000000000", additionalFeeReserve: "0" },
    robinhood: { perTransaction: "10000000000000000", perDay: "100000000000000000", additionalFeeReserve: "0" },
  }),
};

export const buybackLimits: Readonly<Record<string, string>> = {
  BUYBACK_START_AT: "2026-11-12T00:00:00.000Z",
  BUYBACK_SHARE_BPS: "5000",
  BUYBACK_BURN_BPS: "5000",
  BUYBACK_MIN_BRIDGE_MICRO: "25000000",
  BUYBACK_MAX_BRIDGE_COST_BPS: "1000",
  BUYBACK_MAX_BRIDGE_NATIVE_FEE: JSON.stringify({ base: "1000000000000000", ethereum: "1000000000000000", solana: "50000000" }),
  BUYBACK_MIN_BUY_MICRO: "25000000",
  BUYBACK_MIN_BURN_MICRO: "5000000",
  BUYBACK_MAX_SLIPPAGE_BPS: "100",
  BUYBACK_MAX_PRICE_IMPACT_BPS: "300",
  BUYBACK_RUN_CAP_MICRO: "1000000000",
  BUYBACK_DAILY_CAP_MICRO: "5000000000",
  BUYBACK_UNFILLED_ALERT_SECONDS: "3600",
};

export interface Converter {
  readonly mf: Miniflare;
  readonly logs: string[];
  readonly outboundErrors: string[];
  options: WorkerOptions;
}

export interface ConverterEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}

export interface JournalRow {
  readonly kind: string;
  readonly network: string;
  readonly mode: string;
  readonly state: string;
  readonly token: string;
  readonly amount_in: string;
  readonly amount_out: string | null;
  readonly tx_id: string | null;
  readonly raw_tx: string | null;
  readonly landed_tx_id: string | null;
}

interface ScheduledAt {
  scheduled(options: { readonly cron: string; readonly scheduledTime: Date }): Promise<ScheduledOutcome>;
}

function miniflareOptions(converter: Pick<Converter, "logs" | "outboundErrors">, options: WorkerOptions) {
  return { ...workerOptions(options, converter.outboundErrors), handleStructuredLogs: (log: { readonly message: unknown }) => { converter.logs.push(String(log.message)); } };
}

export async function startConverter(options: WorkerOptions): Promise<Converter> {
  const sink = { logs: [] as string[], outboundErrors: [] as string[] };
  const mf = new Miniflare(miniflareOptions(sink, options));
  const failed = (await migrate(mf, converterBinding, migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) {
    await mf.dispose();
    throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  }
  return { mf, ...sink, options };
}

export async function redeploy(converter: Converter, vars: Readonly<Record<string, string>>, removed: ReadonlyArray<string> = []): Promise<void> {
  const kept = Object.fromEntries(Object.entries({ ...converter.options.vars, ...vars }).filter(([name]) => !removed.includes(name)));
  converter.options = { ...converter.options, vars: kept };
  await converter.mf.setOptions(miniflareOptions(converter, converter.options));
  await converter.mf.ready;
}

export async function runAt(converter: Converter, at: string): Promise<string> {
  const worker = (await converter.mf.getWorker()) as unknown as ScheduledAt;
  return (await worker.scheduled({ cron: converterCron, scheduledTime: new Date(at) })).outcome;
}

export function converterEvents(converter: Converter): ReadonlyArray<ConverterEvent> {
  return converter.logs.filter((line) => line.startsWith('{"event":"fee_converter_')).map((line) => JSON.parse(line) as ConverterEvent);
}

async function rows<T>(converter: Converter, text: string, ...params: ReadonlyArray<SqlValue>): Promise<ReadonlyArray<T>> {
  const db = await database(converter.mf, converterBinding);
  return (await db.prepare(text).bind(...params).all()).results as ReadonlyArray<T>;
}

export async function execute(converter: Converter, text: string, ...params: ReadonlyArray<SqlValue>): Promise<void> {
  const db = await database(converter.mf, converterBinding);
  await db.prepare(text).bind(...params).run();
}

export function journal(converter: Converter): Promise<ReadonlyArray<JournalRow>> {
  return rows<JournalRow>(converter, "SELECT kind, network, mode, state, token, amount_in, amount_out, tx_id, raw_tx, landed_tx_id FROM fee_conversions ORDER BY rowid");
}

export async function heldLocks(converter: Converter): Promise<number> {
  const [found] = await rows<{ readonly count: number }>(converter, "SELECT count(*) AS count FROM fee_converter_locks WHERE expires_at > '1970-01-01T00:00:00.000Z'");
  return found?.count ?? 0;
}

export async function signedWithoutReservation(converter: Converter): Promise<ReadonlyArray<string>> {
  const signed = await rows<{ readonly id: string; readonly tx_id: string; readonly raw_tx: string; readonly reserved: number }>(converter,
    `SELECT c.id, c.tx_id, c.raw_tx, (SELECT count(*) FROM fee_native_gas g WHERE g.network = c.network AND g.tx_id = c.tx_id AND g.state = 'signed') AS reserved
       FROM fee_conversions c WHERE c.raw_tx IS NOT NULL ORDER BY c.rowid`);
  return signed.filter((row) => row.reserved !== 1 || keccak256(row.raw_tx as Hex) !== row.tx_id.toLowerCase()).map((row) => row.id);
}

export async function answered(converter: Converter, path: string, forged?: unknown): Promise<readonly [number, string]> {
  const init = forged === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forged) };
  const response = await converter.mf.dispatchFetch(`https://slop-fee-converter.test${path}`, init);
  return [response.status, await response.text()];
}

export function bundledText(path: string): string {
  return readFileSync(path, "utf8");
}

/** @throws {never} */
export function signerMarkers(script: string): ReadonlyArray<string> {
  return [...new Set([...script.matchAll(/slop-signer:[\w:-]+/gu)].map((found) => found[0]))].sort();
}

export function stagingVars(): Readonly<Record<string, string>> {
  const file = JSON.parse(readFileSync(new URL("../../../wrangler/feeConverter.staging.jsonc", import.meta.url), "utf8")) as { readonly vars: Readonly<Record<string, string>> };
  return file.vars;
}

/** @throws {never} */
export function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
