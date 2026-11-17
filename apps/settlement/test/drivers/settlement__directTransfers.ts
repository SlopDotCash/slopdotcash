// spec/settlement/directTransfers.md, "An identical import is a no-op and a contradicting one fails the whole import"
import { Effect, Layer, ManagedRuntime } from "effect";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__directTransfers.conformance.ts";
import type { Disclosure, Disclosures, Event } from "../../gen/settlement__directTransfers.ts";
import { type DirectImportRow, decodedImport, importTransfers, storedRows } from "../../src/directTransfers/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "direct-transfers-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(d1(await database(mf, "SLOP_DB")));

let generation = 0;
const suffix = () => `-g${generation}`;
const importedAt = "2026-11-17T00:00:00.000Z";

const monthText = (month: number) => `${String(Math.trunc(month / 100)).padStart(4, "0")}-${String(month % 100).padStart(2, "0")}`;
const instant = (seconds: number) => (Number.isSafeInteger(seconds) && Math.abs(seconds) < 8_640_000_000_000 ? new Date(seconds * 1000).toISOString() : "invalid");

const rowOf = (d: Disclosure): DirectImportRow => ({
  network: d.network,
  transactionId: d.transaction === "" ? "" : `${d.transaction}${suffix()}`,
  projectId: d.project,
  contributionMonth: monthText(d.month),
  githubUserId: String(d.actor),
  githubNodeId: `node-${d.actor}`,
  login: `login-${d.actor}`,
  chain: d.chain,
  recipient: d.recipient,
  amountMicro: String(d.amountMicro),
  blockTime: instant(d.blockTime),
  blockId: d.block,
  sourcePath: "disclosures/conformance.json",
});

const imported = (event: Event) => runtime.runPromise(importTransfers(event.batch.map(rowOf), importedAt).pipe(
  Effect.as("accepted" as const),
  Effect.catchTag("DisclosureContradiction", () => Effect.succeed("accepted" as const)),
  Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
));

const observed = async (): Promise<Disclosure[]> => {
  const rows = await runtime.runPromise(storedRows(suffix()));
  return rows.map((row) => ({ ...row, transaction: row.transaction.slice(0, -suffix().length) }));
};

export const driver: Driver<Disclosure[]> & AsyncDisposable = {
  reset: () => {
    generation++;
  },
  dispatch: (_key, event: Event) => imported(event),
  receive: async (_key, raw) => {
    const decoded = await outcome(decodedImport(raw));
    if (decoded === "refused") return "refused";
    return imported(await Effect.runPromise(decodedImport(raw)));
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Disclosure[]> = { keys: ["disclosures"], view: (state: Disclosures) => state.rows, walks: 6, steps: 8 };
