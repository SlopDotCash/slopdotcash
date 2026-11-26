// The wallet side of a fee deposit (src/lib/evm-fee-deposit.ts), against a
// scripted wallet and chain. It lives here so the unit shards run it.
import { expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
} from "viem";
import {
  checkFeeBatch,
  checkFeeDeposit,
  feeDepositCall,
  reviewFeeDeposit,
  sendFeeBatch,
  sendFeeDeposit,
  switchFeeChain,
} from "../../src/lib/evm-fee-deposit";
import {
  VaultBatchUnavailable,
  type VaultConnection,
} from "../../src/lib/evm-vault-actions";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import type { FeeWay } from "../../src/lib/submission-fee-page";

const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)",
  "function depositsPaused() view returns (bool)",
]);
const DEPOSITED = toEventSelector(
  "Deposited(uint256,bytes32,address,address,uint128,address)",
);
const PAYER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const ITEM = submissionFeeItem(4242, 7);
const TRANSACTION = `0x${"a".repeat(64)}`;
const BLOCK = `0x${"b".repeat(64)}`;
const usdc: FeeWay = {
  network: "base-mainnet",
  chainId: 8453,
  contract: SUBMISSION_FEE_CONTRACTS["base-mainnet"] as string,
  token: SUBMISSION_FEE_TOKENS["base-mainnet"].usdc as string,
  symbol: "USDC",
  decimals: 6,
  amount: "2000000",
  minimumAccepted: "2000000",
  keptTo: SUBMISSION_FEE_KEPT_TO["base-mainnet"],
  kind: "stable",
};
const slop: FeeWay = {
  network: "robinhood-mainnet",
  chainId: 4663,
  contract: SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"] as string,
  token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop as string,
  symbol: "SLOP",
  decimals: 18,
  amount: "75000000000000000000",
  minimumAccepted: "75000000000000000000",
  keptTo: SUBMISSION_FEE_BURN,
  kind: "slop",
};
const uintWord = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const addressWord = (value: string) =>
  `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;

type Log = {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
};
function depositedLog(
  way: FeeWay,
  change: Partial<{
    item: string;
    payer: string;
    token: string;
    amount: bigint;
    keptTo: string;
    address: string;
  }> = {},
): Log {
  return {
    address: change.address ?? way.contract,
    topics: [
      DEPOSITED,
      uintWord(1n),
      change.item ?? ITEM,
      addressWord(change.payer ?? PAYER),
    ],
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint128" }, { type: "address" }],
      [
        (change.token ?? way.token) as `0x${string}`,
        change.amount ?? BigInt(way.amount),
        (change.keptTo ?? way.keptTo) as `0x${string}`,
      ],
    ),
    logIndex: "0x0",
  };
}

/** A wallet whose chain state the test sets; every request is recorded. */
function wallet(way: FeeWay, start: Partial<ReturnType<typeof state>> = {}) {
  const chain = { ...state(way), ...start };
  const requests: { method: string; params: unknown[] }[] = [];
  const connection = {
    address: PAYER,
    sign: async () => "",
    evmRequest: async (method: string, params: unknown[]) => {
      requests.push({ method, params });
      if (method === "eth_accounts") return [chain.account];
      if (method === "eth_chainId") return `0x${chain.chainId.toString(16)}`;
      if (method === "wallet_switchEthereumChain") {
        if (chain.switchError) throw chain.switchError;
        chain.chainId = Number.parseInt(
          (params[0] as { chainId: string }).chainId,
          16,
        );
        return null;
      }
      if (method === "eth_getCode") return chain.code;
      if (method === "eth_call") {
        const { data } = params[0] as { data: `0x${string}` };
        const call = decodeFunctionData({ abi, data });
        if (call.functionName === "depositsPaused")
          return uintWord(chain.paused ? 1n : 0n);
        if (call.functionName === "balanceOf") return uintWord(chain.balance);
        if (call.functionName === "allowance") return uintWord(chain.allowance);
      }
      if (method === "wallet_getCapabilities") return chain.capabilities;
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return TRANSACTION;
      if (method === "wallet_sendCalls") {
        if (chain.batchError) throw chain.batchError;
        return { id: "batch-1" };
      }
      if (method === "wallet_getCallsStatus") return chain.callsStatus;
      if (method === "eth_getTransactionReceipt") return chain.receipt;
      if (method === "eth_getTransactionByHash") return chain.transaction;
      if (method === "eth_getBlockByNumber")
        return params[0] === "finalized"
          ? { number: `0x${chain.finalized.toString(16)}` }
          : { hash: chain.blockHash };
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as VaultConnection;
  return { chain, requests, connection };
}
function state(way: FeeWay) {
  return {
    account: PAYER,
    chainId: way.chainId,
    code: "0x6000",
    paused: false,
    balance: BigInt(way.amount),
    allowance: 0n,
    capabilities: {} as unknown,
    switchError: null as unknown,
    batchError: null as unknown,
    callsStatus: null as unknown,
    receipt: null as unknown,
    transaction: null as unknown,
    finalized: 100,
    blockHash: BLOCK,
  };
}
const receipt = (logs: Log[], blockNumber = 90, status = "0x1") => ({
  status,
  transactionHash: TRANSACTION,
  blockNumber: `0x${blockNumber.toString(16)}`,
  blockHash: BLOCK,
  logs,
});
function approveData(way: FeeWay) {
  return encodeFunctionData({
    abi,
    functionName: "approve",
    args: [way.contract as `0x${string}`, BigInt(way.amount)],
  });
}
/** The transaction as the chain reports it for the reviewed step. */
function sent(way: FeeWay, step: "approve" | "send" = "send") {
  const call =
    step === "send"
      ? feeDepositCall({ way, item: ITEM })
      : { to: way.token, data: approveData(way) };
  return { from: PAYER, to: call.to, input: call.data, value: "0x0" };
}

test("the deposit call carries exactly the published contract, item, token, amount and kept-to address", () => {
  for (const way of [usdc, slop]) {
    const call = feeDepositCall({ way, item: ITEM });
    expect(call.to).toBe(way.contract);
    expect(call.value).toBe("0x0");
    const decoded = decodeFunctionData({ abi, data: call.data });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args).toEqual([
      ITEM,
      way.token as `0x${string}`,
      BigInt(way.amount),
      way.keptTo as `0x${string}`,
    ]);
  }
});

test("the wallet is asked to move to the fee's network, and a refusal names the network", async () => {
  const onBase = wallet(slop, { chainId: 8453 });
  await switchFeeChain(slop, onBase.connection);
  expect(onBase.chain.chainId).toBe(4663);
  const already = wallet(usdc);
  await switchFeeChain(usdc, already.connection);
  expect(
    already.requests.some(
      (request) => request.method === "wallet_switchEthereumChain",
    ),
  ).toBe(false);
  const unknown = wallet(slop, {
    chainId: 1,
    switchError: Object.assign(new Error("Unrecognized chain"), { code: 4902 }),
  });
  await expect(switchFeeChain(slop, unknown.connection)).rejects.toThrow(
    "Robinhood Chain (chain id 4663)",
  );
});

test("a review reads the wallet's own chain and signs nothing", async () => {
  const deposit = { way: usdc, item: ITEM };
  const fresh = wallet(usdc);
  expect(await reviewFeeDeposit(deposit, fresh.connection)).toEqual({
    approvalNeeded: true,
    resetAllowance: false,
    batch: false,
  });
  expect(
    fresh.requests.some((request) =>
      ["eth_sendTransaction", "wallet_sendCalls"].includes(request.method),
    ),
  ).toBe(false);
  expect(
    await reviewFeeDeposit(
      deposit,
      wallet(usdc, { allowance: 2_000_000n }).connection,
    ),
  ).toMatchObject({ approvalNeeded: false, batch: false });
  expect(
    await reviewFeeDeposit(
      deposit,
      wallet(usdc, {
        allowance: 5n,
        capabilities: { "0x2105": { atomic: { status: "supported" } } },
      }).connection,
    ),
  ).toEqual({ approvalNeeded: true, resetAllowance: true, batch: true });
  // A wallet that would first upgrade the account is not asked to batch.
  expect(
    await reviewFeeDeposit(
      deposit,
      wallet(usdc, {
        capabilities: { "0x2105": { atomic: { status: "ready" } } },
      }).connection,
    ),
  ).toMatchObject({ batch: false });
  await expect(
    reviewFeeDeposit(deposit, wallet(usdc, { balance: 1_999_999n }).connection),
  ).rejects.toThrow("USDC balance on Base is too low");
  await expect(
    reviewFeeDeposit(deposit, wallet(usdc, { paused: true }).connection),
  ).rejects.toThrow("paused");
  await expect(
    reviewFeeDeposit(deposit, wallet(usdc, { code: "0x" }).connection),
  ).rejects.toThrow("not on the network");
  await expect(
    reviewFeeDeposit(deposit, wallet(usdc, { chainId: 1 }).connection),
  ).rejects.toThrow("Switch your wallet to Base");
  await expect(
    reviewFeeDeposit(deposit, wallet(usdc, { account: OTHER }).connection),
  ).rejects.toThrow("account changed");
});

test("a deposit is not sent before its approval, and each request is the reviewed call", async () => {
  const deposit = { way: usdc, item: ITEM };
  const unapproved = wallet(usdc);
  let prompted = 0;
  await expect(
    sendFeeDeposit(deposit, unapproved.connection, "send", () => prompted++),
  ).rejects.toThrow("Approve the exact token amount");
  expect(prompted).toBe(0);
  expect(
    await sendFeeDeposit(
      deposit,
      unapproved.connection,
      "approve",
      () => prompted++,
    ),
  ).toBe(TRANSACTION);
  expect(prompted).toBe(1);
  expect(unapproved.requests.at(-1)).toEqual({
    method: "eth_sendTransaction",
    params: [
      { from: PAYER, to: usdc.token, data: approveData(usdc), value: "0x0" },
    ],
  });
  const approved = wallet(usdc, { allowance: 2_000_000n });
  await sendFeeDeposit(deposit, approved.connection, "send", () => {});
  expect(approved.requests.at(-1)?.params).toEqual([
    { from: PAYER, ...feeDepositCall(deposit) },
  ]);
  await expect(
    sendFeeDeposit(deposit, approved.connection, "approve", () => {}),
  ).rejects.toThrow("already in place");
});

test("one atomic request carries the approval and the deposit, and a refusal sends nothing", async () => {
  const deposit = { way: slop, item: ITEM };
  const supported = { "0x1237": { atomic: { status: "supported" } } };
  const batching = wallet(slop, { capabilities: supported });
  expect(await sendFeeBatch(deposit, batching.connection, () => {})).toBe(
    "batch-1",
  );
  const request = batching.requests.at(-1);
  expect(request?.method).toBe("wallet_sendCalls");
  const body = request?.params[0] as {
    chainId: string;
    atomicRequired: boolean;
    calls: { to: string; data: string; value: string }[];
  };
  expect(body.chainId).toBe("0x1237");
  expect(body.atomicRequired).toBe(true);
  expect(body.calls).toEqual([
    { to: slop.token, data: approveData(slop), value: "0x0" },
    feeDepositCall(deposit),
  ]);
  await expect(
    sendFeeBatch(deposit, wallet(slop).connection, () => {}),
  ).rejects.toBeInstanceOf(VaultBatchUnavailable);
  await expect(
    sendFeeBatch(
      deposit,
      wallet(slop, {
        capabilities: supported,
        batchError: Object.assign(new Error("unsupported"), { code: 5700 }),
      }).connection,
      () => {},
    ),
  ).rejects.toBeInstanceOf(VaultBatchUnavailable);
});

test("an approval counts once it is in a canonical block; a deposit is received there and finished only when final", async () => {
  const deposit = { way: usdc, item: ITEM };
  const check = (
    start: Parameters<typeof wallet>[1],
    step: "approve" | "send" = "send",
  ) =>
    checkFeeDeposit(deposit, wallet(usdc, start).connection, TRANSACTION, step);
  expect(await check({})).toBe("pending");
  expect(
    await check(
      { receipt: receipt([], 150), transaction: sent(usdc, "approve") },
      "approve",
    ),
  ).toBe("approval-confirmed");
  const included = {
    receipt: receipt([depositedLog(usdc)], 150),
    transaction: sent(usdc),
  };
  expect(await check(included)).toBe("received");
  // The block that carried it was replaced.
  expect(await check({ ...included, blockHash: `0x${"c".repeat(64)}` })).toBe(
    "pending",
  );
  expect(
    await check({
      receipt: receipt([depositedLog(usdc)]),
      transaction: sent(usdc),
    }),
  ).toBe("finalized");
  expect(
    await check({ receipt: receipt([], 90, "0x0"), transaction: sent(usdc) }),
  ).toBe("failed");
});

test("a transaction or event that is not the reviewed deposit is never accepted", async () => {
  const deposit = { way: usdc, item: ITEM };
  const refused = (
    start: Parameters<typeof wallet>[1],
    message = "does not match",
  ) =>
    expect(
      checkFeeDeposit(
        deposit,
        wallet(usdc, start).connection,
        TRANSACTION,
        "send",
      ),
    ).rejects.toThrow(message);
  // Another target, other calldata or another sender.
  await refused({
    receipt: receipt([depositedLog(usdc)]),
    transaction: { ...sent(usdc), to: OTHER },
  });
  await refused({
    receipt: receipt([depositedLog(usdc)]),
    transaction: {
      ...sent(usdc),
      input: feeDepositCall({ way: slop, item: ITEM }).data,
    },
  });
  await refused({
    receipt: receipt([depositedLog(usdc)]),
    transaction: { ...sent(usdc), from: OTHER },
  });
  // A final receipt whose event names another amount, token, destination, item, payer or contract.
  for (const change of [
    { amount: 1n },
    { token: OTHER },
    { keptTo: OTHER },
    { item: submissionFeeItem(4242, 8) },
    { payer: OTHER },
    { address: OTHER },
  ])
    await refused({
      receipt: receipt([depositedLog(usdc, change)]),
      transaction: sent(usdc),
    });
  await refused({
    receipt: receipt([depositedLog(usdc), depositedLog(usdc)]),
    transaction: sent(usdc),
  });
  // Before finality the same events are simply not reported as received.
  expect(
    await checkFeeDeposit(
      deposit,
      wallet(usdc, {
        receipt: receipt([depositedLog(usdc, { payer: OTHER })], 150),
        transaction: sent(usdc),
      }).connection,
      TRANSACTION,
      "send",
    ),
  ).toBe("pending");
});

test("a batch is proved by the contract's event, never by the wallet's status", async () => {
  const deposit = { way: slop, item: ITEM };
  const check = (
    start: Parameters<typeof wallet>[1],
    hash: string | null = null,
  ) => checkFeeBatch(deposit, wallet(slop, start).connection, "batch-1", hash);
  expect(await check({ callsStatus: { status: 100 } })).toEqual({
    status: "pending",
    transactionId: null,
  });
  expect(await check({ callsStatus: { status: 400 } })).toEqual({
    status: "not-sent",
    transactionId: null,
  });
  const named = {
    status: 200,
    receipts: [{ transactionHash: TRANSACTION }],
  };
  // The wallet says confirmed; the chain has no receipt yet.
  expect(await check({ callsStatus: named })).toEqual({
    status: "pending",
    transactionId: TRANSACTION,
  });
  expect(
    await check({
      callsStatus: named,
      receipt: receipt([depositedLog(slop)], 150),
    }),
  ).toEqual({ status: "received", transactionId: TRANSACTION });
  expect(
    await check({ callsStatus: named, receipt: receipt([depositedLog(slop)]) }),
  ).toEqual({ status: "finalized", transactionId: TRANSACTION });
  // A confirmed status with a final receipt that carries no matching deposit.
  await expect(
    check({
      callsStatus: named,
      receipt: receipt([depositedLog(slop, { keptTo: OTHER })]),
    }),
  ).rejects.toThrow("does not match");
  await expect(
    check({ callsStatus: named, receipt: receipt([]) }),
  ).rejects.toThrow("does not match");
  await expect(check({ callsStatus: { status: 600 } })).rejects.toThrow(
    "partly completed",
  );
  // An entered hash is read without asking the wallet for its status.
  expect(
    await check({ receipt: receipt([depositedLog(slop)]) }, TRANSACTION),
  ).toEqual({ status: "finalized", transactionId: TRANSACTION });
});
