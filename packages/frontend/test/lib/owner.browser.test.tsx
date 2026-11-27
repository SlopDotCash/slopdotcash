import { base58Encode, base64Encode } from "@repo/platform/chain/solana";
import { webCrypto } from "@repo/platform/crypto";
import { PLEDGED_FUNDS_SELECTOR, escrowAbi, evmAddress, factoryAbi } from "@repo/settlement/chain/evm/abi";
import { depositCalldata, expirePledgeCalldata, pledgeMonthsCalldata, setMonthlyCommitmentCalldata } from "@repo/settlement/chain/evm/actions";
import { EVENT_TOPICS } from "@repo/settlement/chain/evm/events";
import { vaultKey } from "@repo/settlement/chain/evm/factories";
import { pledgeMonthInstructions } from "@repo/settlement/chain/solana/instructions";
import { compileLegacy } from "@repo/settlement/chain/solana/transactions";
import { fromAmount, toAmount } from "@repo/settlement/kernels/amounts";
import { type Period, isPeriod, periodContaining } from "@repo/settlement/kernels/calendar";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Option, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { TestClock } from "effect/testing";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { type Hex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, erc20Abi, pad, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { editorOpen } from "../../gen/frontend__ownerMonthly.ts";
import type { Route } from "../../gen/app.ts";
import { actor as actorOf, visitor } from "../../gen/frontend__ownerVault.ts";
import { type PoolFacts, fundersView, lessThanOneMonthText, noFundersText, noRefundDisclosure, publicFunding } from "../../gen/frontend__projections.ts";
import { Machine as MonthlyMachine } from "../../gen/frontend__ownerMonthly.effect.vibe";
import { Machine as ReadMachine } from "../../gen/frontend__requests.effect.vibe";
import { lockedFundsText } from "../../gen/frontend__vaultLocks.ts";
import { type FundingVault, unreadLocks } from "../../src/kernels/poolFunding.ts";
import { monthBounds } from "../../src/screens/funding/awards/month.ts";
import { OwnerAwards } from "../../src/screens/funding/awards/OwnerAwards.tsx";
import { type PageRuntime, pageRuntime } from "../../src/app/runtime.vibe";
import { EscrowFunding, publicCoverage } from "../../src/screens/funding/vault/EscrowFunding.tsx";
import { lockProject, usdcSnapshot } from "../../src/screens/funding/vault/fixtures.ts";
import { VaultDesk, checkSetting, confirmTransferUnsent, connectWallet, followVault, fundersServicesOf, fundingMessages, reviewAction, savedAction, savedFundingOf, savedRequestHeld, showFunders, vaultServices } from "../../src/screens/funding/vault/funding.vibe";
import type { FundingDeployment, FundingProject } from "../../src/screens/funding/vault/project.schema.ts";
import { vaultKeys as fundingKeys } from "../../src/screens/funding/vault/savedPlans.ts";
import { type LockConnection, connectCard, lockDesk, lockMachine, readCard, releaseCard, reviewCard, sendCard, sendsDeposit, watchCard } from "../../src/screens/funding/vault/monthLock.vibe";
import { useFollowed } from "../../src/screens/funding/vault/VaultActions.tsx";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";
import { connectEvm } from "../../src/wallets/core/evm.vibe";
import { connectSolana } from "../../src/wallets/core/solana.vibe";
import { sessionSlots } from "../../src/wallets/core/slots.ts";
import { batchFlow } from "../../src/wallets/owner/batchedDeposit.vibe";
import { deploymentOf, vaultMonthlyCap } from "../../src/wallets/owner/commitmentCalls.ts";
import { type EvmVault, type VaultReview, checkTransfer, reviewTransfer, sendTransfer } from "../../src/wallets/owner/evmVault.vibe";
import { ownerMonthlyPage } from "../../src/wallets/owner/ownerMonthly.vibe";
import { type Answer, type OwnerVaultPage, type Saved, ownerVaultPage } from "../../src/wallets/owner/ownerVault.vibe";
import { provisionalMessages, provisionalVault } from "../../src/wallets/owner/provisionalVault.vibe";
import { creationOf } from "@repo/settlement/chain/evm/creation";
import { createVaultCalldata } from "@repo/settlement/chain/evm/factories";
import { registryProjectDigest } from "@repo/settlement/owner/ownerInstructions";
import { releaseMonthlyReserveCalldata } from "@repo/settlement/chain/evm/monthlyRoot";
import { parsePeriod } from "@repo/settlement/kernels/calendar";
import { AwardsDesk, awardsServices, checkSavedRelease, connectReleaseOwner, followAwards, reviewRelease, sendRelease } from "../../src/screens/funding/awards/awards.vibe";
import { frozenMonth } from "../../src/screens/funding/awards/fixtures.ts";
import { OwnerVaultSetup } from "../../src/screens/funding/vault/VaultSetup.tsx";
import { SetupDesk, bountyFundsServices, checkRegistration, connectSetupWallet, createVault, readBountyFunds, reviewCreation, savedCreation, setupKey, setupServices } from "../../src/wallets/owner/vaultSetup.vibe";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const owner = account.address.toLowerCase();
const chainId = 8453;
const runtimeCode = "0x6080";
const factory = "0x00000000000000000000000000000000000000fa";
const factoryImplementation = "0x00000000000000000000000000000000000000f1";
const registrar = "0x00000000000000000000000000000000000000f2";
const feeRecipient = "0x00000000000000000000000000000000000000fe";
const projectWord: Hex = `0x${"5".repeat(64)}`;
const codeSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([0x60, 0x80]))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const review: VaultReview = {
  codeSha256,
  implementation: undefined,
  factory: { address: factory, codeSha256, implementation: { address: factoryImplementation, codeSha256 }, registrar },
  feeRecipient,
  bindingDelaySeconds: 0n,
  purpose: "OrdinaryPurpose",
};
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
const networkFetch = globalThis.fetch.bind(globalThis);
let answering: ((path: string, method: string) => Response | undefined) | undefined;
const answeredFetch: typeof globalThis.fetch = (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname;
  const answer = answering?.(path, (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase());
  return answer === undefined ? networkFetch(input, init) : Promise.resolve(answer);
};
globalThis.fetch = answeredFetch;
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
  readonly transactionIndex: bigint;
  readonly logs: ReadonlyArray<{ address: string; topics: string[]; data: string }>;
}

function addressOf(text: string) {
  const parsed = evmAddress(text);
  if (parsed === undefined) throw new Error(`not an address ${text}`);
  return parsed;
}

const vaultKeys = [nativeVault, tokenVault].map((vault) => ({ vault, key: vaultKey({ owner: addressOf(owner), projectId: projectWord as never, asset: addressOf(vault.asset), purpose: "OrdinaryPurpose" }) }));

type Pledges = Map<number, { amount: bigint; open: boolean }>;
type LockBatchReport =
  | "multiple" | "sameBlock" | "reversedIndex" | "stale" | "conflictingHead" | "duplicate" | "wrongMembership"
  | "wrongChain" | "wrongReference" | "wrongDeposit" | "wrongPledge"
  | "legacySingleton" | "modernSingleton" | "wrongSingletonChain" | "nonAtomicSingleton"
  | "notSentWithReceipt" | "notSentWithMalformedReceipt" | "malformedPledgeBlock";

const monthAfter = (period: number, months: number) => {
  const index = Math.floor(period / 100) * 12 + (period % 100) - 1 + months;
  return Math.floor(index / 12) * 100 + (index % 12) + 1;
};

interface FactoryObservation {
  readonly code?: string;
  readonly slot?: string;
  readonly implementationCode?: string;
  readonly registrar?: `0x${string}`;
}

function fakeChain(options: {
  readonly atomic: boolean;
  readonly send: "mine" | "unclear";
  readonly approved?: boolean;
  readonly estimateReverts?: { readonly call: string; readonly error: unknown };
  readonly pledges?: Pledges;
  readonly current?: number;
  readonly failReceipts?: boolean;
  readonly wallet?: string;
  readonly factoryObservation?: FactoryObservation;
  readonly lockBatch?: LockBatchReport;
  readonly batchRefusal?: () => Error;
}) {
  const free = 10n ** 19n;
  const mined: Mined[] = [];
  const seen: string[] = [];
  let finalized = options.lockBatch === "conflictingHead" ? 10n : 0n;
  let lockBatch: { readonly id: string; readonly entries: ReadonlyArray<Mined> } | undefined;
  const notSentWithReceipt = options.lockBatch === "notSentWithReceipt" || options.lockBatch === "notSentWithMalformedReceipt";
  const singleton = options.lockBatch === "legacySingleton" || options.lockBatch === "modernSingleton"
    || options.lockBatch === "wrongSingletonChain" || options.lockBatch === "nonAtomicSingleton" || notSentWithReceipt;
  const blockHash = (block: bigint) => options.lockBatch === "malformedPledgeBlock"
    && mined.some((entry) => entry.block === block && entry.input.startsWith(selector("pledgeMonths")))
    ? "0x0" : hash(block.toString(16).slice(-1));
  const vaultOf = (to: string) => [nativeVault, tokenVault].find((vault) => vault.vault === to.toLowerCase());
  const read = (to: string, data: string): string => {
    const vault = vaultOf(to);
    if (to.toLowerCase() === factory) {
      if (data === encodeFunctionData({ abi: factoryAbi, functionName: "registrar" }))
        return encodeFunctionResult({ abi: factoryAbi, functionName: "registrar", result: options.factoryObservation?.registrar ?? registrar });
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
    if (name.name === "feeRecipient") return encodeFunctionResult({ abi: escrowAbi, functionName: "feeRecipient", result: feeRecipient });
    if (name.name === "factory") return encodeFunctionResult({ abi: escrowAbi, functionName: "factory", result: factory });
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
  const mine = (transaction: { from?: string; to: string; data: string; value?: string }, block = BigInt(mined.length + 10), transactionIndex = 0n) => {
    if (options.pledges !== undefined && options.failReceipts !== true && (transaction.data.startsWith(selector("pledgeMonths")) || transaction.data.startsWith(selector("expirePledge")))) {
      const decoded = decodeFunctionData({ abi: escrowAbi, data: transaction.data as Hex });
      const args = decoded.args as unknown as ReadonlyArray<number | bigint>;
      if (decoded.functionName === "pledgeMonths") for (let index = 0; index < Number(args[1]); index++) options.pledges.set(monthAfter(Number(args[0]), index), { amount: BigInt(args[2] ?? 0n), open: true });
      else options.pledges.set(Number(args[0]), { amount: options.pledges.get(Number(args[0]))?.amount ?? 0n, open: false });
    }
    const vault = vaultOf(transaction.to);
    const amount = transaction.data.startsWith(selector("deposit")) ? BigInt(`0x${transaction.data.slice(10)}`) : 0n;
    const setting = transaction.data.startsWith(selector("setMonthlyCommitment")) ? (decodeFunctionData({ abi: escrowAbi, data: transaction.data as Hex }).args as unknown as readonly [bigint, boolean]) : undefined;
    const logs = vault === undefined ? []
      : setting !== undefined ? [{ address: vault.vault, topics: [EVENT_TOPICS.MonthlyCommitmentSet], data: encodeAbiParameters([{ type: "uint128" }, { type: "bool" }], [setting[0], setting[1]]) }]
      : amount === 0n ? [] : [{ address: vault.vault, topics: [EVENT_TOPICS.Deposited, pad(owner as Hex)], data: encodeAbiParameters([{ type: "uint128" }], [amount]) }];
    const entry = { hash: hash((mined.length + 1).toString(16)), from: (transaction.from ?? options.wallet ?? owner).toLowerCase(), to: transaction.to, input: transaction.data, value: transaction.value ?? "0x0", block, transactionIndex, logs };
    mined.push(entry);
    return entry;
  };
  const previousLock = options.lockBatch === "stale" ? [
    mine({ to: tokenVault.vault, data: depositCalldata(3_000_000n) }),
    mine({ to: tokenVault.vault, data: pledgeMonthsCalldata(options.current ?? 0, 1, 2_000_000n) }),
  ] : undefined;
  const receipt = (entry: Mined) => ({
    status: options.failReceipts === true ? "0x0" : "0x1",
    transactionHash: entry.hash,
    blockNumber: quantity(entry.block),
    blockHash: blockHash(entry.block),
    transactionIndex: quantity(entry.transactionIndex),
    logs: options.failReceipts === true ? [] : entry.logs.map((log, index) => ({ ...log, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), transactionHash: entry.hash, logIndex: quantity(BigInt(index)), removed: false })),
  });
  const provider = {
    request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      const [first] = params as ReadonlyArray<Record<string, string>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return Promise.resolve([options.wallet ?? account.address]);
      if (method === "eth_chainId") return Promise.resolve(quantity(BigInt(chainId)));
      if (method === "eth_call") {
        try {
          return Promise.resolve(read(String(first?.to), String(first?.data)));
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (method === "eth_getBalance") return Promise.resolve(quantity(free));
      if (method === "eth_estimateGas") {
        if (options.estimateReverts !== undefined && String(first?.data).startsWith(options.estimateReverts.call)) return Promise.reject(options.estimateReverts.error instanceof Error ? options.estimateReverts.error : new Error(String(options.estimateReverts.error)));
        return Promise.resolve("0x5208");
      }
      if (method === "wallet_getCapabilities") return Promise.resolve(options.atomic ? { [quantity(BigInt(chainId))]: { atomic: { status: "supported" } } } : {});
      if (method === "eth_sendTransaction") {
        if (options.send === "unclear") return Promise.reject(new Error("RPC timeout"));
        return Promise.resolve(mine(first as unknown as { to: string; data: string; value?: string }).hash);
      }
      if (method === "wallet_sendCalls") {
        if (options.batchRefusal !== undefined) return Promise.reject(options.batchRefusal());
        const calls = (first as unknown as { calls: ReadonlyArray<{ to: string; data: string; value?: string }> }).calls;
        const sharedBlock = options.lockBatch === "sameBlock" || options.lockBatch === "reversedIndex" ? BigInt(mined.length + 10) : undefined;
        const entries = previousLock ?? calls.map((call, index) => {
          const submitted = options.lockBatch === "wrongPledge" && call.data.startsWith(selector("pledgeMonths"))
            ? { ...call, data: pledgeMonthsCalldata(options.current ?? 0, 1, 2_000_001n) }
            : call;
          return sharedBlock === undefined ? mine(submitted) : mine(submitted, sharedBlock, BigInt(index));
        });
        const last = entries.at(-1);
        if (last === undefined || options.lockBatch === undefined) {
          if (last !== undefined) {
            mined[mined.length - 1] = { ...last, logs: [...last.logs, ...entries.slice(0, -1).flatMap((entry) => entry.logs)] };
          }
          return Promise.resolve({ id: `batch-${last?.hash ?? ""}` });
        }
        const id = previousLock === undefined ? `0x${last.hash.slice(2).padStart(128, "0")}` : `0x${"b".repeat(128)}`;
        if (singleton) {
          const single = { ...last, logs: entries.flatMap((entry) => entry.logs) };
          mined.splice(mined.length - entries.length, entries.length, single);
          lockBatch = { id, entries: [single] };
        } else {
          lockBatch = { id, entries };
        }
        return Promise.resolve({ id });
      }
      if (method === "wallet_getCallsStatus") {
        const reference = String(params[0]);
        if (lockBatch === undefined) return Promise.resolve({ status: 200, receipts: [{ transactionHash: reference.slice(6) }] });
        if (reference !== lockBatch.id) return Promise.resolve({ status: 400 });
        if (options.lockBatch === "legacySingleton") return Promise.resolve({ status: 200, receipts: lockBatch.entries.map((entry) => ({ transactionHash: entry.hash })) });
        const [firstEntry, secondEntry, ...remaining] = lockBatch.entries;
        let entries = lockBatch.entries;
        if (options.lockBatch === "duplicate" && secondEntry !== undefined) entries = [secondEntry, secondEntry, ...remaining];
        if (options.lockBatch === "reversedIndex" && firstEntry !== undefined && secondEntry !== undefined) entries = [secondEntry, firstEntry, ...remaining];
        const reportChain = options.lockBatch === "sameBlock" ? `0x0${chainId.toString(16)}` : quantity(BigInt(chainId));
        const receipts = entries.map((entry) => ({
          transactionHash: entry.hash,
          blockNumber: quantity(entry.block),
          blockHash: blockHash(entry.block),
          status: options.failReceipts === true ? "0x0" : "0x1",
          gasUsed: "0x5208",
          logs: options.failReceipts === true ? [] : entry.logs,
        }));
        return Promise.resolve({
          version: "2.0.0",
          id: options.lockBatch === "wrongReference" ? `0x${"f".repeat(128)}` : lockBatch.id,
          chainId: options.lockBatch === "wrongChain" || options.lockBatch === "wrongSingletonChain" ? "0x1" : reportChain,
          status: notSentWithReceipt ? 400 : options.failReceipts === true ? 500 : 200,
          atomic: options.lockBatch !== "nonAtomicSingleton",
          receipts: options.lockBatch === "notSentWithMalformedReceipt" ? receipts[0] : receipts,
        });
      }
      if (method === "eth_getTransactionReceipt") {
        const entry = mined.find((item) => item.hash === params[0]);
        return Promise.resolve(entry === undefined ? null : receipt(entry));
      }
      if (method === "eth_getTransactionByHash") {
        const entry = mined.find((item) => item.hash === params[0]);
        if (entry === undefined) return Promise.resolve(null);
        const wrongDeposit = options.lockBatch === "wrongDeposit" && entry.input.startsWith(selector("deposit"));
        return Promise.resolve({
          hash: entry.hash,
          from: entry.from,
          to: entry.to,
          input: wrongDeposit ? depositCalldata(3_000_001n) : entry.input,
          value: entry.value,
          blockNumber: quantity(entry.block),
          blockHash: blockHash(entry.block),
          transactionIndex: quantity(entry.transactionIndex),
        });
      }
      if (method === "eth_getBlockByNumber") {
        if (params[0] === "latest" && options.lockBatch === "legacySingleton") return Promise.resolve(null);
        const block = params[0] === "latest" ? mined.at(-1)?.block ?? 9n : params[0] === "finalized" ? finalized : BigInt(String(params[0]));
        const transactions = mined.filter((entry) => entry.block === block).map((entry) =>
          options.lockBatch === "wrongMembership" && entry.input.startsWith(selector("deposit")) ? hash("f") : entry.hash);
        return Promise.resolve({ number: quantity(block), hash: blockHash(block), transactions });
      }
      if (method === "eth_getCode") {
        if (params[0] === factory) return Promise.resolve(options.factoryObservation?.code ?? runtimeCode);
        if (params[0] === factoryImplementation) return Promise.resolve(options.factoryObservation?.implementationCode ?? runtimeCode);
        return Promise.resolve(runtimeCode);
      }
      if (method === "eth_getStorageAt") {
        const implementation = encodeAbiParameters([{ type: "address" }], [factoryImplementation]);
        return Promise.resolve(params[0] === factory ? options.factoryObservation?.slot ?? implementation : `0x${"0".repeat(64)}`);
      }
      return Promise.reject(Object.assign(new Error(`unsupported ${method}`), { code: 4200 }));
    },
  };
  return { provider, seen, mined, mineCreation: () => mine({ to: factory, data: "0x" }).hash, mineCall: (call: { to: string; data: string }) => mine(call).hash, finalize: (through = BigInt(mined.length + 100)) => { finalized = through; } };
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

type Requested = { readonly method: string; readonly params?: ReadonlyArray<unknown> };

function storageFailsOnSend(provider: { readonly request: (asked: Requested) => Promise<unknown> }) {
  const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
  cleanups.push(() => {
    if (descriptor !== undefined) Object.defineProperty(Storage.prototype, "setItem", descriptor);
  });
  return {
    request: (asked: Requested) => {
      if (asked.method === "eth_sendTransaction")
        Storage.prototype.setItem = () => {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        };
      return provider.request(asked);
    },
  };
}

const ownerWalletId = Effect.map(Effect.flatMap(WalletChoice, (choice) => choice.current()), (offers) => offers.find((offer) => offer.name === "Owner wallet")?.id ?? 0);

function Follower({ runtime, page, account }: { runtime: ReturnType<typeof started>; page: OwnerVaultPage; account: number }) {
  useFollowed(runtime, `follow:${account}`, () => page.follow(account));
  return null;
}

function followAs(runtime: ReturnType<typeof started>, page: OwnerVaultPage) {
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

// spec/frontend/ownerVault.md, "Story: Create and register the vault without asking the wallet twice"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
describe("Owner vault registration", () => {
  // spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out"
  it("owner deposits once, sign-out/sign-in resumes check, finalized clears slot", async () => {
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
    const follow = followAs(runtime, page);
    const shown = await follow(actor);
    const signedOut = await follow(0);
    const back = await follow(actor);
    chain.finalize();
    const final = await runtime.runPromise(page.autoCheck("Transfer", () => 0, check));
    expect(result.sent).toBe(chain.mined[0]?.hash);
    const savedRecord = JSON.parse(String(result.savedBeforePrompt)) as { account?: number; request?: string; plan: string };
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

  // spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"
  it("a withdrawal whose gas estimate the vault refuses as locked funds says so in plain words, saves nothing and asks the wallet nothing", async () => {
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

  // spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"
  it.each([
    ["runtime", { code: "0x6081" }, "Escrow factory code does not match reviewed deployment"],
    ["implementation slot", { slot: `0x${"0".repeat(64)}` }, "Escrow implementation does not match reviewed deployment"],
    ["implementation runtime", { implementationCode: "0x6081" }, "Escrow implementation does not match reviewed deployment"],
    ["registrar", { registrar: factoryImplementation }, "Escrow asset, factory or registrar does not match reviewed deployment"],
  ] as const)("a changed factory %s refuses before saving or asking the owner wallet", async (_name, factoryObservation, message) => {
    const chain = fakeChain({ atomic: false, send: "mine", factoryObservation });
    const result = await started().runPromise(Effect.gen(function* () {
      announce("f327a18b-2e62-4beb-9c1d-c4a94c6aab21", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), keys, true);
      yield* page.follow(actor);
      yield* page.review("Transfer", 0n, quietPool, unreadLocks, "");
      const refused = yield* Effect.match(page.submit("Transfer", (beforePrompt) => sendTransfer(connection, nativeVault, "deposit", "send", "5", "finalized", beforePrompt)), { onFailure: (error) => error.message, onSuccess: () => "sent" });
      return { refused, saved: sessionStorage.getItem(keys.transfer) !== null, phase: (yield* page.machine.get()).transfer.phase };
    }));
    expect({ ...result, prompts: chain.seen.filter((method) => method === "eth_sendTransaction").length })
      .toEqual({ refused: message, saved: false, phase: "Reviewed", prompts: 0 });
  });
});

// spec/frontend/batchedDeposit.md, "Story: Offer one atomic request only on a wallet that already supports it"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Wallet references identify later lookups and uncertainty preserves the intent"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending"
describe("Atomic batch deposit", () => {
  it("atomic wallet approves and deposits once and reload resumes until finalized", async () => {
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

  it.each([
    { reply: "direct capability refusal", error: Object.assign(new Error("Wallet capability unavailable"), { code: 5700 }), phase: "Separate", resumed: "Unreviewed", failure: "BatchStopped", retained: false },
    { reply: "nested capability code", error: Object.assign(new Error("The reply was lost"), { code: -32603, cause: { code: 5700 } }), phase: "Uncertain", resumed: "Uncertain", failure: "BatchStopped", retained: true },
    { reply: "user decline", error: Object.assign(new Error("Declined"), { code: 4001 }), phase: "Declined", resumed: "Unreviewed", failure: "WalletDeclined", retained: false },
  ])("registered vault batch fallback handles $reply and preserves the saved intent when uncertain", async ({ error, phase, resumed, failure, retained }) => {
    let savedAtPrompt: string | null = null;
    const chain = fakeChain({ atomic: true, send: "mine", batchRefusal: () => {
      savedAtPrompt = sessionStorage.getItem(batchKey);
      return error;
    } });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const connection = yield* connected;
      const flow = yield* batchFlow(sessionSlots(), batchKey);
      yield* flow.review(actor, yield* reviewTransfer(connection, tokenVault, "deposit", "2", "finalized"));
      const outcome = yield* Effect.match(flow.send(connection, tokenVault, "2", "finalized"), { onFailure: (stopped) => stopped._tag, onSuccess: (state) => state.phase });
      const after = (yield* flow.machine.get()).phase;
      const reloaded = yield* batchFlow(sessionSlots(), batchKey);
      const recovered = (yield* reloaded.machine.get()).phase;
      const again = yield* Effect.exit(reloaded.send(connection, tokenVault, "2", "finalized"));
      return { outcome, after, recovered, blocked: Exit.isFailure(again), slot: sessionStorage.getItem(batchKey) };
    }));
    expect(savedAtPrompt).not.toBeNull();
    expect(result).toEqual({ outcome: failure, after: phase, recovered: resumed, blocked: true, slot: retained ? savedAtPrompt : null });
    expect(chain.seen.filter((method) => method === "wallet_sendCalls" || method === "eth_sendTransaction")).toEqual(["wallet_sendCalls"]);
  });

  // spec/frontend/batchedDeposit.md, "A separate approval proceeds at canonical inclusion and never counts as funding"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"
  it("separate approval proceeds at inclusion and deposit counts at finality", async () => {
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

  // spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"
  it("signed-out visitor atomic batch saves under tab slot and re-checks capability", async () => {
    const options = { atomic: true, send: "mine" as const, approved: false, wallet: otherAccount.address };
    const chain = fakeChain(options);
    const deployment: FundingDeployment = { network: "base-mainnet", vault: tokenVault.vault, asset: tokenVault.asset, owner };
    const slots = fundingKeys("visitor-funding", deployment, "2026-11");
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a", chain.provider);
      const connection = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), { creation: slots.creation, transfer: slots.transfer }, true);
      const by = actorOf(yield* page.reviewDeposit());
      const flow = yield* batchFlow(sessionSlots(), slots.batch);
      const reviewed = (amount: string) => Effect.flatMap(reviewTransfer(connection, tokenVault, "deposit", amount, "finalized"), (review) => flow.review(by, review));
      const atomic = yield* reviewed("2");
      options.approved = true;
      const covered = yield* reviewed("3");
      options.approved = false;
      const again = yield* reviewed("2");
      const sent = yield* flow.send(connection, tokenVault, "2", "finalized");
      return {
        by,
        reviews: [atomic, covered, again].map((state) => [state.phase, state.capability]),
        sent: [sent.phase, sent.owner, sent.requests],
        account: (JSON.parse(String(sessionStorage.getItem(slots.batch))) as { account?: number }).account,
        transfer: sessionStorage.getItem(slots.transfer),
      };
    }));
    const other = otherAccount.address.toLowerCase();
    expect({ ...result, approval: chain.mined[0]?.input, calls: chain.mined.map((entry) => [entry.from, entry.to, entry.input.slice(0, 10)]), batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, transactions: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      by: visitor,
      reviews: [["Offered", "AlreadyAtomic"], ["Separate", "NoCapability"], ["Offered", "AlreadyAtomic"]],
      sent: ["WalletReference", visitor, 1],
      account: 0,
      transfer: null,
      approval: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tokenVault.vault as Hex, 2_000_000n] }),
      calls: [[other, tokenVault.asset, toFunctionSelector("approve(address,uint256)")], [other, tokenVault.vault, selector("deposit")]],
      batches: 1,
      transactions: 0,
    });
  });
});

// spec/frontend/provisionalVault.md, "Story: Retain an uncertain deposit through replacement and finality"; spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"; spec/frontend/provisionalVault.md, "Only a finalized deposit in a registered vault is eligible for accounting"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
describe("Provisional deposit recovery", () => {
  it("provisional deposit reloads without re-prompt and counts at finality", async () => {
    const chain = fakeChain({ atomic: false, send: "mine", approved: true });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("9c1d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f", chain.provider);
      const connection = yield* connected;
      const creation = chain.mineCreation();
      const first = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner, actor);
      yield* first.reviewCreation("OrdinaryEvmToken", true);
      const opened = yield* first.followCreation(connection, creation);
      const sent = yield* first.deposit(connection, "2");
      const storedPlan = (JSON.parse(String(sessionStorage.getItem(provisionalKey))) as { plan: string }).plan;
      const savedHash = (JSON.parse(storedPlan) as { hash?: string }).hash;
      const reloaded = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner, actor);
      const resumed = yield* reloaded.machine.get();
      const again = yield* Effect.match(reloaded.deposit(connection, "2"), { onFailure: (error) => error._tag, onSuccess: ({ state }) => state.phase });
      yield* reloaded.followCreation(connection, creation);
      const received = (yield* reloaded.followSaved(connection)).state;
      chain.finalize();
      yield* reloaded.followCreation(connection, creation);
      const counted = (yield* reloaded.followSaved(connection)).state;
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

  const openedProvisional = (connection: Effect.Success<typeof connected>, creation: string) =>
    Effect.gen(function* () {
      const page = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner, actor);
      yield* page.reviewCreation("OrdinaryEvmToken", true);
      yield* page.followCreation(connection, creation);
      return page;
    });

  it("non-batch token deposit approves first under provisional key before deposit", async () => {
    const options = { atomic: false, send: "mine" as const, approved: false };
    const chain = fakeChain(options);
    const savedAtPrompt: unknown[] = [];
    const provider = {
      request: (asked: Requested) => {
        if (asked.method === "eth_sendTransaction") savedAtPrompt.push(JSON.parse((JSON.parse(String(sessionStorage.getItem(provisionalKey))) as { plan: string }).plan));
        return chain.provider.request(asked);
      },
    };
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d", provider);
      const connection = yield* connected;
      const page = yield* openedProvisional(connection, chain.mineCreation());
      const approval = yield* page.deposit(connection, "2");
      const waiting = yield* Effect.match(page.deposit(connection, "2"), { onFailure: (error) => error._tag, onSuccess: ({ state }) => state.phase });
      const settled = (yield* page.followSaved(connection)).state;
      options.approved = true;
      const deposit = yield* page.deposit(connection, "2");
      return { steps: [approval.step, deposit.step], waiting, settled: [settled.approval, settled.phase], phase: deposit.state.phase };
    }));
    const [approve, deposited] = chain.mined.slice(1);
    expect({ ...result, savedAtPrompt, approval: approve?.input, targets: [approve?.to, deposited?.to], sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      steps: ["approve", "send"],
      waiting: "DepositStopped",
      settled: ["ApprovalConfirmed", "NoDeposit"],
      phase: "Submitted",
      savedAtPrompt: [
        { kind: "evmDeposit", call: { kind: "evmCall", from: owner, chainId: quantity(BigInt(chainId)), to: tokenVault.asset, data: approve?.input, value: "0x0" }, hash: "" },
        { kind: "evmDeposit", call: { kind: "evmCall", from: owner, chainId: quantity(BigInt(chainId)), to: tokenVault.vault, data: deposited?.input, value: "0x0" }, hash: "" },
      ],
      approval: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tokenVault.vault as Hex, 2_000_000n] }),
      targets: [tokenVault.asset, tokenVault.vault],
      sends: 2,
    });
  });

  // spec/frontend/batchedDeposit.md, "Wallet references identify later lookups and uncertainty preserves the intent"
  it("atomic provisional deposit resumes on reload and counts at finality", async () => {
    const chain = fakeChain({ atomic: true, send: "mine" });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", chain.provider);
      const connection = yield* connected;
      const creation = chain.mineCreation();
      const first = yield* openedProvisional(connection, creation);
      const sent = yield* first.deposit(connection, "2");
      const reloaded = yield* provisionalVault(sessionSlots(), provisionalKey, tokenVault, owner, actor);
      const resumed = yield* reloaded.machine.get();
      const again = yield* Effect.match(reloaded.deposit(connection, "2"), { onFailure: (error) => error._tag, onSuccess: ({ state }) => state.phase });
      yield* reloaded.followCreation(connection, creation);
      const received = (yield* reloaded.followSaved(connection)).state;
      chain.finalize();
      yield* reloaded.followCreation(connection, creation);
      const counted = (yield* reloaded.followSaved(connection)).state;
      return {
        step: sent.step,
        resumed: [resumed.phase, resumed.batched],
        again,
        received: [received.phase, received.view, received.counted],
        counted: [counted.phase, counted.view, counted.registered, counted.counted],
        cleared: sessionStorage.getItem(provisionalKey),
      };
    }));
    expect({ ...result, calls: chain.mined.slice(1).map((entry) => [entry.to, entry.input.slice(0, 10)]), batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      step: "batch",
      resumed: ["Submitted", true],
      again: "DepositStopped",
      received: ["IncludedEvent", "Received", false],
      counted: ["Verified", "DepositVerified", true, true],
      cleared: null,
      calls: [[tokenVault.asset, toFunctionSelector("approve(address,uint256)")], [tokenVault.vault, selector("deposit")]],
      batches: 1,
      sends: 0,
    });
  });

  it("an unclear wallet answer keeps the unsent provisional request, and after a reload the owner's clear removes it so the deposit is reviewed again", async () => {
    const chain = fakeChain({ atomic: false, send: "unclear", approved: true });
    const runtime = started();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", chain.provider);
      const connection = yield* connected;
      const creation = chain.mineCreation();
      const first = yield* openedProvisional(connection, creation);
      const unclear = yield* Effect.match(first.deposit(connection, "2"), { onFailure: (error) => error.message, onSuccess: () => "sent" });
      const kept = sessionStorage.getItem(provisionalKey) !== null;
      const reloaded = yield* openedProvisional(connection, creation);
      const restored = (yield* reloaded.machine.get()).phase;
      const cleared = yield* reloaded.clearUnsent(connection);
      return { unclear, kept, restored, cleared: [cleared.phase, cleared.form], saved: yield* reloaded.saved(), after: sessionStorage.getItem(provisionalKey) };
    }));
    expect({ ...result, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      unclear: provisionalMessages.unclear,
      kept: true,
      restored: "Prompt",
      cleared: ["NoDeposit", "Provisional"],
      saved: undefined,
      after: null,
      sends: 1,
    });
  });

  // spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"
  it("sent provisional deposit moves to registered vault slot on page load", async () => {
    const chain = fakeChain({ atomic: false, send: "mine", approved: true });
    const runtime = started();
    const sent = await runtime.runPromise(Effect.gen(function* () {
      announce("3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a", chain.provider);
      const connection = yield* connected;
      const page = yield* openedProvisional(connection, chain.mineCreation());
      return yield* page.deposit(connection, "2");
    }));
    const deployment: FundingDeployment = { network: "base-mainnet", vault: tokenVault.vault, asset: tokenVault.asset, owner };
    const project: FundingProject = { id: "handed-over", slug: "handed-over", reward: { kind: "monthly-pool", monthlyCapMinor: "250000000" }, escrow: { chain: "base", deployments: [deployment] } };
    const registered = ManagedRuntime.make(vaultServices(project, deployment, "2026-11"));
    cleanups.push(() => void registered.dispose());
    const moved = await registered.runPromise(Effect.gen(function* () {
      const followed = yield* followVault(actor);
      return { phase: followed.transfer.phase, hash: followed.transfer.slot.hash, label: yield* savedAction(), held: savedRequestHeld(project, deployment, "2026-11") };
    }));
    expect({ ...moved, account: (JSON.parse(String(sessionStorage.getItem(batchKey))) as { account?: number }).account, provisional: sessionStorage.getItem(provisionalKey), sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      phase: "Sent",
      hash: sent.hash,
      label: "Deposit",
      held: true,
      account: actor,
      provisional: null,
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

// spec/frontend/monthLock.md, "Story: Lock months from the owner's wallet"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"; spec/frontend/monthLock.md, "A review runs the lock refusals against the card's own read, and only the owner's accepted review can be sent"; spec/frontend/monthLock.md, "A lapsed month stays locked until any connected wallet sends its release"; spec/frontend/monthLock.md, "A declined or unclear wallet request sends nothing new, and a sent one is checked every five seconds at most 720 times"; spec/frontend/monthLock.md, "A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
describe("Month locks", () => {
  it("unsupported vault hides card and owner locks three months until finalized", async () => {
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

  // spec/frontend/vaultLocks.md, "A lock review refuses a count other than 1, 3, 6 or 12, another wallet, an amount below the monthly amount, a lowered month, short free funds and an unbatchable deposit, in that order"; spec/settlement/monthPledges.md, "A lock covers 1, 3, 6 or 12 months from the current UTC month at one positive amount"
  it("invalid count, low amount, lowered month, short funds, and unbatchable deposit refused in order", async () => {
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

  const batched = async (lockBatch: LockBatchReport, failReceipts = false) => {
    const pledges: Pledges = new Map();
    const chain = fakeChain({ atomic: true, send: "mine", pledges, current, lockBatch, failReceipts });
    const runtime = cardRuntime({ owner, evm: tokenVault, solana: undefined });
    let reloads = 0;
    const journey = Effect.gen(function* () {
      announce("4d5e6f7a-8b9c-4dae-8f01-3b4c5d6e7f8a", chain.provider);
      const connection = yield* evmCard;
      yield* readCard(rowOf(tokenVault, pledges, 10_000_000n), 10_000_000n, nowSeconds());
      yield* connectCard(connection);
      const review = yield* reviewCard(connection, 1, "2", "3", 1_000_000n);
      yield* sendCard(connection);
      const lock = yield* lockMachine();
      const watcher = yield* Effect.forkChild(watchCard(connection, Effect.sync(() => { reloads += 1; })), { startImmediately: true });
      const nextCheck = (checks: number) => Effect.gen(function* () {
        yield* TestClock.adjust("5 seconds");
        return Option.getOrThrow(yield* Stream.runHead(Stream.filter(lock.changes, (state) => state.checks === checks)));
      });
      let partial;
      if (lockBatch === "multiple" && !failReceipts) {
        const deposit = chain.mined.find((entry) => entry.input.startsWith(selector("deposit")));
        if (deposit === undefined) throw new Error("Missing deposit transaction in the batch fixture.");
        chain.finalize(deposit.block);
        partial = (yield* nextCheck(1)).phase;
      }
      let state = yield* cardState;
      if (state.phase === "LockChecking") {
        chain.finalize();
        state = yield* nextCheck(state.checks + 1);
      }
      if (state.phase === "LockChecking") yield* Fiber.interrupt(watcher);
      else yield* Fiber.join(watcher);
      return { deposit: review.depositGross, partial, phase: state.phase, notice: state.notice, withDeposit: sendsDeposit(state), last: chain.mined.at(-1)?.input };
    });
    const result = await runtime.runPromise(Effect.provide(journey, TestClock.layer()));
    return { ...result, reloads, locked: [...pledges.values()], batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, transactions: chain.seen.filter((method) => method === "eth_sendTransaction").length };
  };

  it(`a deposit and lock use one request and the lock waits for both finalized receipts (spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending")`, async () => {
    expect(await batched("multiple")).toMatchObject({
      deposit: 3_000_000n,
      partial: "LockChecking",
      phase: "LockIncluded",
      last: pledgeMonthsCalldata(current, 1, 2_000_000n),
      reloads: 1,
      locked: [{ amount: 2_000_000n, open: true }],
      batches: 1,
      transactions: 0,
    });
  });

  it("a lock batch verifies finalized receipts ordered within one block with a padded report chain ID", async () => {
    expect(await batched("sameBlock")).toMatchObject({ phase: "LockIncluded", reloads: 1, locked: [{ amount: 2_000_000n, open: true }], batches: 1, transactions: 0 });
  });

  it("a legacy singleton lock batch still completes when the pre-prompt chain head is unavailable", async () => {
    expect(await batched("legacySingleton")).toMatchObject({ phase: "LockIncluded", reloads: 1, locked: [{ amount: 2_000_000n, open: true }], batches: 1, transactions: 0 });
  });

  it("a modern singleton lock batch verifies its bound finalized receipt", async () => {
    expect(await batched("modernSingleton")).toMatchObject({ phase: "LockIncluded", reloads: 1, locked: [{ amount: 2_000_000n, open: true }], batches: 1, transactions: 0 });
  });

  it("a fully reverted atomic lock batch locks nothing", async () => {
    expect(await batched("multiple", true)).toMatchObject({ phase: "LockIdle", notice: "LockFailedNotice", withDeposit: true, reloads: 0, locked: [], batches: 1, transactions: 0 });
  });

  it("a reverted atomic lock batch with different deposit calldata stays pending", async () => {
    expect(await batched("wrongDeposit", true)).toMatchObject({ phase: "LockChecking", reloads: 0, locked: [], batches: 1, transactions: 0 });
  });

  it.each([
    "conflictingHead", "duplicate", "reversedIndex", "stale", "wrongChain", "wrongReference", "wrongDeposit", "wrongPledge", "wrongMembership",
    "wrongSingletonChain", "nonAtomicSingleton", "notSentWithReceipt", "notSentWithMalformedReceipt", "malformedPledgeBlock",
  ] as const)("a lock batch with %s evidence stays pending", async (shape) => {
    expect(await batched(shape)).toMatchObject({ phase: "LockChecking", reloads: 0, batches: 1, transactions: 0 });
  });

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

  it("Solana lock review rebuilds prepared message and refuses mismatched transaction", async () => {
    const pair = async () => {
      const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
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
    const account: WalletAccount = { address: wallet.address, publicKey: wallet.raw, chains: ["solana:devnet"], features: ["solana:signAndSendTransaction", "solana:signMessage"] };
    const signed: Uint8Array[] = [];
    const solanaWallet = {
      version: "1.0.0",
      name: "Lock Solana",
      icon: "data:image/svg+xml,<svg/>",
      chains: ["solana:devnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: () => Promise.resolve({ accounts: [account] }) },
        "solana:signMessage": { version: "1.0.0", signMessage: async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: await wallet.sign(message) }] },
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
      const steps: string[] = [];
      const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const { step } = await new Request(input, init).json() as { readonly step: string };
        steps.push(step);
        const answer = step === "check"
          ? { status: "finalized" }
          : { plan: { wallet: wallet.address, periods, requested: periods, amountMinor: "2000000", decimals: 6, current: periods.map((period) => ({ period, amountMinor: "0", open: false })), transaction: { blockhash, lastValidBlockHeight: 100, transaction: base64Encode(wire), networkFeeLamports: "5000" } } };
        return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
      };
      const solana = { projectId: "slop", network: "solana-devnet", vault: project.address, terms: { program: program.address, project: project.address, owner: wallet.address, mint: null, tokenProgram: null } };
      const runtime = cardRuntime({ owner: wallet.address, evm: undefined, solana }, fetch);
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
      return { ...outcome, steps };
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

// spec/frontend/vaultLocks.md, "Story: Withdraw only funds the month's promise or locks leave free"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"; spec/frontend/ownerVault.md, "A withdrawal that would break the month's promise is refused on Slop's pages"; spec/frontend/projections.md, "Slop's pages refuse a withdrawal below the promised amount"; spec/settlement/monthPledges.md, "A withdrawal review refuses to take funds the open pledges hold"
describe("Withdrawal guards", () => {
  it("upgraded vault allows free withdrawal, refuses locked funds, skips promise guard", async () => {
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

  it("two vaults check per-vault free balance and skip guard when balance unread", async () => {
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

// spec/frontend/ownerVault.md, "Story: Check registration and transfers automatically without retiring the owner"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"
describe("Automatic registration and transfer checks", () => {
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

// spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/settlement/monthly.md, "The reviewed ASI closeout proposes its month from the cutoff with its fixed pool and no change"
describe("ASI November closeout", () => {
  it("November closeout stops other projects at October and freezes fixed allocations", async () => {
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
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname;
      const method = init?.method ?? "GET";
      const body = init?.body;
      const text = typeof body === "string" ? body : body instanceof Uint8Array ? new TextDecoder().decode(body) : "";
      asked.push([method, path, text === "" ? null : JSON.parse(text)]);
      const answer = path === `${monthPath}/finalize` ? { ...view, run } : view;
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
    };
    const runtime = ManagedRuntime.make(Layer.mergeAll(webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch)));
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

// spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"
describe("Monthly award navigation", () => {
  it("keeps Eliza October reachable in December", async () => {
    const december = Date.parse("2026-12-01T00:00:00.000Z");
    const octoberEntry = [{ cycleId: "2026-10", monthlyCapMinor: "0" }];
    const project: FundingProject = { ...lockProject, id: "eliza", slug: "eliza", reward: { ...lockProject.reward, cycleCaps: octoberEntry } };
    const route: Route = { kind: "Project", projectId: project.id, cycleId: "", login: "", owner: "", repo: "", number: "", caseId: "" };
    const runtime = pageRuntime(route);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const hostedClock = vi.spyOn(Date, "now").mockReturnValue(december);
    answering = (path) => path === "/api/v1/project-session"
      ? new Response(JSON.stringify({ session: null }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    cleanups.push(() => {
      hostedClock.mockRestore();
      answering = undefined;
      void act(() => root.unmount());
      void runtime.dispose();
    });
    await act(() => Promise.resolve(root.render(<OwnerAwards runtime={runtime} project={project} awardMonths={[]} networkPays={() => true} />)));
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Open");
    expect(open).toBeDefined();
    await act(() => Promise.resolve(open?.click()));
    const nav = container.querySelector('[aria-label="Contribution month"]');
    const previous = nav?.querySelector<HTMLButtonElement>('[aria-label="Previous award month"]');
    expect({ month: nav?.textContent?.trim(), disabled: previous?.disabled }).toEqual({ month: "November 2026", disabled: false });
    await act(() => Promise.resolve(previous?.click()));
    expect({ month: nav?.textContent?.trim(), disabled: previous?.disabled }).toEqual({ month: "October 2026", disabled: true });
    const decemberBounds = { first: "2026-11", last: "2026-11", start: "2026-11" };
    expect({
      eliza: monthBounds("eliza", [], december, octoberEntry),
      beforeClose: monthBounds("eliza", [], Date.parse("2026-10-31T23:59:59.999Z"), octoberEntry),
      withoutRecord: monthBounds("eliza", [], december),
      unrelatedProject: monthBounds("slopdotcash", [], december, octoberEntry),
      earlierPublicCycle: monthBounds("eliza", ["2026-09"], december, octoberEntry),
    }).toEqual({
      eliza: { ...decemberBounds, first: "2026-10" },
      beforeClose: { first: "2026-11", last: "2026-09", start: "2026-09" },
      withoutRecord: decemberBounds,
      unrelatedProject: decemberBounds,
      earlierPublicCycle: { ...decemberBounds, first: "2026-09" },
    });
  });
});

// spec/frontend/projections.md, "Story: Let anyone fund a project from its public page and see who funded"; spec/frontend/projections.md, "The public page offers only a deposit, after the no-refund disclosure"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/settlement/vaultDeposits.md, "The funders read lists the newest 50 deposits with the full count and names a depositor only by one public, open, wallet-signed registration"
describe("Public project funding", () => {
  const period = "2026-11";
  const deployment: FundingDeployment = { network: "base-mainnet", vault: nativeVault.vault, asset: nativeVault.asset, owner };
  const project: FundingProject = { id: "public-funding", slug: "public-funding", reward: { kind: "monthly-pool", monthlyCapMinor: "250000000" }, escrow: { chain: "base", deployments: [deployment] } };
  const offered = publicFunding(true, true, "NoSavedRequest");

  function publicPage() {
    const runtime = ManagedRuntime.make(vaultServices(project, deployment, period));
    cleanups.push(() => void runtime.dispose());
    return runtime;
  }

  const walletId = Effect.map(Effect.flatMap(WalletChoice, (choice) => choice.current()), (offers) => offers.find((offer) => offer.name === "Owner wallet")?.id ?? 0);
  const refusal = <A, E extends { readonly message: string }, R>(work: Effect.Effect<A, E, R>) => Effect.match(work, { onFailure: (error) => error.message, onSuccess: () => "sent" });

  it("a visitor's wallet and the owner's wallet are each offered only a deposit, and a withdrawal is refused before the wallet is asked", async () => {
    const visit = async (wallet: string, uuid: string) => {
      const chain = fakeChain({ atomic: false, send: "mine", wallet });
      const runtime = publicPage();
      return runtime.runPromise(Effect.gen(function* () {
        announce(uuid, chain.provider);
        const connection = yield* connectWallet(yield* walletId, true);
        const withdraw = yield* refusal(reviewAction(connection, "withdraw", "1", undefined, false, offered));
        return { offered, withdraw, held: savedRequestHeld(project, deployment, period), sends: chain.seen.filter((method) => method === "eth_sendTransaction").length };
      }));
    };
    const shown = { offered: "OfferDeposit", withdraw: fundingMessages.manageWithdrawals, held: false, sends: 0 };
    expect(await visit(otherAccount.address, "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b")).toEqual(shown);
    expect(await visit(account.address, "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d")).toEqual(shown);
  });

  it("a withdrawal saved on the manage page in the same tab reopens the public form, is checked and never sent again, and once it settles the form offers a deposit", async () => {
    const chain = fakeChain({ atomic: false, send: "unclear" });
    const keys = fundingKeys(project.id, deployment, period);
    const manage = started();
    await manage.runPromise(Effect.gen(function* () {
      announce("3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e", chain.provider);
      const evm = yield* connected;
      const page = yield* ownerVaultPage(sessionSlots(), { creation: keys.creation, transfer: keys.transfer }, true);
      yield* page.follow(actor);
      yield* page.review("Transfer", 1n, quietPool, unreadLocks, "");
      yield* Effect.ignore(page.submit("Transfer", (beforePrompt) => sendTransfer(evm, nativeVault, "withdraw", "send", "1", "finalized", beforePrompt)));
    }));
    const runtime = publicPage();
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce("3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e", chain.provider);
      const reopened = savedRequestHeld(project, deployment, period);
      yield* followVault(actor);
      const label = yield* savedAction();
      const checking = publicFunding(true, true, savedFundingOf(false, true, label));
      const connection = yield* connectWallet(yield* walletId, true);
      const deposit = yield* refusal(reviewAction(connection, "deposit", "1", undefined, false, checking));
      yield* confirmTransferUnsent();
      const settled = savedRequestHeld(project, deployment, period);
      return { reopened, label, checking, deposit, settled, after: publicFunding(true, true, savedFundingOf(false, settled, label)) };
    }));
    expect({ ...result, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length }).toEqual({
      reopened: true,
      label: "Withdrawal",
      checking: "CheckSavedRequest",
      deposit: fundingMessages.waiting,
      settled: false,
      after: "OfferDeposit",
      sends: 1,
    });
  });

  it("free funds of 253 USDC against 250 a month cover one month, less than 250 covers less than one, and a vault with no free balance on record shows nothing", () => {
    const now = periodContaining(nowSeconds());
    const normalize = (coverage: ReturnType<typeof publicCoverage>) => (coverage.tag === "Covers" ? { tag: coverage.tag, months: toAmount(fromAmount(coverage.months)) } : coverage);
    const covered = (freeBalance: string | null) => normalize(publicCoverage(lockProject, [{ ...usdcSnapshot, freeBalance }], () => true, now));
    expect([covered("253000000"), covered("249999999"), covered(null), normalize(publicCoverage(lockProject, [{ ...usdcSnapshot, freeBalance: "253000000" }], () => false, now))]).toEqual([
      { tag: "Covers", months: toAmount(1n) },
      { tag: "Covers", months: toAmount(0n) },
      { tag: "NoCoverage" },
      { tag: "NoCoverage" },
    ]);
  });

  it("a failed funders read offers Retry and never an empty list, a reply naming another project is refused, and only a reply naming this project lists its deposits", async () => {
    const row = { id: "d1", projectId: "slop", network: "base-mainnet", chain: "base", vault: usdcSnapshot.vault, depositor: otherAccount.address, githubLogin: null, amountBase: "253000000", assetAddress: usdcSnapshot.assetAddress, assetDecimals: 6, transactionId: hash("d"), depositedAt: "2026-11-20T12:00:00.000Z" };
    const replies = [
      new Response(JSON.stringify({ error: "unavailable", message: "Unavailable" }), { status: 503, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ projectId: "other", deposits: [{ ...row, projectId: "other" }], total: 1, servedAt: "2026-11-20T12:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ projectId: "slop", deposits: [row], total: 3, servedAt: "2026-11-20T12:00:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const asked: string[] = [];
    const fetch = (input: RequestInfo | URL) => {
      asked.push(new URL(input instanceof Request ? input.url : String(input), location.origin).pathname);
      return Promise.resolve(replies.shift() ?? new Response("{}", { status: 500 }));
    };
    const runtime = ManagedRuntime.make(Layer.provide(fundersServicesOf(), Layer.succeed(FetchHttpClient.Fetch, fetch)));
    cleanups.push(() => void runtime.dispose());
    const views = await runtime.runPromise(Effect.gen(function* () {
      const read = yield* ReadMachine;
      const shown: Array<readonly [string, number | undefined]> = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const value = yield* showFunders("slop");
        shown.push([fundersView(true, (yield* read.get()).status), value?.total]);
      }
      return shown;
    }));
    expect({ views, asked }).toEqual({
      views: [["FundersError", undefined], ["FundersError", undefined], ["FundersListed", 3]],
      asked: Array.from({ length: 3 }, () => "/api/v1/payments/projects/slop/deposits"),
    });
  });

  it("a paused project shows its funders and no deposit control", async () => {
    const { stale: _stale, ...snapshot } = usdcSnapshot;
    const servedAt = new Date().toISOString();
    const asked: string[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    answering = (path) => {
      asked.push(path);
      if (path === "/api/v1/project-session") return json({ session: null });
      if (path === `/api/v1/payments/projects/${lockProject.id}/vault`) return json({ projectId: lockProject.id, snapshots: [{ ...snapshot, freeBalance: "249999999", observedAt: servedAt }], staleAfterMs: 600_000, servedAt });
      if (path === `/api/v1/payments/projects/${lockProject.id}/deposits`) return json({ projectId: lockProject.id, deposits: [], total: 0, servedAt });
      return new Response(JSON.stringify({ error: "not_found", message: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    };
    cleanups.push(() => {
      answering = undefined;
    });
    const route: Route = { kind: "Project", projectId: lockProject.id, cycleId: "", login: "", owner: "", repo: "", number: "", caseId: "" };
    const runtime: PageRuntime = pageRuntime(route);
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    cleanups.push(() => {
      root.unmount();
      void runtime.dispose();
    });
    await act(() => Promise.resolve(root.render(<EscrowFunding runtime={runtime} project={lockProject} listing={{ active: false, networkPays: () => true }} />)));
    const funders = () => document.querySelector<HTMLElement>('[aria-label="Funded by"]')?.textContent ?? "";
    await expect.poll(funders).toContain(noFundersText);
    await expect.poll(() => document.body.textContent ?? "").toContain(lessThanOneMonthText);
    expect({
      fund: [...document.querySelectorAll("button")].filter((button) => (button.textContent ?? "").startsWith("Fund this project")).length,
      disclosure: (document.body.textContent ?? "").includes(noRefundDisclosure),
      form: document.querySelector('[aria-label^="Fund this project"]'),
      deposits: asked.filter((path) => path === `/api/v1/payments/projects/${lockProject.id}/deposits`).length > 0,
    }).toEqual({ fund: 0, disclosure: false, form: null, deposits: true });
  });

  // spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"
  it("a batched deposit and lock into a native-ETH vault sends the deposit with a value equal to its gross amount", async () => {
    const pledges: Pledges = new Map();
    const chain = fakeChain({ atomic: true, send: "mine", pledges, current });
    const runtime = cardRuntime({ owner, evm: nativeVault, solana: undefined });
    const gross = await runtime.runPromise(Effect.gen(function* () {
      announce("4c5d6e7f-8a9b-4cad-9e0f-3a4b5c6d7e8f", chain.provider);
      const connection = yield* evmCard;
      yield* readCard(rowOf(nativeVault, pledges, 10n * ether), 10n * ether, nowSeconds());
      yield* connectCard(connection);
      const review = yield* reviewCard(connection, 1, "2", "3", 1_000_000n);
      yield* sendCard(connection);
      return review.depositGross;
    }));
    const deposit = chain.mined.find((entry) => entry.input.startsWith(selector("deposit")));
    expect({ value: deposit?.value, batches: chain.seen.filter((method) => method === "wallet_sendCalls").length }).toEqual({ value: quantity(gross), batches: 1 });
  });
});

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly body: unknown;
}

function replying(replies: Array<{ readonly status?: number; readonly body: unknown }>) {
  const asked: Asked[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    asked.push({ method: request.method, path: url.pathname, query: url.search, body: text === "" ? undefined : JSON.parse(text) });
    const reply = replies.shift() ?? { status: 500, body: { error: "unexpected", message: "Unexpected" } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { asked, fetch: Layer.succeed(FetchHttpClient.Fetch, fetch) };
}

// spec/frontend/ownerMonthly.md, "Story: Sign the owner's monthly transactions from a saved attempt"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/settlement/reserveRelease.md, "Current authority and fresh complete wrong-total evidence permit approval"; spec/settlement/reserveRelease.md, "Finalized release returns the whole untouched reserve"
describe("Owner monthly transactions", () => {
  it("a held reserve says why and opens nothing, an approved one is reviewed, and its saved release clears only when the server finds it finalized", async () => {
    const vault = "0x5e1f0000000000000000000000000000000000aa";
    const ready = {
      status: "ready",
      family: "evm",
      request: { projectId: "slop", period: frozenMonth.period, network: "base-mainnet", manifestSha256: frozenMonth.manifestSha256 },
      vault,
      signatureHex: "11".repeat(65),
      transaction: { from: "0x0000000000000000000000000000000000000b0b", to: vault, data: "0x01", value: "0" },
      terms: { allocationDigest: hash("1"), allocationRoot: hash("2"), root: hash("3"), expectedRemaining: "0", releasedGross: "120000000" },
      planId: "b".repeat(64),
    };
    const { asked, fetch } = replying([{ body: frozenMonth }, { body: { status: "held", reason: "no-wrong-sum-fault" } }, { body: ready }, { body: { status: "pending" } }, { body: { status: "finalized" } }]);
    const runtime = ManagedRuntime.make(Layer.provide(awardsServices(lockProject, frozenMonth.period), fetch));
    cleanups.push(() => void runtime.dispose());
    const result = await runtime.runPromise(Effect.gen(function* () {
      const { monthly } = yield* AwardsDesk;
      yield* followAwards(actor, String(actor));
      const held = yield* reviewRelease();
      const approved = yield* reviewRelease();
      const plan = { kind: "evmRelease" as const, planId: ready.planId, call: { kind: "evmCall" as const, from: "0x0000000000000000000000000000000000000b0b", chainId: quantity(BigInt(chainId)), to: vault, data: "0x01", value: "0x0" } };
      yield* monthly.submit("Release", (beforePrompt) => Effect.as(beforePrompt(plan), hash("e")));
      const pending = yield* checkSavedRelease();
      const pendingPhase = (yield* monthly.machine.get()).release.phase;
      const kept = sessionStorage.length > 0;
      const finalized = yield* checkSavedRelease();
      return { held, approved: approved.kind, pending: [pending.status, pendingPhase, kept], finalized: [finalized.status, (yield* monthly.machine.get()).release.phase] };
    }));
    expect({ ...result, checks: asked.slice(3).map((entry) => entry.body) }).toEqual({
      held: { kind: "held", message: "Total correct. Nothing to release." },
      approved: "ready",
      pending: ["pending", "Sent", true],
      finalized: ["finalized", "Done"],
      checks: Array.from({ length: 2 }, () => ({ network: "base-mainnet", manifestSha256: frozenMonth.manifestSha256, planId: ready.planId, transactionId: hash("e") })),
    });
  });

  // spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
  it("a release the wallet sends while browser storage refuses to record its hash comes back with the hash marked not kept", async () => {
    const deployment = deploymentOf(frozenMonth.deployment);
    const period = parsePeriod(frozenMonth.period);
    if (deployment === undefined || period === undefined) throw new Error("the frozen month names its vault and period");
    const signatureHex = "11".repeat(65);
    const terms = { allocationDigest: hash("1"), allocationRoot: hash("2"), root: hash("3"), expectedRemaining: "0", releasedGross: "120000000" };
    const ready = {
      status: "ready",
      family: "evm",
      request: { projectId: "slop", period: frozenMonth.period, network: "base-mainnet", manifestSha256: frozenMonth.manifestSha256 },
      vault: deployment.vault,
      signatureHex,
      transaction: { from: owner, to: deployment.vault, data: releaseMonthlyReserveCalldata(period, { expectedRemaining: 0n, releasedGross: 120_000_000n }, `0x${signatureHex}`), value: "0" },
      terms,
      planId: "c".repeat(64),
    };
    const { asked, fetch } = replying([{ body: { ...frozenMonth, deployment: { ...deployment, owner } } }, { body: ready }, { body: ready }]);
    const chain = fakeChain({ atomic: false, send: "mine" });
    const runtime = ManagedRuntime.make(Layer.provide(awardsServices(lockProject, frozenMonth.period), fetch));
    cleanups.push(() => void runtime.dispose());
    const sent = await runtime.runPromise(Effect.gen(function* () {
      announce("6d7e8f9a-0b1c-4d2e-8f3a-5b6c7d8e9f0a", storageFailsOnSend(chain.provider));
      yield* followAwards(actor, String(actor));
      const reviewed = yield* reviewRelease();
      if (reviewed.kind !== "ready") throw new Error("the release was held");
      const connection = yield* connectReleaseOwner(yield* ownerWalletId);
      return yield* sendRelease(connection, reviewed.ready);
    }));
    expect({ ...sent, mined: chain.mined.map((entry) => [entry.to, entry.input]), requests: asked.length }).toEqual({
      hash: chain.mined[0]?.hash,
      kept: false,
      mined: [[deployment.vault, ready.transaction.data]],
      requests: 3,
    });
  });

  // spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
  it("pre-cutover reserve release and autopay resume as owner attempts and clear finalized", async () => {
    const deployment = deploymentOf(frozenMonth.deployment);
    if (deployment === undefined) throw new Error("the frozen month names its vault");
    const releaseKey = `slop:monthly-release:v1:${lockProject.id}:${frozenMonth.period}:${deployment.network}`;
    const planId = "d".repeat(64);
    sessionStorage.setItem(releaseKey, JSON.stringify({ attemptId: "0f8fad5b-d9cb-469f-a165-70867728950e", planId, hash: hash("e") }));
    const { asked, fetch } = replying([{ body: frozenMonth }, { body: { status: "finalized" } }]);
    const awards = ManagedRuntime.make(Layer.provide(awardsServices(lockProject, frozenMonth.period), fetch));
    cleanups.push(() => void awards.dispose());
    const release = await awards.runPromise(Effect.gen(function* () {
      const { monthly } = yield* AwardsDesk;
      yield* followAwards(actor, String(actor));
      const resumed = (yield* monthly.machine.get()).release;
      const checked = yield* checkSavedRelease();
      return { resumed: [resumed.phase, resumed.slotOwner, resumed.slot.hash], checked: [checked.status, (yield* monthly.machine.get()).release.phase], kept: sessionStorage.getItem(releaseKey) };
    }));

    const cap = 250_000_000n;
    const chain = fakeChain({ atomic: false, send: "mine" });
    const settingHash = chain.mineCall({ to: nativeVault.vault, data: setMonthlyCommitmentCalldata(cap, true) });
    chain.finalize();
    const vaultDeployment: FundingDeployment = { network: "base-mainnet", vault: nativeVault.vault, asset: nativeVault.asset, owner };
    const settingKey = `slop:vault-monthly:v1:${vaultDeployment.network}:${vaultDeployment.vault}`;
    sessionStorage.setItem(settingKey, JSON.stringify({ version: 1, attemptId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", wallet: account.address, cap: String(cap), enabled: true, decimals: 18, hash: settingHash, hashSource: "wallet" }));
    const vault = ManagedRuntime.make(vaultServices(lockProject, vaultDeployment, frozenMonth.period));
    cleanups.push(() => void vault.dispose());
    const setting = await vault.runPromise(Effect.gen(function* () {
      announce("8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b", chain.provider);
      const { monthly } = yield* VaultDesk;
      const resumed = (yield* monthly.follow(actor, String(actor), false)).setting;
      const connection = yield* connectWallet(yield* ownerWalletId, false);
      const checked = yield* checkSetting(connection);
      return { resumed: [resumed.phase, resumed.slotOwner, resumed.slot.hash], checked, phase: (yield* monthly.machine.get()).setting.phase, kept: sessionStorage.getItem(settingKey) };
    }));

    const rewardAsset = { network: "base", address: vaultDeployment.asset, decimals: 18 };
    expect({
      release,
      setting,
      checks: asked.slice(1).map((entry) => entry.body),
      prompts: chain.seen.filter((method) => method === "eth_sendTransaction" || method === "wallet_sendCalls").length,
      pinnedCaps: [
        vaultMonthlyCap({ kind: "monthly-pool", chain: "base", monthlyCapMinor: "250000000", cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "500000000" }, { cycleId: "2026-09", monthlyCapMinor: "900000000" }], asset: rewardAsset }, vaultDeployment, 18, Date.parse("2026-11-15T00:00:00Z")),
        vaultMonthlyCap({ kind: "monthly-pool", chain: "base", monthlyCapMinor: "0", cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "400000000" }], asset: rewardAsset }, vaultDeployment, 18, Date.parse("2026-12-03T23:59:59Z")),
        vaultMonthlyCap({ kind: "monthly-pool", chain: "base", monthlyCapMinor: "0", cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "400000000" }], asset: rewardAsset }, vaultDeployment, 18, Date.parse("2026-12-04T00:00:00Z")),
      ],
    }).toEqual({
      release: { resumed: ["Sent", actor, hash("e")], checked: ["finalized", "Done"], kept: null },
      setting: { resumed: ["Sent", actor, settingHash], checked: { status: "finalized", enabled: true, hash: settingHash }, phase: "Done", kept: null },
      checks: [{ network: deployment.network, manifestSha256: frozenMonth.manifestSha256, planId, transactionId: hash("e") }],
      prompts: 0,
      pinnedCaps: [{ kind: "cap", cap: 500_000_000n }, { kind: "cap", cap: 400_000_000n }, { kind: "cap", cap: 0n }],
    });
  });
});

// spec/frontend/ownerMonthly.md, "Story: Read the private bounty vault's funds under current authority"; spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"; spec/security/program.md, "Funding state comes only from a fresh finalized bounty-vault snapshot"
describe("Read the private bounty vault's funds under current authority", () => {
  it("a failed private read shows an error and no balance, and the next read shows the finalized snapshot's funds to the current owner", async () => {
    const funds = { currency: "USDC", decimals: 6, network: "base", freeMinor: "5000000", snapshotAt: "2026-11-20T12:00:00.000Z", availableMinor: "5000000", assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", deploymentNetwork: "base-mainnet" };
    const { asked, fetch } = replying([{ status: 503, body: { error: "unavailable", message: "Unavailable" } }, { body: { revision: 3, canSetup: true, networks: ["base-mainnet"], funds } }]);
    const runtime = ManagedRuntime.make(Layer.provide(bountyFundsServices("slop"), fetch));
    cleanups.push(() => void runtime.dispose());
    const reads = await runtime.runPromise(Effect.gen(function* () {
      const machine = yield* MonthlyMachine;
      const failed = yield* readBountyFunds(actor, String(actor));
      const failedState = (yield* machine.get()).funds;
      const ready = yield* readBountyFunds(actor, String(actor));
      return [[failed, failedState], [ready, (yield* machine.get()).funds]];
    }));
    expect({ reads, asked: asked.map((entry) => `${entry.path}${entry.query}`) }).toEqual({
      reads: [[undefined, "FundsError"], [{ canSetup: true, funds }, "FundsReady"]],
      asked: Array.from({ length: 2 }, () => "/api/v1/project-vaults/slop?purpose=security-bounty"),
    });
  });
});

// spec/frontend/ownerVault.md, "Story: Create and register the vault without asking the wallet twice"; spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"
describe("Vault setup review", () => {
  it("mismatched factory call refused, matching saved before wallet, registers finalized", async () => {
    const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const creation = creationOf({ owner, projectDigest: registryProjectDigest("slop"), asset: usdc, bounty: false, monthlyCap: 250_000_000n, automatic: true });
    if (creation === undefined) throw new Error("no creation");
    const review = { payoutPolicy: "ordinary", family: "evm", network: "base-mainnet", owner, asset: usdc, cap: "250000000", capDisplay: "250 USDC", automatic: true, chainId: "8453", existingVault: null, transaction: { from: owner, to: factory, data: createVaultCalldata(creation), value: "0x0" } };
    const { asked, fetch } = replying([
      { body: { review: { ...review, transaction: { ...review.transaction, data: "0x00" } } } },
      { body: { review } },
      { body: { status: "pending" } },
      { body: { status: "registered", deployment: {}, project: {}, revision: 2, notice: "Vault registered." } },
    ]);
    const terms = { projectId: "slop", purpose: "ordinary" as const, rewardAsset: undefined, rewardDecimals: undefined, monthlyCapMinor: "250000000", monthlyCapDisplay: "250 USDC" };
    const runtime = ManagedRuntime.make(Layer.provide(setupServices(terms), fetch));
    cleanups.push(() => void runtime.dispose());
    const options = { revision: 7, networks: ["base-mainnet"], claims: [{ chain: "base" as const, claimId: "c1", address: owner, authorized: true, firstAuthorizedAt: null }] };
    const result = await runtime.runPromise(Effect.gen(function* () {
      const { page, key } = yield* SetupDesk;
      yield* page.follow(actor);
      const refused = yield* Effect.match(reviewCreation(options, "base-mainnet", true, owner), { onFailure: (error) => error.message, onSuccess: () => "accepted" });
      const checked = yield* reviewCreation(options, "base-mainnet", true, owner);
      const plan = { kind: "vaultCreation" as const, network: "base-mainnet", claimId: "c1", automatic: true, payoutPolicy: "ordinary" as const, expectedRevision: 7, owner, asset: usdc, capDisplay: "250 USDC" };
      let savedBeforePrompt = false;
      yield* page.submit("Creation", (beforePrompt) => Effect.as(Effect.tap(beforePrompt(plan), () => Effect.sync(() => { savedBeforePrompt = sessionStorage.getItem(key) !== null; })), hash("c")));
      const pending = yield* checkRegistration();
      const registered = yield* checkRegistration();
      return { refused, existing: checked.review.existingVault, savedBeforePrompt, pending: [pending.registration?.kind, pending.state.creation.phase], registered: [registered.registration, registered.state.creation.phase, sessionStorage.getItem(key)] };
    }));
    expect({ ...result, register: asked.slice(2).map((entry) => entry.body) }).toEqual({
      refused: "Vault request mismatch. Reload and review again.",
      existing: null,
      savedBeforePrompt: true,
      pending: ["pending", "Sent"],
      registered: [{ kind: "registered", notice: "Vault registered.", revision: 2 }, "Done", null],
      register: Array.from({ length: 2 }, () => ({ step: "register", expectedRevision: 7, network: "base-mainnet", claimId: "c1", automatic: true, payoutPolicy: "ordinary", transactionId: hash("c") })),
    });
  });

  const usdc = tokenVault.asset;
  const setupTerms = (projectId: string) => ({ projectId, purpose: "ordinary" as const, rewardAsset: undefined, rewardDecimals: undefined, monthlyCapMinor: "250000000", monthlyCapDisplay: "250 USDC" });
  const developmentCreation = (transaction: string) => JSON.stringify({ version: 1, input: { network: "base-mainnet", claimId: "c1", automatic: true, expectedRevision: 7 }, review: { owner, asset: usdc, capDisplay: "250 USDC", payoutPolicy: "ordinary" }, hash: transaction });
  const registerBody = { step: "register", expectedRevision: 7, network: "base-mainnet", claimId: "c1", automatic: true, payoutPolicy: "ordinary", transactionId: hash("c") };

  // spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
  it("a creation request development saved before the cut-over resumes as the signed-in owner's pending creation and registers from its hash without asking the wallet", async () => {
    const terms = setupTerms("legacy-setup");
    const key = setupKey(terms.projectId, terms.purpose);
    sessionStorage.setItem(key, developmentCreation(hash("c")));
    const { asked, fetch } = replying([{ body: { status: "registered", deployment: {}, project: {}, revision: 2, notice: "Vault registered." } }]);
    const runtime = ManagedRuntime.make(Layer.provide(setupServices(terms), fetch));
    cleanups.push(() => void runtime.dispose());
    const result = await runtime.runPromise(Effect.gen(function* () {
      const { page } = yield* SetupDesk;
      const resumed = yield* page.follow(actor);
      const plan = yield* savedCreation();
      const registered = yield* checkRegistration();
      return { resumed: [resumed.creation.phase, resumed.creation.slotOwner, resumed.creation.slot.hash], plan: [plan?.network, plan?.owner, plan?.asset, plan?.expectedRevision], registered: [registered.registration, registered.state.creation.phase, sessionStorage.getItem(key)] };
    }));
    expect({ ...result, register: asked.map((entry) => entry.body) }).toEqual({
      resumed: ["Sent", actor, hash("c")],
      plan: ["base-mainnet", owner, usdc, 7],
      registered: [{ kind: "registered", notice: "Vault registered.", revision: 2 }, "Done", null],
      register: [registerBody],
    });
  });

  // spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
  it("a creation the wallet sends while browser storage refuses to record its hash is reported as sent but not kept in storage", async () => {
    const creation = creationOf({ owner, projectDigest: registryProjectDigest("kept-setup"), asset: usdc, bounty: false, monthlyCap: 250_000_000n, automatic: true });
    if (creation === undefined) throw new Error("no creation");
    const review = { payoutPolicy: "ordinary", family: "evm", network: "base-mainnet", owner, asset: usdc, cap: "250000000", capDisplay: "250 USDC", automatic: true, chainId: "8453", existingVault: null, transaction: { from: owner, to: factory, data: createVaultCalldata(creation), value: "0x0" } };
    const { fetch } = replying([{ body: { review } }, { body: { review } }]);
    const chain = fakeChain({ atomic: false, send: "mine" });
    const runtime = ManagedRuntime.make(Layer.provide(setupServices(setupTerms("kept-setup")), fetch));
    cleanups.push(() => void runtime.dispose());
    const options = { revision: 7, networks: ["base-mainnet"], claims: [{ chain: "base" as const, claimId: "c1", address: owner, authorized: true, firstAuthorizedAt: null }] };
    const sent = await runtime.runPromise(Effect.gen(function* () {
      announce("7e8f9a0b-1c2d-4e3f-9a4b-6c7d8e9f0a1b", storageFailsOnSend(chain.provider));
      const { page } = yield* SetupDesk;
      yield* page.follow(actor);
      const connection = yield* connectSetupWallet(yield* ownerWalletId, "base-mainnet");
      const shown = yield* reviewCreation(options, "base-mainnet", true, owner);
      return yield* createVault(connection, shown);
    }));
    expect({ ...sent, mined: chain.mined.map((entry) => [entry.to, entry.input]) }).toEqual({ hash: chain.mined[0]?.hash, kept: "storage", mined: [[factory, createVaultCalldata(creation)]] });
  });

  // spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"
  it("a pending creation whose registration answer names the included vault shows the provisional deposit form under it", async () => {
    const terms = setupTerms("provisional-setup");
    sessionStorage.setItem(setupKey(terms.projectId, terms.purpose), developmentCreation(hash("c")));
    const provisional = { network: "base-mainnet", vault: tokenVault.vault, owner, asset: usdc, deploymentTransaction: hash("c") };
    const asked: Array<readonly [string, string]> = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    answering = (path, method) => {
      asked.push([method, path]);
      if (path === `/api/v1/project-vaults/${terms.projectId}`) return json(method === "POST" ? { status: "pending", provisional } : { revision: 7, networks: ["base-mainnet"] });
      if (path === "/api/v1/payments/me") return json({ githubUserId: String(actor), wallets: [{ chain: "base", claimId: "c1", address: owner, authorized: true, firstAuthorizedAt: null }], payments: [], monthlyAwards: [], balances: [], directTransfers: [], walletObservations: [] });
      return new Response(JSON.stringify({ error: "not_found", message: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    };
    cleanups.push(() => {
      answering = undefined;
    });
    const project: FundingProject = { id: terms.projectId, slug: terms.projectId, reward: { kind: "monthly-pool", monthlyCapMinor: terms.monthlyCapMinor, monthlyCapDisplay: terms.monthlyCapDisplay }, escrow: { chain: "base", deployments: [] } };
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    cleanups.push(() => root.unmount());
    await act(() => Promise.resolve(root.render(<OwnerVaultSetup project={project} account={actor} githubId={String(actor)} loginHref="/login" onRegistered={() => undefined} />)));
    const form = () => document.querySelector<HTMLElement>('[aria-label^="Fund or withdraw ·"]');
    await expect.poll(() => form()?.textContent ?? "", { timeout: 20_000 }).toContain("Direct transfers are not credited");
    expect(asked.filter(([method]) => method === "POST")).toContainEqual(["POST", `/api/v1/project-vaults/${terms.projectId}`]);
  });
});
