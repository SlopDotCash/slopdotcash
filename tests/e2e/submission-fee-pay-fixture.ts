/**
 * Shared pieces of the pay page specs: the fee record the read route serves,
 * the test seam that switches the page on in the fixture build, and a wallet
 * whose every request the test sees.
 */
import type { Page } from "@playwright/test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
} from "viem";
import {
  type SubmissionFeeTerms,
  submissionFeeItem,
  submissionFeeOptions,
} from "../../src/lib/submission-fee.mjs";

export const FEE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)",
  "function depositsPaused() view returns (bool)",
]);
export const DEPOSITED = toEventSelector(
  "Deposited(uint256,bytes32,address,address,uint128,address)",
);
/** One SLOP rate in force, so the route offers SLOP: 2.00 at half price is 75 SLOP. */
const RATES = [{ effectiveAt: "2026-11-01T00:00:00.000Z", slopPerUsd: "75" }];

export type FeeRecord = ReturnType<typeof feeRecord>;

/** The body `GET /api/v1/submission-fee/items/<id>/<number>` serves for an unpaid pull request. */
export function feeRecord(
  repositoryId: number,
  pullNumber: number,
  terms: SubmissionFeeTerms = {},
) {
  return {
    schema: "slop-submission-fee-item-v1",
    repositoryId,
    pullNumber,
    projectId: "eliza",
    item: submissionFeeItem(repositoryId, pullNumber) as string,
    stableMinor: "2000000",
    askedAt: "2026-12-01T10:00:00.000Z",
    due: submissionFeeOptions(
      "2000000",
      RATES,
      "2026-12-05T12:00:00.000Z",
      terms,
    ),
    paid: null as null | {
      at: string;
      network: string;
      depositId: number;
      token: string;
      amount: string;
      transaction: string;
      finalized: boolean;
    },
    outcome: null as string | null,
    outcomeAt: null as string | null,
    resolveTransaction: null as string | null,
  };
}

/** The body `GET /api/v1/submission-fee/rate` serves while that one rate is in force. */
export const FEE_RATE_REPLY = {
  schema: "slop-submission-fee-rate-v1",
  slopShareBps: 5000,
  rate: RATES[0],
  previous: null,
};

/**
 * Serves one pull request's fee record and the published SLOP rate; both
 * `current` and `rate` are read on every request. A null rate reply answers
 * 503, as an unreachable rate route would.
 */
export async function serveFeeRecord(
  page: Page,
  repositoryId: number,
  pullNumber: number,
  current: () => FeeRecord | null,
  rate: () => unknown = () => FEE_RATE_REPLY,
) {
  let reads = 0;
  await page.route("**/api/v1/submission-fee/rate", (route) => {
    const reply = rate();
    return reply === null
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.fulfill({ json: reply });
  });
  await page.route(
    `**/api/v1/submission-fee/items/${repositoryId}/${pullNumber}`,
    (route) => {
      reads += 1;
      const record = current();
      return record
        ? route.fulfill({ json: record })
        : route.fulfill({ status: 404, json: { error: "not_found" } });
    },
  );
  return () => reads;
}

/**
 * Switches the pay page on in the browser-test build and, for a private
 * chain, replaces the published address tables. No deployed bundle reads it.
 */
export async function switchFeeOn(page: Page, tables?: SubmissionFeeTerms) {
  await page.addInitScript(
    (fixture) => {
      (
        window as unknown as { __SLOP_FEE_FIXTURE__: unknown }
      ).__SLOP_FEE_FIXTURE__ = fixture;
    },
    { switchedOn: true, tables },
  );
}

/** The same seam, switched off: what a bundle built with the switch off shows. */
export async function switchFeeOff(page: Page) {
  await page.addInitScript(() => {
    (
      window as unknown as { __SLOP_FEE_FIXTURE__: unknown }
    ).__SLOP_FEE_FIXTURE__ = { switchedOn: false };
  });
}

/**
 * Installs `window.ethereum` and answers each request in the test process.
 * A returned `{ walletError: code }` is thrown in the page with that code.
 */
export async function installWallet(
  page: Page,
  answer: (method: string, params: unknown[]) => Promise<unknown> | unknown,
) {
  await page.exposeFunction("feeWalletRequest", answer);
  await page.addInitScript(() => {
    Object.assign(window, {
      ethereum: {
        isMetaMask: true,
        request: async ({
          method,
          params = [],
        }: {
          method: string;
          params?: unknown[];
        }) => {
          const value = await (
            window as unknown as {
              feeWalletRequest: (
                method: string,
                params: unknown[],
              ) => Promise<unknown>;
            }
          ).feeWalletRequest(method, params);
          const code = (value as { walletError?: number } | null)?.walletError;
          if (typeof code === "number")
            throw Object.assign(new Error("Wallet refused"), { code });
          return value;
        },
      },
    });
  });
}

const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const addressWord = (value: string) =>
  `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
const blockHash = (number: number) =>
  `0x${number.toString(16).padStart(64, "b")}`;

type Way = FeeRecord["due"][number];

/**
 * A wallet on a chain the test advances by hand. It records every signing
 * request, so a test can compare what the page asked the wallet to sign with
 * the published contract, token, amount, item and kept-to address.
 */
export function scriptedWallet(account: string) {
  const state = {
    chainId: 1,
    balance: 10n ** 30n,
    allowance: 0n,
    atomic: false,
    /** The next signing request answers with this wallet error code, once. */
    refuseNext: null as number | null,
    finalized: 100,
    head: 100,
    switches: [] as string[],
    sends: [] as { to: string; data: string; value: string; from: string }[],
    batches: [] as {
      chainId: string;
      atomicRequired: boolean;
      calls: { to: string; data: string; value: string }[];
    }[],
    transactions: new Map<
      string,
      { from: string; to: string; input: string; value: string }
    >(),
    receipts: new Map<string, unknown>(),
    batchStatus: { status: 100 } as unknown,
  };
  let count = 0;
  const nextHash = () => {
    count += 1;
    return `0x${count.toString(16).padStart(64, "a")}`;
  };
  /** Puts a submitted transaction in the next block, not final yet. */
  const mine = (
    hash: string,
    deposited?: { way: Way; item: string; payer?: string },
  ) => {
    state.head += 1;
    state.receipts.set(hash, {
      status: "0x1",
      transactionHash: hash,
      blockNumber: `0x${state.head.toString(16)}`,
      blockHash: blockHash(state.head),
      logs: deposited
        ? [
            {
              address: deposited.way.contract,
              topics: [
                DEPOSITED,
                word(1n),
                deposited.item,
                addressWord(deposited.payer ?? account),
              ],
              data: encodeAbiParameters(
                [{ type: "address" }, { type: "uint128" }, { type: "address" }],
                [
                  deposited.way.token as `0x${string}`,
                  BigInt(deposited.way.amount),
                  deposited.way.keptTo as `0x${string}`,
                ],
              ),
              logIndex: "0x0",
            },
          ]
        : [],
    });
  };
  const answer = (method: string, params: unknown[]): unknown => {
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return [account];
    if (method === "eth_chainId") return `0x${state.chainId.toString(16)}`;
    if (method === "wallet_switchEthereumChain") {
      const { chainId } = params[0] as { chainId: string };
      state.switches.push(chainId);
      state.chainId = Number.parseInt(chainId, 16);
      return null;
    }
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_call") {
      const call = decodeFunctionData({
        abi: FEE_ABI,
        data: (params[0] as { data: `0x${string}` }).data,
      });
      if (call.functionName === "depositsPaused") return word(0n);
      if (call.functionName === "balanceOf") return word(state.balance);
      if (call.functionName === "allowance") return word(state.allowance);
    }
    if (method === "wallet_getCapabilities")
      return state.atomic
        ? {
            [`0x${state.chainId.toString(16)}`]: {
              atomic: { status: "supported" },
            },
          }
        : {};
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction" || method === "wallet_sendCalls") {
      if (state.refuseNext !== null) {
        const walletError = state.refuseNext;
        state.refuseNext = null;
        return { walletError };
      }
      if (method === "wallet_sendCalls") {
        state.batches.push(params[0] as (typeof state.batches)[number]);
        return { id: "fixture-batch" };
      }
      const transaction = params[0] as (typeof state.sends)[number];
      state.sends.push(transaction);
      const hash = nextHash();
      state.transactions.set(hash, {
        from: transaction.from,
        to: transaction.to,
        input: transaction.data,
        value: transaction.value,
      });
      return hash;
    }
    if (method === "wallet_getCallsStatus") return state.batchStatus;
    if (method === "eth_getTransactionReceipt")
      return state.receipts.get(params[0] as string) ?? null;
    if (method === "eth_getTransactionByHash")
      return state.transactions.get(params[0] as string) ?? null;
    if (method === "eth_getBlockByNumber")
      return params[0] === "finalized"
        ? { number: `0x${state.finalized.toString(16)}` }
        : { hash: blockHash(Number.parseInt(params[0] as string, 16)) };
    throw new Error(`The scripted wallet has no answer for ${method}`);
  };
  return { state, answer, mine, nextHash };
}

/** The calldata the page must send for one way to pay. */
export function expectedCalls(way: Way, item: string) {
  return {
    approve: {
      to: way.token,
      data: encodeFunctionData({
        abi: FEE_ABI,
        functionName: "approve",
        args: [way.contract as `0x${string}`, BigInt(way.amount)],
      }),
      value: "0x0",
    },
    deposit: {
      to: way.contract as string,
      data: encodeFunctionData({
        abi: FEE_ABI,
        functionName: "deposit",
        args: [
          item as `0x${string}`,
          way.token as `0x${string}`,
          BigInt(way.amount),
          way.keptTo as `0x${string}`,
        ],
      }),
      value: "0x0",
    },
  };
}
