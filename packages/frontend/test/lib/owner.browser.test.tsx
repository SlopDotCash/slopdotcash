import { webCrypto } from "@repo/platform/crypto";
import { PLEDGED_FUNDS_SELECTOR, escrowAbi, evmAddress, factoryAbi } from "@repo/settlement/chain/evm/abi";
import { EVENT_TOPICS } from "@repo/settlement/chain/evm/events";
import { vaultKey } from "@repo/settlement/chain/evm/factories";
import { Effect, Layer, ManagedRuntime } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { type Hex, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, pad, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolFacts } from "../../gen/frontend__projections.ts";
import { lockedFundsText } from "../../gen/frontend__vaultLocks.ts";
import { unreadLocks } from "../../src/kernels/poolFunding.ts";
import { useFollowed } from "../../src/screens/funding/vault/VaultActions.tsx";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";
import { connectEvm } from "../../src/wallets/core/evm.vibe";
import { sessionSlots } from "../../src/wallets/core/slots.ts";
import { batchFlow } from "../../src/wallets/owner/batchedDeposit.vibe";
import { type EvmVault, type VaultReview, checkTransfer, reviewTransfer, sendTransfer } from "../../src/wallets/owner/evmVault.vibe";
import { type Answer, type OwnerVaultPage, type Saved, ownerVaultPage } from "../../src/wallets/owner/ownerVault.vibe";
import { provisionalMessages, provisionalVault } from "../../src/wallets/owner/provisionalVault.vibe";

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

function fakeChain(options: { readonly atomic: boolean; readonly send: "mine" | "unclear"; readonly approved?: boolean; readonly estimateReverts?: { readonly call: string; readonly error: unknown } }) {
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
    throw new Error(`unexpected getter ${name.name}`);
  };
  const mine = (transaction: { to: string; data: string; value?: string }) => {
    const block = BigInt(mined.length + 10);
    const vault = vaultOf(transaction.to);
    const amount = transaction.data.startsWith(selector("deposit")) ? BigInt(`0x${transaction.data.slice(10)}`) : 0n;
    const logs = vault === undefined || amount === 0n ? [] : [{ address: vault.vault, topics: [EVENT_TOPICS.Deposited, pad(owner as Hex)], data: encodeAbiParameters([{ type: "uint128" }], [amount]) }];
    const entry = { hash: hash((mined.length + 1).toString(16)), to: transaction.to, input: transaction.data, value: transaction.value ?? "0x0", block, logs };
    mined.push(entry);
    return entry;
  };
  const receipt = (entry: Mined) => ({
    status: "0x1",
    transactionHash: entry.hash,
    blockNumber: quantity(entry.block),
    blockHash: blockHash(entry.block),
    logs: entry.logs.map((log, index) => ({ ...log, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), transactionHash: entry.hash, logIndex: quantity(BigInt(index)), removed: false })),
  });
  const provider = {
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      const [first] = params as ReadonlyArray<Record<string, string>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
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
        return entry === undefined ? null : { from: owner, to: entry.to, input: entry.input, value: entry.value };
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
      yield* page.review("Transfer", 0n, quietPool, unreadLocks);
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
    const final = await runtime.runPromise(page.autoCheck("Transfer", 0, check));
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
      yield* first.review("Transfer", 0n, quietPool, unreadLocks);
      const send = (page: typeof first) => Effect.match(page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", beforePrompt)), { onFailure: (error) => error._tag, onSuccess: () => "sent" });
      const unclear = yield* send(first);
      const reloaded = yield* ownerVaultPage(sessionSlots(), keys, true);
      const other = yield* reloaded.follow(actor + 1);
      const none = yield* reloaded.follow(0);
      const same = yield* reloaded.follow(actor);
      const resend = yield* Effect.match(reloaded.review("Transfer", 0n, quietPool, unreadLocks), { onFailure: (error) => error._tag, onSuccess: (state) => state.transfer.phase });
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
      yield* page.review("Transfer", 10n ** 18n, quietPool, unreadLocks);
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
      const shown = provisionalMessages.received(tokenVault.network, sent.hash);
      chain.finalize();
      yield* reloaded.followCreation(connection, creation);
      const counted = yield* reloaded.followDeposit(connection, 2_000_000n);
      return {
        form: opened.form,
        savedHash: savedHash === sent.hash,
        resumed: [resumed.phase, resumed.transaction],
        again,
        received: [received.phase, received.view, received.counted],
        shown: shown === `Deposit received in a Base block. The vault is recorded once Base finalizes its creation, usually within 20 minutes, and the deposit counts after that; you can leave this page. ${sent.hash}`,
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
      shown: true,
      counted: ["Verified", "DepositVerified", true, true],
      cleared: null,
      sends: 1,
    });
  });
});
