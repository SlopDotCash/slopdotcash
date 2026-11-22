import { slopFeeBase, submissionFeeItem } from "@repo/backend/client";
import { webCrypto } from "@repo/platform/crypto";
import { reportDepositItem } from "@repo/security/client";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type Hex, decodeFunctionData, encodeAbiParameters, pad, parseAbi, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { FeeSetup, type FeePay, type PayAddress, openPayPage } from "../../src/screens/fee/payFlow.vibe";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";
import { sessionSlots } from "../../src/wallets/core/slots.ts";
import { depositedKey, feeDepositKey, publishedTerms } from "../../src/wallets/fee/feeCalls.ts";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const payerAddress = account.address.toLowerCase();
const base = publishedTerms.networks.find((network) => network.network === "base-mainnet");
const robinhood = publishedTerms.networks.find((network) => network.network === "robinhood-mainnet");
if (base === undefined || robinhood === undefined) throw new Error("published terms name base-mainnet and robinhood-mainnet");
const usdc = base.tokens.find((token) => token.symbol === "USDC");
const slop = robinhood.tokens.find((token) => token.symbol === "SLOP");
if (usdc === undefined || slop === undefined) throw new Error("published terms name USDC and SLOP");
const repositoryId = "123456";
const pullNumber = 7;
const caseId = "sc_reportcase01";
const pullItem = submissionFeeItem(repositoryId, pullNumber) ?? "";
const reportItem = reportDepositItem(caseId) ?? "";
const stableMinor = "2000000";
const rate = "250";
const slopAmount = slopFeeBase(stableMinor, rate) ?? "";
const reportAmount = (395n * 10n ** 18n).toString();
const depositedTopic = toEventSelector("Deposited(uint256,bytes32,address,address,uint128,address)");
const depositAbi = parseAbi(["function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)", "function approve(address,uint256) returns (bool)"]);
const askedAt = "2026-11-20T10:00:00.000Z";
const pullAddress: PayAddress = { kind: "pullRequest", owner: "acme", repo: "widget", number: String(pullNumber) };
const reportAddress: PayAddress = { kind: "report", caseId };
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  sessionStorage.clear();
});

const quantity = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const blockHash = (block: bigint) => `0x${block.toString(16).padStart(64, "b")}`;

function stableWay(overrides: Record<string, unknown> = {}) {
  return { network: base?.network, chainId: base?.chainId, contract: base?.contract, token: usdc?.address, symbol: "USDC", decimals: 6, amount: stableMinor, minimumAccepted: stableMinor, keptTo: publishedTerms.feeWallet, ...overrides };
}

function slopWay(amount: string, overrides: Record<string, unknown> = {}) {
  return { network: robinhood?.network, chainId: robinhood?.chainId, contract: robinhood?.contract, token: slop?.address, symbol: "SLOP", decimals: 18, amount, minimumAccepted: amount, keptTo: publishedTerms.burn, ...overrides };
}

function paid(network: string, token: string, amount: string, finalized: boolean) {
  return { at: "2026-11-20T11:00:00.000Z", network, depositId: 1, token, amount, transaction: `0x${"a".repeat(64)}`, finalized };
}

function pullRecord(due: ReadonlyArray<unknown>, settled: Record<string, unknown> = {}) {
  return { schema: "slop-submission-fee-item-v1", repositoryId: Number(repositoryId), pullNumber, projectId: "demo", item: pullItem, stableMinor, askedAt, due, paid: null, outcome: null, outcomeAt: null, resolveTransaction: null, ...settled };
}

function reportRecord(due: ReadonlyArray<unknown>, settled: Record<string, unknown> = {}) {
  return { schema: "slop-report-deposit-v1", caseId, item: reportItem, askedAt, due, paid: null, outcome: null, outcomeReason: null, outcomeAt: null, resolveTransaction: null, ...settled };
}

const registry = { schemaVersion: "1", projects: [{ id: "demo", name: "Demo", slug: "demo", status: "active", listingTier: "listed", authority: { repositoryId }, repositories: [{ id: "acme/widget", aliases: [] }] }] };

interface Api {
  item: unknown;
  report: unknown;
  rate: unknown;
  reads: string[];
}

function api(state: Partial<Api> = {}) {
  const held: Api = { item: undefined, report: undefined, rate: { schema: "slop-submission-fee-rate-v1", slopShareBps: 5000, rate: { effectiveAt: askedAt, slopPerUsd: rate }, previous: null }, reads: [], ...state };
  const answer = (body: unknown) => (body === undefined ? new Response(null, { status: 404 }) : body === "down" ? new Response(null, { status: 503 }) : Response.json(body));
  const fetch: typeof globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    held.reads.push(path);
    if (path === "/api/v1/projects") return Response.json(registry);
    if (path === `/api/v1/submission-fee/items/${repositoryId}/${pullNumber}`) return answer(held.item);
    if (path === `/api/v1/submission-fee/reports/${caseId}`) return answer(held.report);
    if (path === "/api/v1/submission-fee/rate") return answer(held.rate);
    return new Response(null, { status: 404 });
  };
  return { held, fetch };
}

interface Mined {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly input: string;
  readonly block: bigint;
  readonly logs: ReadonlyArray<{ address: string; topics: string[]; data: string }>;
}

function fakeChain(options: { atomic: boolean }) {
  let chain = 1n;
  let finalized = 0n;
  const allowances = new Map<string, bigint>();
  const mined: Mined[] = [];
  const seen: string[] = [];
  const savedAtPrompt: Array<string | null> = [];
  let watchedKey = "";
  const mine = (transaction: { to: string; data: string }) => {
    const block = BigInt(mined.length + 10);
    const decoded = decodeFunctionData({ abi: depositAbi, data: transaction.data as Hex });
    const logs = [];
    if (decoded.functionName === "approve") allowances.set(transaction.to.toLowerCase(), BigInt(decoded.args[1]));
    else {
      const [item, token, amount, keptTo] = decoded.args;
      logs.push({ address: transaction.to, topics: [depositedTopic, word(1n), item, pad(payerAddress as Hex)], data: encodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "address" }], [token, amount, keptTo]) });
    }
    const entry: Mined = { hash: `0x${(mined.length + 1).toString(16).padStart(64, "c")}`, from: payerAddress, to: transaction.to, input: transaction.data, block, logs };
    mined.push(entry);
    return entry;
  };
  const provider = {
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      const [first] = params as ReadonlyArray<Record<string, unknown>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
      if (method === "eth_chainId") return quantity(chain);
      if (method === "wallet_switchEthereumChain") {
        chain = BigInt(String(first?.chainId));
        return null;
      }
      if (method === "eth_getCode") return "0x6080";
      if (method === "eth_call") {
        const data = String(first?.data);
        if (data.startsWith("0x70a08231")) return word(10n ** 30n);
        if (data.startsWith("0xdd62ed3e")) return word(allowances.get(String(first?.to).toLowerCase()) ?? 0n);
        return word(0n);
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "wallet_getCapabilities") return options.atomic ? { [quantity(chain)]: { atomic: { status: "supported" } } } : {};
      if (method === "eth_sendTransaction") {
        savedAtPrompt.push(sessionStorage.getItem(watchedKey));
        return mine(first as unknown as { to: string; data: string }).hash;
      }
      if (method === "wallet_sendCalls") {
        savedAtPrompt.push(sessionStorage.getItem(watchedKey));
        const last = (first as unknown as { calls: Array<{ to: string; data: string }> }).calls.map(mine).at(-1);
        return { id: `batch-${last?.hash ?? ""}` };
      }
      if (method === "wallet_getCallsStatus") return { status: 200, receipts: [{ transactionHash: String(params[0]).slice(6) }] };
      if (method === "eth_getTransactionReceipt") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : { status: "0x1", transactionHash: entry.hash, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), logs: entry.logs.map((log, index) => ({ ...log, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), transactionHash: entry.hash, logIndex: quantity(BigInt(index)), removed: false })) };
      }
      if (method === "eth_getTransactionByHash") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : { from: entry.from, to: entry.to, input: entry.input, value: "0x0" };
      }
      if (method === "eth_getBlockByNumber") return params[0] === "finalized" ? { number: quantity(finalized), hash: blockHash(finalized) } : { number: params[0], hash: blockHash(BigInt(String(params[0]))) };
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    },
  };
  return {
    provider,
    seen,
    mined,
    savedAtPrompt,
    watch: (key: string) => {
      watchedKey = key;
    },
    finalize: () => {
      finalized = 1_000n;
    },
  };
}

function announce(uuid: string, provider: unknown) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid, name: "Payer wallet", rdns: "test.payer", icon: "data:image/svg+xml,<svg/>" }, provider }) }));
}

function started(fetch: typeof globalThis.fetch, switches: { submissionFee: boolean; reportDeposit: boolean } = { submissionFee: true, reportDeposit: true }) {
  const setup = Layer.succeed(FeeSetup, { ...switches, terms: publishedTerms });
  const runtime = ManagedRuntime.make(Layer.mergeAll(walletChoiceServices, webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch), setup));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

const walletId = Effect.gen(function* () {
  const choice = yield* WalletChoice;
  return (yield* choice.current()).find((offer) => offer.name === "Payer wallet")?.id ?? 0;
});

const shownPage = (pay: FeePay) => Effect.gen(function* () {
  const state = yield* pay.machine.get();
  const shown = yield* pay.shown();
  return { page: state.page, dueWays: state.dueWays, due: shown.record?.due.map((way) => way.symbol) ?? [], withheld: shown.record?.slopWithheld ?? false, paid: shown.record?.paid?.depositId ?? 0, refused: shown.message !== "" };
});

describe('Pay a refundable deposit for a pull request or a private report from any wallet (spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"; spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown")', () => {
  it("a switched-off build offers nothing and still shows a recorded deposit, an unlisted repository, a bad address and an unasked record each say so, and a record off the published terms or rate offers nothing while an unread rate withholds only SLOP", async () => {
    const opened = async (address: PayAddress, held: Partial<Api>, switches?: { submissionFee: boolean; reportDeposit: boolean }) => {
      const runtime = started(api(held).fetch, switches);
      return runtime.runPromise(Effect.flatMap(openPayPage(address, sessionSlots()), shownPage));
    };
    const dueBoth = pullRecord([stableWay(), slopWay(slopAmount)]);
    const result = {
      switchedOff: await opened(pullAddress, { item: dueBoth }, { submissionFee: false, reportDeposit: false }),
      reportSwitchedOff: await opened(reportAddress, { report: reportRecord([slopWay(reportAmount)]) }, { submissionFee: false, reportDeposit: false }),
      recordedWhileOff: await opened(pullAddress, { item: pullRecord([], { paid: paid("base-mainnet", usdc.address, stableMinor, false), outcome: "refund_due" }) }, { submissionFee: false, reportDeposit: false }),
      badAddress: await opened({ ...pullAddress, number: "07" }, {}),
      badCase: await opened({ kind: "report", caseId: "sc_x" }, {}),
      unlisted: await opened({ ...pullAddress, repo: "elsewhere" }, {}),
      noFee: await opened(pullAddress, {}),
      noDeposit: await opened(reportAddress, {}),
      due: await opened(pullAddress, { item: dueBoth }),
      otherContract: await opened(pullAddress, { item: pullRecord([stableWay({ contract: `0x${"1".repeat(40)}` })]) }),
      otherDestination: await opened(pullAddress, { item: pullRecord([stableWay({ keptTo: publishedTerms.burn })]) }),
      otherNetwork: await opened(pullAddress, { item: pullRecord([stableWay({ chainId: 1 })]) }),
      otherCase: await opened(reportAddress, { report: { ...reportRecord([slopWay(reportAmount)]), caseId: "sc_anothercase1" } }),
      reportInStable: await opened(reportAddress, { report: reportRecord([stableWay()]) }),
      offRate: await opened(pullAddress, { item: pullRecord([stableWay(), slopWay((BigInt(slopAmount) + 1n).toString())]) }),
      rateUnread: await opened(pullAddress, { item: dueBoth, rate: "down" }),
    };
    const nothing = { dueWays: 0, due: [] };
    expect(result).toMatchObject({
      switchedOff: { page: "SwitchedOff", ...nothing },
      reportSwitchedOff: { page: "SwitchedOff", dueWays: 0 },
      recordedWhileOff: { page: "Recorded", dueWays: 0, paid: 1 },
      badAddress: { page: "NotAddressed", ...nothing },
      badCase: { page: "NotAddressed", ...nothing },
      unlisted: { page: "NotRegistered", ...nothing },
      noFee: { page: "NothingAsked", ...nothing },
      noDeposit: { page: "NothingAsked", ...nothing },
      due: { page: "Due", dueWays: 2, due: ["USDC", "SLOP"], withheld: false },
      otherContract: { page: "Failed", ...nothing, refused: true },
      otherDestination: { page: "Failed", ...nothing, refused: true },
      otherNetwork: { page: "Failed", ...nothing, refused: true },
      otherCase: { page: "Failed", ...nothing, refused: true },
      reportInStable: { page: "Failed", ...nothing, refused: true },
      offRate: { page: "Failed", ...nothing, refused: true },
      rateUnread: { page: "Due", dueWays: 1, due: ["USDC"], withheld: true },
    });
  });
});

describe('Pay from a wallet and follow the deposit to final (spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"; spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/batchedDeposit.md, "A separate approval proceeds at canonical inclusion and never counts as funding")', () => {
  const separately = (address: PayAddress, held: Partial<Api>, item: string, recorded: (api: Api) => void) => async () => {
    const key = feeDepositKey(item);
    const chain = fakeChain({ atomic: false });
    chain.watch(key);
    const { held: served, fetch } = api(held);
    const runtime = started(fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const pay = yield* openPayPage(address, sessionSlots());
      yield* pay.connect(yield* walletId);
      yield* pay.review();
      const switched = chain.seen.includes("wallet_switchEthereumChain");
      yield* pay.pay();
      const approval = yield* pay.check("");
      yield* pay.review();
      yield* pay.pay();
      const included = yield* pay.check("");
      const kept = sessionStorage.getItem(key) !== null;
      chain.finalize();
      recorded(served);
      const final = yield* pay.check("");
      const page = yield* shownPage(pay);
      return { switched, approval: [approval.phase, approval.notice], included: [included.evidence, included.phase], kept, final: [final.evidence, final.notice, final.phase], page: page.page, slot: sessionStorage.getItem(key), marker: sessionStorage.getItem(depositedKey(item)) !== null };
    }));
    const [, deposit] = chain.mined;
    expect({
      ...result,
      calls: chain.mined.length,
      depositTo: deposit?.to.toLowerCase(),
      savedBeforePrompt: chain.savedAtPrompt.every((text) => text !== null),
      sends: chain.seen.filter((method) => method === "eth_sendTransaction").length,
    }).toMatchObject({
      switched: true,
      approval: ["Reviewed", "ApprovalConfirmed"],
      included: ["Received", "Sent"],
      kept: true,
      final: ["Finished", "VerifiedNotice", "Idle"],
      page: "Recorded",
      slot: null,
      marker: true,
      calls: 2,
      depositTo: (address.kind === "report" ? robinhood : base).contract.toLowerCase(),
      savedBeforePrompt: true,
      sends: 2,
    });
  };

  it("a wallet on another chain switches, approves the exact amount, deposits exactly the published call into the fee contract and is followed to final for a pull request", separately(pullAddress, { item: pullRecord([stableWay()]) }, pullItem, (served) => {
    served.item = pullRecord([], { paid: paid("base-mainnet", usdc.address, stableMinor, true) });
  }));

  it("the same pay form pays a report's SLOP deposit on Robinhood Chain and follows it to final", separately(reportAddress, { report: reportRecord([slopWay(reportAmount)]) }, reportItem, (served) => {
    served.report = reportRecord([], { paid: paid("robinhood-mainnet", slop.address, reportAmount, true) });
  }));

  it("a batching wallet pays SLOP in one request, and a deposit of the tab already on chain stops a second payment", async () => {
    const chain = fakeChain({ atomic: true });
    const key = feeDepositKey(pullItem);
    chain.watch(key);
    const { fetch } = api({ item: pullRecord([stableWay(), slopWay(slopAmount)]) });
    const runtime = started(fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const pay = yield* openPayPage(pullAddress, sessionSlots());
      yield* pay.connect(yield* walletId);
      yield* pay.choose(`robinhood-mainnet:${slop.address.toLowerCase()}`);
      yield* pay.review();
      const reference = yield* pay.pay();
      chain.finalize();
      const final = yield* pay.check("");
      yield* pay.review();
      const again = yield* Effect.exit(pay.pay());
      return { batched: reference.startsWith("batch-"), final: [final.evidence, final.phase], again: Exit.isFailure(again), within: (yield* pay.machine.get()).dueWays > 0 };
    }));
    expect({ ...result, batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length, calls: chain.mined.length }).toMatchObject({
      batched: true,
      final: ["Finished", "Idle"],
      again: true,
      within: true,
      batches: 1,
      sends: 0,
      calls: 2,
    });
  });
});
