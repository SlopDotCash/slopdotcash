import { encodeFunctionData, parseAbi } from "viem";
import {
  buildDepositCalldata,
  buildWithdrawCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  EVM_NATIVE_ASSET,
  type EvmEscrowConfig,
  readVaultTotals,
  verifyEvmDeployment,
  verifyVaultFundingAction,
} from "../../contracts/evm/adapter";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import { networkLabel } from "./network-names";
import { ordinaryFee, type PayoutPolicy } from "./payments/contracts";
import { parseVaultAmount } from "./payments/vault-amount";
import type { PayoutWallet } from "./use-payout-wallets";

export type VaultConnection = Awaited<ReturnType<PayoutWallet["connect"]>>;
export type VaultOperation = "deposit" | "withdraw";
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
/**
 * EIP-5792 and provider codes a wallet returns when it refuses a batch before
 * sending anything: unsupported method, capability, chain, size or atomicity.
 */
const BATCH_REFUSED = new Set([4200, -32601, 5700, 5710, 5740, 5750, 5760]);
/** The wallet cannot send the approval and deposit as one request; nothing was sent. */
export class VaultBatchUnavailable extends Error {}
const hexQuantity = (value: bigint) => `0x${value.toString(16)}`;
const approveCall = (deployment: EscrowDeployment, value: bigint) => ({
  to: deployment.asset,
  data: encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [deployment.vault as `0x${string}`, value],
  }),
  value: "0x0",
});
/**
 * True only when the wallet already executes batches atomically on this chain.
 * A wallet that would first have to upgrade the account ("ready") is not asked to.
 */
async function atomicBatchSupported(
  wallet: VaultConnection,
  chainId: bigint,
): Promise<boolean> {
  const request = wallet.evmRequest;
  if (!request) return false;
  try {
    const capabilities = await request("wallet_getCapabilities", [
      wallet.address,
      [hexQuantity(chainId)],
    ]);
    if (!capabilities || typeof capabilities !== "object") return false;
    return Object.entries(capabilities).some(
      ([chain, value]) =>
        /^0x[0-9a-fA-F]+$/.test(chain) &&
        BigInt(chain) === chainId &&
        (value as { atomic?: { status?: unknown } } | null)?.atomic?.status ===
          "supported",
    );
  } catch {
    return false;
  }
}
const word = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("The wallet returned an invalid token amount.");
  return BigInt(value);
};

export function walletVaultConfig(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  payoutPolicy: PayoutPolicy = "ordinary",
): EvmEscrowConfig & Pick<EscrowDeployment, "network"> {
  const network = ESCROW_NETWORKS[deployment.network];
  if (
    network.family !== "evm" ||
    !network.chainId ||
    !wallet.evmRequest ||
    !deployment.factory ||
    !deployment.factoryCodeSha256 ||
    !deployment.registrar
  )
    throw new Error("This wallet cannot use the selected vault.");
  return {
    ...deployment,
    payoutPolicy,
    factory: deployment.factory,
    factoryCodeSha256: deployment.factoryCodeSha256,
    registrar: deployment.registrar,
    chainId: BigInt(network.chainId),
    request: wallet.evmRequest,
  };
}
export async function assertVaultWalletAccount(
  wallet: VaultConnection,
  config: EvmEscrowConfig & Pick<EscrowDeployment, "network">,
) {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const accounts = await request("eth_accounts", []);
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== wallet.address.toLowerCase()
  )
    throw new Error("The wallet account changed. Connect and review again.");
  const chain = await request("eth_chainId", []);
  if (
    typeof chain !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(chain) ||
    BigInt(chain) !== config.chainId
  )
    throw new Error(
      `Switch your wallet to ${networkLabel(config.network)}, then review again.`,
    );
}

export async function reviewVaultAction(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  operation: VaultOperation,
  amount: string,
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  const config = walletVaultConfig(deployment, wallet, payoutPolicy);
  await assertVaultWalletAccount(wallet, config);
  await verifyEvmDeployment(config);
  const totals = await readVaultTotals({
    ...config,
    network: deployment.network,
  });
  const gross = parseVaultAmount(amount, totals.decimals);
  if (totals.asset.toLowerCase() !== deployment.asset.toLowerCase())
    throw new Error("The vault asset changed. Reload the project.");
  const native = deployment.asset.toLowerCase() === EVM_NATIVE_ASSET;
  let allowance = 0n;
  if (operation === "withdraw") {
    if (wallet.address.toLowerCase() !== deployment.owner.toLowerCase())
      throw new Error("Only the vault owner's wallet can withdraw free funds.");
    if (totals.freeBalance === null || gross > BigInt(totals.freeBalance))
      throw new Error(
        "The amount exceeds the vault's free balance. Reserved awards cannot be withdrawn.",
      );
  } else {
    const request = wallet.evmRequest;
    if (!request) throw new Error("Choose an EVM wallet.");
    if (native) {
      const balance = await request("eth_getBalance", [
        wallet.address,
        "latest",
      ]);
      if (
        typeof balance !== "string" ||
        !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(balance)
      )
        throw new Error("The wallet returned an invalid ETH balance.");
      if (BigInt(balance) < gross)
        throw new Error("Your ETH balance is too low for this deposit.");
    } else {
      const call = (data: string) =>
        request("eth_call", [{ to: deployment.asset, data }, "latest"]);
      const balance = word(
        await call(
          encodeFunctionData({
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [wallet.address as `0x${string}`],
          }),
        ),
      );
      if (balance < gross)
        throw new Error("Your token balance is too low for this deposit.");
      allowance = word(
        await call(
          encodeFunctionData({
            abi: tokenAbi,
            functionName: "allowance",
            args: [
              wallet.address as `0x${string}`,
              deployment.vault as `0x${string}`,
            ],
          }),
        ),
      );
    }
  }
  const fee = operation === "withdraw" ? ordinaryFee(gross) : 0n;
  const approvalNeeded =
    operation === "deposit" && !native && allowance < gross;
  return {
    gross: gross.toString(),
    fee: fee.toString(),
    net: (gross - fee).toString(),
    decimals: totals.decimals,
    freeBalance: totals.freeBalance,
    approvalNeeded,
    resetAllowance: approvalNeeded && allowance > 0n,
    /** One wallet request can carry the approval and the deposit. */
    batch:
      approvalNeeded && (await atomicBatchSupported(wallet, config.chainId)),
  };
}
export type VaultActionReview = Awaited<ReturnType<typeof reviewVaultAction>>;

/** The caller shows the exact action and obtains the user's wallet confirmation. No retries. */
export async function sendVaultAction(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  operation: VaultOperation,
  amount: string,
  step: "approve" | "reset" | "send",
  beforeSend: () => void,
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  const review = await reviewVaultAction(
    deployment,
    wallet,
    operation,
    amount,
    payoutPolicy,
  );
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const native = deployment.asset.toLowerCase() === EVM_NATIVE_ASSET;
  if (step === "send" && review.approvalNeeded)
    throw new Error("Approve the exact token amount before depositing.");
  if (step !== "send" && operation !== "deposit")
    throw new Error("Withdrawals do not require token approval.");
  if (step !== "send" && native)
    throw new Error("Native ETH deposits do not require token approval.");
  const data =
    step === "send"
      ? (operation === "deposit"
          ? buildDepositCalldata
          : buildWithdrawCalldata)(review.gross)
      : encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [
            deployment.vault as `0x${string}`,
            step === "reset" ? 0n : BigInt(review.gross),
          ],
        });
  const transaction = {
    from: wallet.address,
    to: step === "send" ? deployment.vault : deployment.asset,
    data,
    value:
      native && operation === "deposit"
        ? `0x${BigInt(review.gross).toString(16)}`
        : "0x0",
  };
  await request("eth_estimateGas", [transaction]);
  await assertVaultWalletAccount(
    wallet,
    walletVaultConfig(deployment, wallet, payoutPolicy),
  );
  beforeSend();
  const hash = await request("eth_sendTransaction", [transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error(
      "The wallet did not return a transaction hash. Check wallet activity before another attempt.",
    );
  return hash;
}

/**
 * Sends the exact approval and the deposit as one atomic wallet request
 * (EIP-5792). The caller shows the action and obtains the confirmation. No retries.
 * Returns the wallet's batch identifier, which is not a transaction hash.
 */
export async function sendVaultBatch(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  amount: string,
  beforeSend: () => void,
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  const review = await reviewVaultAction(
    deployment,
    wallet,
    "deposit",
    amount,
    payoutPolicy,
  );
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  if (!review.batch)
    throw new VaultBatchUnavailable(
      "Your wallet cannot send this as one request. Approve, then deposit.",
    );
  const config = walletVaultConfig(deployment, wallet, payoutPolicy);
  const calls = [
    ...(review.resetAllowance ? [approveCall(deployment, 0n)] : []),
    approveCall(deployment, BigInt(review.gross)),
    {
      to: deployment.vault,
      data: buildDepositCalldata(review.gross),
      value: "0x0",
    },
  ];
  // The deposit cannot be estimated before its approval exists; the wallet
  // simulates the batch. The first call must at least be executable.
  await request("eth_estimateGas", [{ from: wallet.address, ...calls[0] }]);
  await assertVaultWalletAccount(wallet, config);
  beforeSend();
  let result: unknown;
  try {
    result = await request("wallet_sendCalls", [
      {
        version: "2.0.0",
        from: wallet.address,
        chainId: hexQuantity(config.chainId),
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

/**
 * A batched deposit is proved by its finalized vault event, never by the
 * wallet's own status. The status only supplies the transaction to read. The
 * transaction is sent by the wallet's account logic, so its target and input
 * are not compared; the event names the depositor and the exact amount.
 */
export async function checkVaultBatch(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  gross: string,
  batchId: string | null,
  transactionId: string | null,
  payoutPolicy: PayoutPolicy = "ordinary",
): Promise<{
  status: "pending" | "not-sent" | "failed" | "finalized";
  transactionId: string | null;
}> {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const config = walletVaultConfig(deployment, wallet, payoutPolicy);
  await assertVaultWalletAccount(wallet, config);
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
    if (typeof last !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(last))
      throw new Error(
        "The wallet did not return the batch transaction. Enter its hash from wallet activity.",
      );
    hash = last;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
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
  if (settled !== "finalized") return { status: settled, transactionId: hash };
  const events = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === deployment.vault.toLowerCase() &&
      log.topics[0]?.toLowerCase() === EVM_ESCROW_EVENT_TOPICS.Deposited,
  );
  if (events.length !== 1)
    throw new Error("This transaction does not match the request.");
  await verifyVaultFundingAction(
    config,
    hash,
    Number(BigInt(events[0].logIndex)),
    { operation: "deposit", address: wallet.address, gross },
  );
  return { status: "finalized", transactionId: hash };
}

/** A receipt alone is insufficient: require canonical finality and the exact reviewed vault event. */
export async function checkVaultAction(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  operation: VaultOperation,
  gross: string,
  transactionId: string,
  step: "approve" | "reset" | "send",
  payoutPolicy: PayoutPolicy = "ordinary",
) {
  const config = walletVaultConfig(deployment, wallet, payoutPolicy);
  const native = deployment.asset.toLowerCase() === EVM_NATIVE_ASSET;
  if (step !== "send" && native)
    throw new Error("Native ETH deposits do not require token approval.");
  const expectedInput =
    step === "send"
      ? (operation === "deposit"
          ? buildDepositCalldata
          : buildWithdrawCalldata)(gross)
      : encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [
            deployment.vault as `0x${string}`,
            step === "reset" ? 0n : BigInt(gross),
          ],
        });
  const checked = await readFinalizedWalletTransaction(
    deployment,
    wallet,
    transactionId,
    step === "send" ? deployment.vault : deployment.asset,
    expectedInput,
    native && operation === "deposit" ? BigInt(gross) : 0n,
    // An approval moves no funds and never counts as funding, so it needs only
    // canonical inclusion. The next review reads the live allowance again, and
    // a reorganized approval makes the deposit fail before the wallet prompt.
    step === "send" ? "finalized" : "included",
  );
  if (checked.status !== "finalized") return checked.status;
  const receipt = checked.receipt;
  if (step !== "send") return "approval-confirmed";
  const topic =
    EVM_ESCROW_EVENT_TOPICS[
      operation === "deposit" ? "Deposited" : "UnusedWithdrawn"
    ];
  const events = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === deployment.vault.toLowerCase() &&
      log.topics[0]?.toLowerCase() === topic,
  );
  if (events.length !== 1)
    throw new Error("This transaction does not match the request.");
  await verifyVaultFundingAction(
    config,
    transactionId,
    Number(BigInt(events[0].logIndex)),
    {
      operation,
      address: operation === "withdraw" ? deployment.owner : wallet.address,
      gross,
    },
  );
  return "finalized";
}

/**
 * Verify exact wallet intent and canonical finality before inspecting its domain event.
 * `evidence: "included"` accepts a canonical block that is not finalized yet. Only a
 * token approval may use it; every transfer of funds keeps the finalized default.
 */
export async function readFinalizedWalletTransaction(
  deployment: EscrowDeployment,
  wallet: VaultConnection,
  transactionId: string,
  target: string,
  expectedInput: string,
  expectedValue = 0n,
  evidence: "finalized" | "included" = "finalized",
) {
  const request = wallet.evmRequest;
  if (!request) throw new Error("Choose an EVM wallet.");
  const config = walletVaultConfig(deployment, wallet);
  await assertVaultWalletAccount(wallet, config);
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionId))
    throw new Error("Enter a transaction hash from your wallet.");
  const receipt = (await request("eth_getTransactionReceipt", [
    transactionId,
  ])) as WalletReceipt | null;
  if (!receipt) return { status: "pending" as const, receipt: null };
  const transaction = (await request("eth_getTransactionByHash", [
    transactionId,
  ])) as {
    from: string;
    to: string;
    input: string;
    value: string;
  } | null;
  if (
    !transaction ||
    transaction.from.toLowerCase() !== wallet.address.toLowerCase() ||
    transaction.to?.toLowerCase() !== target.toLowerCase() ||
    transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
    BigInt(transaction.value) !== expectedValue
  )
    throw new Error(
      "This transaction does not match the pending wallet action. Check its hash in your wallet.",
    );
  const settled = await settleWalletReceipt(
    request,
    receipt,
    transactionId,
    evidence,
  );
  if (settled === "pending")
    return { status: "pending" as const, receipt: null };
  if (settled === "failed") return { status: "failed" as const, receipt };
  return { status: "finalized" as const, receipt };
}

type WalletReceipt = {
  status: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logs: { address: string; topics: string[]; logIndex: string }[];
};
/** Canonical block, required evidence level and execution status of one receipt. */
async function settleWalletReceipt(
  request: NonNullable<VaultConnection["evmRequest"]>,
  receipt: WalletReceipt,
  transactionId: string,
  evidence: "finalized" | "included",
): Promise<"pending" | "failed" | "finalized"> {
  if (evidence === "finalized") {
    const finalized = (await request("eth_getBlockByNumber", [
      "finalized",
      false,
    ])) as { number: string };
    if (BigInt(receipt.blockNumber) > BigInt(finalized.number))
      return "pending";
  }
  const block = (await request("eth_getBlockByNumber", [
    receipt.blockNumber,
    false,
  ])) as { hash: string } | null;
  if (
    block?.hash !== receipt.blockHash ||
    receipt.transactionHash.toLowerCase() !== transactionId.toLowerCase()
  ) {
    // A block that is not final can still be replaced; ask again later.
    if (evidence === "included") return "pending";
    throw new Error("The transaction is not in the canonical finalized chain.");
  }
  if (receipt.status === "0x0") return "failed";
  if (receipt.status !== "0x1")
    throw new Error("The transaction status is not recognized.");
  return "finalized";
}
