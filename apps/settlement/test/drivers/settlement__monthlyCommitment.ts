// spec/settlement/monthlyCommitment.md, "The first authorization records the frozen funded allocation once"; spec/settlement/monthlyCommitment.md, "EVM signs the remaining sources at one finalized block; a source change makes a new attempt"; spec/settlement/monthlyCommitment.md, "The first authorization, signed attempts and freeze time are immutable"; spec/settlement/monthlyCommitment.md, "The attester re-reads the signing facts at the same finalized height and refuses without signing"
import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { privateKeyToAccount } from "viem/accounts";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/settlement__monthlyCommitment.conformance.ts";
import type { ChainFamily, ChainView, Commitment, Event, FundedMonth, LegacyAuthorization } from "../../gen/settlement__monthlyCommitment.ts";
import { fromAmount, toAmount } from "../../src/kernels/amounts.ts";
import { type Period, formatPeriod } from "../../src/kernels/calendar.ts";
import { type JournalContext, type JournalKey, type ObservedRun, type SignedPlan, loadJournal, runJournal } from "../../src/monthlyCommitment/store.vibe";

const NETWORK = "base-sepolia";
const keys: Readonly<Record<string, `0x${string}`>> = {
  attester: "0x1111111111111111111111111111111111111111111111111111111111111111",
  next: "0x2222222222222222222222222222222222222222222222222222222222222222",
  anyone: "0x3333333333333333333333333333333333333333333333333333333333333333",
};
const signers = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, privateKeyToAccount(key)]));
const addressOf = (name: string) => signers[name]?.address.toLowerCase() ?? name;
const nameOf = (address: string) => Object.keys(signers).find((name) => addressOf(name) === address) ?? address;

const mf = startWorker({ d1: { SLOP_DB: "monthly-commitment-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const clock = settableClock(1796342400 * 1000);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

interface World {
  readonly projectId: string;
  readonly attemptIds: Map<string, number>;
  readonly signers: Map<string, string>;
  family: ChainFamily;
  funded: FundedMonth | undefined;
  observed: ObservedRun | undefined;
  seeded: boolean;
}

let generation = 0;
let world: World = { projectId: "commitment-g0", attemptIds: new Map(), signers: new Map(), family: "EvmV2", funded: undefined, observed: undefined, seeded: false };

const keyOf = (w: World): JournalKey => ({ projectId: w.projectId, period: (w.funded?.period ?? 202611) as Period, network: NETWORK });

const storedMonthOf = (projectId: string, month: FundedMonth): FundedMonth => ({
  ...month,
  project: projectId,
  snapshotDigest: month.snapshotDigest === "" ? "" : sha(month.snapshotDigest),
});

const storedMonth = (w: World): FundedMonth | undefined => w.funded === undefined ? undefined : storedMonthOf(w.projectId, w.funded);

const seed = async (w: World) => {
  if (w.seeded || w.funded === undefined) return;
  const period = formatPeriod(w.funded.period as Period);
  const snapshot = JSON.stringify({ project: w.projectId, period, digest: w.funded.snapshotDigest });
  await db.prepare("INSERT INTO monthly_reward_bases (project_id, period, manifest, manifest_sha256, source_snapshot_sha256, cap_base, recipient_count, created_at) VALUES (?, ?, '{}', ?, ?, ?, 0, '2026-12-04T00:00:00.000Z')").bind(w.projectId, period, sha("{}"), sha(w.projectId), fromAmount(w.funded.cap).toString()).run();
  await db.prepare("INSERT INTO monthly_payment_runs (project_id, period, trigger, actor_id, allocation_sequence, snapshot, snapshot_sha256, network, vault, total_gross_base, frozen_at, obligations_created_at) VALUES (?, ?, 'automatic', NULL, 0, ?, ?, ?, 'vault', ?, '2026-12-04T00:00:00.000Z', NULL)").bind(w.projectId, period, snapshot, sha(w.funded.snapshotDigest), NETWORK, fromAmount(w.funded.wholeGross).toString()).run();
  await db.prepare("UPDATE monthly_payment_runs SET obligations_created_at = '2026-12-04T00:00:01.000Z' WHERE project_id = ? AND period = ?").bind(w.projectId, period).run();
  w.seeded = true;
};

const persistLegacy = async (w: World, legacy: LegacyAuthorization) => {
  if (w.funded === undefined) return;
  const period = formatPeriod(w.funded.period as Period);
  const messageHex = sha(`legacy:${legacy.root}`);
  const signer = signers[legacy.signer];
  const signatureHex = signer === undefined ? "" : (await signer.sign({ hash: `0x${messageHex}` })).slice(2);
  const authorization = JSON.stringify({
    plan: {
      family: "evm",
      allocationRoot: legacy.root,
      messageHex,
      totalGrossBase: fromAmount(legacy.wholeGross).toString(),
      entries: Array.from({ length: legacy.leafCount }, (_, index) => ({ sourceDigest: `legacy-${index}` })),
    },
    signatureHex,
  });
  await db.prepare("INSERT INTO monthly_payment_authorizations (project_id, period, network, snapshot_sha256, authorization, published_at) VALUES (?, ?, ?, ?, ?, '2026-12-04T00:00:00.000Z') ON CONFLICT DO NOTHING")
    .bind(w.projectId, period, NETWORK, sha(legacy.snapshotDigest), authorization).run();
};

const signedFor = (w: World, event: Event & { readonly root: string }): SignedPlan => {
  const view = w.observed?.view;
  const month = w.funded;
  const leaves = (month?.leaves ?? []).filter((leaf) => w.family === "SolanaV3" || !(view?.consumed ?? []).includes(leaf.source));
  const remaining = leaves.reduce((sum, leaf) => sum + fromAmount(leaf.gross), 0n).toString();
  const messageHex = sha(`${event.root}:${view?.sourceSequence ?? 0}`);
  const request = { projectId: w.projectId, period: formatPeriod((month?.period ?? 202611) as Period), network: NETWORK, snapshotSha256: sha(month?.snapshotDigest ?? "") };
  const plan = {
    request,
    deployment: { network: NETWORK, vault: "vault" },
    family: w.family === "SolanaV3" ? "solana" as const : "evm" as const,
    allocationRoot: event.root,
    messageHex,
    totalGrossBase: w.family === "SolanaV3" ? remaining : fromAmount(month?.wholeGross ?? [0]).toString(),
    ...(w.family === "SolanaV3" ? { frozenAt: String(view?.time ?? 0) } : { evmReservation: { version: 2 as const, allocationDigest: `0x${request.snapshotSha256}`, allocationRoot: event.root, wholeGross: fromAmount(month?.wholeGross ?? [0]).toString(), remainingGross: remaining, count: leaves.length, sourceSequence: String(view?.sourceSequence ?? 0) } }),
    entries: leaves.map((leaf) => ({ githubUserId: String(leaf.actor), grossMicro: fromAmount(leaf.gross).toString(), sourceDigest: leaf.source })),
  };
  return { plan, signatureHex: "" };
};

const signature = async (signed: SignedPlan, by: string): Promise<SignedPlan> => {
  const signer = signers[by];
  if (signer === undefined) return signed;
  const hex = await signer.sign({ hash: `0x${signed.plan.messageHex}` });
  return { ...signed, signatureHex: hex.slice(2) };
};

const translatedView = (view: ChainView): ChainView => ({ ...view, authority: addressOf(view.authority) });

const observedFrom = (state: Commitment, attemptIds: Map<string, number>, recordedSigners: Map<string, string>): ObservedRun => ({
  view: state.view,
  facts: state.facts,
  clock: state.clock,
  phase: state.phase,
  refusal: state.refusal,
  held: state.held,
  admittedRoot: state.admittedRoot,
  admittedLegacy: state.admittedLegacy,
  ...(state.legacy.root !== "" ? { legacy: state.legacy } : {}),
  attemptIds,
  signers: recordedSigners,
});

const contextOf = (w: World): JournalContext => ({
  family: w.family,
  funded: storedMonth(w),
  authority: w.observed?.view.authority ?? addressOf("attester"),
  observed: w.observed,
});

const dispatch = async (event: Event, by: string) => {
  const w = world;
  const sent: Event = event.type === "authorize"
    ? { type: "authorize", family: event.family, month: storedMonthOf(w.projectId, event.month) }
    : event.type === "observe"
      ? { type: "observe", view: translatedView(event.view) }
      : event.type === "observeFacts"
        ? { type: "observeFacts", facts: { ...event.facts, snapshotDigest: event.facts.snapshotDigest === "" ? "" : sha(event.facts.snapshotDigest) } }
        : event.type === "retainLegacy"
          ? { type: "retainLegacy", legacy: { ...event.legacy, snapshotDigest: event.legacy.snapshotDigest === "" ? "" : sha(event.legacy.snapshotDigest), signer: addressOf(event.legacy.signer) } }
          : event;
  const signed = (event.type === "signEvm" || event.type === "signSolana") && w.funded !== undefined ? await signature(signedFor(w, event), by) : undefined;
  const next = await runtime.runPromise(runJournal(keyOf(w), contextOf(w), { events: [sent], by: addressOf(by), signed }).pipe(
    Effect.catchTags({ Rejected: () => Effect.succeed(undefined) }),
  ));
  if (next === undefined) return "refused" as const;
  if (event.type === "authorize") {
    w.family = event.family;
    w.funded = event.month;
    if (next.phase === "Authorized") await seed(w);
  }
  if (event.type === "retainLegacy") await persistLegacy(w, event.legacy);
  if ((event.type === "signEvm" || event.type === "signSolana") && next.attempts.length > w.attemptIds.size) {
    w.attemptIds.set(event.root, event.attemptId);
    if (event.type === "signSolana") w.signers.set(event.root, addressOf(by));
  }
  w.observed = observedFrom(next, w.attemptIds, w.signers);
  return "accepted" as const;
};

const modelDigest = (w: World, digest: string) => w.funded !== undefined && digest === sha(w.funded.snapshotDigest) ? w.funded.snapshotDigest : digest;

const observed = async (): Promise<Commitment> => {
  const w = world;
  const { state: journal } = await runtime.runPromise(loadJournal(keyOf(w), contextOf(w)));
  return {
    ...journal,
    month: { ...journal.month, project: w.funded !== undefined && journal.month.project === w.projectId ? w.funded.project : journal.month.project, snapshotDigest: modelDigest(w, journal.month.snapshotDigest) },
    attempts: journal.attempts.map((attempt) => ({ ...attempt, signer: nameOf(attempt.signer) })),
    legacy: { ...journal.legacy, signer: nameOf(journal.legacy.signer), snapshotDigest: modelDigest(w, journal.legacy.snapshotDigest) },
  };
};

const canonicalAmount = (amount: ReadonlyArray<number>) => toAmount(fromAmount([...amount]));

const view = (state: Commitment) => ({
  family: state.family,
  phase: state.phase,
  month: {
    ...state.month,
    wholeGross: canonicalAmount(state.month.wholeGross),
    cap: canonicalAmount(state.month.cap),
    leaves: state.month.leaves.map((leaf) => ({ ...leaf, gross: canonicalAmount(leaf.gross) })),
  },
  attempts: state.attempts.map((attempt) => ({ root: attempt.root, remainingGross: canonicalAmount(attempt.remainingGross), leafCount: attempt.leafCount, frozenAt: attempt.frozenAt, signer: attempt.signer })),
  admittedRoot: state.admittedRoot,
  frozenAt: state.frozenAt,
});

export const driver: Driver<ReturnType<typeof view>> & AsyncDisposable = {
  reset: () => {
    generation++;
    world = { projectId: `commitment-g${generation}`, attemptIds: new Map(), signers: new Map(), family: "EvmV2", funded: undefined, observed: undefined, seeded: false };
    clock.set(1796342400 * 1000);
  },
  dispatch: (_key, event: Event, by) => dispatch(event, typeof by === "string" ? by : ""),
  observe: async () => view(await observed()),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<ReturnType<typeof view>> = { keys: ["journal"], walks: 0, view };
