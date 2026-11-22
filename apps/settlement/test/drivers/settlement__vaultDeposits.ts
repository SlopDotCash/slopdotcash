// spec/settlement/vaultDeposits.md, "A run reads pages up to the finalized block and stores each page with its cursor"; spec/settlement/vaultDeposits.md, "Rules"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__vaultDeposits.conformance.ts";
import type { Event, EvmDeposits } from "../../gen/settlement__vaultDeposits.ts";
import { type DepositKey, type EvmDepositSession, type VaultDepositRecord, openEvmDeposits } from "../../src/deposits/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "vault-deposits-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto));

const DEPOSIT_BLOCKS = [2, 5];
const LAST_BLOCK = 6;
const DEPOSITOR = `0x${"ab".repeat(20)}`;

interface Chain {
  readonly session: EvmDepositSession;
  readonly key: DepositKey;
  readonly serial: number;
  finalized: number;
}

let generation = 0;
const chains = new Map<string, Chain>();

const keyOf = (key: string): DepositKey => ({ projectId: `vault-deposits-${generation}-${key}`, network: "base-mainnet", chain: "base", vault: `0x${"2".repeat(40)}` });

const chainOf = async (key: string) => {
  const known = chains.get(key);
  if (known !== undefined) return known;
  const deposits = keyOf(key);
  const session = await runtime.runPromise(openEvmDeposits(deposits, { purpose: "OrdinaryVault", origin: 1, pageBlocks: 2 }));
  await runtime.runPromise(session.observe(1));
  const opened: Chain = { session, key: deposits, serial: generation * 100 + chains.size, finalized: 1 };
  chains.set(key, opened);
  return opened;
};

const recordsIn = (chain: Chain, run: EvmDeposits["first"]): ReadonlyArray<VaultDepositRecord> =>
  DEPOSIT_BLOCKS.filter((block) => run.active && block >= run.fromBlock && block <= run.toBlock).map((block) => ({
    transactionId: `0x${(chain.serial * 100 + block).toString(16).padStart(64, "0")}`,
    eventIndex: 0,
    depositor: DEPOSITOR,
    amount: 5n,
    blockNumber: BigInt(block),
    blockTime: 1_800_000_000 + block,
  }));

const outcome = (sent: Effect.Effect<unknown, { readonly _tag: string }, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const) }),
));

const recorded = async (chain: Chain) => {
  const found = await db.prepare("SELECT DISTINCT block_number FROM vault_deposits WHERE project_id = ?").bind(chain.key.projectId).all<{ block_number: string }>();
  return found.results.map((row) => Number(row.block_number)).sort((left, right) => left - right);
};

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    chains.clear();
  },
  dispatch: async (key, event: Event, by) => {
    const chain = await chainOf(key);
    if (event.type === "finalize") {
      if (by !== "chain" || chain.finalized >= LAST_BLOCK) return "refused";
      chain.finalized += 1;
      await runtime.runPromise(chain.session.observe(chain.finalized));
      return "accepted";
    }
    const sender = typeof by === "string" ? by : "";
    if (event.type !== "completePage") return outcome(chain.session.send(event, sender, []));
    const now = await runtime.runPromise(chain.session.current());
    return outcome(chain.session.send(event, sender, recordsIn(chain, event.slot === 1 ? now.first : now.second)));
  },
  observe: async (key) => {
    const chain = await chainOf(key);
    return { ...(await runtime.runPromise(chain.session.current())), recorded: await recorded(chain) };
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = {
  view: (state) => ({ ...state, recorded: [...state.recorded].sort((left, right) => left - right) }),
  keys: ["a", "b"],
  walks: 4,
  steps: 16,
};
