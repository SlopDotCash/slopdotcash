import { base58Encode, base64Encode } from "@repo/platform/chain/solana";
import { webCrypto } from "@repo/platform/crypto";
import { PLEDGED_FUNDS_SELECTOR, escrowAbi, evmAddress, factoryAbi } from "@repo/settlement/chain/evm/abi";
import { expirePledgeCalldata, pledgeMonthsCalldata } from "@repo/settlement/chain/evm/actions";
import { EVENT_TOPICS } from "@repo/settlement/chain/evm/events";
import { vaultKey } from "@repo/settlement/chain/evm/factories";
import { pledgeMonthInstructions } from "@repo/settlement/chain/solana/instructions";
import { compileLegacy } from "@repo/settlement/chain/solana/transactions";
import { toAmount } from "@repo/settlement/kernels/amounts";
import { type Period, isPeriod, periodContaining } from "@repo/settlement/kernels/calendar";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { type Hex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, pad, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { editorOpen } from "../../gen/frontend__ownerMonthly.ts";
import type { PoolFacts } from "../../gen/frontend__projections.ts";
import { lockedFundsText } from "../../gen/frontend__vaultLocks.ts";
import { type FundingVault, unreadLocks } from "../../src/kernels/poolFunding.ts";
import { monthBounds } from "../../src/screens/funding/awards/month.ts";
import { type LockConnection, connectCard, lockDesk, lockMachine, readCard, releaseCard, reviewCard, sendCard, sendsDeposit, watchCard } from "../../src/screens/funding/vault/monthLock.vibe";
import { useFollowed } from "../../src/screens/funding/vault/VaultActions.tsx";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";
import { connectEvm } from "../../src/wallets/core/evm.vibe";
import { connectSolana } from "../../src/wallets/core/solana.vibe";
import { sessionSlots } from "../../src/wallets/core/slots.ts";
import { batchFlow } from "../../src/wallets/owner/batchedDeposit.vibe";
import { type EvmVault, type VaultReview, checkTransfer, reviewTransfer, sendTransfer } from "../../src/wallets/owner/evmVault.vibe";
import { ownerMonthlyPage } from "../../src/wallets/owner/ownerMonthly.vibe";
import { type Answer, type OwnerVaultPage, type Saved, ownerVaultPage } from "../../src/wallets/owner/ownerVault.vibe";
import { provisionalVault } from "../../src/wallets/owner/provisionalVault.vibe";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const owner = account.address.toLowerCase();
const chainId = 8453;
const runtimeCode = "0x6080";
const factory = "0x00000000000000000000000000000000000000fa";
const feeRecipient = "0x00000000000000000000000000000000000000fe";
const projectWord = `0x${"5".repeat(64)}` as Hex;
const codeSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([0x60, 0x80]))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const review: VaultReview = { codeSha256, implementation: undefined, factory, feeRecipient, bindingDelaySeconds: 0n, purpose: "OrdinaryPurpose" };
const nativeVault: EvmVault = { network: "base-mainnet", chainId: BigInt(chainId), vault: "0x00000000000000000000000000000000000000aa", asset: "0x0000000000000000000000000000000000000000", owner, review };
const tokenVault: EvmVault = { ...nativeVault, vault: "0x00000000000000000000000000000000000000ab", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const keys = { creation: "slop:vault-setup:v1:journey", transfer: `slop:vault-action:v1:base-mainnet:${nativeVault.vault}:${nativeVault.asset}` };
const batchKey = `slop:vault-action:v1:base-mainnet:${tokenVault.vault}:${tokenVault.asset}`;
const provisionalKey = `slop:vault-action:v1:base-mainnet:provisional:${tokenVault.vault}`;
const actor = 4242;
const zero = [0];
const quietPool: PoolFacts = { read: "PoolCurrent", monthlyPool: false, period: 0, amount: zero, priorAmount: zero, priorPending: false, freeNow: zero, monthStartRead: false, freeAtStart: zero, withdrawnSince: false, pledgeSupport: false, pledged: zero };
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const quantity = (value: bigint) => `0x${value.toString(16)}`;

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  sessionStorage.clear();
  document.body.replaceChildren();
});

interface Mined {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly input: string;
  readonly value: string;
  readonly block: bigint;
  readonly logs: ReadonlyArray<{ address: string; topics: string[]; data: string }>;
}

function addressOf(text: string) {
  const parsed = evmAddress(text);
  if (parsed === undefined) throw new Error(`not an address ${text}`);
  return parsed;
}

const vaultKeys = [nativeVault, tokenVault].map((vault) => ({ vault, key: vaultKey({ owner: addressOf(owner), projectId: projectWord as never, asset: addressOf(vault.asset), purpose: "OrdinaryPurpose" }) }));

type Pledges = Map<number, { amount: bigint; open: boolean }>;

const monthAfter = (period: number, months: number) => {
  const index = Math.floor(period / 100) * 12 + (period % 100) - 1 + months;
  return Math.floor(index / 12) * 100 + (index % 12) + 1;
};

function fakeChain(options: { readonly atomic: boolean; readonly send: "mine" | "unclear"; readonly approved?: boolean; readonly estimateReverts?: { readonly call: string; readonly error: unknown }; readonly pledges?: Pledges; readonly current?: number; readonly failReceipts?: boolean; readonly wallet?: string }) {
  const free = 10n ** 19n;
  const mined: Mined[] = [];
  const seen: string[] = [];
  let finalized = 0n;
  const blockHash = (block: bigint) => hash(block.toString(16).slice(-1));
  const vaultOf = (to: string) => [nativeVault, tokenVault].find((vault) => vault.vault === to.toLowerCase());
  const read = (to: string, data: string): string => {
    const vault = vaultOf(to);
    if (to.toLowerCase() === factory) {
      const found = vaultKeys.find((entry) => data.toLowerCase() === encodeFunctionData({ abi: factoryAbi, functionName: "vaults", args: [entry.key] }).toLowerCase());
      return encodeAbiParameters([{ type: "address" }], [(found?.vault.vault ?? "0x0000000000000000000000000000000000000000") as Hex]);
    }
    if (vault === undefined) return encodeAbiParameters([{ type: "uint256" }], [data.startsWith("0x70a08231") ? 10n ** 21n : data.startsWith("0xdd62ed3e") && options.approved === true ? 10n ** 21n : 0n]);
    const name = escrowAbi.find((item) => item.type === "function" && data.startsWith(selector(item.name)));
    if (name === undefined || name.type !== "function") throw new Error(`unexpected call ${data}`);
    if (name.name === "totals") return encodeFunctionResult({ abi: escrowAbi, functionName: "totals", result: [free, 0n, 0n, 0n, 0n, free, 0n, 0n, 0n, free] });
    if (name.name === "token") return encodeFunctionResult({ abi: escrowAbi, functionName: "token", result: vault.asset as Hex });
    if (name.name === "decimals") return encodeFunctionResult({ abi: escrowAbi, functionName: "decimals", result: vault === nativeVault ? 18 : 6 });
    if (name.name === "owner") return encodeFunctionResult({ abi: escrowAbi, functionName: "owner", result: owner as Hex });
    if (name.name === "feeRecipient") return encodeFunctionResult({ abi: escrowAbi, functionName: "feeRecipient", result: feeRecipient as Hex });
    if (name.name === "factory") return encodeFunctionResult({ abi: escrowAbi, functionName: "factory", result: factory as Hex });
    if (name.name === "bindingDelay") return encodeFunctionResult({ abi: escrowAbi, functionName: "bindingDelay", result: 0n });
    if (name.name === "purpose") return encodeFunctionResult({ abi: escrowAbi, functionName: "purpose", result: 0 });
    if (name.name === "projectId") return encodeFunctionResult({ abi: escrowAbi, functionName: "projectId", result: projectWord });
    const pledges = options.pledges;
    if (pledges !== undefined && name.name === "currentPeriod") return encodeFunctionResult({ abi: escrowAbi, functionName: "currentPeriod", result: options.current ?? 0 });
    if (pledges !== undefined && name.name === "openPledgedGross") return encodeFunctionResult({ abi: escrowAbi, functionName: "openPledgedGross", result: [...pledges.values()].reduce((sum, pledge) => (pledge.open ? sum + pledge.amount : sum), 0n) });
    if (pledges !== undefined && name.name === "monthPledges") {
      const [period] = decodeFunctionData({ abi: escrowAbi, data: data as Hex }).args as unknown as [number];
      const found = pledges.get(period);
      return encodeFunctionResult({ abi: escrowAbi, functionName: "monthPledges", result: [found?.amount ?? 0n, found?.open ?? false] });
    }
    if (pledges === undefined && ["currentPeriod", "openPledgedGross", "monthPledges"].includes(name.name)) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
    throw new Error(`unexpected getter ${name.name}`);
  };
  const mine = (transaction: { from?: string; to: string; data: string; value?: string }) => {
    const block = BigInt(mined.length + 10);
    if (options.pledges !== undefined && options.failReceipts !== true && (transaction.data.startsWith(selector("pledgeMonths")) || transaction.data.startsWith(selector("expirePledge")))) {
      const decoded = decodeFunctionData({ abi: escrowAbi, data: transaction.data as Hex });
      const args = decoded.args as unknown as ReadonlyArray<number | bigint>;
      if (decoded.functionName === "pledgeMonths") for (let index = 0; index < Number(args[1]); index++) options.pledges.set(monthAfter(Number(args[0]), index), { amount: BigInt(args[2] ?? 0n), open: true });
      else options.pledges.set(Number(args[0]), { amount: options.pledges.get(Number(args[0]))?.amount ?? 0n, open: false });
    }
    const vault = vaultOf(transaction.to);
    const amount = transaction.data.startsWith(selector("deposit")) ? BigInt(`0x${transaction.data.slice(10)}`) : 0n;
    const logs = vault === undefined || amount === 0n ? [] : [{ address: vault.vault, topics: [EVENT_TOPICS.Deposited, pad(owner as Hex)], data: encodeAbiParameters([{ type: "uint128" }], [amount]) }];
    const entry = { hash: hash((mined.length + 1).toString(16)), from: (transaction.from ?? options.wallet ?? owner).toLowerCase(), to: transaction.to, input: transaction.data, value: transaction.value ?? "0x0", block, logs };
    mined.push(entry);
    return entry;
  };
  const receipt = (entry: Mined) => ({
    status: options.failReceipts === true ? "0x0" : "0x1",
    transactionHash: entry.hash,
    blockNumber: quantity(entry.block),
    blockHash: blockHash(entry.block),
    logs: entry.logs.map((log, index) => ({ ...log, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), transactionHash: entry.hash, logIndex: quantity(BigInt(index)), removed: false })),
  });
  const provider = {
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      const [first] = params as ReadonlyArray<Record<string, string>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [options.wallet ?? account.address];
      if (method === "eth_chainId") return quantity(BigInt(chainId));
      if (method === "eth_call") return read(String(first?.to), String(first?.data));
      if (method === "eth_getBalance") return quantity(free);
      if (method === "eth_estimateGas") {
        if (options.estimateReverts !== undefined && String(first?.data).startsWith(options.estimateReverts.call)) throw options.estimateReverts.error;
        return "0x5208";
      }
      if (method === "wallet_getCapabilities") return options.atomic ? { [quantity(BigInt(chainId))]: { atomic: { status: "supported" } } } : {};
      if (method === "eth_sendTransaction") {
        if (options.send === "unclear") throw new Error("RPC timeout");
        return mine(first as unknown as { to: string; data: string; value?: string }).hash;
      }
      if (method === "wallet_sendCalls") {
        const calls = (first as unknown as { calls: Array<{ to: string; data: string }> }).calls;
        const last = calls.map(mine).at(-1);
        return { id: `batch-${last?.hash ?? ""}` };
      }
      if (method === "wallet_getCallsStatus") return { status: 200, receipts: [{ transactionHash: String(params[0]).slice(6) }] };
      if (method === "eth_getTransactionReceipt") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : receipt(entry);
      }
      if (method === "eth_getTransactionByHash") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : { from: entry.from, to: entry.to, input: entry.input, value: entry.value };
      }
      if (method === "eth_getBlockByNumber") return params[0] === "finalized" ? { number: quantity(finalized), hash: blockHash(finalized) } : { number: params[0], hash: blockHash(BigInt(String(params[0]))) };
      if (method === "eth_getCode") return runtimeCode;
      if (method === "eth_getStorageAt") return `0x${"0".repeat(64)}`;
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    },
  };
  return { provider, seen, mined, mineCreation: () => mine({ to: factory, data: "0x" }).hash, finalize: () => { finalized = BigInt(mined.length + 100); } };
}

function selector(name: string): string {
  const item = escrowAbi.find((entry) => entry.type === "function" && entry.name === name);
  if (item === undefined || item.type !== "function") throw new Error(`no function ${name}`);
  return toFunctionSelector(item);
}

function started() {
  const runtime = ManagedRuntime.make(Layer.mergeAll(walletChoiceServices, webCrypto));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

function announce(uuid: string, provider: unknown) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid, name: "Owner wallet", rdns: "test.owner", icon: "data:image/svg+xml,<svg/>" }, provider }) }));
}

function Follower({ runtime, page, account }: { runtime: ReturnType<typeof started>; page: OwnerVaultPage; account: number }) {
  useFollowed(runtime, `follow:${account}`, () => page.follow(account));
  return null;
}

async function followAs(runtime: ReturnType<typeof started>, page: OwnerVaultPage) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  cleanups.push(() => root.unmount());
  return async (account: number) => {
    await act(() => Promise.resolve(root.render(<Follower runtime={runtime} page={page} account={account} />)));
    await expect.poll(async () => (await runtime.runPromise(page.machine.get())).owner).toBe(account);
    return runtime.runPromise(page.machine.get());
  };
}

const connected = Effect.gen(function* () {
  const choice = yield* WalletChoice;
  const id = (yield* choice.current()).find((offer) => offer.name === "Owner wallet")?.id ?? 0;
  return yield* connectEvm(id, false);
});

describe('Create and register the vault without asking the wallet twice (spec/frontend/ownerVault.md, "Story: Create and register the vault without asking the wallet twice"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request")', () => {
  it('the owner deposits into the registered vault once, the slot is saved before the prompt, an included transfer counts nothing, a sign-out and the same account signing in again on the page bring back the request and its automatic check, and only the finalized exact deposit clears the slot (spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out")', async () => {
    const chain = fakeChain({ atomic: false, send: "mine" });
    const runtime = started();
    const { page, check, ...result } = await runtime.runPromise(Effect.gen(function* () {
      announce("6f8a1f3e-5a2b-4c7d-8e9f-0a1b2c3d4e5f", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
      let savedBeforePrompt: string | null = null;
      const sent = yield* page.submit("Transfer", (beforePrompt) =>
        sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", (plan) => Effect.tap(beforePrompt(plan), () => Effect.sync(() => { savedBeforePrompt = sessionStorage.getItem(keys.transfer); }))));
      const check = (saved: Saved) => Effect.map(checkTransfer(connection, nativeVault, "deposit", "send", 5n * 10n ** 18n, saved.plan, saved.attempt.hash), (status): Answer => (status === "finalized" ? "FinalRead" : status === "received" ? "IncludedRead" : status === "failed" || status === "noVault" ? "Reverted" : "StillPending")).pipe(Effect.orElseSucceed((): Answer => "ReadFailed"));
      const included = yield* page.ask("Transfer", "OwnerCheck", check);
      return { page, check, sent, savedBeforePrompt, included: [included.notice, included.transfer.phase], kept: sessionStorage.getItem(keys.transfer) !== null };
    }));
    const follow = await followAs(runtime, page);
    const shown = await follow(actor);
    const signedOut = await follow(0);
    const back = await follow(actor);
    chain.finalize();
    const final = await runtime.runPromise(page.autoCheck("Transfer", () => 0, check));
    expect(result.sent).toBe(chain.mined[0]?.hash);
    const savedRecord = JSON.parse(String(result.savedBeforePrompt));
    expect(savedRecord).toMatchObject({ account: actor, request: "transfer" });
    expect(JSON.parse(savedRecord.plan)).toEqual({ kind: "evmCall", from: owner, chainId: quantity(BigInt(chainId)), to: nativeVault.vault, data: chain.mined[0]?.input, value: quantity(5n * 10n ** 18n) });
    expect({
      ...result,
      followed: [shown.transfer.phase, signedOut.transfer.phase, back.transfer.phase, back.transfer.slot.hash === result.sent],
      final: [final.notice, final.transfer.phase],
      after: sessionStorage.getItem(keys.transfer),
      sends: chain.seen.filter((method) => method === "eth_sendTransaction").length,
    }).toMatchObject({
      included: ["Received", "Sent"],
      kept: true,
      followed: ["Sent", "Idle", "Sent", true],
      final: ["Counted", "Done"],
      after: null,
      sends: 1,
    });
  });

  it("a reload after an unclear send recovers the saved request for the same account without asking the wallet again", async () => {
    const chain = fakeChain({ atomic: false, send: "unclear" });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("7a9b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", chain.provider);
      const connection = yield* connected;
      const first = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* first.follow(actor);
      yield* first.review("Transfer", 0n, quietPool, unreadLocks, "");
      const send = (page: typeof first) => Effect.match(page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", beforePrompt)), { onFailure: (error) => error._tag, onSuccess: () => "sent" });
      const unclear = yield* send(first);
      const reloaded = yield* ownerVaultPage(sessionSlots(), keys, true);
      const other = yield* reloaded.follow(actor + 1);
      const none = yield* reloaded.follow(0);
      const same = yield* reloaded.follow(actor);
      const resend = yield* Effect.match(reloaded.review("Transfer", 0n, quietPool, unreadLocks, ""), { onFailure: (error) => error._tag, onSuccess: (state) => state.transfer.phase });
      const unsent = yield* reloaded.confirmUnsent("Transfer");
      return { unclear, otherPhase: other.transfer.phase, nonePhase: none.transfer.phase, samePhase: same.transfer.phase, resend, afterConfirm: [unsent.transfer.phase, sessionStorage.getItem(keys.transfer)], sends: chain.seen.filter((method) => method === "eth_sendTransaction").length };
    }));
    expect(result).toEqual({ unclear: "VaultUncertain", otherPhase: "Idle", nonePhase: "Idle", samePhase: "Unclear", resend: "VaultRefused", afterConfirm: ["Reviewed", null], sends: 1 });
  });

  it(`a withdrawal whose gas estimate the vault refuses as locked funds says so in plain words, saves nothing and asks the wallet nothing (spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them")`, async () => {
    const refusal = Object.assign(new Error("Internal JSON-RPC error."), { code: -32603, data: { code: 3, message: "execution reverted", data: PLEDGED_FUNDS_SELECTOR } });
    const chain = fakeChain({ atomic: false, send: "mine", estimateReverts: { call: selector("withdrawUnused"), error: refusal } });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("5e7f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      yield* page.review("Transfer", 10n ** 18n, quietPool, unreadLocks, "");
      const refused = yield* Effect.match(page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "withdraw", "send", "1", "finalized", beforePrompt)), { onFailure: (error) => error.message, onSuccess: () => "sent" });
      return { refused, saved: sessionStorage.getItem(keys.transfer), phase: (yield* page.machine.get()).transfer.phase, prompts: chain.seen.filter((method) => method === "eth_sendTransaction").length };
    }));
    expect(result).toEqual({ refused: lockedFundsText, saved: null, phase: "Reviewed", prompts: 0 });
  });
});

describe('Offer one atomic request only on a wallet that already supports it (spec/frontend/batchedDeposit.md, "Story: Offer one atomic request only on a wallet that already supports it"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Wallet references identify later lookups and uncertainty preserves the intent"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending")', () => {
  it("an atomic wallet approves and deposits in one request, a reload resumes the saved reference without a second request, and only the finalized deposit event verifies it", async () => {
    const chain = fakeChain({ atomic: true, send: "mine" });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("8b0c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e", chain.provider);
      const connection = yield* connected;
      const flow = yield* batchFlow(sessionSlots(), batchKey);
      const review = yield* reviewTransfer(connection, tokenVault, "deposit", "2", "finalized");
      yield* flow.review(actor, review);
      const referenced = yield* flow.send(connection, tokenVault, "2", "finalized");
      const savedIntent = sessionStorage.getItem(batchKey);
      const reloaded = yield* batchFlow(sessionSlots(), batchKey);
      const resumed = yield* reloaded.machine.get();
      const again = yield* Effect.match(reloaded.send(connection, tokenVault, "2", "finalized"), { onFailure: (error) => error._tag, onSuccess: (state) => state.phase });
      const named = yield* reloaded.lookup(connection, tokenVault);
      const pending = yield* reloaded.observe(connection, tokenVault, 2_000_000n);
      chain.finalize();
      const verified = yield* reloaded.observe(connection, tokenVault, 2_000_000n);
      return {
        capability: review.batch,
        phases: [referenced.phase, resumed.phase, named.phase, pending.phase, verified.phase],
        sameReference: resumed.reference === referenced.reference && resumed.digest === referenced.digest,
        again,
        savedIntent: savedIntent !== null,
        cleared: sessionStorage.getItem(batchKey),
        batches: chain.seen.filter((method) => method === "wallet_sendCalls").length,
      };
    }));
    expect(result).toEqual({ capability: true, phases: ["WalletReference", "WalletReference", "HashKnown", "HashKnown", "Verified"], sameReference: true, again: "BatchStopped", savedIntent: true, cleared: null, batches: 1 });
  });

  it('a separate approval included in a canonical block that is not final lets the owner review the deposit against the live allowance, and the deposit counts only at its finalized event (spec/frontend/batchedDeposit.md, "A separate approval proceeds at canonical inclusion and never counts as funding"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request")', async () => {
    const options = { atomic: false, send: "mine" as const, approved: false };
    const chain = fakeChain(options);
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), { creation: keys.creation, transfer: batchKey }, true);
      yield* page.follow(actor);
      const first = yield* reviewTransfer(connection, tokenVault, "deposit", "2", "finalized");
      yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
      yield* page.submit("Transfer", (beforePrompt) => sendTransfer(connection, tokenVault, "deposit", "approve", "2", "finalized", beforePrompt));
      const checkStep = (step: "approve" | "send") => (saved: Saved) => Effect.map(checkTransfer(connection, tokenVault, "deposit", step, 2_000_000n, saved.plan, saved.attempt.hash), (status): Answer => (status === "finalized" || status === "approvalConfirmed" ? "FinalRead" : status === "received" ? "IncludedRead" : status === "failed" || status === "noVault" ? "Reverted" : "StillPending")).pipe(Effect.orElseSucceed((): Answer => "ReadFailed"));
      const approved = yield* page.ask("Transfer", "OwnerCheck", checkStep("approve"));
      options.approved = true;
      const second = yield* reviewTransfer(connection, tokenVault, "deposit", "2", "finalized");
      yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
      yield* page.submit("Transfer", (beforePrompt) => sendTransfer(connection, tokenVault, "deposit", "send", "2", "finalized", beforePrompt));
      const included = yield* page.ask("Transfer", "OwnerCheck", checkStep("send"));
      chain.finalize();
      const counted = yield* page.autoCheck("Transfer", () => 0, checkStep("send"));
      return {
        needed: [first.approvalNeeded, second.approvalNeeded],
        approved: [approved.notice, approved.transfer.phase],
        included: [included.notice, included.transfer.phase],
        counted: [counted.notice, counted.transfer.phase, sessionStorage.getItem(batchKey)],
        prompts: chain.seen.filter((method) => method === "eth_sendTransaction").length,
      };
    }));
    expect(result).toEqual({ needed: [true, false], approved: ["Counted", "Done"], included: ["Received", "Sent"], counted: ["Counted", "Done", null], prompts: 2 });
  });

  it("a deposit whose allowance already covers the amount asks the wallet for the deposit alone, with no approval", async () => {
    const chain = fakeChain({ atomic: true, send: "mine", approved: true });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("4d6e9f0a-1b2c-4d3e-9f5a-6b7c8d9e0f1a", chain.provider);
      const connection = yield* connected;
      const review = yield* reviewTransfer(connection, tokenVault, "deposit", "2", "finalized");
      const sent = yield* sendTransfer(connection, tokenVault, "deposit", "send", "2", "finalized", () => Effect.void);
      return { approvalNeeded: review.approvalNeeded, batch: review.batch, sent: sent === chain.mined[0]?.hash, calls: chain.mined.map((entry) => [entry.to, entry.input.slice(0, 10)]), batches: chain.seen.filter((method) => method === "wallet_sendCalls").length };
    }));
    expect(result).toEqual({ approvalNeeded: false, batch: false, sent: true, calls: [[tokenVault.vault, selector("deposit")]], batches: 0 });
  });
});

describe('Retain an uncertain deposit through replacement and finality (spec/frontend/provisionalVault.md, "Story: Retain an uncertain deposit through replacement and finality"; spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"; spec/frontend/provisionalVault.md, "Only a finalized deposit in a registered vault is eligible for accounting"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission")', () => {
  it("the owner deposits into a provisional vault once, a reload resumes the saved transaction without a new prompt, and the deposit counts only once creation and deposit are final", async () => {
    const chain = fakeChain({ atomic: false, send: "mine", approved: true });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("9c1d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f", chain.provider);
      const connection = yield* connected;
      const creation = chain.mineCreation();
      const first = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner);
      yield* first.reviewCreation("OrdinaryEvmToken", true);
      const opened = yield* first.followCreation(connection, creation);
      const sent = yield* first.deposit(connection, "2");
      const savedHash = JSON.parse(JSON.parse(String(sessionStorage.getItem(provisionalKey))).plan).hash;
      const reloaded = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner);
      const resumed = yield* reloaded.machine.get();
      const again = yield* Effect.match(reloaded.deposit(connection, "2"), { onFailure: (error) => error._tag, onSuccess: ({ state }) => state.phase });
      yield* reloaded.followCreation(connection, creation);
      const received = yield* reloaded.followDeposit(connection, 2_000_000n);
      chain.finalize();
      yield* reloaded.followCreation(connection, creation);
      const counted = yield* reloaded.followDeposit(connection, 2_000_000n);
      return {
        form: opened.form,
        savedHash: savedHash === sent.hash,
        resumed: [resumed.phase, resumed.transaction],
        again,
        received: [received.phase, received.view, received.counted],
        counted: [counted.phase, counted.view, counted.registered, counted.counted],
        cleared: sessionStorage.getItem(provisionalKey),
        sends: chain.seen.filter((method) => method === "eth_sendTransaction").length,
      };
    }));
    expect(result).toEqual({
      form: "Provisional",
      savedHash: true,
      resumed: ["Submitted", 1],
      again: "DepositStopped",
      received: ["IncludedEvent", "Received", false],
      counted: ["Verified", "DepositVerified", true, true],
      cleared: null,
      sends: 1,
    });
  });
});

const nowSeconds = () => Math.floor(Date.now() / 1000);
const current = Number(periodContaining(nowSeconds()));
const ether = 10n ** 18n;
const otherAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

function asPeriod(value: number): Period {
  if (!isPeriod(value)) throw new Error(`not a period ${value}`);
  return value;
}

function rowOf(vault: { readonly network: string; readonly vault: string }, pledges: Pledges | undefined, free: bigint): FundingVault {
  if (pledges === undefined) return { network: vault.network, vault: vault.vault, freeBalance: free, openPledgedGross: null, pledges: [] };
  const open = [...pledges].filter(([, pledge]) => pledge.open);
  return { network: vault.network, vault: vault.vault, freeBalance: free, openPledgedGross: open.reduce((sum, [, pledge]) => sum + pledge.amount, 0n), pledges: open.map(([period, pledge]) => ({ period: asPeriod(period), amount: pledge.amount, open: true })) };
}

function cardRuntime(terms: Parameters<typeof lockDesk>[0], fetch: typeof globalThis.fetch = globalThis.fetch) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(walletChoiceServices, webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch), lockDesk(terms)));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

const cardState = Effect.flatMap(lockMachine(), (lock) => lock.get());
const evmCard = Effect.map(connected, (evm): LockConnection => ({ family: "evm", address: evm.address, evm }));
const tagOf = <A, E extends { readonly _tag: string }, R>(work: Effect.Effect<A, E, R>) => Effect.match(work, { onFailure: (error) => error._tag, onSuccess: () => "done" });

describe('Lock months from the owner\'s wallet (spec/frontend/monthLock.md, "Story: Lock months from the owner\'s wallet"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"; spec/frontend/monthLock.md, "A review runs the lock refusals against the card\'s own read, and only the owner\'s accepted review can be sent"; spec/frontend/monthLock.md, "A lapsed month stays locked until any connected wallet sends its release"; spec/frontend/monthLock.md, "A declined or unclear wallet request sends nothing new, and a sent one is checked every five seconds at most 720 times"; spec/frontend/monthLock.md, "A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault\'s current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it")', () => {
  it("a vault without pledge support shows no card, and the owner locks three months from the vault's month with one exact pledgeMonths transaction that shows only after the reloaded finalized read", async () => {
    const pledges: Pledges = new Map();
    const chain = fakeChain({ atomic: false, send: "mine", pledges, current });
    const unsupported = cardRuntime({ owner, evm: nativeVault, solana: undefined });
    const hidden = await unsupported.runPromise(readCard(rowOf(nativeVault, undefined, 10n * ether), 10n * ether, nowSeconds()));
    const runtime = cardRuntime({ owner, evm: nativeVault, solana: undefined });
    let reloads = 0;
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", chain.provider);
      const connection = yield* evmCard;
      const shown = yield* readCard(rowOf(nativeVault, pledges, 10n * ether), 10n * ether, nowSeconds());
      yield* connectCard(connection);
      const review = yield* reviewCard(connection, 3, "2", "", ether);
      const sent = yield* sendCard(connection);
      yield* watchCard(connection, Effect.sync(() => { reloads += 1; }));
      const included = yield* cardState;
      const beforeRead = [included.phase, included.shownLocked];
      const after = yield* readCard(rowOf(nativeVault, pledges, 4n * ether), 4n * ether, nowSeconds());
      return { shown: shown.phase, months: review.periods, sent: sent.phase, beforeRead, after: [after.phase, after.notice, after.shownLocked] };
    }));
    expect({ hidden: hidden.phase, ...result, reloads, calls: chain.mined.map((entry) => entry.input), sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      hidden: "LockHidden",
      shown: "LockIdle",
      months: [current, monthAfter(current, 1), monthAfter(current, 2)],
      sent: "LockChecking",
      beforeRead: ["LockIncluded", toAmount(0n)],
      after: ["LockIdle", "LockedNotice", toAmount(6n * ether)],
      reloads: 1,
      calls: [pledgeMonthsCalldata(current, 3, 2n * ether)],
      sends: 1,
    });
  }, 20_000);

  it(`a count other than 1, 3, 6 or 12, an amount below the monthly amount, a lowered month, short free funds and a deposit the wallet cannot batch are refused in that order and nothing is sent (spec/frontend/vaultLocks.md, "A lock review refuses a count other than 1, 3, 6 or 12, another wallet, an amount below the monthly amount, a lowered month, short free funds and an unbatchable deposit, in that order"; spec/settlement/monthPledges.md, "A lock covers 1, 3, 6 or 12 months from the current UTC month at one positive amount")`, async () => {
    const pledges: Pledges = new Map([[current, { amount: 3n * ether, open: true }]]);
    const chain = fakeChain({ atomic: false, send: "mine", pledges, current });
    const runtime = cardRuntime({ owner, evm: nativeVault, solana: undefined });
    const refusals = await runtime.runPromise(Effect.gen(function* () {
      announce("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", chain.provider);
      const connection = yield* evmCard;
      yield* readCard(rowOf(nativeVault, pledges, 10n * ether), 10n * ether, nowSeconds());
      yield* connectCard(connection);
      const seen: string[] = [];
      for (const [count, amount, deposit] of [[2, "4", ""], [1, "0.5", ""], [1, "2", ""], [6, "4", ""], [1, "4", "1"]] as const) {
        yield* reviewCard(connection, count, amount, deposit, ether);
        seen.push((yield* cardState).refusal);
      }
      return seen;
    }));
    expect({ refusals, sends: chain.seen.filter((method) => method === "eth_sendTransaction" || method === "wallet_sendCalls").length }).toEqual({
      refusals: ["LockCountRefused", "BelowMonthlyAmount", "LowersLockedMonth", "FreeFundsShort", "DepositNotBatched"],
      sends: 0,
    });
  });

  it(`a deposit and lock go to the wallet as one request, an included batch keeps checking until its finalized deposit, and a failed receipt locks nothing (spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending")`, async () => {
    const batched = async (failReceipts: boolean, uuid: string) => {
      const pledges: Pledges = new Map();
      const chain = fakeChain({ atomic: true, send: "mine", pledges, current, failReceipts });
      const runtime = cardRuntime({ owner, evm: tokenVault, solana: undefined });
      let reloads = 0;
      const result = await runtime.runPromise(Effect.gen(function* () {
        announce(uuid, chain.provider);
        const connection = yield* evmCard;
        yield* readCard(rowOf(tokenVault, pledges, 10_000_000n), 10_000_000n, nowSeconds());
        yield* connectCard(connection);
        const review = yield* reviewCard(connection, 1, "2", "3", 1_000_000n);
        yield* sendCard(connection);
        const included = failReceipts ? undefined : (yield* Effect.timeoutOption(watchCard(connection, Effect.void), "6 seconds"), (yield* cardState).phase);
        chain.finalize();
        yield* watchCard(connection, Effect.sync(() => { reloads += 1; }));
        const state = yield* cardState;
        return { deposit: review.depositGross, included, phase: state.phase, notice: state.notice, withDeposit: sendsDeposit(state), last: chain.mined.at(-1)?.input };
      }));
      return { ...result, reloads, locked: [...pledges.values()], batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, transactions: chain.seen.filter((method) => method === "eth_sendTransaction").length };
    };
    const shared = { deposit: 3_000_000n, last: pledgeMonthsCalldata(current, 1, 2_000_000n), batches: 1, transactions: 0 };
    expect(await batched(false, "4d5e6f7a-8b9c-4dae-8f01-3b4c5d6e7f8a")).toMatchObject({ ...shared, included: "LockChecking", phase: "LockIncluded", reloads: 1, locked: [{ amount: 2_000_000n, open: true }] });
    expect(await batched(true, "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f")).toEqual({ ...shared, included: undefined, phase: "LockFailed", notice: "LockFailedNotice", withDeposit: true, reloads: 0, locked: [] });
  }, 40_000);

  it("a lapsed month is released with expirePledge by a connected wallet that is not the owner's, whose own lock review is refused", async () => {
    const lapsed = monthAfter(current, -3);
    const pledges: Pledges = new Map([[lapsed, { amount: ether, open: true }]]);
    const other = otherAccount.address.toLowerCase();
    const chain = fakeChain({ atomic: false, send: "mine", pledges, current, wallet: otherAccount.address });
    const runtime = cardRuntime({ owner, evm: nativeVault, solana: undefined });
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a", chain.provider);
      const connection = yield* evmCard;
      yield* readCard(rowOf(nativeVault, pledges, 10n * ether), 10n * ether, nowSeconds());
      yield* connectCard(connection);
      yield* reviewCard(connection, 1, "1", "", ether);
      const refused = (yield* cardState).refusal;
      yield* releaseCard(connection, lapsed, ether);
      yield* watchCard(connection, Effect.void);
      const state = yield* cardState;
      return { refused, kind: state.kind, notice: state.notice };
    }));
    expect({ ...result, mined: chain.mined.map((entry) => [entry.from, entry.input]), open: pledges.get(lapsed)?.open }).toEqual({
      refused: "NotVaultOwner",
      kind: "ReleasingMonth",
      notice: "ReleasedNotice",
      mined: [[other, expirePledgeCalldata(lapsed)]],
      open: false,
    });
  }, 20_000);

  it("the Solana lock review rebuilds the prepared message from the reviewed months and sends it through the wallet, and a prepared transaction that differs is refused before the wallet is asked", async () => {
    const pair = async () => {
      const keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
      return { address: base58Encode(raw), raw, sign: async (message: Uint8Array) => new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, Uint8Array.from(message))) };
    };
    const [wallet, program, project] = await Promise.all([pair(), pair(), pair()]);
    const blockhash = base58Encode(new Uint8Array(32).fill(9));
    const periods = [current, monthAfter(current, 1), monthAfter(current, 2)];
    const built = pledgeMonthInstructions({ program: program.address as never, project: project.address as never, owner: wallet.address as never, periods, amount: 2_000_000n });
    if (built.kind !== "built") throw new Error("pledge instructions refused");
    const compiled = compileLegacy({ payer: wallet.address as never, blockhash: blockhash as never, instructions: built.value });
    if (compiled.kind !== "compiled") throw new Error("message refused");
    const unsigned = new Uint8Array(65 + compiled.bytes.length);
    unsigned[0] = 1;
    unsigned.set(compiled.bytes, 65);
    const account: WalletAccount = { address: wallet.address, publicKey: wallet.raw, chains: ["solana:devnet"], features: ["solana:signAndSendTransaction"] };
    const signed: Uint8Array[] = [];
    const solanaWallet = {
      version: "1.0.0",
      name: "Lock Solana",
      icon: "data:image/svg+xml,<svg/>",
      chains: ["solana:devnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy"],
          signAndSendTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
            signed.push(transaction);
            return [{ signature: await wallet.sign(transaction.slice(65)) }];
          },
        },
      },
    } as unknown as Wallet;
    cleanups.push(getWallets().register(solanaWallet));
    const run = async (wire: Uint8Array) => {
      const asked: unknown[] = [];
      const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        asked.push(body);
        const answer = body.step === "check"
          ? { status: "finalized" }
          : { plan: { wallet: wallet.address, periods, requested: periods, amountMinor: "2000000", decimals: 6, current: periods.map((period) => ({ period, amountMinor: "0", open: false })), transaction: { blockhash, lastValidBlockHeight: 100, transaction: base64Encode(wire), networkFeeLamports: "5000" } } };
        return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
      };
      const solana = { projectId: "slop", network: "solana-devnet", vault: project.address, terms: { program: program.address, project: project.address, owner: wallet.address, mint: null, tokenProgram: null } };
      const runtime = cardRuntime({ owner: wallet.address, evm: undefined, solana }, fetch as typeof globalThis.fetch);
      const outcome = await runtime.runPromise(Effect.gen(function* () {
        const choice = yield* WalletChoice;
        const id = (yield* choice.current()).find((offer) => offer.name === "Lock Solana")?.id ?? 0;
        const solanaConnection = yield* connectSolana(id);
        const connection: LockConnection = { family: "solana", address: solanaConnection.address, solana: solanaConnection };
        yield* readCard({ network: "solana-devnet", vault: project.address, freeBalance: 10_000_000n, openPledgedGross: 0n, pledges: [] }, 10_000_000n, nowSeconds());
        yield* connectCard(connection);
        const reviewed = yield* tagOf(reviewCard(connection, 3, "2", "", 1_000_000n));
        if (reviewed !== "done") return { reviewed, phase: (yield* cardState).phase };
        yield* sendCard(connection);
        yield* watchCard(connection, Effect.void);
        return { reviewed, phase: (yield* cardState).phase };
      }));
      return { ...outcome, steps: asked.map((body) => (body as { step: string }).step) };
    };
    const altered = Uint8Array.from(unsigned);
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
    const honest = await run(unsigned);
    const sentWires = signed.length;
    const changed = await run(altered);
    expect({ honest, sentWires, changed, signedAfter: signed.length, sameWire: signed[0]?.every((byte, index) => byte === unsigned[index]) }).toEqual({
      honest: { reviewed: "done", phase: "LockIncluded", steps: ["review", "check"] },
      sentWires: 1,
      changed: { reviewed: "MonthLockRefused", phase: "LockIdle", steps: ["review"] },
      signedAfter: 1,
      sameWire: true,
    });
  }, 20_000);
});

describe('Withdraw only funds the month\'s promise or locks leave free (spec/frontend/vaultLocks.md, "Story: Withdraw only funds the month\'s promise or locks leave free"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop\'s own guard applies only to a vault without them"; spec/frontend/ownerVault.md, "A withdrawal that would break the month\'s promise is refused on Slop\'s pages"; spec/frontend/projections.md, "Slop\'s pages refuse a withdrawal below the promised amount"; spec/settlement/monthPledges.md, "A withdrawal review refuses to take funds the open pledges hold")', () => {
  it("an upgraded vault with 700 free and 500 locked lets a 200 withdrawal through, refuses 201 with the locked-funds text before the wallet is asked, and skips the page's promise guard", async () => {
    const promisePool: PoolFacts = { ...quietPool, monthlyPool: true, amount: toAmount(1000n), freeNow: toAmount(700n) };
    const locks = { cachedSupport: true, walletRead: true, freeKnown: true, free: toAmount(700n), locked: toAmount(500n) };
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      const allowed = yield* page.review("Transfer", 200n, promisePool, locks, "");
      const refused = yield* Effect.match(page.review("Transfer", 201n, promisePool, locks, ""), { onFailure: (error) => error.message, onSuccess: (state) => state.notice });
      return { allowed: [allowed.notice, allowed.transfer.phase], refused, saved: sessionStorage.getItem(keys.transfer) };
    }));
    expect(result).toEqual({ allowed: ["Quiet", "Reviewed"], refused: lockedFundsText, saved: null });
  });

  it("with two vaults, a withdrawal that would leave this vault's freshly reviewed free balance below the owed amount is refused before the wallet is asked although the pool's cached total covers it, and a review without a free balance skips the page's guard", async () => {
    const pool: PoolFacts = { ...quietPool, monthlyPool: true, amount: toAmount(1000n), freeNow: toAmount(5000n) };
    const reviewed = { cachedSupport: false, walletRead: false, freeKnown: true, free: toAmount(1100n), locked: toAmount(0n) };
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      const shown = "promise";
      const refused = yield* Effect.match(page.review("Transfer", 200n, pool, reviewed, shown), { onFailure: (error) => [error._tag, error.notice, error.message === shown], onSuccess: (state) => [state.notice] });
      const phase = (yield* page.machine.get()).transfer.phase;
      const above = yield* page.review("Transfer", 100n, pool, reviewed, shown);
      const other = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* other.follow(actor);
      const unread = yield* other.review("Transfer", 5000n, pool, { ...reviewed, freeKnown: false }, shown);
      return { refused, phase, above: above.transfer.phase, unread: unread.transfer.phase, saved: sessionStorage.getItem(keys.transfer) };
    }));
    expect(result).toEqual({ refused: ["VaultRefused", "WithdrawalRefused", true], phase: "Idle", above: "Reviewed", unread: "Reviewed", saved: null });
  });
});

describe('Check registration and transfers automatically without retiring the owner (spec/frontend/ownerVault.md, "Story: Check registration and transfers automatically without retiring the owner"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request")', () => {
  it("in a hidden tab a saved transfer is not checked automatically and spends none of its automatic asks", async () => {
    const chain = fakeChain({ atomic: false, send: "mine" });
    const runtime = started();
    let asks = 0;
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("5e6f7a8b-9c0d-4e1f-8a2b-4c5d6e7f8a9b", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
      yield* page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", beforePrompt));
      yield* page.tabHidden(true);
      const waited = yield* Effect.timeoutOption(page.autoCheck("Transfer", () => 5, () => Effect.sync((): Answer => { asks += 1; return "StillPending"; })), "200 millis");
      const state = yield* page.machine.get();
      return { waited: Option.isNone(waited), phase: state.transfer.phase, autoAsks: state.transfer.autoAsks, hiddenAsks: state.transfer.hiddenAsks, kept: sessionStorage.getItem(keys.transfer) !== null };
    }));
    expect({ ...result, asks }).toEqual({ waited: true, phase: "Sent", autoAsks: 0, hiddenAsks: 0, kept: true, asks: 0 });
  });

  it("a saved deposit keeps being checked after failed reads and stops only at 240 asks or at a final answer", async () => {
    const chain = fakeChain({ atomic: false, send: "mine" });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f", chain.provider);
      const connection = yield* connected;
      const sentPage = Effect.gen(function* () {
        sessionStorage.clear();
        const page = yield* ownerVaultPage(sessionSlots(), keys, true);
        yield* page.follow(actor);
        yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
        yield* page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", beforePrompt));
        return page;
      });
      let asks = 0;
      const failing = yield* sentPage;
      const limited = yield* failing.autoCheck("Transfer", () => 0, () => Effect.sync((): Answer => (++asks <= 3 ? "ReadFailed" : "StillPending")));
      const limitedAsks = asks;
      asks = 0;
      const answered = yield* sentPage;
      const final = yield* answered.autoCheck("Transfer", () => 0, () => Effect.sync((): Answer => (++asks <= 3 ? "Refused" : "FinalRead")));
      return {
        limited: [limitedAsks, limited.transfer.phase, limited.transfer.autoAsks, limited.transfer.stopped, limited.notice],
        final: [asks, final.transfer.phase, final.notice],
      };
    }));
    expect(result).toEqual({ limited: [240, "Sent", 240, false, "Quiet"], final: [4, "Done", "Counted"] });
  });

  it("a saved creation stops being checked after three failed checks in a row and keeps its saved request", async () => {
    const runtime = started();
    let asks = 0;
    const result = await runtime.runPromise(Effect.gen(function* () {
      const page = yield* ownerVaultPage(sessionSlots(), keys, false);
      yield* page.follow(actor);
      yield* page.review("Creation", 0n, quietPool, unreadLocks, "");
      const plan = { kind: "evmCall" as const, from: owner, chainId: quantity(BigInt(chainId)), to: factory, data: "0x", value: "0x0" };
      yield* page.submit("Creation", (beforePrompt) => Effect.as(beforePrompt(plan), hash("c")));
      const stopped = yield* page.autoCheck("Creation", () => 0, () => Effect.sync((): Answer => { asks += 1; return "Refused"; }));
      return { phase: stopped.creation.phase, stopped: stopped.creation.stopped, refusals: stopped.creation.refusals, notice: stopped.notice, kept: sessionStorage.getItem(keys.creation) !== null };
    }));
    expect({ ...result, asks }).toEqual({ phase: "Sent", stopped: true, refusals: 3, notice: "CheckFailed", kept: true, asks: 3 });
  });
});

describe('Close ASI\'s November month early from its owner awards (spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/settlement/monthly.md, "The reviewed ASI closeout proposes its month from the cutoff with its fixed pool and no change")', () => {
  it("after the cutoff November is the closeout project's last reachable month and other projects stop at October, its fixed allocations are never edited or saved, and Finalize sends the sequence it read and freezes the month", async () => {
    const monthPath = "/api/v1/payments/projects/asi/monthly/2026-11";
    const allocation = { githubUserId: "1", login: "fixture-contributor", grossBase: "150000000", proposedGrossBase: "150000000", sourceDigest: "c".repeat(64) };
    const view = {
      projectId: "asi",
      period: "2026-11",
      manifestSha256: "a".repeat(64),
      automatic: false,
      canManage: true,
      cutoffAt: "2026-12-04T00:00:00.000Z",
      deployment: null,
      asset: { network: "robinhood-mainnet", assetAddress: `0x${"1".repeat(40)}`, assetDecimals: 6, symbol: "USDG" },
      proposal: { earlyCloseAt: "2026-11-19T00:00:00.000Z", capBase: "150000000", allocationSequence: 0, allocations: [allocation], latestCutAt: null },
      run: null,
    };
    const run = { trigger: "owner", frozenAt: "2026-11-19T12:00:00.000Z", snapshotSha256: "d".repeat(64), totalGrossBase: "150000000", network: "robinhood-mainnet", vault: `0x${"2".repeat(40)}`, funded: true, awards: [{ githubUserId: "1", login: "fixture-contributor", grossBase: "150000000", feeBase: "1500000", netBase: "148500000", state: "awaiting-reservation" }] };
    const asked: Array<readonly [string, string, unknown]> = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname;
      const method = init?.method ?? "GET";
      const body = init?.body;
      asked.push([method, path, body === undefined || body === null ? null : JSON.parse(body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body))]);
      const answer = path === `${monthPath}/finalize` ? { ...view, run } : view;
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    };
    const runtime = ManagedRuntime.make(Layer.mergeAll(webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch)));
    cleanups.push(() => void runtime.dispose());
    const viewedAt = Date.parse("2026-11-22T00:00:00.000Z");
    const result = await runtime.runPromise(Effect.gen(function* () {
      const page = yield* ownerMonthlyPage(sessionSlots(), { commitment: "slop:award-commitment:v2:asi:2026-11", setting: "slop:vault-monthly:v1:robinhood-mainnet:asi", release: "slop:monthly-release:v1:asi:2026-11" }, "asi", "2026-11");
      yield* page.follow(actor, "123", true);
      const read = yield* page.readMonth();
      const edit = yield* tagOf(page.editDraft(false, ""));
      const save = yield* tagOf(page.save("1", "100000000", ""));
      const done = yield* page.finalize();
      return { fixed: read.state.month.fixed, editor: editorOpen(read.state), edit, save, frozen: (yield* page.machine.get()).month.frozen, final: "view" in done && done.view !== undefined ? done.view.run?.awards.map((award) => award.netBase) : undefined };
    }));
    expect({ ...result, closeout: monthBounds("asi", [], viewedAt), other: monthBounds("slop", [], viewedAt).last, asked }).toEqual({
      fixed: true,
      editor: false,
      edit: "MonthlyRefused",
      save: "MonthlyRefused",
      frozen: true,
      final: ["148500000"],
      closeout: { first: "2026-11", last: "2026-11", start: "2026-11" },
      other: "2026-10",
      asked: [["GET", monthPath, null], ["POST", `${monthPath}/finalize`, { expectedSequence: 0 }]],
    });
  });
});
