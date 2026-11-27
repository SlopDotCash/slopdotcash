import { Cause, Exit, ManagedRuntime, Redacted } from "effect";
import type { D1Database } from "@repo/platform/bindings";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { ApprovedAward } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/settlement__directBounty.conformance.ts";
import type { Network } from "../../gen/fees__runtime.ts";
import type { ArchivedIntent, DirectBounty, Event, Intent, QualifiedRoute, Retirement, Terms, Transfer, TxUse, Wallet } from "../../gen/settlement__directBounty.ts";
import type { DirectIntent, PaymentWallet } from "../../src/client/direct.vibe";
import type { EvmDirectRail } from "../../src/direct/evm.vibe";
import { type Entry, type Facts, type Snapshot, send, snapshot, walletModel } from "../../src/direct/journal.vibe";
import { fromAmount } from "../../src/kernels/amounts.ts";
import { bountyFeeBase, bountyResearcherBase } from "../../src/kernels/fees.ts";
import type { NetworkKey } from "../../src/kernels/networks.ts";

const mf = startWorker({ d1: { SLOP_DB: "direct-bounty-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db: D1Database = await database(mf, "SLOP_DB");
const runtime = ManagedRuntime.make(d1(db));

const networkKeys: Readonly<Record<Network, NetworkKey>> = { Base: "base-mainnet", Ethereum: "ethereum", Robinhood: "robinhood-mainnet", Solana: "solana-mainnet" };
const chains: Readonly<Record<Network, string>> = { Base: "base", Ethereum: "ethereum", Robinhood: "robinhood", Solana: "solana" };

interface Case {
  readonly caseId: string;
  readonly suffix: string;
  readonly otherUses: TxUse[];
  facts: Facts | undefined;
  terms: Terms | undefined;
}

let generation = 0;
let current: Case = await opened();

async function opened(): Promise<Case> {
  generation += 1;
  const suffix = `~g${generation}`;
  const caseId = `sc_conformance_${Date.now()}_${generation}`;
  const projectId = `conformance-${generation}-${Date.now()}`.slice(0, 48);
  const manifest = JSON.stringify({ id: projectId, status: "active" });
  const sha = "f".repeat(64);
  const now = "2026-11-16T00:00:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'conformance', ?)").bind(projectId, manifest, sha, now),
    db.prepare("INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)").bind(projectId, manifest, sha, now, now),
    db.prepare("INSERT INTO security_cases (id, project_id, advisory_repository, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, revision, created_at, updated_at) VALUES (?, ?, 'owner/repo', '2', 'reporter', 'verified', ?, ?, '7', 1, '{}', 'confirmed', 'resolved', 'approved', 'not-applicable', 'embargoed', 'private', 'none', 1, ?, ?)").bind(caseId, projectId, now, now, now, now),
    db.prepare("INSERT INTO security_direct_awards (case_id, project_id, root_cause_key, terms, gross_base, approved_at) VALUES (?, ?, ?, '{}', '4', ?)").bind(caseId, projectId, `root-${caseId}`, now),
  ]);
  return { caseId, suffix, otherUses: [], facts: undefined, terms: undefined };
}

const mapped = (text: string) => (text === "" ? "" : `${text}${current.suffix}`);
const unmapped = (text: string) => (text.endsWith(current.suffix) ? text.slice(0, -current.suffix.length) : text);

function limbsValid(amount: ReadonlyArray<number>) {
  return amount.length > 0 && amount.every((limb) => Number.isSafeInteger(limb) && limb >= 0 && limb <= 999);
}

function baseUnits(amount: ReadonlyArray<number>) {
  return fromAmount([...amount]);
}

function stored(wallet: Wallet): PaymentWallet | undefined {
  return wallet.claim <= 0 ? undefined : { id: `c${wallet.claim}`, address: mapped(wallet.address), digest: wallet.digest };
}

function representable(wallet: Wallet) {
  return wallet.claim > 0 ? wallet.address !== "" && wallet.digest !== "" : wallet.address === "" && wallet.digest === "";
}

function walletIn(snapshotted: Snapshot, wallet: Wallet): Wallet {
  return representable(wallet) ? walletModel(snapshotted.claims, stored(wallet)) : wallet;
}

function railOf(route: QualifiedRoute): EvmDirectRail {
  return { network: networkKeys[route.network], model: route.network, chainId: 0n, urls: Redacted.make([]), feeRecipient: mapped(route.feeWallet) };
}

const unadmitted: Facts = {
  approval: { caseId: "", projectId: "", caseRevision: 1, termsRevision: 1, direct: false, split: "StandardSplit", grossBaseUnits: "4", asset: "", rootCauseKey: "", approvedAt: "", network: "Base" },
  network: "Base",
  rail: { network: "base-mainnet", model: "Base", chainId: 0n, urls: Redacted.make([]), feeRecipient: "" },
  caseRevision: 1,
  reporterGithubId: "2",
  payerGithubId: "1",
  payerWallet: undefined,
  reporterWallet: undefined,
  otherUses: [],
};

function factsNow(): Facts {
  return { ...(current.facts ?? unadmitted), otherUses: current.otherUses };
}

function admissionFacts(event: Extract<Event, { type: "admit" }>): Facts | undefined {
  const { terms, approval, route, caseVersion } = event;
  const sameCase = approval.caseId === terms.caseId && approval.rootCause === terms.finding && approval.caseRevision === caseVersion;
  const sameAward = approval.asset === terms.asset && limbsValid(approval.gross) && limbsValid(terms.gross) && baseUnits(approval.gross) === baseUnits(terms.gross);
  const sameRoute = route.network === terms.network && route.asset === terms.asset && route.feeWallet === terms.feeWallet;
  if (!sameCase || !sameAward || !sameRoute || terms.caseId <= 0 || terms.project <= 0 || terms.finding <= 0) return undefined;
  const award: ApprovedAward = {
    caseId: current.caseId,
    projectId: "conformance",
    caseRevision: caseVersion,
    termsRevision: 1,
    direct: approval.direct,
    split: terms.split === "FullAward" || approval.split === "FullAward" ? "FullAward" : "StandardSplit",
    grossBaseUnits: baseUnits(terms.gross).toString(),
    asset: mapped(terms.asset),
    rootCauseKey: `root-${current.caseId}`,
    approvedAt: "2026-11-16T00:00:00.000Z",
    network: terms.network,
  };
  return { ...unadmitted, approval: award, network: terms.network, rail: railOf(route), caseRevision: caseVersion, reporterGithubId: String(terms.reporterActor), payerGithubId: String(terms.payerActor) };
}

function intentEntry(facts: Facts, intent: Intent): DirectIntent {
  const gross = BigInt(facts.approval.grossBaseUnits);
  const solana = facts.rail.model === "Solana";
  const transfers = [
    { recipient: mapped(intent.reporter.address), amountBase: (gross % 4n === 0n && gross > 0n ? bountyResearcherBase(gross) : 0n).toString() },
    { recipient: facts.rail.feeRecipient, amountBase: (gross % 4n === 0n && gross > 0n ? bountyFeeBase(gross) : 0n).toString() },
  ];
  const nonce = (value: number) => (value >= 0 ? `0x${value.toString(16)}` : String(value));
  return {
    protocolVersion: 2,
    preparedAt: "2026-11-16T00:00:00.000Z",
    afterBlock: String(intent.researcherAnchor),
    ...solana ? {} : { afterBlocks: [String(intent.researcherAnchor), String(intent.feeAnchor)] },
    rail: "direct",
    network: facts.rail.network,
    chain: chains[facts.rail.model],
    asset: { address: facts.approval.asset, decimals: 0, symbol: "" },
    payer: stored(intent.payer) ?? { id: "", address: "", digest: "" },
    recipient: stored(intent.reporter) ?? { id: "", address: "", digest: "" },
    grossBase: gross.toString(),
    feeBase: transfers[1]?.amountBase ?? "0",
    netBase: transfers[0]?.amountBase ?? "0",
    transfers,
    ...solana
      ? { solana: { transaction: mapped(intent.message) } }
      : { transactions: [intent.researcherNonce, intent.feeNonce].map((value, index) => ({ chainId: "0x0", from: mapped(intent.payer.address), nonce: nonce(value), to: transfers[index]?.recipient ?? "", value: "0x0", data: "0x" })) },
    payerGithubId: String(current.terms?.payerActor ?? 1),
  };
}

function mappedIntent(snapshotted: Snapshot, intent: Intent): Intent {
  return { ...intent, payer: walletIn(snapshotted, intent.payer), reporter: walletIn(snapshotted, intent.reporter), message: mapped(intent.message), earlierMessages: intent.earlierMessages.map(mapped) };
}

function mappedTransfer(transfer: Transfer): Transfer {
  return { ...transfer, asset: mapped(transfer.asset), payerAddress: mapped(transfer.payerAddress), researcherAddress: mapped(transfer.researcherAddress), feeAddress: mapped(transfer.feeAddress), transaction: mapped(transfer.transaction), message: mapped(transfer.message) };
}

function receiptOf(transfer: Transfer) {
  return { legIndex: transfer.lane === "Fee" ? 1 : 0, transactionId: mapped(transfer.transaction), blockHash: `0x${"0".repeat(64)}`, blockNumber: String(transfer.height), ...transfer.lane === "Both" ? { message: mapped(transfer.message) } : {} };
}

function retirementEntry(retirement: Retirement) {
  const kinds = { EvmRetired: "evm-nonce-retired", SameRequest: "consent-renewal", SolanaRetired: "solana-expired", Unverified: "unverified" } as const;
  return {
    kind: kinds[retirement.kind],
    legIndex: retirement.lane === "Fee" ? 1 : 0,
    nonce: String(retirement.nonce),
    blockNumber: String(retirement.height),
    transactionId: retirement.observation,
    message: mapped(retirement.message),
    coveredMessages: retirement.coveredMessages.map(mapped),
  };
}

type Plan = { readonly facts: Facts; readonly extra: ReadonlyArray<PaymentWallet | undefined>; readonly eventOf: (snapshotted: Snapshot) => Event; readonly entry: Entry | undefined; readonly after?: (next: DirectBounty) => void };

function plan(event: Event, by: number): Plan | "refused" {
  const facts = factsNow();
  const now = "2026-11-16T00:00:00.000Z";
  switch (event.type) {
    case "admit": {
      if (current.facts !== undefined) return "refused";
      const candidate = admissionFacts(event);
      if (candidate === undefined) return "refused";
      return { facts: candidate, extra: [], eventOf: () => event, entry: undefined };
    }
    case "observeCaseRevision":
      return { facts, extra: [], eventOf: () => event, entry: undefined };
    case "observeWallets": {
      const representableRead = representable(event.payerWallet) && representable(event.reporterWallet);
      return {
        facts,
        extra: [stored(event.payerWallet), stored(event.reporterWallet)],
        eventOf: (snapshotted) => ({ ...event, payerWallet: walletIn(snapshotted, event.payerWallet), reporterWallet: walletIn(snapshotted, event.reporterWallet), authorizedRead: event.authorizedRead && representableRead }),
        entry: undefined,
        after: () => {
          const payer = stored(event.payerWallet);
          const reporter = stored(event.reporterWallet);
          current.facts = { ...facts, payerWallet: payer === undefined ? undefined : { address: payer.address, claimId: payer.id, digest: payer.digest }, reporterWallet: reporter === undefined ? undefined : { address: reporter.address, claimId: reporter.id, digest: reporter.digest } };
        },
      };
    }
    case "consent": {
      const recipient = stored(event.wallet);
      const deployment = JSON.stringify({ rail: "direct", network: facts.rail.network, asset: { address: facts.approval.asset, decimals: 0, symbol: "" }, recipient: recipient ?? { id: "", address: "", digest: "" } });
      return { facts, extra: [recipient], eventOf: (snapshotted) => ({ ...event, wallet: walletIn(snapshotted, event.wallet) }), entry: { kind: "consent", deployment, reporterGithubId: String(by), acceptedAt: now } };
    }
    case "prepare":
      return { facts, extra: [stored(event.intent.payer), stored(event.intent.reporter)], eventOf: (snapshotted) => ({ ...event, intent: mappedIntent(snapshotted, event.intent) }), entry: { kind: "intent", intent: intentEntry(facts, event.intent) } };
    case "recordOtherUse":
      return { facts, extra: [], eventOf: () => ({ ...event, use: { ...event.use, transaction: mapped(event.use.transaction) } }), entry: undefined, after: () => { current.otherUses.push({ network: event.use.network, transaction: mapped(event.use.transaction) }); } };
    case "recordTransfer":
      return { facts, extra: [], eventOf: () => ({ ...event, transfer: mappedTransfer(event.transfer) }), entry: { kind: "receipts", network: facts.rail.network, verifiedAt: now, proofs: [receiptOf(event.transfer)] } };
    case "recordPair":
      return { facts, extra: [], eventOf: () => ({ ...event, pair: { researcher: mappedTransfer(event.pair.researcher), fee: mappedTransfer(event.pair.fee) } }), entry: { kind: "receipts", network: facts.rail.network, verifiedAt: now, proofs: [receiptOf(event.pair.researcher), receiptOf(event.pair.fee)] } };
    case "recover":
      return {
        facts,
        extra: [stored(event.successor.payer), stored(event.successor.reporter)],
        eventOf: (snapshotted) => ({ ...event, successor: mappedIntent(snapshotted, event.successor), retirement: { ...event.retirement, message: mapped(event.retirement.message), coveredMessages: event.retirement.coveredMessages.map(mapped) } }),
        entry: { kind: "successor", generation: event.successor.generation, intent: intentEntry(facts, event.successor), retirement: retirementEntry(event.retirement), actorGithubId: String(by), createdAt: now },
      };
  }
}

const refusals = new Set(["Rejected", "NotAnEvent", "Conflict", "ConstraintViolation", "DatabaseFailure"]);

async function dispatch(event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const actor = typeof by === "number" ? by : 0;
  const planned = plan(event, actor);
  if (planned === "refused") return "refused";
  if (event.type === "admit") {
    const admitted = await runtime.runPromise(snapshot(current.caseId, planned.facts));
    if (!admitted.state.admitted) return "refused";
    current.facts = planned.facts;
    current.terms = event.terms;
    return "accepted";
  }
  const exit = await runtime.runPromiseExit(send(current.caseId, planned.facts, planned.extra, planned.eventOf, actor, planned.entry));
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    if (typeof error === "object" && error !== null && "_tag" in error && refusals.has(String(error._tag))) return "refused";
    throw error;
  }
  planned.after?.(exit.value);
  if (current.facts !== undefined) current.facts = { ...current.facts, caseRevision: exit.value.caseRevision };
  return "accepted";
}

function walletBack(claims: ReadonlyArray<string>, wallet: Wallet): Wallet {
  const id = claims[wallet.claim - 1];
  return wallet.claim <= 0 || id === undefined ? wallet : { claim: Number(id.slice(1)), address: unmapped(wallet.address), digest: wallet.digest };
}

function intentBack(claims: ReadonlyArray<string>, intent: Intent): Intent {
  return { ...intent, payer: walletBack(claims, intent.payer), reporter: walletBack(claims, intent.reporter), message: unmapped(intent.message), earlierMessages: intent.earlierMessages.map(unmapped) };
}

function transferBack(transfer: Transfer): Transfer {
  return { ...transfer, asset: unmapped(transfer.asset), payerAddress: unmapped(transfer.payerAddress), researcherAddress: unmapped(transfer.researcherAddress), feeAddress: unmapped(transfer.feeAddress), transaction: unmapped(transfer.transaction), message: unmapped(transfer.message) };
}

function archivedBack(claims: ReadonlyArray<string>, archived: ArchivedIntent): ArchivedIntent {
  return { intent: intentBack(claims, archived.intent), retirement: { ...archived.retirement, message: unmapped(archived.retirement.message), coveredMessages: archived.retirement.coveredMessages.map(unmapped) } };
}

async function observe(): Promise<DirectBounty> {
  const { state, claims } = await runtime.runPromise(snapshot(current.caseId, factsNow()));
  return {
    ...state,
    terms: state.admitted && current.terms !== undefined ? current.terms : state.terms,
    payerWallet: walletBack(claims, state.payerWallet),
    reporterWallet: walletBack(claims, state.reporterWallet),
    consent: walletBack(claims, state.consent),
    intent: intentBack(claims, state.intent),
    priorIntents: state.priorIntents.map((archived) => archivedBack(claims, archived)),
    researcherReceipt: transferBack(state.researcherReceipt),
    feeReceipt: transferBack(state.feeReceipt),
    otherUses: state.otherUses.map((use: TxUse) => ({ ...use, transaction: unmapped(use.transaction) })),
  };
}

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    current = await opened();
  },
  dispatch: (_key, event, by) => dispatch(event, by),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["case"], walks: 6, steps: 12 };
