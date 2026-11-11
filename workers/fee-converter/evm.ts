/**
 * EVM fee-wallet client for Base, Ethereum and Robinhood Chain. Routes come
 * from the KyberSwap Aggregator API. Every built swap is decoded and checked
 * before signing: the pinned router, the exact input token and amount, the
 * network's Circle USDC as output, the fee wallet as receiver, no extra fee
 * receivers, and a signed minimum no lower than the recorded quote minimum.
 */

import {
  type Address,
  BaseError,
  type Chain,
  createPublicClient,
  decodeFunctionData,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  FeeCapTooLowError,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseEventLogs,
  parseTransaction,
  RpcRequestError,
  recoverTransactionAddress,
  serializeTransaction,
  TransactionNotFoundError,
  type TransactionReceipt,
  TransactionReceiptNotFoundError,
  type TransactionSerializableEIP1559,
  type TransactionSerializedEIP1559,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type EvmEscrowConfig,
  type EvmUpgrade,
  isCanonicalEvmReceipt,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import { evmReceiptNativeCost } from "../../contracts/evm/native-cost";
import { isNativeAssetAddress } from "../../src/lib/escrow-policy.mjs";
import { nextReplacementFees } from "../verified-fee-replacement";
import type {
  BridgeQuote,
  BridgeTerms,
  BurnQuote,
  BuybackChainClient,
  BuyQuote,
  FillState,
  OutcomeEvidence,
  PreparedBridge,
} from "./buyback";
import { bridgeTerms } from "./buyback";
import {
  BURN_ADDRESS,
  BUYBACK_NETWORK,
  type BuybackLimits,
  DLN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_USDG,
  SLOP_TOKEN,
} from "./buyback-config";
import type { Limits, NetworkConfig } from "./config";
import type {
  ChainClient,
  ConversionRow,
  FeeVault,
  PreparedSend,
  Quote,
  QuoteResult,
  ReplacementResult,
  SendReplacement,
  SendStatus,
} from "./core";
import {
  checkedDlnOrder,
  DLN_DESTINATION_ABI,
  DLN_SOURCE_ABI,
  type DlnProposal,
  GIVE_STATUS,
  proposeDlnOrder,
  TAKE_STATUS,
} from "./debridge";
import type { NativeGasJournal, RecordedNativeSend } from "./native-gas";
import {
  minimumOutput,
  priceImpactCeiling,
  roundedDivision,
  spendableNative,
} from "./verified-arithmetic";
import { bridgeFeeWithin } from "./verified-buyback";

const KYBER_API = "https://aggregator-api.kyberswap.com";
/** KyberSwap's address for the chain's native currency, used to price gas. */
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/** The permissionless ProjectEscrow fee claim (contracts/evm/adapter.ts). */
const VAULT_FEE_ABI = [
  {
    type: "event",
    name: "FeesClaimed",
    inputs: [
      { name: "feeRecipient", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
  {
    type: "function",
    name: "accruedFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "identityAuthority",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "pendingIdentityAuthority",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "pendingUpgradeAuthority",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "claimFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
const CLAIM_FEES = encodeFunctionData({
  abi: VAULT_FEE_ABI,
  functionName: "claimFees",
});
const DEADLINE_SECONDS = 20 * 60;
const RECEIPT_WAIT_MS = 60_000;
/**
 * Same-nonce fee replacement policy (owner decision of 25 October 2026),
 * shared with the payment keeper in `workers/verified-fee-replacement.ts`.
 * Each step raises both fee fields by 25%, never above three times the
 * original send's fields. Every step must raise both fields by at least 10%,
 * the minimum that nodes accept for an EIP-1559 replacement; a step that
 * cannot is the cap.
 */
const REPLACEMENT_CAP_MULTIPLE = 3n;
/**
 * A swap replacement reuses the signed calldata and so its router deadline.
 * Within this margin of the deadline, a replacement would revert, so the
 * send waits instead.
 */
const REPLACEMENT_DEADLINE_MARGIN_SECONDS = 120;

/** Refuses a nonce that an open journaled send already holds. */
function assertNonceFree(nonce: number, nonceFloor: number) {
  if (nonce < nonceFloor)
    throw new Error(
      `fee-wallet nonce ${nonce} is held by an open journaled send; next free nonce is ${nonceFloor}`,
    );
}

const DESCRIPTION = {
  type: "tuple",
  name: "desc",
  components: [
    { type: "address", name: "srcToken" },
    { type: "address", name: "dstToken" },
    { type: "address[]", name: "srcReceivers" },
    { type: "uint256[]", name: "srcAmounts" },
    { type: "address[]", name: "feeReceivers" },
    { type: "uint256[]", name: "feeAmounts" },
    { type: "address", name: "dstReceiver" },
    { type: "uint256", name: "amount" },
    { type: "uint256", name: "minReturnAmount" },
    { type: "uint256", name: "flags" },
    { type: "bytes", name: "permit" },
  ],
} as const;
const OUTPUTS = [
  { type: "uint256", name: "returnAmount" },
  { type: "uint256", name: "gasUsed" },
] as const;
/** KyberSwap MetaAggregationRouterV2 entry points. */
export const KYBER_ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "execution",
        components: [
          { type: "address", name: "callTarget" },
          { type: "address", name: "approveTarget" },
          { type: "bytes", name: "targetData" },
          DESCRIPTION,
          { type: "bytes", name: "clientData" },
        ],
      },
    ],
    outputs: OUTPUTS,
  },
  {
    type: "function",
    name: "swapSimpleMode",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "caller" },
      DESCRIPTION,
      { type: "bytes", name: "executorData" },
      { type: "bytes", name: "clientData" },
    ],
    outputs: OUTPUTS,
  },
] as const;

type Fetch = typeof fetch;

interface EvmClientOptions {
  config: NetworkConfig;
  limits: Limits;
  kyberClientId: string;
  /** Absent in dry_run: the client can quote but cannot sign. */
  privateKey?: string;
  fetch?: Fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  nativeGas?: NativeGasJournal;
  /**
   * SLOP buyback (PRD section 6). Absent leaves this client exactly as
   * before: no bridge, purchase or burn method exists and Robinhood Chain
   * neither quotes nor signs.
   */
  buyback?: {
    limits: BuybackLimits;
    /** The Robinhood Chain fee wallet every bridge order delivers to. */
    receiver: string;
  };
}

/** Conservative gas for one DLN order, used only to price its cost. */
const DLN_ORDER_GAS = 700_000n;
interface BridgeCost {
  token: string;
  amount: bigint;
  takeAmount: bigint;
  nativeFee: bigint;
  /** An approval also leaves room for the following order's native ceiling. */
  approval: boolean;
}
const PAUSED_ABI = [
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * Parses a non-negative decimal dollar string into integer micro-units.
 * The default rounds up so a cap is never undercounted, as on Solana;
 * "down" truncates instead, for a value a measured difference is taken
 * against, where rounding up would undercount the cap.
 */
export function usdMicro(
  value: unknown,
  direction: "up" | "down" = "up",
): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e-(\d+))?$/u.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const digits = match[1] + fraction;
  // A negative exponent larger than this text can only be sub-micro. Handle
  // it before building any bigint power, so hostile exponents cannot request
  // an unbounded power of ten or round positive gas cost down to zero.
  const exponent = match[3] === undefined ? 0 : Number(match[3]);
  const discarded = fraction.length + exponent - 6;
  if (discarded >= digits.length)
    return direction === "up" && /[1-9]/u.test(digits) ? 1n : 0n;
  if (discarded <= 0) return BigInt(digits) * 10n ** BigInt(-discarded);
  return roundedDivision(
    BigInt(digits),
    10n ** BigInt(discarded),
    direction === "up",
  );
}

interface KyberRoute {
  routeSummary: Record<string, unknown> & {
    amountIn: string;
    amountOut: string;
    tokenIn: string;
    tokenOut: string;
  };
  routerAddress: string;
}

export function createEvmClient(options: EvmClientOptions): ChainClient {
  const { config, limits } = options;
  const definition = config.definition;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const router = definition.router as Address;
  /**
   * The stablecoin that prices value and gas: the network's USDC, or on a
   * network without a conversion target its pricing reference, and that only
   * while the buyback is configured. Without either, nothing quotes or signs.
   */
  const usdc = (): string => {
    const reference =
      definition.usdc ?? (options.buyback ? definition.stable : null);
    if (reference === null)
      throw new Error(`no verified USDC target on ${config.network}`);
    return reference;
  };
  const wallet = config.feeWallet as Address;
  const nativeAsset = (token: string) =>
    isNativeAssetAddress(config.network, token);
  const routeToken = (token: string) => (nativeAsset(token) ? NATIVE : token);
  const chain: Chain = defineChain({
    id: definition.chainId as number,
    name: config.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { fetchFn: doFetch, retryCount: 1 }),
  }) as PublicClient;
  if (options.privateKey && (!options.nativeGas || !config.nativeBudget))
    throw new Error(
      "Fee signing needs native limits and a durable budget journal",
    );
  const account = options.privateKey
    ? (() => {
        if (!/^0x[0-9a-fA-F]{64}$/u.test(options.privateKey))
          throw new TypeError(
            `Fee-wallet key for ${config.network} is malformed`,
          );
        const value = privateKeyToAccount(options.privateKey as Hex);
        if (value.address.toLowerCase() !== wallet)
          throw new TypeError(
            `Fee-wallet key for ${config.network} does not control the configured fee wallet`,
          );
        return value;
      })()
    : null;

  async function kyber<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(
      `${KYBER_API}/${definition.kyberChain}/api/v1/${path}`,
      {
        ...init,
        headers: {
          "x-client-id": options.kyberClientId,
          "content-type": "application/json",
          accept: "application/json",
        },
      },
    );
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error("KyberSwap response too large");
    let body: { code?: number; message?: string; data?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`KyberSwap returned HTTP ${response.status}`);
    }
    if (!response.ok || body.code !== 0 || body.data === undefined) {
      const error = new Error(
        `KyberSwap ${path.split("?")[0]}: ${String(body.message ?? response.status).slice(0, 200)}`,
      );
      (error as Error & { status?: number; code?: number }).status =
        response.status;
      (error as Error & { code?: number }).code = body.code;
      throw error;
    }
    return body.data as T;
  }

  /** A KyberSwap route from `token` to `target`, by default this network's USDC. */
  const kyberRoute = (token: string, amountIn: bigint, target = usdc()) =>
    kyber<KyberRoute>(
      `routes?${new URLSearchParams({
        tokenIn: routeToken(token),
        tokenOut: target,
        amountIn: amountIn.toString(),
        gasInclude: "true",
      })}`,
    );
  /** The vault a claim row recorded when it was journaled. */
  const recordedVault = (row: ConversionRow) =>
    JSON.parse(row.quote as string) as FeeVault;
  /** A recorded claim is resent or replaced only while it pays this wallet. */
  async function assertRecordedClaim(row: ConversionRow) {
    if (row.kind === "claim" && !(await verifiedVault(recordedVault(row))))
      throw new Error("Recorded claim pays another fee wallet");
  }
  /**
   * The one spender an approval row may name: the pinned bridge contract for
   * a bridge approval (route `debridge`), otherwise the pinned swap router.
   */
  const approvalSpender = (row: ConversionRow) =>
    row.route === "debridge" ? (DLN.source as Address) : router;
  /** The approval calldata grants exactly the row's amount to its pinned spender. */
  function boundedApproval(row: ConversionRow, data: Hex, value?: bigint) {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    return (
      (value ?? 0n) === 0n &&
      decoded.functionName === "approve" &&
      decoded.args[0].toLowerCase() === approvalSpender(row) &&
      decoded.args[1] === BigInt(row.amountIn)
    );
  }
  /** The exact burn calldata: a transfer of the row's amount to the burn address. */
  const burnCalldata = (amount: bigint) =>
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [BURN_ADDRESS as Address, amount],
    });
  /** The contract a recorded send must call, by its kind. */
  const sendRecipient = (row: ConversionRow): string =>
    row.kind === "claim"
      ? recordedVault(row).vault
      : row.kind === "approval"
        ? row.token
        : row.kind === "bridge"
          ? DLN.source
          : row.kind === "burn"
            ? SLOP_TOKEN
            : router;
  /**
   * A recorded bridge order or burn must still be exactly the send that was
   * journaled: the pinned contract and the recorded terms, nothing else.
   */
  function assertBuybackIntent(
    row: ConversionRow,
    to: string | null | undefined,
    data: Hex,
    value: bigint,
  ) {
    if (row.kind === "burn") {
      if (
        to?.toLowerCase() !== SLOP_TOKEN ||
        value !== 0n ||
        data.toLowerCase() !== burnCalldata(BigInt(row.amountIn)).toLowerCase()
      )
        throw new Error("Recorded burn differs from its exact transfer");
      return;
    }
    if (row.kind !== "bridge") return;
    const terms = bridgeTerms(row);
    const order = checkedDlnOrder(data, {
      wallet,
      giveToken: row.token,
      giveAmount: BigInt(row.amountIn),
      takeToken: terms.takeToken,
      takeChainId: BigInt(terms.takeChainId),
      receiver: terms.receiver,
    });
    if (
      to?.toLowerCase() !== DLN.source ||
      value !== BigInt(terms.nativeFee) ||
      order.takeAmount !== BigInt(terms.takeAmount) ||
      order.salt !== BigInt(terms.salt) ||
      terms.takeToken.toLowerCase() !== ROBINHOOD_USDG ||
      BigInt(terms.takeChainId) !== ROBINHOOD_CHAIN_ID
    )
      throw new Error("Recorded bridge order differs from its terms");
  }

  async function sendRaw(raw: Hex): Promise<void> {
    try {
      await client.request({
        method: "eth_sendRawTransaction",
        params: [raw],
      });
    } catch (error) {
      if (/already known/iu.test(String((error as Error).message))) return;
      const rpcError =
        error instanceof BaseError
          ? error.walk((cause) => cause instanceof RpcRequestError)
          : null;
      // Only an explicit node rejection permits escalation after rebroadcast.
      // Do not classify HTTP/transport failures or a generic "outdated" error.
      if (
        rpcError instanceof RpcRequestError &&
        /max fee per gas less than block base fee|fee cap less than block base fee/iu.test(
          rpcError.details ?? "",
        )
      )
        throw new FeeCapTooLowError();
      throw error;
    }
  }

  async function waitForReceipt(hash: Hex) {
    const deadline = Date.now() + RECEIPT_WAIT_MS;
    while (Date.now() < deadline) {
      // Only "not mined yet" waits; any other RPC failure is reported.
      const receipt = await client
        .getTransactionReceipt({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        });
      if (receipt) return receipt;
      await sleep(2_000);
    }
    return null;
  }

  async function baseFee(
    selector: "0xf1c7a58b" | "0x275aedd2",
    amount: bigint,
    blockNumber: bigint,
  ) {
    const result = await client.call({
      to: "0x420000000000000000000000000000000000000f",
      data: `${selector}${amount.toString(16).padStart(64, "0")}` as Hex,
      blockNumber,
    });
    if (!result.data || !/^0x[0-9a-fA-F]{64}$/u.test(result.data))
      throw new Error("Base data/operator fee evidence is unavailable");
    return BigInt(result.data);
  }
  async function signIntent(
    input: TransactionSerializableEIP1559,
    valueMicro: bigint,
    assertLease?: () => Promise<void>,
    replaces?: string,
    bridge?: BridgeCost,
  ) {
    if (!account || !options.nativeGas || !config.nativeBudget)
      throw new Error("Fee signing needs the durable native budget");
    const unsigned = serializeTransaction(input);
    const extra = BigInt(config.nativeBudget.additionalFeeReserve);
    if (config.network === "base") {
      const blockNumber = await client.getBlockNumber();
      // Same oracle/allowance as the keeper; include worst-case signature size.
      const data = await baseFee(
        "0xf1c7a58b",
        BigInt((unsigned.length - 2) / 2 + 68),
        blockNumber,
      );
      const operator = await baseFee(
        "0x275aedd2",
        input.gas as bigint,
        blockNumber,
      );
      if (data + operator > extra)
        throw new Error(
          "Base data/operator fees exceed the configured allowance",
        );
    }
    const maximum =
      (input.gas as bigint) * (input.maxFeePerGas as bigint) + extra;
    if (bridge) {
      const buybackLimits = options.buyback?.limits;
      if (!buybackLimits)
        throw new Error("Bridge signing needs buyback limits");
      const preparation = await options.nativeGas.bridgePreparationNative(
        bridge.token,
        { nonce: input.nonce as number, maximum },
      );
      const native =
        preparation +
        bridge.nativeFee +
        (bridge.approval ? BigInt(config.nativeBudget.perTransaction) : 0n);
      const priced = await self.quote(NATIVE, native);
      if (
        "noRoute" in priced ||
        priced.amountOut >= bridge.takeAmount ||
        !bridgeFeeWithin(
          bridge.amount,
          bridge.takeAmount - priced.amountOut,
          buybackLimits.maxBridgeCostBps,
        )
      )
        throw new Error(
          "Final prepared bridge cost exceeds the cap or cannot be priced",
        );
    }
    if ((input.value ?? 0n) > 0n) {
      const balance = await client.getBalance({ address: wallet });
      if (balance < (input.value ?? 0n) + maximum)
        throw new Error("Native conversion cannot cover its input and gas");
    }
    const priced = await self.quote(NATIVE, maximum);
    if (
      "noRoute" in priced ||
      priced.amountOut * limits.gasMultiple > valueMicro
    )
      throw new Error(
        "Final prepared native fee exceeds the gas-cost multiple or cannot be priced",
      );
    await assertLease?.();
    const nativeGasId = await options.nativeGas.reserve({
      nonce: input.nonce as number,
      intentHash: keccak256(unsigned),
      maximumWei: maximum.toString(),
      replaces,
    });
    await assertLease?.();
    const raw = await account.signTransaction(input);
    return { raw, hash: keccak256(raw), nativeGasId };
  }
  async function signAndSend(
    to: Address,
    data: Hex,
    nonce: number,
    valueMicro: bigint,
    assertLease?: () => Promise<void>,
    value = 0n,
    bridge?: BridgeCost,
  ): Promise<{ raw: Hex; hash: Hex; nativeGasId: string }> {
    if (!account)
      throw new Error("Signing is disabled without a fee-wallet key");
    const gas = await client.estimateGas({
      account: wallet,
      to,
      data,
      value,
    });
    const fees = await client.estimateFeesPerGas();
    return signIntent(
      {
        chainId: chain.id,
        type: "eip1559",
        to,
        data,
        value,
        nonce,
        gas: (gas * 13n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      },
      valueMicro,
      assertLease,
      undefined,
      bridge,
    );
  }

  async function verifiedVault(entry: FeeVault, atBlock?: bigint) {
    const record = entry.deployment;
    const text = (name: string): string => {
      const value = record[name];
      if (typeof value !== "string" || value.length === 0)
        throw new Error(`reviewed EVM deployment lacks ${name}`);
      return value;
    };
    if (
      !definition.escrowNetworks.includes(text("network")) ||
      text("vault").toLowerCase() !== entry.vault.toLowerCase()
    )
      throw new Error("Vault differs from its reviewed network or deployment");
    const escrow: EvmEscrowConfig = {
      request: (method, params) => client.request({ method, params } as never),
      chainId: BigInt(chain.id),
      payoutPolicy: entry.payoutPolicy,
      vault: text("vault"),
      asset: text("asset"),
      owner: text("owner"),
      identityAuthority: text("identityAuthority"),
      feeRecipient: text("feeRecipient"),
      factory: text("factory"),
      registrar: text("registrar"),
      codeSha256: text("codeSha256"),
      factoryCodeSha256: text("factoryCodeSha256"),
      bindingDelaySeconds: text("bindingDelaySeconds"),
      ...(record.evmUpgrade === undefined
        ? {}
        : { evmUpgrade: record.evmUpgrade as EvmUpgrade }),
    };
    // Pin every read to one current block. A recent unreviewed upgrade must not
    // remain claimable merely because the prior implementation is finalized.
    const block = atBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
    await verifyEvmDeployment(escrow, `0x${block.toString(16)}`);
    if (escrow.feeRecipient.toLowerCase() !== wallet) return null;
    // The attester can rotate without changing the deployment record. Check
    // current and proposed roles on chain, not the record's old attester.
    const role = (
      functionName:
        | "identityAuthority"
        | "pendingIdentityAuthority"
        | "pendingUpgradeAuthority",
    ) =>
      client.readContract({
        address: escrow.factory as Address,
        abi: VAULT_FEE_ABI,
        functionName,
        blockNumber: block,
      });
    const roles = await Promise.all([
      role("identityAuthority"),
      role("pendingIdentityAuthority"),
      ...(escrow.evmUpgrade ? [role("pendingUpgradeAuthority")] : []),
    ]);
    if (
      [
        escrow.owner,
        escrow.registrar,
        escrow.evmUpgrade?.authority,
        ...roles,
      ].some((address) => address?.toLowerCase() === wallet)
    )
      throw new Error("The fee wallet holds or is proposed for a vault role");
    const amount = await client.readContract({
      address: escrow.vault as Address,
      abi: VAULT_FEE_ABI,
      functionName: "accruedFees",
      blockNumber: block,
    });
    return { escrow, amount };
  }

  async function claimReceipt(
    entry: FeeVault,
    receipt: TransactionReceipt,
  ): Promise<bigint> {
    const verified = await verifiedVault(entry, receipt.blockNumber);
    if (
      !verified ||
      receipt.from.toLowerCase() !== wallet ||
      receipt.to?.toLowerCase() !== entry.vault.toLowerCase()
    )
      throw new Error(
        "Claim receipt does not match the reviewed vault or fee wallet",
      );
    const { escrow } = verified;
    const claims = parseEventLogs({
      abi: VAULT_FEE_ABI,
      eventName: "FeesClaimed",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === escrow.vault.toLowerCase(),
      ),
    });
    if (
      claims.length !== 1 ||
      claims[0].args.feeRecipient.toLowerCase() !== wallet ||
      claims[0].args.amount <= 0n
    )
      throw new Error("Claim receipt lacks the reviewed vault fee event");
    if (nativeAsset(escrow.asset)) {
      const transaction = await client.getTransaction({
        hash: receipt.transactionHash,
      });
      if (
        transaction.hash.toLowerCase() !==
          receipt.transactionHash.toLowerCase() ||
        transaction.from.toLowerCase() !== wallet ||
        transaction.to?.toLowerCase() !== escrow.vault.toLowerCase() ||
        transaction.blockHash !== receipt.blockHash ||
        transaction.blockNumber !== receipt.blockNumber ||
        transaction.input !== CLAIM_FEES ||
        transaction.value !== 0n
      )
        throw new Error("Native claim transaction differs from its intent");
      // The pinned implementation emits FeesClaimed only after sendExact
      // checks this transaction's exact native debit and recipient credit.
      // Whole-block balances also include unrelated transactions and cannot
      // establish the amount sent by this claim.
      return claims[0].args.amount;
    }
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === escrow.asset.toLowerCase(),
      ),
    });
    let received = 0n,
      paid = 0n;
    for (const { args } of transfers) {
      if (args.to.toLowerCase() === wallet) received += args.value;
      if (args.from.toLowerCase() === wallet) received -= args.value;
      if (args.from.toLowerCase() === escrow.vault.toLowerCase())
        paid += args.value;
      if (args.to.toLowerCase() === escrow.vault.toLowerCase())
        paid -= args.value;
    }
    if (received !== claims[0].args.amount || received !== paid)
      throw new Error(
        `claim ${receipt.transactionHash} receipt does not match the vault fee`,
      );
    return received;
  }

  async function receiptNativeCost(
    receipt: TransactionReceipt,
  ): Promise<bigint> {
    return evmReceiptNativeCost(client, receipt, config.network === "base");
  }

  async function recordedIntent(
    send: RecordedNativeSend,
  ): Promise<TransactionSerializableEIP1559> {
    let intent: TransactionSerializableEIP1559;
    if (send.rawTx) {
      if (
        keccak256(send.rawTx as Hex) !== send.txId ||
        (
          await recoverTransactionAddress({
            serializedTransaction: send.rawTx as TransactionSerializedEIP1559,
          })
        ).toLowerCase() !== send.feeWallet
      )
        throw new Error("Recorded native send signature differs");
      const {
        r: _r,
        s: _s,
        v: _v,
        yParity: _y,
        ...parsed
      } = parseTransaction(send.rawTx as Hex);
      if (parsed.type !== "eip1559")
        throw new Error("Recorded native send type is unsupported");
      intent = parsed;
    } else {
      const tx = await client.getTransaction({ hash: send.txId as Hex });
      if (
        tx.hash.toLowerCase() !== send.txId.toLowerCase() ||
        tx.from.toLowerCase() !== send.feeWallet ||
        tx.type !== "eip1559"
      )
        throw new Error("Historical native transaction evidence differs");
      intent = {
        type: "eip1559",
        chainId: tx.chainId,
        nonce: tx.nonce,
        to: tx.to ?? undefined,
        data: tx.input,
        value: tx.value,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        accessList: tx.accessList,
      };
      // A hash-only historical row still binds every signed fee field. Do not
      // let an inconsistent RPC body shrink its unresolved gas liability.
      const serialized = serializeTransaction(intent, {
        r: tx.r,
        s: tx.s,
        v: tx.v,
        yParity: tx.yParity,
      });
      if (
        keccak256(serialized).toLowerCase() !== send.txId.toLowerCase() ||
        (
          await recoverTransactionAddress({
            serializedTransaction: serialized,
          })
        ).toLowerCase() !== send.feeWallet
      )
        throw new Error("Historical native transaction signature differs");
    }
    if (
      intent.chainId !== chain.id ||
      intent.nonce === undefined ||
      (send.nonce !== null && intent.nonce !== send.nonce) ||
      intent.gas === undefined ||
      intent.maxFeePerGas === undefined ||
      intent.maxPriorityFeePerGas === undefined
    )
      throw new Error("Recorded native transaction bounds are unavailable");
    return intent;
  }
  /**
   * A finalized bridge order: the pinned contract created exactly the
   * recorded order and took exactly the recorded amount from this wallet.
   */
  function bridgeReceipt(row: ConversionRow, receipt: TransactionReceipt) {
    const terms = bridgeTerms(row);
    const created = parseEventLogs({
      abi: DLN_SOURCE_ABI,
      eventName: "CreatedOrder",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === DLN.source,
      ),
    });
    if (
      created.length !== 1 ||
      created[0].args.orderId.toLowerCase() !== terms.orderId ||
      created[0].args.order.takeAmount !== BigInt(terms.takeAmount) ||
      created[0].args.order.takeChainId !== BigInt(terms.takeChainId) ||
      created[0].args.order.takeTokenAddress.toLowerCase() !==
        terms.takeToken.toLowerCase() ||
      created[0].args.order.receiverDst.toLowerCase() !==
        terms.receiver.toLowerCase()
    )
      throw new Error("Bridge receipt lacks the recorded order");
    let paid = 0n;
    for (const { args } of parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === row.token.toLowerCase(),
      ),
    })) {
      if (args.from.toLowerCase() === wallet) paid += args.value;
      if (args.to.toLowerCase() === wallet) paid -= args.value;
    }
    if (paid !== BigInt(row.amountIn))
      throw new Error("Bridge receipt debit differs from the recorded amount");
    return paid;
  }

  /** A finalized burn: exactly the recorded SLOP left this wallet for the burn address. */
  function burnReceipt(row: ConversionRow, receipt: TransactionReceipt) {
    let burned = 0n;
    let left = 0n;
    for (const { args } of parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === SLOP_TOKEN,
      ),
    })) {
      if (args.from.toLowerCase() !== wallet) continue;
      left += args.value;
      if (args.to.toLowerCase() === BURN_ADDRESS) burned += args.value;
    }
    if (burned !== BigInt(row.amountIn) || left !== burned)
      throw new Error("Burn receipt differs from the recorded amount");
    return burned;
  }

  /**
   * A checked KyberSwap quote from `token` to `target`. The minimum output is
   * this Worker's own floor of the quote at `slippageBps`.
   */
  async function quoteTo(
    token: string,
    amount: bigint,
    target: string,
    slippageBps: number,
  ): Promise<QuoteResult> {
    let route: KyberRoute;
    try {
      route = await kyberRoute(token, amount, target);
    } catch (error) {
      const status = (error as { status?: number }).status;
      // 4xx: no pool or an unsupported token. Anything else is a fault.
      if (status !== undefined && status >= 400 && status < 500)
        return { noRoute: (error as Error).message };
      throw error;
    }
    const summary = route.routeSummary;
    if (
      route.routerAddress.toLowerCase() !== router ||
      summary.tokenIn.toLowerCase() !== routeToken(token) ||
      summary.tokenOut.toLowerCase() !== target ||
      summary.amountIn !== amount.toString() ||
      !/^\d+$/u.test(summary.amountOut)
    )
      throw new Error("KyberSwap route does not match the request");
    const amountOut = BigInt(summary.amountOut);
    if (amountOut === 0n) return { noRoute: "KyberSwap quoted zero output" };
    const inUsd = usdMicro(summary.amountInUsd);
    // The output rounds down: rounding it up would shrink the measured
    // impact below the cap it is checked against.
    const outUsd = usdMicro(summary.amountOutUsd, "down");
    // Rounded up so a cap is never undercounted, as on Solana.
    const priceImpactBps =
      inUsd !== null && outUsd !== null && inUsd > 0n
        ? Number(priceImpactCeiling(inUsd, outUsd))
        : null;
    const gasUsd = usdMicro(summary.gasUsd);
    // Ethereum has no separate L1 posting fee. Base needs both estimates;
    // an unavailable price must not weaken the conversion's 10x gas gate.
    const l1FeeUsd =
      summary.l1FeeUsd === undefined && config.network === "ethereum"
        ? 0n
        : usdMicro(summary.l1FeeUsd);
    if (gasUsd === null || l1FeeUsd === null)
      throw new Error("KyberSwap gas cost is unavailable");
    const gasCostMicro = gasUsd + l1FeeUsd;
    return {
      route: "kyberswap",
      amountIn: amount,
      amountOut,
      minAmountOut: minimumOutput(amountOut, BigInt(slippageBps)),
      priceImpactBps,
      gasCostMicro,
      summary: {
        aggregator: "kyberswap",
        chain: definition.kyberChain,
        router: route.routerAddress.toLowerCase(),
        amountInUsd: summary.amountInUsd ?? null,
        amountOutUsd: summary.amountOutUsd ?? null,
        gas: summary.gas ?? null,
        gasUsd: summary.gasUsd ?? null,
        l1FeeUsd: summary.l1FeeUsd ?? null,
        hops: Array.isArray(summary.route)
          ? (summary.route as unknown[][]).flat().length
          : null,
        observedAt: now().toISOString(),
      },
    };
  }
  /**
   * Signs the exact approval or the checked swap of `token` into `target`.
   * `valueMicro` is the send's stablecoin value for the final gas check.
   */
  async function prepareSwap(
    token: string,
    quote: Quote,
    target: string,
    slippageBps: number,
    valueMicro: bigint,
    nonceFloor: number,
    assertLease?: () => Promise<void>,
  ): Promise<PreparedSend> {
    if (!account)
      throw new Error("Signing is disabled without a fee-wallet key");
    // Approve exactly the order amount to the pinned router, never more.
    const native = nativeAsset(token);
    const allowance = native
      ? quote.amountIn
      : await client.readContract({
          address: token as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, router],
        });
    const nonce = await client.getTransactionCount({
      address: wallet,
      blockTag: "pending",
    });
    // A node that dropped an open send reports its nonce as free. Never
    // reuse it: the two sends would outbid each other.
    assertNonceFree(nonce, nonceFloor);
    if (allowance < quote.amountIn) {
      const approval = await signAndSend(
        token as Address,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [router, quote.amountIn],
        }),
        nonce,
        valueMicro,
        assertLease,
      );
      return {
        kind: "approval",
        txId: approval.hash,
        rawTx: approval.raw,
        evmNonce: nonce,
        expiresAt: null,
        approvalTxId: approval.hash,
        minAmountOut: 0n,
        nativeGasId: approval.nativeGasId,
      };
    }

    // Re-route at the moment of signing with half the slippage budget, so
    // the signed minimum stays at or above the recorded quote minimum.
    const fresh = await kyberRoute(token, quote.amountIn, target);
    const deadline = Math.floor(now().getTime() / 1000) + DEADLINE_SECONDS;
    const built = await kyber<{
      data: Hex;
      routerAddress: string;
      transactionValue: string;
      amountIn: string;
      amountOut: string;
    }>("route/build", {
      method: "POST",
      body: JSON.stringify({
        routeSummary: fresh.routeSummary,
        sender: wallet,
        recipient: wallet,
        slippageTolerance: Math.max(1, Math.floor(slippageBps / 2)),
        deadline,
        source: options.kyberClientId,
      }),
    });
    if (built.routerAddress.toLowerCase() !== router)
      throw new Error("KyberSwap build names an unexpected router");
    const value = native ? quote.amountIn : 0n;
    if (built.transactionValue !== value.toString())
      throw new Error("KyberSwap build carries a different native value");
    const decoded = decodeFunctionData({
      abi: KYBER_ROUTER_ABI,
      data: built.data,
    });
    const desc =
      decoded.functionName === "swap" ? decoded.args[0].desc : decoded.args[1];
    if (
      desc.srcToken.toLowerCase() !== routeToken(token) ||
      desc.dstToken.toLowerCase() !== target ||
      desc.dstReceiver.toLowerCase() !== wallet ||
      desc.amount !== quote.amountIn ||
      desc.feeReceivers.length !== 0 ||
      desc.feeAmounts.length !== 0
    )
      throw new Error("KyberSwap calldata does not match the order");
    if (desc.minReturnAmount < quote.minAmountOut)
      throw new Error("price moved below the recorded minimum");

    const simulated = await client.call({
      account: wallet,
      to: router,
      data: built.data,
      value,
    });
    if (!simulated.data) throw new Error("swap simulation returned no data");
    const [returnAmount] = decodeFunctionResult({
      abi: KYBER_ROUTER_ABI,
      functionName: decoded.functionName,
      data: simulated.data,
    }) as readonly [bigint, bigint];
    if (returnAmount < desc.minReturnAmount)
      throw new Error("swap simulation returned less than the signed minimum");

    const swap = await signAndSend(
      router,
      built.data,
      nonce,
      valueMicro,
      assertLease,
      value,
    );
    return {
      txId: swap.hash,
      rawTx: swap.raw,
      evmNonce: nonce,
      expiresAt: deadline,
      approvalTxId: null,
      minAmountOut: desc.minReturnAmount,
      nativeGasId: swap.nativeGasId,
    };
  }
  const self: ChainClient = {
    async reconcileNativeGas() {
      const journal = options.nativeGas;
      if (!journal) return;
      await journal.recoverUnsigned();
      for (const send of await journal.unaccounted()) {
        const tx = await recordedIntent(send);
        await journal.importRecorded(
          send,
          tx.nonce as number,
          keccak256(serializeTransaction(tx)),
          (
            (tx.gas as bigint) * (tx.maxFeePerGas as bigint) +
            BigInt(journal.limits.additionalFeeReserve)
          ).toString(),
        );
      }
      for (const send of await journal.unsettled()) {
        const receipt = await client
          .getTransactionReceipt({ hash: send.txId as Hex })
          .catch((e: unknown) => {
            if (e instanceof TransactionReceiptNotFoundError) return null;
            throw e;
          });
        // An advanced nonce does not identify its winner. Keep the liability
        // until the journaled send's canonical finalized cost is available.
        if (!receipt) continue;
        const block = await client.getBlock({
          blockNumber: receipt.blockNumber,
        });
        const finalized = await client.getBlock({ blockTag: "finalized" });
        if (
          !isCanonicalEvmReceipt(send.txId, receipt, block) ||
          typeof finalized.number !== "bigint" ||
          !["success", "reverted"].includes(receipt.status)
        )
          throw new Error("Native fee receipt is not canonical");
        if (receipt.blockNumber > finalized.number) continue;
        const intent = await recordedIntent(send);
        const tx = await client.getTransaction({ hash: send.txId as Hex });
        if (
          tx.hash.toLowerCase() !== send.txId.toLowerCase() ||
          tx.from.toLowerCase() !== send.feeWallet ||
          tx.blockHash !== receipt.blockHash ||
          tx.blockNumber !== receipt.blockNumber ||
          tx.transactionIndex !== receipt.transactionIndex ||
          tx.nonce !== intent.nonce ||
          tx.to?.toLowerCase() !== intent.to?.toLowerCase() ||
          tx.input !== (intent.data ?? "0x") ||
          tx.value !== (intent.value ?? 0n) ||
          tx.gas !== intent.gas ||
          tx.maxFeePerGas !== intent.maxFeePerGas ||
          tx.maxPriorityFeePerGas !== intent.maxPriorityFeePerGas ||
          receipt.from.toLowerCase() !== send.feeWallet ||
          receipt.gasUsed < 0n ||
          receipt.gasUsed > (intent.gas as bigint) ||
          receipt.effectiveGasPrice < 0n ||
          receipt.effectiveGasPrice > (intent.maxFeePerGas as bigint)
        )
          throw new Error(
            "Native fee receipt differs from the signed transaction",
          );
        const actual = await receiptNativeCost(receipt);
        await journal.settle(
          { ...send, nonce: intent.nonce as number },
          {
            txId: send.txId,
            actualWei: actual.toString(),
            blockHash: receipt.blockHash,
          },
        );
      }
    },
    async balance(token) {
      if (nativeAsset(token)) {
        const balance = await client.getBalance({
          address: wallet,
          blockTag: "finalized",
        });
        const reserve = BigInt(config.nativeBudget?.perTransaction ?? "0");
        return spendableNative(balance, reserve);
      }
      return client.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      });
    },

    quote: (token, amount) =>
      quoteTo(token, amount, usdc(), limits.maxSlippageBps),

    async prepare(
      token,
      quote: Quote,
      nonceFloor = 0,
      assertLease?: () => Promise<void>,
    ): Promise<PreparedSend> {
      // A pricing reference is never a conversion target.
      if (definition.usdc === null)
        throw new Error(`no verified USDC target on ${config.network}`);
      return prepareSwap(
        token,
        quote,
        definition.usdc,
        limits.maxSlippageBps,
        quote.amountOut,
        nonceFloor,
        assertLease,
      );
    },

    broadcast: (raw) => sendRaw(raw as Hex),

    async status(
      row: ConversionRow,
      replacements: readonly SendReplacement[] = [],
    ): Promise<SendStatus> {
      // The original send and its replacements share one nonce, so at most
      // one of them can be included. Check each; the included one decides.
      const attempts = [
        row.txId as Hex,
        ...replacements.map((replacement) => replacement.txId as Hex),
      ];
      const latestRaw = replacements.at(-1)?.rawTx ?? (row.rawTx as string);
      for (const hash of attempts) {
        // Only the node's "not found" answer means absence. Any other lookup
        // error throws, so the row stays open for the next run.
        const receipt = await client
          .getTransactionReceipt({ hash })
          .catch((error: unknown) => {
            if (error instanceof TransactionReceiptNotFoundError) return null;
            throw error;
          });
        if (!receipt) continue;
        const canonical = await client.getBlock({
          blockNumber: receipt.blockNumber,
        });
        if (
          !isCanonicalEvmReceipt(hash, receipt, canonical) ||
          !["success", "reverted"].includes(receipt.status)
        )
          throw new Error("Fee send receipt identity differs");
        const landed = { txId: hash };
        const finalized = await client.getBlock({ blockTag: "finalized" });
        if (typeof finalized.number !== "bigint" || finalized.number < 0n)
          throw new Error("Fee send finality unavailable");
        if (receipt.blockNumber > finalized.number)
          return { kind: "pending", mined: true };
        if (row.kind === "approval") {
          const transaction = await client.getTransaction({ hash });
          if (
            transaction.hash.toLowerCase() !== hash.toLowerCase() ||
            transaction.from.toLowerCase() !== wallet ||
            transaction.to?.toLowerCase() !== row.token.toLowerCase() ||
            transaction.nonce !== row.evmNonce ||
            transaction.blockHash !== receipt.blockHash ||
            transaction.blockNumber !== receipt.blockNumber ||
            !boundedApproval(row, transaction.input, transaction.value)
          )
            throw new Error("Approval receipt differs from its bounded intent");
          if (receipt.status !== "success")
            return {
              kind: "failed",
              reason: "approval transaction reverted",
              ...landed,
            };
          const allowance = await client.readContract({
            address: row.token as Address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [wallet, approvalSpender(row)],
            blockNumber: receipt.blockNumber,
          });
          if (allowance !== BigInt(row.amountIn))
            throw new Error("Finalized approval allowance differs");
          return { kind: "finalized", amountOut: 0n, ...landed };
        }
        if (row.kind === "bridge" || row.kind === "burn") {
          // The landed attempt must be the journaled send: the pinned
          // contract and the recorded terms, from this wallet and nonce.
          const transaction = await client.getTransaction({ hash });
          if (
            transaction.hash.toLowerCase() !== hash.toLowerCase() ||
            transaction.from.toLowerCase() !== wallet ||
            transaction.nonce !== row.evmNonce ||
            transaction.blockHash !== receipt.blockHash ||
            transaction.blockNumber !== receipt.blockNumber
          )
            throw new Error("Buyback receipt differs from its recorded send");
          assertBuybackIntent(
            row,
            transaction.to,
            transaction.input,
            transaction.value,
          );
        }
        if (receipt.status !== "success")
          return {
            kind: "failed",
            reason: `${
              row.kind === "claim"
                ? "claim"
                : row.kind === "bridge"
                  ? "bridge order"
                  : row.kind === "burn"
                    ? "burn transfer"
                    : "swap"
            } transaction reverted`,
            ...landed,
          };
        if (row.kind === "bridge")
          return {
            kind: "finalized",
            amountOut: bridgeReceipt(row, receipt),
            ...landed,
          };
        if (row.kind === "burn")
          return {
            kind: "finalized",
            amountOut: burnReceipt(row, receipt),
            ...landed,
          };
        if (row.kind === "claim")
          return {
            kind: "finalized",
            amountOut: await claimReceipt(recordedVault(row), receipt),
            ...landed,
          };
        const logs = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs.filter(
            // The row's own target, so a send reconciles against the asset
            // it was signed for.
            (log) => log.address.toLowerCase() === row.targetToken,
          ),
        });
        const amountOut = logs
          .filter((log) => log.args.to.toLowerCase() === wallet)
          .reduce((sum, log) => sum + log.args.value, 0n);
        return { kind: "finalized", amountOut, ...landed };
      }
      const seen: Hex[] = [];
      for (const hash of attempts) {
        const pending = await client
          .getTransaction({ hash })
          .catch((error: unknown) => {
            if (error instanceof TransactionNotFoundError) return null;
            throw error;
          });
        if (pending) seen.push(hash);
      }
      const deadlinePassed =
        row.expiresAt !== null &&
        Math.floor(now().getTime() / 1000) > row.expiresAt + 60;
      if (seen.includes(attempts[attempts.length - 1]))
        return { kind: "pending" };
      if (seen.length > 0) {
        // An older attempt waits in the node, but the latest journaled
        // replacement does not (a restart before its broadcast). Send the
        // latest bytes; never sign another. A swap past its deadline would
        // revert, so it only waits.
        if (row.kind !== "claim" && row.kind !== "approval" && deadlinePassed)
          return { kind: "pending" };
        await assertRecordedClaim(row);
        return { kind: "rebroadcast", rawTx: latestRaw };
      }
      // A finalized nonce advance proves consumption, not which transaction
      // won. Our swap can already have succeeded while both hash lookups lag.
      // Keep every send open until its own canonical receipt is available;
      // otherwise immutable failed history would hide a later success.
      const finalizedNonce = await client.getTransactionCount({
        address: wallet,
        blockTag: "finalized",
      });
      if (row.evmNonce !== null && finalizedNonce > row.evmNonce)
        return { kind: "pending", mined: true };
      // An included transaction can also precede finality while hash lookups
      // are unavailable. Its successful execution may predate the deadline;
      // do not turn that uncertainty into immutable expiry failure.
      if (
        row.evmNonce !== null &&
        (await client.getTransactionCount({
          address: wallet,
          blockTag: "latest",
        })) > row.evmNonce
      )
        return { kind: "pending", mined: true };
      // Past the router deadline the swap reverts even if it is mined later.
      if (deadlinePassed)
        return {
          kind: "failed",
          reason: "router deadline passed before inclusion",
        };
      await assertRecordedClaim(row);
      // A historical approval hash without retained bytes cannot be resent.
      if (row.rawTx === null) return { kind: "pending", mined: true };
      return { kind: "rebroadcast", rawTx: latestRaw };
    },

    /**
     * Signs one same-nonce replacement of a journaled claim or swap that is
     * not mined (owner decision of 25 October 2026). It copies the recipient,
     * calldata, value, gas limit and nonce of the original signed bytes, and
     * raises only the two fee fields. It never broadcasts: core.ts journals
     * the bytes first.
     */
    async replace(
      row: ConversionRow,
      replacements: readonly SendReplacement[],
      assertLease: () => Promise<void>,
    ): Promise<ReplacementResult> {
      if (!account) return { wait: "signing needs the fee-wallet key" };
      const original = parseTransaction(row.rawTx as Hex);
      const previous = parseTransaction(
        (replacements.at(-1)?.rawTx ?? row.rawTx) as Hex,
      );
      const recipient = sendRecipient(row);
      if (
        original.type !== "eip1559" ||
        previous.type !== "eip1559" ||
        original.chainId !== chain.id ||
        original.nonce !== row.evmNonce ||
        previous.nonce !== row.evmNonce ||
        original.to?.toLowerCase() !== recipient.toLowerCase() ||
        original.data === undefined ||
        original.gas === undefined ||
        original.maxFeePerGas === undefined ||
        original.maxPriorityFeePerGas === undefined ||
        previous.maxFeePerGas === undefined ||
        previous.maxPriorityFeePerGas === undefined ||
        (
          await recoverTransactionAddress({
            serializedTransaction: row.rawTx as TransactionSerializedEIP1559,
          })
        ).toLowerCase() !== wallet
      )
        throw new Error("Recorded send cannot be replaced");
      if (
        row.kind !== "claim" &&
        row.kind !== "approval" &&
        row.expiresAt !== null &&
        Math.floor(now().getTime() / 1000) +
          REPLACEMENT_DEADLINE_MARGIN_SECONDS >=
          row.expiresAt
      )
        return {
          wait: "router deadline too close; a same-nonce replacement would revert",
        };
      if (
        row.kind === "approval" &&
        !boundedApproval(row, original.data as Hex, original.value)
      )
        throw new Error("Recorded approval differs from its bounded intent");
      assertBuybackIntent(
        row,
        original.to,
        original.data as Hex,
        original.value ?? 0n,
      );
      const block = await client.getBlock({ blockTag: "latest" });
      if (block.baseFeePerGas === null || block.baseFeePerGas === undefined)
        return { wait: "the current network base fee is unavailable" };
      // EIP-1559 caps the effective tip at maxFee - baseFee. A new suggested
      // tip does not make an otherwise includable transaction underpriced.
      if (block.baseFeePerGas <= previous.maxFeePerGas)
        return { wait: "the signed fee covers the current network fee" };
      const next =
        original.maxFeePerGas > 0n &&
        original.maxPriorityFeePerGas >= 0n &&
        previous.maxFeePerGas > 0n &&
        previous.maxPriorityFeePerGas >= 0n
          ? nextReplacementFees(
              original.maxFeePerGas,
              original.maxPriorityFeePerGas,
              previous.maxFeePerGas,
              previous.maxPriorityFeePerGas,
              // This route has no absolute ceiling beyond three times the original.
              original.maxFeePerGas * REPLACEMENT_CAP_MULTIPLE,
            )
          : null;
      if (!next?.ok) return { wait: "fee replacement cap reached" };
      if (row.quoteValueMicro === null)
        return { wait: "the send has no recorded value to bound its fee" };
      let bridge: BridgeCost | undefined;
      if (row.route === "debridge") {
        if (!options.buyback)
          return { wait: "bridge replacement needs the active buyback limits" };
        const terms = JSON.parse(row.quote as string) as { nativeFee?: string };
        if (!terms.nativeFee || row.quoteAmountOut === null)
          throw new Error("Bridge replacement lacks its recorded cost terms");
        bridge = {
          token: row.token,
          amount: BigInt(row.amountIn),
          takeAmount: BigInt(row.quoteAmountOut),
          nativeFee: BigInt(terms.nativeFee),
          approval: row.kind === "approval",
        };
      }
      await assertRecordedClaim(row);
      const signed = await signIntent(
        {
          chainId: chain.id,
          type: "eip1559",
          to: original.to as Address,
          data: original.data,
          value: original.value ?? 0n,
          nonce: original.nonce,
          gas: original.gas,
          accessList: original.accessList,
          maxFeePerGas: next.maxFeePerGas,
          maxPriorityFeePerGas: next.maxPriorityFeePerGas,
        },
        BigInt(row.quoteValueMicro),
        assertLease,
        row.txId as string,
        bridge,
      );
      return {
        txId: signed.hash,
        rawTx: signed.raw,
        nativeGasId: signed.nativeGasId,
        maxFeePerGas: next.maxFeePerGas,
        maxPriorityFeePerGas: next.maxPriorityFeePerGas,
      };
    },

    vaultFees: {
      async accrued(entry) {
        const verified = await verifiedVault(entry);
        return verified === null || verified.amount === 0n
          ? null
          : {
              asset: verified.escrow.asset.toLowerCase(),
              amount: verified.amount,
            };
      },

      async claimCostMicro({ vault }) {
        const [gas, fees] = await Promise.all([
          client.estimateGas({
            account: wallet,
            to: vault as Address,
            data: CLAIM_FEES,
            value: 0n,
          }),
          client.estimateFeesPerGas(),
        ]);
        const priced = await self.quote(
          NATIVE,
          ((gas * 13n) / 10n) * fees.maxFeePerGas,
        );
        return "noRoute" in priced ? null : priced.amountOut;
      },

      async claim(entry, recordClaim, nonceFloor = 0, assertLease, valueMicro) {
        const verified = await verifiedVault(entry);
        if (!verified) throw new Error("Vault pays another fee recipient");
        if (verified.amount === 0n) throw new Error("No accrued fees to claim");
        if (valueMicro === undefined)
          throw new Error(
            "Fee claim needs its verified value for the final gas check",
          );
        const { escrow, amount } = verified;
        const vault = escrow.vault;
        // One send at a time: a claim waits until no earlier fee-wallet
        // transaction is pending, so a resend can never race the first.
        const [latest, pending] = await Promise.all([
          client.getTransactionCount({ address: wallet, blockTag: "latest" }),
          client.getTransactionCount({ address: wallet, blockTag: "pending" }),
        ]);
        if (pending !== latest)
          throw new Error("an earlier fee-wallet transaction is still pending");
        if (!recordClaim)
          throw new Error("Fee claim requires a durable send record");
        assertNonceFree(latest, nonceFloor);
        const sent = await signAndSend(
          vault as Address,
          CLAIM_FEES,
          latest,
          valueMicro,
          assertLease,
        );
        await recordClaim({
          txId: sent.hash,
          rawTx: sent.raw,
          evmNonce: latest,
          expiresAt: null,
          amount,
          nativeGasId: sent.nativeGasId,
        });
        await assertLease?.();
        await sendRaw(sent.raw);
        const receipt = await waitForReceipt(sent.hash);
        if (!receipt) throw new Error(`claim ${sent.hash} not mined in time`);
        if (receipt.status !== "success")
          throw new Error(`claim ${sent.hash} reverted`);
        await claimReceipt(entry, receipt);
        return { txId: sent.hash };
      },
    },
  };

  /** The network fee of `gas` units at the current maximum fee, in micro-units. */
  async function gasMicro(gas: bigint): Promise<bigint> {
    const fees = await client.estimateFeesPerGas();
    const priced = await self.quote(NATIVE, gas * fees.maxFeePerGas);
    if ("noRoute" in priced) throw new Error("Network fee cannot be priced");
    return priced.amountOut;
  }
  /** One free nonce with no earlier fee-wallet transaction still pending. */
  async function freeNonce(nonceFloor: number): Promise<number> {
    const [latest, pending] = await Promise.all([
      client.getTransactionCount({ address: wallet, blockTag: "latest" }),
      client.getTransactionCount({ address: wallet, blockTag: "pending" }),
    ]);
    if (pending !== latest)
      throw new Error("an earlier fee-wallet transaction is still pending");
    assertNonceFree(latest, nonceFloor);
    return latest;
  }
  /** A finalized block read: evidence is never taken from an unfinalized head. */
  async function finalizedBlock() {
    const block = await client.getBlock({ blockTag: "finalized" });
    if (typeof block.number !== "bigint" || !block.hash)
      throw new Error("Finalized block is unavailable");
    return { number: block.number, hash: block.hash };
  }

  const buyback = options.buyback;
  if (buyback && definition.usdc !== null) {
    const source = definition.usdc;
    const proposals = new WeakMap<BridgeQuote, DlnProposal>();
    const bridge: NonNullable<BuybackChainClient["bridge"]> = {
      async quote(amount) {
        const proposal = await proposeDlnOrder(doFetch, {
          srcChainId: String(chain.id),
          giveToken: source,
          giveAmount: amount,
          takeChainId: ROBINHOOD_CHAIN_ID.toString(),
          takeToken: ROBINHOOD_USDG,
          wallet,
          receiver: buyback.receiver,
        });
        if ("noRoute" in proposal) return proposal;
        if (proposal.to.toLowerCase() !== DLN.source)
          throw new Error("DLN proposal names an unexpected contract");
        const order = checkedDlnOrder(proposal.data, {
          wallet,
          giveToken: source,
          giveAmount: amount,
          takeToken: ROBINHOOD_USDG,
          takeChainId: ROBINHOOD_CHAIN_ID,
          receiver: buyback.receiver,
        });
        // The order pays exactly the contract's own fixed fee, read on chain.
        const fixedFee = await client.readContract({
          address: DLN.source as Address,
          abi: DLN_SOURCE_ABI,
          functionName: "globalFixedNativeFee",
        });
        if (proposal.value !== fixedFee)
          throw new Error("DLN proposal value differs from the fixed fee");
        if (order.takeAmount > amount)
          throw new Error("DLN proposal delivers more than its input");
        const feeValue =
          fixedFee === 0n ? 0n : await self.quote(NATIVE, fixedFee);
        if (typeof feeValue !== "bigint" && "noRoute" in feeValue)
          throw new Error("Fixed bridge fee cannot be priced");
        const feeMicro =
          typeof feeValue === "bigint" ? feeValue : feeValue.amountOut;
        const networkMicro = await gasMicro(DLN_ORDER_GAS);
        const quote: BridgeQuote = {
          amountIn: amount,
          takeToken: ROBINHOOD_USDG,
          takeAmount: order.takeAmount,
          nativeFee: fixedFee,
          costMicro: amount - order.takeAmount + feeMicro + networkMicro,
          receiver: buyback.receiver,
          summary: {
            provider: "debridge",
            contract: DLN.source,
            orderId: proposal.orderId,
            takeAmount: order.takeAmount.toString(),
            takeChainId: ROBINHOOD_CHAIN_ID.toString(),
            receiver: buyback.receiver.toLowerCase(),
            nativeFee: fixedFee.toString(),
            nativeFeeMicro: feeMicro.toString(),
            networkFeeMicro: networkMicro.toString(),
            observedAt: now().toISOString(),
          },
        };
        proposals.set(quote, proposal);
        return quote;
      },

      async prepare(quote, nonceFloor, assertLease): Promise<PreparedBridge> {
        if (!account)
          throw new Error("Signing is disabled without a fee-wallet key");
        const proposal = proposals.get(quote);
        if (!proposal) throw new Error("Bridge quote has no checked proposal");
        const allowance = await client.readContract({
          address: source as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, DLN.source as Address],
        });
        const nonce = await freeNonce(nonceFloor);
        // Approve exactly the order amount to the pinned bridge, never more.
        if (allowance < quote.amountIn) {
          const approval = await signAndSend(
            source as Address,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [DLN.source as Address, quote.amountIn],
            }),
            nonce,
            quote.amountIn,
            assertLease,
            0n,
            {
              token: source,
              amount: quote.amountIn,
              takeAmount: quote.takeAmount,
              nativeFee: quote.nativeFee,
              approval: true,
            },
          );
          return {
            kind: "approval",
            txId: approval.hash,
            rawTx: approval.raw,
            evmNonce: nonce,
            expiresAt: null,
            approvalTxId: approval.hash,
            minAmountOut: 0n,
            nativeGasId: approval.nativeGasId,
            terms: null,
          };
        }
        // Check the same bytes again at the moment of signing.
        const order = checkedDlnOrder(proposal.data, {
          wallet,
          giveToken: source,
          giveAmount: quote.amountIn,
          takeToken: ROBINHOOD_USDG,
          takeChainId: ROBINHOOD_CHAIN_ID,
          receiver: buyback.receiver,
        });
        if (
          order.takeAmount !== quote.takeAmount ||
          proposal.value !== quote.nativeFee
        )
          throw new Error("Bridge proposal differs from its quote");
        // The contract itself names the order id it would create.
        const simulated = await client.call({
          account: wallet,
          to: DLN.source as Address,
          data: proposal.data,
          value: proposal.value,
        });
        if (!simulated.data)
          throw new Error("bridge simulation returned no data");
        const orderId = decodeFunctionResult({
          abi: DLN_SOURCE_ABI,
          functionName: "createSaltedOrder",
          data: simulated.data,
        }).toLowerCase();
        if (orderId !== proposal.orderId)
          throw new Error(
            "Simulated bridge order id differs from the proposal",
          );
        const signed = await signAndSend(
          DLN.source as Address,
          proposal.data,
          nonce,
          quote.amountIn,
          assertLease,
          proposal.value,
          {
            token: source,
            amount: quote.amountIn,
            takeAmount: quote.takeAmount,
            nativeFee: quote.nativeFee,
            approval: false,
          },
        );
        const terms: BridgeTerms = {
          provider: "debridge",
          orderId,
          takeToken: ROBINHOOD_USDG,
          takeAmount: order.takeAmount.toString(),
          takeChainId: ROBINHOOD_CHAIN_ID.toString(),
          receiver: buyback.receiver.toLowerCase(),
          nativeFee: proposal.value.toString(),
          salt: order.salt.toString(),
        };
        return {
          kind: "bridge",
          txId: signed.hash,
          rawTx: signed.raw,
          evmNonce: nonce,
          expiresAt: null,
          approvalTxId: null,
          minAmountOut: order.takeAmount,
          nativeGasId: signed.nativeGasId,
          terms,
        };
      },

      async refund(terms): Promise<OutcomeEvidence | null> {
        const block = await finalizedBlock();
        const [status] = await client.readContract({
          address: DLN.source as Address,
          abi: DLN_SOURCE_ABI,
          functionName: "giveOrders",
          args: [terms.orderId as Hex],
          blockNumber: block.number,
        });
        return status === GIVE_STATUS.claimedCancel
          ? { block: Number(block.number), blockHash: block.hash }
          : null;
      },
    };
    self.buyback = { bridge };
  }

  if (buyback && config.network === BUYBACK_NETWORK) {
    const reference = usdc();
    const market: NonNullable<BuybackChainClient["market"]> = {
      async fill(terms): Promise<FillState> {
        if (
          terms.takeToken.toLowerCase() !== ROBINHOOD_USDG ||
          BigInt(terms.takeChainId) !== ROBINHOOD_CHAIN_ID ||
          terms.receiver.toLowerCase() !== wallet
        )
          throw new Error("Bridge order does not deliver to this fee wallet");
        const block = await finalizedBlock();
        const [status] = await client.readContract({
          address: DLN.destination as Address,
          abi: DLN_DESTINATION_ABI,
          functionName: "takeOrders",
          args: [terms.orderId as Hex],
          blockNumber: block.number,
        });
        if (
          status === TAKE_STATUS.fulfilled ||
          status === TAKE_STATUS.sentUnlock
        )
          return {
            state: "arrived",
            evidence: { block: Number(block.number), blockHash: block.hash },
          };
        return status === TAKE_STATUS.sentCancel
          ? { state: "cancelling" }
          : { state: "open" };
      },

      async quoteBuy(token, amount) {
        if (token.toLowerCase() === SLOP_TOKEN)
          throw new Error("SLOP is never an input of its own purchase");
        const quote = await quoteTo(
          token,
          amount,
          SLOP_TOKEN,
          buyback.limits.maxSlippageBps,
        );
        if ("noRoute" in quote) return quote;
        // The input's own stablecoin value bounds the caps and the gas check.
        let valueMicro = amount;
        if (token.toLowerCase() !== reference) {
          const valued = await self.quote(token, amount);
          if ("noRoute" in valued)
            return { noRoute: `value unavailable: ${valued.noRoute}` };
          valueMicro = valued.amountOut;
        }
        return { ...quote, valueMicro };
      },

      prepareBuy: (token, quote: BuyQuote, nonceFloor, assertLease) =>
        prepareSwap(
          token,
          quote,
          SLOP_TOKEN,
          buyback.limits.maxSlippageBps,
          quote.valueMicro,
          nonceFloor,
          assertLease,
        ).then((prepared) => ({
          ...prepared,
          kind: prepared.kind === "approval" ? "approval" : "buyback",
        })),

      async quoteBurn(amount): Promise<BurnQuote | { blocked: string }> {
        if (
          await client.readContract({
            address: SLOP_TOKEN as Address,
            abi: PAUSED_ABI,
            functionName: "paused",
          })
        )
          return { blocked: "SLOP transfers are paused" };
        const data = burnCalldata(amount);
        const simulated = await client
          .call({ account: wallet, to: SLOP_TOKEN as Address, data })
          .catch(() => null);
        if (
          !simulated?.data ||
          !decodeFunctionResult({
            abi: erc20Abi,
            functionName: "transfer",
            data: simulated.data,
          })
        )
          return { blocked: "burn transfer simulation failed" };
        const valued = await self.quote(SLOP_TOKEN, amount);
        if ("noRoute" in valued)
          return { blocked: `burn value unavailable: ${valued.noRoute}` };
        const gas = await client.estimateGas({
          account: wallet,
          to: SLOP_TOKEN as Address,
          data,
        });
        return {
          valueMicro: valued.amountOut,
          gasCostMicro: await gasMicro((gas * 13n) / 10n),
        };
      },

      async prepareBurn(amount, quote, nonceFloor, assertLease) {
        if (!account)
          throw new Error("Signing is disabled without a fee-wallet key");
        const nonce = await freeNonce(nonceFloor);
        const signed = await signAndSend(
          SLOP_TOKEN as Address,
          burnCalldata(amount),
          nonce,
          quote.valueMicro,
          assertLease,
        );
        return {
          kind: "burn",
          txId: signed.hash,
          rawTx: signed.raw,
          evmNonce: nonce,
          expiresAt: null,
          approvalTxId: null,
          minAmountOut: 0n,
          nativeGasId: signed.nativeGasId,
        };
      },
    };
    self.buyback = { market };
  }
  return self;
}
