// spec/settlement/referralPublication.md, "The next immutable filed tree supplies every root entry"; spec/settlement/referralPublication.md, "Every signed root reserves gas and journals its exact identity first"; spec/settlement/referralPublication.md, "Only exact finalized evidence makes a root claimable"; spec/settlement/referralPublication.md, "A claim uses the active root's pinned wallet and cumulative amount"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Redacted } from "effect";
import type { D1Database } from "@repo/platform/bindings";
import type { Hex } from "@repo/platform/chain/evm";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__referralPublication.conformance.ts";
import type { Amount } from "../../gen/settlement__money.ts";
import type { Accrual, RootEntry } from "../../gen/settlement__referralAccrual.ts";
import type { Distributor } from "../../gen/settlement__referralDistributor.ts";
import type { PostingNetwork } from "../../gen/settlement__referrals.ts";
import type { Event, Publication, Root } from "../../gen/settlement__referralPublication.ts";
import { fromAmount } from "../../src/kernels/amounts.ts";
import { blankSetup } from "../../src/referrals/accrual.vibe";
import type { Deployment } from "../../src/referrals/distributor.vibe";
import { type Evidence, type Session, applyInSession, commit, dayText, openLedger, periodText, sessionOf } from "../../src/referrals/publication.vibe";

const SLOTS = 32;
const DAY_MILLIS = 86_400_000;
const mf = startWorker({ d1: Object.fromEntries(Array.from({ length: SLOTS }, (_, slot) => [`POSTS_${slot}`, `referral-publication-conformance-${slot}`])) });
const clock = settableClock(1);
const runtimeOver = (db: D1Database) => ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));
type Runtime = ReturnType<typeof runtimeOver>;
type Shell<A> = Effect.Effect<A, unknown, ManagedRuntime.ManagedRuntime.Services<Runtime>>;

const hexOf = (index: number, width: number) => `0x${index.toString(16).padStart(width, "0")}` as Hex;
const tokenAddress = hexOf(0xc0ffee, 40);
const deployments: Readonly<Record<PostingNetwork, Deployment>> = {
  RobinhoodTestnet: { networkKey: "robinhood-testnet", network: "RobinhoodTestnet", chainId: 46630n, distributor: hexOf(0xd1, 40), token: tokenAddress, poster: hexOf(0xb0, 40), deploymentBlock: 0n, codeHash: hexOf(1, 64), urls: Redacted.make(["http://127.0.0.1:9"]) },
  RobinhoodMainnet: { networkKey: "robinhood-mainnet", network: "RobinhoodMainnet", chainId: 4663n, distributor: hexOf(0xd2, 40), token: tokenAddress, poster: hexOf(0xb1, 40), deploymentBlock: 0n, codeHash: hexOf(2, 64), urls: Redacted.make(["http://127.0.0.1:9"]) },
};

interface World {
  readonly db: D1Database;
  readonly runtime: Runtime;
  deployment: Deployment;
  accrual: Accrual;
  base: Session;
  current: Session;
  pending: Array<{ readonly event: Event; readonly by: string }>;
  refreshes: number;
}

let slot = -1;
let world: World | undefined;
const hexes = new Map<string, Hex>();
const names = new Map<string, string>([[tokenAddress, "token"]]);

const live = () => {
  if (world === undefined) throw new Error("the referral publication driver was not reset");
  return world;
};

const run = <A>(program: Shell<A>) => live().runtime.runPromise(program);

const rootHex = (name: string) => {
  if (name === "") return "";
  const known = hexes.get(name);
  if (known !== undefined) return known;
  const made = hexOf(hexes.size + 1, 64);
  hexes.set(name, made);
  names.set(made, name);
  return made;
};

const tokenOf = (name: string) => (name === "" ? "" : tokenAddress);

const chainTerms = (chain: Distributor): Distributor => ({ ...chain, token: tokenOf(chain.token), epochs: chain.epochs.map((epoch) => ({ ...epoch, root: rootHex(epoch.root) })) });

function shellTerms(event: Event): Event {
  switch (event.type) {
    case "prepare":
      return { ...event, merkleRoot: rootHex(event.merkleRoot), chain: chainTerms(event.chain) };
    case "journal":
      return { ...event, chain: chainTerms(event.chain) };
    case "finalize":
      return { ...event, rootReceipt: { ...event.rootReceipt, merkleRoot: rootHex(event.rootReceipt.merkleRoot) } };
    default:
      return event;
  }
}

async function attempt<A>(program: Shell<A>): Promise<{ readonly accepted: A } | "refused"> {
  const exit = await live().runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return { accepted: exit.value };
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return "refused";
  throw error;
}

async function reopen() {
  const state = live();
  state.base = sessionOf(await run(openLedger(state.deployment, state.accrual)));
  let current = state.base;
  for (const step of state.pending) current = await run(applyInSession(current, step.event, step.by));
  state.current = current;
}

async function seedFile(root: Root) {
  const { db } = live();
  const period = periodText(root.period);
  const found = await db.prepare("SELECT epoch FROM referral_accrual_files WHERE period = ?").bind(period).all();
  if (found.results.length > 0) return;
  const [filed] = (await db.prepare("SELECT count(*) AS n FROM referral_accrual_files").all()).results;
  const count = Number(filed?.n ?? 0);
  const insert = (text: string, epoch: number, merkle: string | null, total: string, leaves: number) =>
    db.prepare("INSERT INTO referral_accrual_files (period, epoch, run_id, mode, body, body_sha256, merkle_root, tree_total_base, leaf_count, created_at) VALUES (?, ?, 'rrun_conformance', 'dry_run', '{}', ?, ?, ?, ?, ?)")
      .bind(text, epoch, "0".repeat(64), merkle, total, leaves, new Date(clock.now()).toISOString());
  const gaps = Array.from({ length: Math.max(0, root.id - 1 - count) }, (_, index) => root.period - (root.id - 1 - count) + index);
  await db.batch([
    ...gaps.map((ordinal, index) => insert(periodText(ordinal), count + index, null, "0", 0)),
    insert(period, count + gaps.length, root.entries.length === 0 ? null : root.merkleRoot, fromAmount(root.total).toString(), root.entries.length),
  ]);
}

function evidenceFor(event: Event, state: World): Evidence {
  switch (event.type) {
    case "journal":
      return { signed: { id: `rpost_attempt_${event.attempt}`, runId: "rrun_conformance", raw: `0x02${event.attempt.toString(16).padStart(16, "0")}`, txId: hexOf(event.attempt, 64), nonce: event.attempt, poster: state.deployment.poster } };
    case "loseObservation":
      return { reason: "receipt not observed; nonce still free" };
    case "finalize":
      return { blockNumber: BigInt(event.rootReceipt.height), settledDay: dayText(event.rootReceipt.settledDay) };
    case "finalizeFailure":
      return { blockNumber: 1n, settledDay: dayText(event.settledDay) };
    case "acknowledgeVoid":
      return { note: "The operator recorded the correction for this void." };
    case "refreshCache": {
      const { current } = state;
      const walletOf = new Map(current.state.pins.map((pin) => [pin.actor, pin.wallet]));
      state.refreshes += 1;
      return {
        cache: JSON.stringify({
          block: { number: String(state.refreshes) },
          paused: event.paused,
          latestPaused: false,
          claimed: Object.fromEntries(current.state.claims.map((claim) => [walletOf.get(claim.actor) ?? "", fromAmount(claim.cumulative).toString()])),
          claimedEpochs: current.state.roots.filter((root) => root.sealed).map((root) => root.epoch),
          epochs: current.state.roots.map((root) => ({ epoch: root.epoch, voided: root.voided })),
        }),
      };
    }
    default:
      return {};
  }
}

async function send(model: Event, by: unknown) {
  const state = live();
  const sender = typeof by === "string" ? by : "";
  const event = shellTerms(model);
  clock.advance(1);
  if (event.type === "setPostingPaused")
    throw new Error("the frozen referral schema stores no poster operational pause, so setPostingPaused has no shell operation (owner decision in the contracts-referrals:U2 report)");
  const verdict = await attempt(applyInSession(state.current, event, sender));
  if (verdict === "refused") return "refused" as const;
  if (event.type === "prepare" || event.type === "discardPrepared") {
    if (event.type === "prepare") {
      state.accrual = event.a;
      state.deployment = deployments[event.network];
    }
    state.pending.push({ event, by: sender });
    state.current = verdict.accepted;
    return "accepted" as const;
  }
  if (event.type === "observeDay") {
    clock.set(Math.max(clock.now() + 1, (event.day - 1) * DAY_MILLIS + 1));
    await reopen();
    return "accepted" as const;
  }
  if (event.type === "journal") {
    await seedFile(state.current.state.prepared);
    const steps = [...state.pending, { event, by: sender, evidence: evidenceFor(event, state) }];
    state.pending = [];
    state.base = sessionOf(await run(openLedger(state.deployment, state.accrual)));
    await run(commit(state.base, steps));
    await reopen();
    return "accepted" as const;
  }
  await run(commit(state.base, [{ event, by: sender, evidence: evidenceFor(event, state) }]));
  await reopen();
  return "accepted" as const;
}

const units = (amount: Amount) => fromAmount(amount).toString();
const nameOf = (text: string) => names.get(text) ?? text;
const entryView = (entry: RootEntry) => [entry.actor, entry.wallet, units(entry.amount)];
const rootView = (root: Root) => ({ ...root, merkleRoot: nameOf(root.merkleRoot), entries: root.entries.map(entryView), total: units(root.total) });
const project = (state: Publication) => ({
  phase: state.phase,
  prepared: state.phase === "Idle" ? null : rootView(state.prepared),
  roots: state.roots.map(rootView),
  attempts: state.attempts,
  claims: state.claims.map((claim) => [claim.actor, units(claim.cumulative)]),
  pins: state.pins,
  token: nameOf(state.token),
  tokenUnit: units(state.tokenUnit),
  currentAttempt: state.currentAttempt,
  day: state.day,
  settledGas: state.settledGas,
  nativeHold: state.nativeHold,
  postingPaused: state.postingPaused,
  distributorPaused: state.distributorPaused,
  cacheFresh: state.cacheFresh,
  network: state.network,
});
type View = ReturnType<typeof project>;

export const driver: Driver<View> & AsyncDisposable = {
  reset: async () => {
    slot += 1;
    if (slot >= SLOTS) throw new Error(`the referral publication driver has only ${SLOTS} fresh databases`);
    const binding = `POSTS_${slot}`;
    const failed = (await migrate(mf, binding, migrationsDir)).find((applied) => applied.error !== undefined);
    if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
    await world?.runtime.dispose();
    clock.set(1);
    const db = await database(mf, binding);
    const runtime = runtimeOver(db);
    const deployment = deployments.RobinhoodTestnet;
    const accrual = blankSetup(new Map()).start;
    const base = sessionOf(await runtime.runPromise(openLedger(deployment, accrual)));
    world = { db, runtime, deployment, accrual, base, current: base, pending: [], refreshes: 0 };
  },
  dispatch: (_key, event, by) => send(event, by),
  observe: async () => {
    const state = live();
    if (state.pending.length === 0) await reopen();
    return project(state.current.state);
  },
  [Symbol.asyncDispose]: async () => {
    await world?.runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { keys: ["publication"], walks: 0, view: project };
