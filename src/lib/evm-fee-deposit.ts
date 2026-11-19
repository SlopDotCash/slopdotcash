/**
 * Wallet side of one submission fee deposit (PRD section 5 and FEE-01). The
 * caller passes a way to pay that `readFeeItem` already checked against the
 * published address tables, and the pull request's item hash. Nothing here
 * takes an address or an amount from page input, and nothing here retries.
 *
 * The same wallet handling as vault funding: an exact approval then the
 * deposit, or one atomic request (EIP-5792) where the wallet already supports
 * it. A deposit is proved by the contract's own `Deposited` event in a
 * canonical block; the wallet's batch status only names the transaction.
 */

import {
  decodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
} from "viem";
import {
  assertVaultWalletAccount,
  atomicBatchSupported,
  BATCH_REFUSED,
  hexQuantity,
  settleWalletReceipt,
  VaultBatchUnavailable,
  type VaultConnection,
  type WalletReceipt,
  word,
} from "./evm-vault-actions";
import { networkLabel } from "./network-names";
import type { FeeWay } from "./submission-fee-page";

export type FeeDepositStep = "approve" | "reset" | "send";
export type FeeDepositRequest = { way: FeeWay; item: string };

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const depositsAbi = parseAbi([
  "function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)",
  "function depositsPaused() view returns (bool)",
]);
const DEPOSITED = toEventSelector(
  "Deposited(uint256,bytes32,address,address,uint128,address)",
);
const HASH = /^0x[0-9a-fA-F]{64}$/u;

const chainOf = (way: FeeWay) => ({
  chainId: BigInt(way.chainId),
  network: way.network,
});
const addressWord = (address: string) =>
  `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

function evmRequest(wallet: VaultConnection) {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  return request;
}

function approveCall(way: FeeWay, value: bigint) {
  return {
    to: way.token,
    data: encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [way.contract as `0x${string}`, value],
    }),
    value: "0x0" as const,
  };
}

/** The one deposit call: exactly the published contract, token, amount, item and kept-to address. */
export function feeDepositCall({ way, item }: FeeDepositRequest) {
  return {
    to: way.contract,
    data: encodeFunctionData({
      abi: depositsAbi,
      functionName: "deposit",
      args: [
        item as `0x${string}`,
        way.token as `0x${string}`,
        BigInt(way.amount),
        way.keptTo as `0x${string}`,
      ],
    }),
    value: "0x0" as const,
  };
}

/**
 * Asks the wallet to move to the fee's network when it is on another one. A
 * wallet that does not know the network is told its name and chain id; this
 * page never supplies an RPC address.
 */
export async function switchFeeChain(way: FeeWay, wallet: VaultConnection) {
  const request = evmRequest(wallet);
  const chainId = BigInt(way.chainId);
  const current = await request("eth_chainId", []);
  if (
    typeof current === "string" &&
    /^0x[0-9a-fA-F]+$/u.test(current) &&
    BigInt(current) === chainId
  )
    return;
  try {
    await request("wallet_switchEthereumChain", [
      { chainId: hexQuantity(chainId) },
    ]);
  } catch (caught) {
    if ((caught as { code?: unknown } | null)?.code === 4001)
      throw new Error(
        `Switch your wallet to ${networkLabel(way.network)} to pay this way.`,
      );
    throw new Error(
      `Your wallet could not switch to ${networkLabel(way.network)} (chain id ${way.chainId}). Add that network in your wallet, then review again.`,
    );
  }
}

/**
 * Reads what the deposit needs from the wallet's own chain: the contract is
 * there and accepts deposits, the wallet holds the amount, and whether an
 * approval is still needed. Signs nothing.
 */
export async function reviewFeeDeposit(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
) {
  const { way } = deposit;
  const request = evmRequest(wallet);
  await assertVaultWalletAccount(wallet, chainOf(way));
  const call = (to: string, data: string) =>
    request("eth_call", [{ to, data }, "latest"]);
  if ((await request("eth_getCode", [way.contract, "latest"])) === "0x")
    throw new Error(
      `The deposit contract is not on the network your wallet is connected to. Check that it is ${networkLabel(way.network)}.`,
    );
  if (
    word(
      await call(
        way.contract,
        encodeFunctionData({
          abi: depositsAbi,
          functionName: "depositsPaused",
        }),
      ),
    ) !== 0n
  )
    throw new Error(
      "New deposits are paused on the deposit contract. Nothing was sent. Try again later.",
    );
  const amount = BigInt(way.amount);
  const balance = word(
    await call(
      way.token,
      encodeFunctionData({
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [wallet.address as `0x${string}`],
      }),
    ),
  );
  if (balance < amount)
    throw new Error(
      `Your ${way.symbol} balance on ${networkLabel(way.network)} is too low for this deposit.`,
    );
  const allowance = word(
    await call(
      way.token,
      encodeFunctionData({
        abi: tokenAbi,
        functionName: "allowance",
        args: [wallet.address as `0x${string}`, way.contract as `0x${string}`],
      }),
    ),
  );
  const approvalNeeded = allowance < amount;
  return {
    approvalNeeded,
    resetAllowance: approvalNeeded && allowance > 0n,
    /** One wallet request can carry the approval and the deposit. */
    batch:
      approvalNeeded &&
      (await atomicBatchSupported(wallet, chainOf(way).chainId)),
  };
}
export type FeeDepositReview = Awaited<ReturnType<typeof reviewFeeDeposit>>;

function stepCall(deposit: FeeDepositRequest, step: FeeDepositStep) {
  return step === "send"
    ? feeDepositCall(deposit)
    : approveCall(
        deposit.way,
        step === "reset" ? 0n : BigInt(deposit.way.amount),
      );
}

/** The caller shows the exact action and obtains the wallet confirmation. No retries. */
export async function sendFeeDeposit(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
  step: FeeDepositStep,
  beforeSend: () => void,
) {
  const review = await reviewFeeDeposit(deposit, wallet);
  const request = evmRequest(wallet);
  if (step === "send" && review.approvalNeeded)
    throw new Error("Approve the exact token amount before depositing.");
  if (step !== "send" && !review.approvalNeeded)
    throw new Error("The token approval is already in place. Review again.");
  const transaction = { from: wallet.address, ...stepCall(deposit, step) };
  await request("eth_estimateGas", [transaction]);
  await assertVaultWalletAccount(wallet, chainOf(deposit.way));
  beforeSend();
  const hash = await request("eth_sendTransaction", [transaction]);
  if (typeof hash !== "string" || !HASH.test(hash))
    throw new Error(
      "The wallet did not return a transaction hash. Check wallet activity before another attempt.",
    );
  return hash;
}

/**
 * Sends the exact approval and the deposit as one atomic wallet request
 * (EIP-5792). Returns the wallet's batch reference, which is not a
 * transaction hash.
 */
export async function sendFeeBatch(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
  beforeSend: () => void,
) {
  const review = await reviewFeeDeposit(deposit, wallet);
  const request = evmRequest(wallet);
  if (!review.batch)
    throw new VaultBatchUnavailable(
      "Your wallet cannot send this as one request. Approve, then deposit.",
    );
  const { way } = deposit;
  const calls = [
    ...(review.resetAllowance ? [approveCall(way, 0n)] : []),
    approveCall(way, BigInt(way.amount)),
    feeDepositCall(deposit),
  ];
  // The deposit cannot be estimated before its approval exists; the wallet
  // simulates the batch. The first call must at least be executable.
  await request("eth_estimateGas", [{ from: wallet.address, ...calls[0] }]);
  await assertVaultWalletAccount(wallet, chainOf(way));
  beforeSend();
  let result: unknown;
  try {
    result = await request("wallet_sendCalls", [
      {
        version: "2.0.0",
        from: wallet.address,
        chainId: hexQuantity(BigInt(way.chainId)),
        atomicRequired: true,
        calls,
      },
    ]);
  } catch (caught) {
    if (BATCH_REFUSED.has(Number((caught as { code?: unknown } | null)?.code)))
      throw new VaultBatchUnavailable(
        "Your wallet could not send this as one request. Nothing was sent. Approve, then deposit.",
      );
    throw caught;
  }
  const id =
    typeof result === "string" ? result : (result as { id?: unknown })?.id;
  if (typeof id !== "string" || id.length < 1 || id.length > 4096)
    throw new Error(
      "The wallet did not return a batch reference. Check wallet activity before another attempt.",
    );
  return id;
}

/** This wallet's deposits for this item in a receipt, whatever they carry. */
function depositEvents(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
  receipt: WalletReceipt,
) {
  return receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === deposit.way.contract.toLowerCase() &&
      log.topics[0]?.toLowerCase() === DEPOSITED &&
      log.topics[2]?.toLowerCase() === deposit.item.toLowerCase() &&
      log.topics[3]?.toLowerCase() === addressWord(wallet.address),
  );
}

/** The one event must carry the reviewed token, amount and kept-to address. */
function assertReviewedDeposit(
  deposit: FeeDepositRequest,
  events: WalletReceipt["logs"],
) {
  const mismatch = new Error("This transaction does not match the request.");
  if (events.length !== 1 || typeof events[0].data !== "string") throw mismatch;
  let token: string;
  let amount: bigint;
  let keptTo: string;
  try {
    [token, amount, keptTo] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint128" }, { type: "address" }],
      events[0].data as `0x${string}`,
    );
  } catch {
    throw mismatch;
  }
  if (
    token.toLowerCase() !== deposit.way.token.toLowerCase() ||
    amount !== BigInt(deposit.way.amount) ||
    keptTo.toLowerCase() !== deposit.way.keptTo.toLowerCase()
  )
    throw mismatch;
}

export type FeeDepositStatus =
  | "pending"
  | "not-sent"
  | "received"
  | "failed"
  | "approval-confirmed"
  | "finalized";

/**
 * Checks one transaction this wallet sent for the request. An approval moves
 * no funds, so canonical inclusion is enough for it. A deposit is "received"
 * once its event is in a canonical block and "finalized" once that block is
 * final; only then is the request finished.
 */
export async function checkFeeDeposit(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
  transactionId: string,
  step: FeeDepositStep,
): Promise<FeeDepositStatus> {
  const request = evmRequest(wallet);
  await assertVaultWalletAccount(wallet, chainOf(deposit.way));
  if (!HASH.test(transactionId))
    throw new Error("Enter a transaction hash from your wallet.");
  const receipt = (await request("eth_getTransactionReceipt", [
    transactionId,
  ])) as WalletReceipt | null;
  if (!receipt) return "pending";
  const transaction = (await request("eth_getTransactionByHash", [
    transactionId,
  ])) as {
    from: string;
    to: string | null;
    input: string;
    value: string;
  } | null;
  const expected = stepCall(deposit, step);
  if (
    !transaction ||
    transaction.from.toLowerCase() !== wallet.address.toLowerCase() ||
    transaction.to?.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
    BigInt(transaction.value) !== 0n
  )
    throw new Error(
      "This transaction does not match the pending wallet action. Check its hash in your wallet.",
    );
  const settled = await settleWalletReceipt(
    request,
    receipt,
    transactionId,
    step === "send" ? "finalized" : "included",
  );
  if (settled === "pending" || settled === "failed") return settled;
  if (step !== "send") return "approval-confirmed";
  const events = depositEvents(deposit, wallet, receipt);
  if (settled === "included")
    return events.length === 1 ? "received" : "pending";
  assertReviewedDeposit(deposit, events);
  return "finalized";
}

/**
 * Checks a batched deposit. The wallet's status is untrusted and only names
 * the transaction to read; the transaction is sent by the wallet's account
 * logic, so its target and input are not compared. The contract's event
 * names the payer, the item, the token, the amount and the kept-to address.
 */
export async function checkFeeBatch(
  deposit: FeeDepositRequest,
  wallet: VaultConnection,
  batchId: string | null,
  transactionId: string | null,
): Promise<{ status: FeeDepositStatus; transactionId: string | null }> {
  const request = evmRequest(wallet);
  await assertVaultWalletAccount(wallet, chainOf(deposit.way));
  let hash = transactionId;
  if (hash === null) {
    if (batchId === null)
      throw new Error("Enter the transaction from your wallet.");
    const reported = (await request("wallet_getCallsStatus", [batchId])) as {
      status?: unknown;
      receipts?: { transactionHash?: unknown }[];
    } | null;
    const code = reported?.status;
    if (typeof code !== "number" || !Number.isInteger(code))
      throw new Error(
        "The wallet returned an unrecognized batch status. Enter its transaction hash from wallet activity.",
      );
    if (code >= 100 && code < 200) return { status: "pending", transactionId };
    // The wallet reports that the batch was not included and will not be retried.
    if (code >= 400 && code < 500) return { status: "not-sent", transactionId };
    if (code !== 200 && code !== 500)
      throw new Error(
        "The wallet reports a partly completed batch. Check wallet activity and enter its transaction hash.",
      );
    const last = reported?.receipts?.at(-1)?.transactionHash;
    if (typeof last !== "string" || !HASH.test(last))
      throw new Error(
        "The wallet did not return the batch transaction. Enter its hash from wallet activity.",
      );
    hash = last;
  }
  if (!HASH.test(hash))
    throw new Error("Enter a transaction hash from your wallet.");
  const receipt = (await request("eth_getTransactionReceipt", [
    hash,
  ])) as WalletReceipt | null;
  if (!receipt) return { status: "pending", transactionId: hash };
  const settled = await settleWalletReceipt(
    request,
    receipt,
    hash,
    "finalized",
  );
  if (settled === "pending" || settled === "failed")
    return { status: settled, transactionId: hash };
  const events = depositEvents(deposit, wallet, receipt);
  if (settled === "included")
    return {
      status: events.length === 1 ? "received" : "pending",
      transactionId: hash,
    };
  assertReviewedDeposit(deposit, events);
  return { status: "finalized", transactionId: hash };
}
