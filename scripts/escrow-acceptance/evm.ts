/**
 * EVM leg of the section 21 acceptance runner (Base Sepolia, Ethereum Sepolia,
 * Robinhood Chain Testnet). Test keys sign the owner, depositor and registrar
 * transactions; the production executor and identity attester (in-process
 * PaymentSignerJournal instances) bind and pay through the real dispatch path.
 */
import { createHash } from "node:crypto";
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import {
  buildClaimFeesCalldata,
  buildCommitAwardCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildWithdrawCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  evmAwardId,
  type evmBindingTypedData,
  evmVaultKey,
  readVaultTotals,
} from "../../contracts/evm/adapter";
import { captureUpgrade } from "../../contracts/evm/integration/upgrade";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "../../src/lib/escrow-policy.mjs";
import { isWalletChain } from "../../src/lib/wallets";
import { PaymentSignerJournal } from "../../workers/payment-executor/index";
import type {
  PaymentDeployment,
  PaymentsWorkerEnvironment,
} from "../../workers/payments/index";
import {
  type AcceptanceNetwork,
  AcceptanceRegistry,
  type AssetEvidence,
  amountsText,
  assertEvmTestChain,
  type Evidence,
  evmKey,
  type Fetcher,
  jsonRpc,
  loadEvidence,
  newEvidence,
  Projection,
  RpcError,
  reconcile,
  replayDispatch,
  requireEnv,
  runPaymentsCron,
  type ScenarioAmounts,
  type StepRecord,
  type Suite,
  saveEvidence,
  scenarioAmounts,
  sha256Text,
  type TestActor,
  testActor,
  unitDivisor,
  untilReady,
  Waiting,
  waitPolicy,
} from "./shared";

export const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address,uint256) returns (bool)",
]);
export const FACTORY = parseAbi([
  "function registrar() view returns (address)",
  "function identityAuthority() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function bindingDelay() view returns (uint64)",
  "function vaults(bytes32) view returns (address)",
  "function create(bytes32,address,uint8) returns (address)",
  "function pendingIdentityAuthority() view returns (address)",
  "function upgradeAuthority() view returns (address)",
  "function vaultImplementation() view returns (address)",
  "function proposeIdentityAuthority(address)",
  "function executeIdentityAuthorityRotation()",
  "event IdentityAuthorityRotationProposed(address indexed current, address indexed proposed, uint64 effectiveAt)",
  "event IdentityAuthorityRotated(address indexed previous, address indexed current)",
]);
export const VAULT = parseAbi([
  "function awards(bytes32) view returns (uint64 actorId,uint128 gross,uint128 fee,bytes32 sourceDigest,uint64 committedAt,bool paid)",
  "function bindings(uint64) view returns (address destination,uint64 version,bytes32 claimDigest,uint64 activatesAt,bool cancelled)",
  "function payableBinding(uint64) view returns (address destination,uint64 version)",
  "function purpose() view returns (uint8)",
  "function identityAuthority() view returns (address)",
  "function monthlyReserveVersion() view returns (uint8)",
  "function bindingDelay() view returns (uint64)",
  "function freeBalance() view returns (uint128)",
  "function accruedFees() view returns (uint128)",
  "function monthlyCap() view returns (uint128)",
  "function monthlyEnabled() view returns (bool)",
  "function monthlyRoots(uint32) view returns (bytes32)",
  "function monthlyWindow(uint32) view returns (uint64 opensAt,uint64 closesAt)",
  "function setMonthlyCommitment(uint128,bool)",
  "function totals() view returns (uint128 deposited,uint128 paid,uint128 payoutFees,uint128 grossWithdrawn,uint128 withdrawalFees,uint128 free,uint128 principalReserved,uint128 feesReserved,uint128 feesAccrued,uint256 balance)",
  "event Deposited(address indexed depositor, uint128 amount)",
  "event AwardCommitted(bytes32 indexed id, uint64 indexed actorId, uint128 gross, uint128 fee, bytes32 sourceDigest)",
  "event DestinationBound(uint64 indexed actorId, address indexed destination, uint64 version, bytes32 claimDigest, uint64 activatesAt)",
  "event BindingCancelled(uint64 indexed actorId, uint64 version)",
  "event Paid(bytes32 indexed id, uint64 indexed actorId, address indexed destination, uint64 version, uint128 gross, uint128 net, uint128 fee)",
  "event UnusedWithdrawn(address indexed destination, uint128 gross, uint128 net, uint128 fee)",
  "event FeesClaimed(address indexed feeRecipient, uint128 amount)",
  "event MonthlyCommitmentSet(uint128 cap, bool enabled)",
  "event MonthlyCommitted(uint32 indexed period, bytes32 allocationRoot, uint128 gross, uint256 awards)",
  "event MonthlyReserved(uint32 indexed period, bytes32 allocationDigest, bytes32 allocationRoot, uint128 wholeGross, uint128 remainingGross, uint32 count, uint256 sourceSequence)",
  "error Unauthorized()",
  "error InvalidInput()",
  "error InsufficientFreeBalance()",
  "error DuplicateAward()",
  "error InvalidBinding()",
  "error TransferFailed()",
  "error ReentrantCall()",
  "error WrongPurpose()",
  "error MonthlyDisabled()",
  "error MonthlyWindowClosed()",
  "error MonthlyAlreadyCommitted()",
  "error MonthlyCapExceeded()",
  "error InvalidAttestation()",
  "error AwardPending()",
  "error CancelLimit()",
  "error InvalidWalletSignature()",
  "error MonthlySourceChanged()",
  "error InvalidAllocationProof()",
  "error MonthExpired()",
]);
export const ZERO = "0x0000000000000000000000000000000000000000";

export interface Receipt {
  status: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logs: { address: string; topics: Hex[]; data: Hex }[];
}

/** JSON-RPC, signing and receipts on one EVM test chain. Raw bytes are saved before broadcast. */
export class EvmChain {
  constructor(
    readonly rpcUrl: string,
    readonly chainId: number,
    private readonly persist: () => Promise<void>,
  ) {}
  rpc(method: string, params: unknown[]) {
    return jsonRpc(this.rpcUrl, method, params);
  }
  async read<T>(
    to: string,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[] = [],
    block: string = "latest",
  ): Promise<T> {
    const data = encodeFunctionData({
      abi,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]);
    const result = (await this.rpc("eth_call", [{ to, data }, block])) as Hex;
    return decodeFunctionResult({
      abi,
      functionName,
      data: result,
    } as Parameters<typeof decodeFunctionResult>[0]) as T;
  }
  balance(token: string, owner: string, block = "latest") {
    return this.read<bigint>(token, ERC20, "balanceOf", [owner], block);
  }
  async latestTime(): Promise<bigint> {
    const block = (await this.rpc("eth_getBlockByNumber", [
      "latest",
      false,
    ])) as { timestamp: string };
    return BigInt(block.timestamp);
  }
  async finalizedNumber(): Promise<bigint> {
    const block = (await this.rpc("eth_getBlockByNumber", [
      "finalized",
      false,
    ])) as { number: string } | null;
    if (!block) throw new Error("RPC serves no finalized block");
    return BigInt(block.number);
  }
  async receipt(hash: string): Promise<Receipt | null> {
    return (await this.rpc("eth_getTransactionReceipt", [
      hash,
    ])) as Receipt | null;
  }
  /** A mined transaction is not acceptance until its canonical block is final. */
  async finalizeSteps(steps: Record<string, StepRecord>) {
    const finalized = await this.finalizedNumber();
    const transactions: Record<string, string> = {};
    for (const [key, step] of Object.entries(steps)) {
      const receipt = await this.receipt(step.transactionId);
      if (!receipt || BigInt(receipt.blockNumber) > finalized)
        throw new Waiting(`${key}: ${step.transactionId} is not finalized`);
      const block = (await this.rpc("eth_getBlockByNumber", [
        receipt.blockNumber,
        false,
      ])) as { hash: string } | null;
      if (
        !block ||
        block.hash !== receipt.blockHash ||
        receipt.transactionHash.toLowerCase() !==
          step.transactionId.toLowerCase() ||
        BigInt(receipt.blockNumber).toString() !== step.block ||
        (receipt.status === "0x1" ? "success" : "reverted") !== step.status
      )
        throw new Error(
          `${key}: finalized receipt differs from the saved evidence`,
        );
      transactions[step.transactionId] = receipt.blockHash;
    }
    return { block: finalized.toString(), transactions };
  }
  /** Simulates a call that must revert and returns the node's reason. */
  async mustRevert(
    from: string,
    to: string,
    data: string,
    block = "latest",
  ): Promise<string> {
    try {
      await this.rpc("eth_call", [{ from, to, data }, block]);
    } catch (error) {
      if (!(error instanceof RpcError) || !error.reverted) throw error;
      // Name the custom error when the node returns the revert data.
      if (
        typeof error.data === "string" &&
        /^0x[0-9a-fA-F]{8}/.test(error.data)
      )
        try {
          return decodeErrorResult({ abi: VAULT, data: error.data as Hex })
            .errorName;
        } catch {
          return error.message;
        }
      return error.message;
    }
    throw new Error(`Call to ${to} succeeded but must revert`);
  }
  /**
   * Sends one keyed transaction. A rerun finds the stored signed bytes and
   * rebroadcasts them, so a step never signs a second transaction.
   */
  async send(
    steps: Record<string, StepRecord>,
    key: string,
    account: PrivateKeyAccount,
    to: string,
    data: Hex,
    options: { gas?: bigint; expect?: "success" | "reverted" } = {},
  ): Promise<Receipt> {
    const expect = options.expect ?? "success";
    let record = steps[key];
    if (!record) {
      const nonce = Number(
        BigInt(
          (await this.rpc("eth_getTransactionCount", [
            account.address,
            "pending",
          ])) as string,
        ),
      );
      const block = (await this.rpc("eth_getBlockByNumber", [
        "latest",
        false,
      ])) as { baseFeePerGas: string };
      const priority = BigInt(
        (await this.rpc("eth_maxPriorityFeePerGas", [])) as string,
      );
      const gas =
        options.gas ??
        (BigInt(
          (await this.rpc("eth_estimateGas", [
            { from: account.address, to, data },
          ])) as string,
        ) *
          12n) /
          10n;
      const raw = await account.signTransaction({
        type: "eip1559",
        chainId: this.chainId,
        nonce,
        gas,
        maxFeePerGas: BigInt(block.baseFeePerGas) * 2n + priority,
        maxPriorityFeePerGas: priority,
        to: to as Hex,
        data,
        value: 0n,
      });
      record = { transactionId: keccak256(raw), raw, from: account.address };
      steps[key] = record;
      await this.persist();
    }
    let receipt = await this.receipt(record.transactionId);
    if (!receipt) {
      try {
        await this.rpc("eth_sendRawTransaction", [record.raw]);
      } catch (error) {
        if (
          !(await this.rpc("eth_getTransactionByHash", [record.transactionId]))
        )
          throw new Error(
            `${key}: broadcast failed and the node does not know ${record.transactionId}: ${error instanceof Error ? error.message : error}`,
          );
      }
      for (let i = 0; i < 90 && !receipt; i++) {
        await Bun.sleep(1000);
        receipt = await this.receipt(record.transactionId);
      }
      if (!receipt)
        throw new Waiting(`${key}: ${record.transactionId} is not mined yet`);
    }
    record.status = receipt.status === "0x1" ? "success" : "reverted";
    record.block = BigInt(receipt.blockNumber).toString();
    await this.persist();
    if (record.status !== expect)
      throw new Error(`${key}: ${record.transactionId} ${record.status}`);
    return receipt;
  }
}

export const codeSha256 = async (chain: EvmChain, address: string) =>
  createHash("sha256")
    .update(
      Buffer.from(
        ((await chain.rpc("eth_getCode", [address, "latest"])) as string).slice(
          2,
        ),
        "hex",
      ),
    )
    .digest("hex");

/** The typed data the account API returns, in the shape viem signs. */
export function signBinding(
  account: PrivateKeyAccount,
  typedData: ReturnType<typeof evmBindingTypedData>,
) {
  const { EIP712Domain: _domain, ...types } = typedData.types;
  return account.signTypedData({
    domain: {
      ...typedData.domain,
      chainId: Number(typedData.domain.chainId),
      verifyingContract: typedData.domain.verifyingContract as Hex,
    },
    types,
    primaryType: typedData.primaryType,
    message: {
      actorId: BigInt(typedData.message.actorId),
      destination: typedData.message.destination as Hex,
      expectedVersion: BigInt(typedData.message.expectedVersion),
      claimDigest: typedData.message.claimDigest as Hex,
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
}

/**
 * The keys, chain identity, factory roles and evidence file of one EVM run.
 * Nothing signs before the RPC chain id is the named test network and the
 * factory's registrar and identity authority are the configured test keys.
 */
export async function openEvmRun(
  network: AcceptanceNetwork,
  directory: string,
  suite: Suite,
) {
  const policy = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS];
  if (policy?.family !== "evm")
    throw new Error(`${network} is not an EVM network`);
  // Automatic payouts need a registered payout wallet on this chain.
  if (!isWalletChain(policy.chain))
    throw new Error(
      `The account API does not accept ${policy.chain} payout wallets (WALLET_CHAINS in src/lib/wallets.ts), so ${network} cannot complete the registered-wallet payout`,
    );
  const rpcUrl = requireEnv("ESCROW_ACCEPTANCE_RPC_URL");
  const factory = requireEnv("ESCROW_ACCEPTANCE_FACTORY").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(factory))
    throw new Error("Factory and asset addresses must be EVM addresses");
  const keys = {
    registrar: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_REGISTRAR_KEY")),
    owner: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_OWNER_KEY")),
    depositor: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_DEPOSITOR_KEY")),
    relayer: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_RELAYER_KEY")),
    registered: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_ACTOR_A_KEY")),
    walletless: privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_ACTOR_B_KEY")),
  };
  const identityKey = evmKey("ESCROW_ACCEPTANCE_IDENTITY_KEY");
  const identity = privateKeyToAccount(identityKey);
  const relayerKey = evmKey("ESCROW_ACCEPTANCE_RELAYER_KEY");
  const addresses = [...Object.values(keys), identity].map((k) =>
    k.address.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new Error("Every test role needs its own key");

  // Chain identity first: nothing signs before the chain id is a test chain.
  const chainId = assertEvmTestChain(
    network,
    BigInt((await jsonRpc(rpcUrl, "eth_chainId", [])) as string),
  );
  let evidence = await loadEvidence(directory);
  const persist = async () => {
    if (evidence) await saveEvidence(directory, evidence);
  };
  const chain = new EvmChain(rpcUrl, Number(chainId), persist);
  const [registrar, identityAuthority, feeRecipient, bindingDelay] =
    await Promise.all([
      chain.read<string>(factory, FACTORY, "registrar"),
      chain.read<string>(factory, FACTORY, "identityAuthority"),
      chain.read<string>(factory, FACTORY, "feeRecipient"),
      chain.read<bigint>(factory, FACTORY, "bindingDelay"),
    ]);
  if (registrar.toLowerCase() !== keys.registrar.address.toLowerCase())
    throw new Error(
      "ESCROW_ACCEPTANCE_REGISTRAR_KEY is not the factory registrar",
    );
  // Extended suite only: the key-recovery scenario rotates the factory
  // identity authority to this key and back. A run interrupted between the
  // two rotations resumes with the recovery key in force.
  const recovery =
    suite === "extended" && process.env.ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY
      ? privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY"))
      : null;
  if (recovery && addresses.includes(recovery.address.toLowerCase()))
    throw new Error("Every test role needs its own key");
  const identityRotated =
    recovery !== null &&
    identityAuthority.toLowerCase() === recovery.address.toLowerCase();
  if (
    identityAuthority.toLowerCase() !== identity.address.toLowerCase() &&
    !identityRotated
  )
    throw new Error(
      "ESCROW_ACCEPTANCE_IDENTITY_KEY is not the factory identity authority",
    );
  const factoryCodeSha256 = await codeSha256(chain, factory);
  const reviewedFactoryCode = process.env.ESCROW_ACCEPTANCE_FACTORY_CODE_SHA256;
  if (reviewedFactoryCode && reviewedFactoryCode !== factoryCodeSha256)
    throw new Error("Factory runtime code differs from the reviewed digest");
  const roles = {
    factory,
    registrar: keys.registrar.address.toLowerCase(),
    owner: keys.owner.address.toLowerCase(),
    refundDestination: keys.owner.address.toLowerCase(),
    depositor: keys.depositor.address.toLowerCase(),
    identityAuthority: identity.address.toLowerCase(),
    relayer: keys.relayer.address.toLowerCase(),
    feeRecipient: feeRecipient.toLowerCase(),
    // The extended suite's dedicated keeper gas wallet, when supplied.
    ...(process.env.ESCROW_ACCEPTANCE_KEEPER_KEY
      ? {
          keeper: privateKeyToAccount(
            evmKey("ESCROW_ACCEPTANCE_KEEPER_KEY"),
          ).address.toLowerCase(),
        }
      : {}),
  };
  if (!evidence) {
    evidence = newEvidence({
      network,
      rpcUrl,
      suite,
      chain: {
        chainId,
        startedAtBlock: BigInt(
          (await chain.rpc("eth_blockNumber", [])) as string,
        ).toString(),
        factoryCodeSha256,
        factoryCodeDigestSource: reviewedFactoryCode
          ? "reviewed (ESCROW_ACCEPTANCE_FACTORY_CODE_SHA256)"
          : "observed on chain",
        bindingDelaySeconds: bindingDelay.toString(),
      },
      roles,
      actors: {
        registered: keys.registered.address.toLowerCase(),
        walletless: keys.walletless.address.toLowerCase(),
      },
      runId: process.env.ESCROW_ACCEPTANCE_RUN_ID,
    });
    await persist();
  } else if (
    evidence.network !== network ||
    (evidence.suite ?? "section-21") !== suite ||
    evidence.chain.chainId !== chainId ||
    JSON.stringify(evidence.roles) !== JSON.stringify(roles)
  )
    throw new Error(
      "The evidence directory belongs to another network, suite, factory or key set",
    );
  const run = evidence;
  run.status = "running";
  run.waiting = null;
  return {
    network,
    policy,
    rpcUrl,
    factory,
    keys,
    identity,
    identityKey,
    relayerKey,
    recovery,
    identityRotated,
    chainId,
    chain,
    feeRecipient: feeRecipient.toLowerCase(),
    bindingDelay,
    factoryCodeSha256,
    run,
    persist,
  };
}
export type EvmRun = Awaited<ReturnType<typeof openEvmRun>>;

/**
 * The local backend of one run: the projection, the project registry the
 * payments Worker reads, and the production executor roles, each with its own
 * durable journal and key. `restart` replaces the signer instances, as a
 * Worker restart does; the journals stay on disk.
 */
export function evmServices(
  ctx: EvmRun,
  directory: string,
  projects: () => {
    projectId: string;
    effectiveCycle: string;
    deployment: EscrowDeployment;
  }[],
  rpcUrl = ctx.rpcUrl,
) {
  const projection = new Projection(directory);
  // The dispatcher finds each vault in the project registry, as in
  // production; only the signer roles keep a pinned deployment list.
  const registry = new AcceptanceRegistry(directory);
  const env: PaymentsWorkerEnvironment = {
    PAYMENTS_DB: projection.db,
    REGISTRY_DB: registry.db,
    PAYMENT_NETWORKS: JSON.stringify([ctx.network]),
    PAYMENT_RPC_URLS: JSON.stringify({ [ctx.network]: rpcUrl }),
  };
  let pinnedDeployments = "[]";
  const refresh = () => {
    pinnedDeployments = JSON.stringify(registry.record(projects()));
  };
  const signer = (
    role: "attester" | "relayer",
    key: Hex,
    attester?: Fetcher,
  ): Fetcher => {
    let instance: PaymentSignerJournal | undefined;
    const namespace = {
      idFromName: (name: string) => name,
      get: () => {
        if (!instance) throw new Error("Signer journal not ready");
        return instance;
      },
    };
    instance = new PaymentSignerJournal(
      { storage: projection.journal(role) },
      {
        get PAYMENTS_DB() {
          return env.PAYMENTS_DB;
        },
        get PAYMENT_DEPLOYMENTS() {
          return pinnedDeployments;
        },
        get PAYMENT_RPC_URLS() {
          return env.PAYMENT_RPC_URLS;
        },
        SIGNER_ROLE: role,
        CHAIN_FAMILY: "evm",
        TEST_SIGNER_PRIVATE_KEY: key,
        JOURNAL: namespace,
        IDENTITY_ATTESTER: attester,
      },
    );
    return instance;
  };
  const services = {
    projection,
    registry,
    env,
    refresh,
    attester: signer("attester", ctx.identityKey),
    relayer: undefined as unknown as Fetcher,
    relayerJournal: projection.journal("relayer"),
    attesterJournal: projection.journal("attester"),
    restart() {
      services.attester = signer("attester", ctx.identityKey);
      services.relayer = signer("relayer", ctx.relayerKey, services.attester);
      env.EVM_PAYMENT_EXECUTOR = services.relayer;
    },
  };
  services.restart();
  return services;
}

/**
 * Registers an actor's payout wallet through the account API and signs the
 * vault binding challenge with the wallet, as a contributor does on the
 * account page. The identity attester then binds it during dispatch.
 */
export async function registerEvmWallet(input: {
  projection: Projection;
  actor: TestActor;
  chain: string;
  network: AcceptanceNetwork;
  vault: string;
  wallet: PrivateKeyAccount;
  deps: { paymentDeployments: PaymentDeployment[] | object[] };
}) {
  const { projection, actor, wallet, network, vault } = input;
  const deps = input.deps as never;
  const claim = await projection.registerWallet(
    actor,
    input.chain,
    wallet.address.toLowerCase(),
    (message) => wallet.signMessage({ message }),
    deps,
  );
  const authorized = projection.sqlite
    .query<{ n: number }, [string, string]>(
      "SELECT count(*) n FROM payment_binding_authorizations WHERE claim_id=? AND vault=?",
    )
    .get(claim.claimId, vault);
  if (!authorized?.n) {
    const challenge = await projection.api(
      actor,
      "/wallets/bind-challenge",
      { claimId: claim.claimId, network, vault, expectedVersion: "0" },
      deps,
    );
    const typedData = challenge.typedData as ReturnType<
      typeof evmBindingTypedData
    >;
    await projection.api(
      actor,
      "/wallets/bind-authorize",
      {
        claimId: claim.claimId,
        network,
        vault,
        expectedVersion: "0",
        expiresAt: typedData.message.expiresAt,
        signature: await signBinding(wallet, typedData),
      },
      deps,
    );
  }
  return claim;
}

/** The escrow deployment an admin revision records in project.json for one vault. */
export async function evmDeploymentRecord(
  ctx: EvmRun,
  vault: string,
  asset: string,
  deploymentTransaction: string,
): Promise<EscrowDeployment> {
  return {
    network: ctx.network as EscrowDeployment["network"],
    vault,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    asset,
    owner: ctx.keys.owner.address.toLowerCase(),
    identityAuthority: ctx.identity.address.toLowerCase(),
    feeRecipient: ctx.feeRecipient,
    deploymentTransaction,
    sourceCommit: ctx.run.sourceCommit,
    codeSha256: await codeSha256(ctx.chain, vault),
    bindingDelaySeconds: ctx.bindingDelay.toString(),
    rotationDelaySeconds: null,
    factory: ctx.factory,
    factoryCodeSha256: ctx.factoryCodeSha256,
    evmUpgrade: await captureUpgrade(
      (method, params) => jsonRpc(ctx.rpcUrl, method, params),
      ctx.factory,
      vault,
    ),
    registrar: ctx.keys.registrar.address.toLowerCase(),
  };
}

export async function runEvm(
  network: AcceptanceNetwork,
  directory: string,
): Promise<Evidence> {
  const ctx = await openEvmRun(network, directory, "section-21");
  const { policy, rpcUrl, factory, keys, identity, chainId, chain, run } = ctx;
  const { persist, feeRecipient, bindingDelay } = ctx;
  const assets = requireEnv("ESCROW_ACCEPTANCE_ASSETS")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (!assets.length || assets.some((asset) => !/^0x[0-9a-f]{40}$/.test(asset)))
    throw new Error("Factory and asset addresses must be EVM addresses");
  // A resume must keep every recorded asset. Otherwise an omitted asset stays
  // unfinished while the run reports passed.
  if (assets.length < run.assets.length)
    throw new Error("Asset list changed since the run started");
  const divisor = unitDivisor();
  const services = evmServices(ctx, directory, () =>
    run.assets
      .filter((a) => a.vault)
      .map((a) => ({
        projectId: a.projectId,
        effectiveCycle: run.startedAt.slice(0, 7),
        deployment: a.deployment as unknown as EscrowDeployment,
      })),
  );
  const { projection, env, relayerJournal, attesterJournal } = services;
  const refreshDeployments = services.refresh;
  const relayer = services.relayer;
  const policyWait = waitPolicy();
  const deadline = Date.now() + policyWait.maxWaitMs;
  const report = (reason: string) => {
    console.log(`[${network}] waiting: ${reason}`);
  };

  try {
    for (const [index, asset] of assets.entries()) {
      const decimals = Number(
        await chain.read<number>(asset, ERC20, "decimals"),
      );
      const amounts = scenarioAmounts(decimals, divisor);
      let entry = run.assets[index];
      if (!entry) {
        const onchainProjectId = `0x${sha256Text(`slop-escrow-acceptance:${run.runId}:${network}:${asset}`)}`;
        entry = {
          address: asset,
          decimals,
          referenceStablecoin: policy.assets.some(
            (known) => known.address.toLowerCase() === asset,
          ),
          amounts: amountsText(amounts),
          projectId: `acceptance-${run.runId.slice(0, 8)}-${index}`,
          onchainProjectId,
          vault: null,
          deployment: {},
          steps: {},
          checks: {},
          status: "pending",
        };
        run.assets.push(entry);
        await persist();
      } else if (entry.address !== asset)
        throw new Error("Asset list changed since the run started");
      if (entry.status === "passed") continue;
      await runAsset({
        index,
        entry,
        amounts,
        decimals,
      });
    }
    const covered = run.assets.map((a) => a.decimals);
    if (!covered.some((d) => d !== 6))
      throw new Error(
        "Section 21 needs a token without six decimals in ESCROW_ACCEPTANCE_ASSETS",
      );
    if (!run.assets.some((a) => a.referenceStablecoin)) {
      const note = `No asset is the ${network} reference stablecoin (${policy.assets.map((a) => `${a.symbol} ${a.address}`).join(", ")}); this run is not ${policy.assets[0]?.symbol ?? "stablecoin"} evidence.`;
      if (!run.deviations.includes(note)) run.deviations.push(note);
    }
    if (!run.assets.every((a) => a.amounts.fullScale === true)) {
      const note =
        "ESCROW_ACCEPTANCE_UNIT_DIVISOR scaled the section 21 figures down; the run is not at 1,000-unit scale.";
      if (!run.deviations.includes(note)) run.deviations.push(note);
    }
    run.status = "passed";
    run.waiting = null;
  } catch (error) {
    if (error instanceof Waiting) {
      run.status = "waiting";
      run.waiting = {
        reason: error.message,
        until: error.until?.toISOString() ?? null,
      };
    } else {
      run.status = "failed";
      run.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  await persist();
  return run;

  async function runAsset(input: {
    index: number;
    entry: AssetEvidence;
    amounts: ScenarioAmounts;
    decimals: number;
  }) {
    const { index, entry, amounts } = input;
    const steps = entry.steps;
    const asset = entry.address;
    const ready = <T>(step: () => Promise<T>) =>
      untilReady(step, policyWait, deadline, report);
    const send = (
      key: string,
      account: PrivateKeyAccount,
      to: string,
      data: Hex,
      options?: { gas?: bigint; expect?: "success" | "reverted" },
    ) => ready(() => chain.send(steps, key, account, to, data, options));

    // 1. The owner creates its own ordinary vault for this run and asset.
    const vaultKey = evmVaultKey({
      owner: keys.owner.address,
      projectId: entry.onchainProjectId,
      asset,
    });
    let vault = (
      await chain.read<string>(factory, FACTORY, "vaults", [vaultKey])
    ).toLowerCase();
    if (vault === ZERO) {
      if (steps["create-vault"]?.status === "success")
        throw new Error("Recorded vault creation is missing from the factory");
      await send(
        "create-vault",
        keys.owner,
        factory,
        encodeFunctionData({
          abi: FACTORY,
          functionName: "create",
          args: [entry.onchainProjectId as Hex, asset as Hex, 0],
        }),
      );
      vault = (
        await chain.read<string>(factory, FACTORY, "vaults", [vaultKey])
      ).toLowerCase();
    }
    if (!steps["create-vault"])
      throw new Error("Vault exists without a recorded creation transaction");
    if (!entry.vault) {
      entry.vault = vault;
      // The escrow deployment an admin revision records in project.json.
      const deployment = await evmDeploymentRecord(
        ctx,
        vault,
        asset,
        steps["create-vault"].transactionId,
      );
      entry.deployment = { ...deployment };
      await persist();
    }
    refreshDeployments();
    const deps = {
      paymentDeployments: run.assets
        .filter((a) => a.vault)
        .map((a) => ({
          network,
          chain: policy.chain,
          vault: a.vault as string,
          chainId,
        })),
    };

    // 2. Fund 1,000 units: 900 from the owner and 100 from a third party.
    for (const [role, account, amount] of [
      ["owner", keys.owner, amounts.ownerDeposit],
      ["third-party", keys.depositor, amounts.thirdPartyDeposit],
    ] as const) {
      if (!steps[`deposit-${role}`]) {
        const held = await chain.balance(asset, account.address);
        if (held < amount && !steps[`approve-${role}`])
          throw new Error(
            `${role} ${account.address} holds ${held} of ${asset}; it needs ${amount} base units`,
          );
        await send(
          `approve-${role}`,
          account,
          asset,
          encodeFunctionData({
            abi: ERC20,
            functionName: "approve",
            args: [vault as Hex, amount],
          }),
        );
      }
      const receipt = await send(
        `deposit-${role}`,
        account,
        vault,
        buildDepositCalldata(amount) as Hex,
      );
      const deposited = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === vault &&
          log.topics[0] === EVM_ESCROW_EVENT_TOPICS.Deposited,
      );
      if (!deposited) throw new Error(`deposit-${role}: no Deposited event`);
      const event = decodeEventLog({
        abi: VAULT,
        eventName: "Deposited",
        topics: deposited.topics as [Hex, ...Hex[]],
        data: deposited.data,
      });
      if (
        event.args.depositor.toLowerCase() !== account.address.toLowerCase() ||
        event.args.amount !== amount
      )
        throw new Error(`deposit-${role}: Deposited event mismatch`);
      entry.checks[`deposited-${role}`] = {
        depositor: event.args.depositor.toLowerCase(),
        amount: event.args.amount.toString(),
      };
    }

    // 3. Approve 100 for the registered actor and 50 for the walletless actor.
    const actors = {
      registered: testActor("registered", index),
      walletless: testActor("walletless", index),
    };
    const awards = {} as Record<
      "registered" | "walletless",
      { id: string; source: string; gross: bigint; net: bigint; fee: bigint }
    >;
    for (const [role, gross, net, fee] of [
      ["registered", amounts.awardA, amounts.netA, amounts.feeA],
      ["walletless", amounts.awardB, amounts.netB, amounts.feeB],
    ] as const) {
      const source = `0x${sha256Text(`${entry.onchainProjectId}:award:${role}`)}`;
      const id = evmAwardId(BigInt(chainId), vault, source);
      awards[role] = { id, source, gross, net, fee };
      await send(
        `commit-${role}`,
        keys.owner,
        vault,
        buildCommitAwardCalldata({
          obligationId: id,
          githubUserId: actors[role].githubUserId,
          grossMicro: gross,
          sourceDigest: source,
        }) as Hex,
      );
    }
    entry.checks.awards = Object.fromEntries(
      Object.entries(awards).map(([role, award]) => [
        role,
        {
          obligationId: award.id,
          githubUserId: actors[role as "registered"].githubUserId,
          gross: award.gross.toString(),
          net: award.net.toString(),
          fee: award.fee.toString(),
          sourceDigest: award.source,
        },
      ]),
    );
    // The 150 reserved (98 + 2 and 49 + 1) cannot be withdrawn.
    if (!entry.checks.reservedNotWithdrawable)
      entry.checks.reservedNotWithdrawable = {
        attemptedGross: (amounts.withdrawGross + 1n).toString(),
        revert: await chain.mustRevert(
          keys.owner.address,
          vault,
          buildWithdrawCalldata(amounts.withdrawGross + 1n),
        ),
      };
    await persist();

    // 4-5. Register each actor through the account API, then let the cron
    // dispatch: the attester binds, the relayer pays after both delays.
    for (const role of ["registered", "walletless"] as const) {
      await payThroughDispatch(role, actors[role], awards[role], deps, vault);
    }

    // 6. Replay dispatch: no second attempt, no second transfer.
    await replay(awards, actors, vault);

    // 7. Withdraw the 850 free units: 2% to fees, the rest to the owner.
    if (!entry.checks.withdrawal) {
      const before = await chain.balance(asset, keys.owner.address);
      const receipt = await send(
        "withdraw-unused",
        keys.owner,
        vault,
        buildWithdrawCalldata(amounts.withdrawGross) as Hex,
      );
      const after = BigInt(
        await chain.balance(asset, keys.owner.address, receipt.blockNumber),
      );
      const log = receipt.logs.find(
        (l) =>
          l.address.toLowerCase() === vault &&
          l.topics[0] === EVM_ESCROW_EVENT_TOPICS.UnusedWithdrawn,
      );
      if (!log) throw new Error("withdraw-unused: no UnusedWithdrawn event");
      const event = decodeEventLog({
        abi: VAULT,
        eventName: "UnusedWithdrawn",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      const beforeAtParent = await chain.balance(
        asset,
        keys.owner.address,
        `0x${(BigInt(receipt.blockNumber) - 1n).toString(16)}`,
      );
      entry.checks.withdrawal = {
        gross: event.args.gross.toString(),
        fee: event.args.fee.toString(),
        net: event.args.net.toString(),
        destination: event.args.destination.toLowerCase(),
        ownerBalanceDelta: (after - beforeAtParent).toString(),
        observedBefore: before.toString(),
      };
      if (
        event.args.gross !== amounts.withdrawGross ||
        event.args.fee !== amounts.withdrawFee ||
        event.args.net !== amounts.withdrawGross - amounts.withdrawFee ||
        event.args.destination.toLowerCase() !==
          keys.owner.address.toLowerCase() ||
        after - beforeAtParent !== amounts.withdrawGross - amounts.withdrawFee
      )
        throw new Error("Withdrawal did not pay ceil(gross / 50) as the fee");
      await persist();
    }
    if (!entry.checks.overWithdrawal)
      entry.checks.overWithdrawal = {
        attemptedGross: "1",
        revert: await chain.mustRevert(
          keys.owner.address,
          vault,
          buildWithdrawCalldata(1n),
        ),
      };

    // Fees accrue in the vault; anyone moves them to the fee recipient.
    if (!entry.checks.feesClaimed) {
      const receipt = await send(
        "claim-fees",
        keys.depositor,
        vault,
        buildClaimFeesCalldata() as Hex,
      );
      const log = receipt.logs.find(
        (l) =>
          l.address.toLowerCase() === vault &&
          l.topics[0] === EVM_ESCROW_EVENT_TOPICS.FeesClaimed,
      );
      if (!log) throw new Error("claim-fees: no FeesClaimed event");
      const event = decodeEventLog({
        abi: VAULT,
        eventName: "FeesClaimed",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      const expected = amounts.feeA + amounts.feeB + amounts.withdrawFee;
      entry.checks.feesClaimed = {
        feeRecipient: event.args.feeRecipient.toLowerCase(),
        amount: event.args.amount.toString(),
        expected: expected.toString(),
      };
      if (
        event.args.amount !== expected ||
        event.args.feeRecipient.toLowerCase() !== feeRecipient.toLowerCase()
      )
        throw new Error("Claimed fees differ from 2 + 1 + the withdrawal fee");
      await persist();
    }

    // 8. The cached vault_snapshots row equals the finalized chain counters.
    const lastBlock = BigInt(steps["claim-fees"].block ?? "0");
    await ready(async () => {
      const finalized = await chain.finalizedNumber();
      if (finalized < lastBlock)
        throw new Waiting(
          `final transactions wait for finality (block ${lastBlock}, finalized ${finalized})`,
        );
    });
    await runPaymentsCron(env);
    const totals = await readVaultTotals({
      rpcUrl,
      network,
      vault,
      chainId: BigInt(chainId),
    });
    const vaultBalance = await chain.balance(
      asset,
      vault,
      `0x${BigInt(totals.blockNumber).toString(16)}`,
    );
    const result = await reconcile(projection, entry.projectId, totals, {
      totalDeposited: amounts.totalDeposit.toString(),
      totalPaid: (amounts.netA + amounts.netB).toString(),
      totalPayoutFees: (amounts.feeA + amounts.feeB).toString(),
      totalGrossWithdrawn: amounts.withdrawGross.toString(),
      totalWithdrawalFees: amounts.withdrawFee.toString(),
      freeBalance: "0",
      reservedPrincipal: "0",
      reservedFees: "0",
      accruedFees: "0",
      reserved: null,
    });
    entry.checks.reconciliation = {
      ...result,
      vaultTokenBalance: vaultBalance.toString(),
    };
    if (result.mismatches.length)
      throw new Error(`Reconciliation failed: ${result.mismatches.join("; ")}`);
    if (vaultBalance !== 0n)
      throw new Error(`Vault still holds ${vaultBalance} base units`);
    entry.status = "passed";
    await persist();
  }

  async function payThroughDispatch(
    role: "registered" | "walletless",
    actor: TestActor,
    award: { id: string; gross: bigint; net: bigint; fee: bigint },
    deps: { paymentDeployments: PaymentDeployment[] | object[] },
    vault: string,
  ) {
    const entry = run.assets.find((a) => a.vault === vault) as AssetEvidence;
    const key = `paid-${role}`;
    if (entry.checks[key]) return;
    const wallet = keys[role];
    // The walletless actor registers only after the first award is paid.
    if (role === "walletless" && !entry.checks["paid-registered"])
      throw new Error("Walletless actor must register after the first payment");
    const balanceKey = `${role}BalanceBefore`;
    if (entry.checks[balanceKey] === undefined) {
      entry.checks[balanceKey] = (
        await chain.balance(entry.address, wallet.address)
      ).toString();
      await persist();
    }
    const ready = <T>(step: () => Promise<T>) =>
      untilReady(step, policyWait, deadline, report);
    const claim = await registerEvmWallet({
      projection,
      actor,
      chain: policy.chain,
      network,
      vault,
      wallet,
      deps,
    });
    const cronErrors: string[] = [];
    await ready(async () => {
      const errors = await runPaymentsCron(env);
      cronErrors.splice(0, cronErrors.length, ...errors);
      if (projection.obligation(award.id)?.state === "paid") return;
      const [state, binding, now] = await Promise.all([
        chain.read<readonly [bigint, bigint, bigint, Hex, bigint, boolean]>(
          vault,
          VAULT,
          "awards",
          [award.id],
        ),
        chain.read<readonly [string, bigint, Hex, bigint, boolean]>(
          vault,
          VAULT,
          "bindings",
          [BigInt(actor.githubUserId)],
        ),
        chain.latestTime(),
      ]);
      const payableAt = state[4] + bindingDelay;
      const target =
        binding[1] === 0n
          ? payableAt
          : binding[3] > payableAt
            ? binding[3]
            : payableAt;
      const until =
        target > now
          ? new Date(Date.now() + Number(target - now) * 1000)
          : null;
      const phase = state[5]
        ? "paid on chain; ledger waits for finality"
        : binding[1] === 0n
          ? "binding not yet on chain"
          : target > now
            ? `binding and commit delays end at chain time ${target}`
            : "payment waits for the next dispatch or finality";
      throw new Waiting(
        `${role} award ${phase}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
        until,
      );
    });
    const obligation = projection.obligation(award.id);
    const attempt = projection
      .attempts(award.id)
      .find((a) => a.transaction_id === obligation?.paid_transaction);
    if (!obligation?.paid_transaction || !attempt)
      throw new Error(`${role}: paid obligation has no recorded attempt`);
    const payment = await chain.receipt(obligation.paid_transaction);
    const bind = await attesterJournal.get<{ transactionId: string }>(
      `bind:${attempt.id}`,
    );
    const pay = await relayerJournal.get<{ transactionId: string }>(
      `pay:${attempt.id}`,
    );
    const balance = await chain.balance(entry.address, wallet.address);
    const delta = balance - BigInt(entry.checks[balanceKey] as string);
    if (
      payment?.status !== "0x1" ||
      pay?.transactionId !== payment.transactionHash
    )
      throw new Error(`${role}: payment receipt does not match the journal`);
    if (delta !== award.net)
      throw new Error(`${role}: wallet received ${delta}, not ${award.net}`);
    entry.steps[`bind-${role}`] = {
      transactionId: bind?.transactionId ?? "",
      from: identity.address.toLowerCase(),
      status: "success",
      note: "Submitted by the identity attester (PaymentSignerJournal) with the wallet's EIP-712 signature",
    };
    entry.steps[`pay-${role}`] = {
      transactionId: payment.transactionHash,
      from: keys.relayer.address.toLowerCase(),
      status: "success",
      block: BigInt(payment.blockNumber).toString(),
      note: "Submitted by the relayer (PaymentSignerJournal) through dispatchPayment",
    };
    entry.checks[key] = {
      obligationId: award.id,
      githubUserId: actor.githubUserId,
      claimId: claim.claimId,
      attemptId: attempt.id,
      net: award.net.toString(),
      fee: award.fee.toString(),
      walletDelta: delta.toString(),
      ledgerState: obligation.state,
      outbox: projection.outbox(award.id),
    };
    await persist();
  }

  async function replay(
    awards: Record<"registered" | "walletless", { id: string }>,
    actors: Record<"registered" | "walletless", TestActor>,
    vault: string,
  ) {
    const entry = run.assets.find((a) => a.vault === vault) as AssetEvidence;
    if (entry.checks.replay) return;
    const balances = async () => ({
      registered: (
        await chain.balance(entry.address, keys.registered.address)
      ).toString(),
      walletless: (
        await chain.balance(entry.address, keys.walletless.address)
      ).toString(),
      vault: (await chain.balance(entry.address, vault)).toString(),
    });
    const before = await balances();
    const dispatch = await replayDispatch(projection, [
      awards.registered.id,
      awards.walletless.id,
    ]);
    // The relayer service with the same attempt returns the same transaction.
    const paid = entry.checks["paid-registered"] as {
      attemptId: string;
      claimId: string;
    };
    const claim = projection.sqlite
      .query<{ record_sha256: string }, [string]>(
        "SELECT record_sha256 FROM wallet_claims WHERE id=?",
      )
      .get(paid.claimId);
    const service = await relayer.fetch(
      new Request("https://payments-executor.internal/v1/pay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": paid.attemptId,
        },
        body: JSON.stringify({
          obligationId: awards.registered.id,
          network,
          vault,
          githubUserId: actors.registered.githubUserId,
          claimId: paid.claimId,
          claimDigest: claim?.record_sha256,
          destination: keys.registered.address.toLowerCase(),
          idempotencyKey: paid.attemptId,
        }),
      }),
    );
    const serviceResult = (await service.json()) as { transactionId?: string };
    if (
      service.status !== 200 ||
      serviceResult.transactionId !==
        entry.steps["pay-registered"].transactionId
    )
      throw new Error("Executor replay did not return the original payment");
    // The same signed bytes again: the node refuses or already knows them.
    const journaled = await relayerJournal.get<{ rawTransaction: string }>(
      `pay:${paid.attemptId}`,
    );
    let rebroadcast: string;
    try {
      rebroadcast = `accepted as ${await chain.rpc("eth_sendRawTransaction", [journaled?.rawTransaction])}`;
    } catch (error) {
      rebroadcast = error instanceof Error ? error.message : String(error);
    }
    const version = (
      await chain.read<readonly [string, bigint]>(vault, VAULT, "bindings", [
        BigInt(actors.registered.githubUserId),
      ])
    )[1].toString();
    const payData = buildPayCalldata(awards.registered.id, version) as Hex;
    const simulated = await chain.mustRevert(
      keys.depositor.address,
      vault,
      payData,
    );
    // A new pay transaction for the paid award is mined and reverts.
    const reverted = await untilReady(
      () =>
        chain.send(
          entry.steps,
          "replay-pay-onchain",
          keys.depositor,
          vault,
          payData,
          {
            gas: 300_000n,
            expect: "reverted",
          },
        ),
      policyWait,
      deadline,
      report,
    );
    const after = await balances();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Balances changed during replay");
    entry.checks.replay = {
      dispatch,
      executorReplay: {
        status: service.status,
        transactionId: serviceResult.transactionId,
      },
      rebroadcastSignedPayment: rebroadcast,
      simulatedSecondPayment: simulated,
      minedSecondPayment: {
        transactionId: reverted.transactionHash,
        status: reverted.status,
      },
      balancesBefore: before,
      balancesAfter: after,
    };
    await persist();
  }
}
