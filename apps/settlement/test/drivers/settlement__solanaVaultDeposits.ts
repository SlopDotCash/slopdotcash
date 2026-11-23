// spec/settlement/solanaVaultDeposits.md, "A run reads newest first below the interval it resumes and above the covered position"; spec/settlement/solanaVaultDeposits.md, "Rules"
import { Effect, Layer, ManagedRuntime } from "effect";
import { base58Encode } from "@repo/platform/chain/solana";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__solanaVaultDeposits.conformance.ts";
import type { Event, SolanaDeposits } from "../../gen/settlement__solanaVaultDeposits.ts";
import { type DepositKey, type SolanaDepositSession, type VaultDepositRecord, openSolanaDeposits } from "../../src/deposits/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "solana-vault-deposits-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto));

const PAGE = 2;
const LAST_TRANSACTION = 4;
const DEPOSIT_TRANSACTIONS = [2, 4];
const DEPOSITOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

type View = Pick<SolanaDeposits, "position" | "pending" | "resume" | "recorded">;

interface Cluster {
  readonly session: SolanaDepositSession;
  readonly key: DepositKey;
  readonly signatures: ReadonlyArray<string>;
  readonly numbers: ReadonlyMap<string, number>;
  readonly pages: Map<number, ReadonlyArray<string>>;
  newest: number;
}

let generation = 0;
const clusters = new Map<string, Cluster>();

const signatureOf = (serial: number, transaction: number) => base58Encode(Uint8Array.from({ length: 64 }, (_, at) => (at === 0 ? 1 + transaction : at === 1 ? serial % 251 : at === 2 ? Math.floor(serial / 251) % 251 : 7 + at)));

const clusterOf = async (key: string) => {
  const known = clusters.get(key);
  if (known !== undefined) return known;
  const deposits: DepositKey = { projectId: `solana-deposits-${generation}-${key}`, network: "solana-mainnet", chain: "solana", vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" };
  const serial = generation * 10 + clusters.size;
  const signatures = Array.from({ length: LAST_TRANSACTION + 1 }, (_, transaction) => signatureOf(serial, transaction));
  const session = await runtime.runPromise(openSolanaDeposits(deposits, PAGE));
  const opened: Cluster = { session, key: deposits, signatures, numbers: new Map(signatures.map((signature, transaction) => [signature, transaction])), pages: new Map(), newest: 1 };
  clusters.set(key, opened);
  return opened;
};

const numberOf = (cluster: Cluster, signature: string | null) => (signature === null ? 0 : cluster.numbers.get(signature) ?? -1);

const listed = async (cluster: Cluster) => {
  const at = await runtime.runPromise(cluster.session.cursor());
  const below = at.resumeBefore === null ? cluster.newest + 1 : numberOf(cluster, at.resumeBefore);
  const above = numberOf(cluster, at.position);
  const page: string[] = [];
  for (let transaction = below - 1; transaction > above && page.length < PAGE; transaction--) page.push(cluster.signatures[transaction] ?? "");
  return { at, page };
};

const recordsOf = (cluster: Cluster, signature: string | undefined): ReadonlyArray<VaultDepositRecord> => {
  const transaction = signature === undefined ? 0 : numberOf(cluster, signature);
  return signature === undefined || !DEPOSIT_TRANSACTIONS.includes(transaction)
    ? []
    : [{ transactionId: signature, eventIndex: 0, depositor: DEPOSITOR, amount: 7n, blockNumber: BigInt(100 + transaction), blockTime: 1_800_000_000 + transaction }];
};

const refusedOn = <A>(sent: Effect.Effect<A, { readonly _tag: string }, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.map((value) => ({ kind: "accepted" as const, value })),
  Effect.catchTags({ Rejected: () => Effect.succeed({ kind: "refused" as const }) }),
));

export const driver: Driver<View> & AsyncDisposable = {
  reset: () => {
    generation++;
    clusters.clear();
  },
  dispatch: async (key, event: Event, by) => {
    const cluster = await clusterOf(key);
    const sender = typeof by === "string" ? by : "";
    if (event.type === "arrive") {
      if (sender !== "chain" || cluster.newest >= LAST_TRANSACTION) return "refused";
      cluster.newest += 1;
      return "accepted";
    }
    if (event.type === "startRun") {
      const { at, page } = await listed(cluster);
      const started = await refusedOn(cluster.session.start(event.slot, sender, at, page));
      if (started.kind === "accepted") cluster.pages.set(event.slot, page);
      return started.kind;
    }
    if (event.type === "readTransaction") {
      const page = cluster.pages.get(event.slot) ?? [];
      const read = await refusedOn(cluster.session.read(event.slot, sender, recordsOf(cluster, page[0])));
      if (read.kind === "accepted" && read.value === "Read") cluster.pages.set(event.slot, page.slice(1));
      if (read.kind === "accepted" && read.value === "Overtaken") cluster.pages.delete(event.slot);
      return read.kind;
    }
    const ended = await refusedOn(event.type === "failRun" ? cluster.session.fail(event.slot, sender) : cluster.session.finish(event.slot, sender));
    if (ended.kind === "accepted") cluster.pages.delete(event.slot);
    return ended.kind;
  },
  observe: async (key) => {
    const cluster = await clusterOf(key);
    const at = await runtime.runPromise(cluster.session.cursor());
    const found = await db.prepare("SELECT DISTINCT transaction_id FROM vault_deposits WHERE project_id = ?").bind(cluster.key.projectId).all();
    return {
      position: numberOf(cluster, at.position),
      pending: numberOf(cluster, at.pendingTop),
      resume: numberOf(cluster, at.resumeBefore),
      recorded: found.results.map((row) => numberOf(cluster, typeof row.transaction_id === "string" ? row.transaction_id : null)).sort((left, right) => left - right),
    };
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = {
  view: (state) => ({ position: state.position, pending: state.pending, resume: state.resume, recorded: [...state.recorded].sort((left, right) => left - right) }),
  keys: ["a", "b"],
  walks: 4,
  steps: 16,
};
