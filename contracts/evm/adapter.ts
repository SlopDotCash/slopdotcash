import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import {
  acceptsPayoutFee,
  ordinaryFee,
  type PayoutPolicy,
  payoutFee,
} from "../../src/lib/payments/contracts";
import type { VaultTotals } from "../vault-totals";

export { EVM_NATIVE_ASSET };

/** Finalized escrow events from a reviewed deployment. The configured RPC and vault are trust roots. */
export type EvmRpc =
  | { rpcUrl: string; request?: never }
  | {
      rpcUrl?: never;
      request: (method: string, params: unknown[]) => Promise<unknown>;
    };

/** The requested transaction must occupy its receipt's exact canonical block slot. */
export function isCanonicalEvmReceipt(
  transactionId: string,
  receipt: {
    transactionHash: string;
    blockHash: string;
    blockNumber: bigint;
    transactionIndex: number;
  },
  block: {
    hash: string;
    number: bigint;
    transactions: readonly unknown[];
  } | null,
): boolean {
  const same = (left: unknown, right: unknown) =>
    typeof left === "string" &&
    typeof right === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(left) &&
    left.toLowerCase() === right.toLowerCase();
  return (
    same(receipt.transactionHash, transactionId) &&
    typeof receipt.blockNumber === "bigint" &&
    receipt.blockNumber >= 0n &&
    block !== null &&
    same(block.hash, receipt.blockHash) &&
    block.number === receipt.blockNumber &&
    Number.isSafeInteger(receipt.transactionIndex) &&
    receipt.transactionIndex >= 0 &&
    Array.isArray(block.transactions) &&
    same(block.transactions[receipt.transactionIndex], transactionId)
  );
}

/** One reviewed upgrade authority and implementation pair for the vault and factory proxies. */
export interface EvmImplementationReview {
  authority: string;
  vaultImplementation: string;
  vaultImplementationCodeSha256: string;
  factoryImplementation: string;
  factoryImplementationCodeSha256: string;
}
/** A superseded review. It applies only to events before `supersededAtBlock`. */
export interface EvmSupersededReview extends EvmImplementationReview {
  /** Decimal block number at and after which this review no longer applies: the block of the
   * last proxy upgrade (vault or factory) that left it, since proxies upgrade separately. */
  supersededAtBlock: string;
}
export interface EvmUpgrade extends EvmImplementationReview {
  /** Superseded reviews, oldest first and append-only. Only a finalized event before an entry's
   * bound verifies against it, at its own block, so a later upgrade cannot strand earlier events
   * and a rollback cannot revive a superseded review. */
  history?: EvmSupersededReview[];
}
export type EvmEscrowConfig = EvmRpc & {
  evmUpgrade?: EvmUpgrade;
  /** Selected from the approved private settlement, never inferred from event amounts. */
  payoutPolicy?: PayoutPolicy;
  chainId: bigint;
  vault: string;
  asset: string;
  owner: string;
  /** The identity authority at activation. Later authorities come only from the factory's
   * registrar-proposed rotation, so it is not compared with live state. */
  identityAuthority: string;
  feeRecipient: string;
  codeSha256: string;
  /** Reviewed delay, in seconds, before a destination binding can pay. */
  bindingDelaySeconds: string;
  /** The EscrowFactory that created the vault and holds the identity authority. */
  factory: string;
  /** sha256 of the factory runtime code; proxy implementation evidence is separate. */
  factoryCodeSha256: string;
  /** The factory registrar, the only account that can propose an authority rotation. */
  registrar: string;
};

/** Reviewed factory infrastructure; no project or existing vault is required. */
export type EvmFactoryConfig = EvmRpc &
  Omit<
    EvmEscrowConfig,
    "rpcUrl" | "request" | "vault" | "asset" | "owner" | "payoutPolicy"
  >;

/** Amount fields keep their historical `*Micro` names; they carry token base units of any decimals as
 * decimal strings up to uint128. */
export interface FinalizedEscrowEvent {
  transactionId: string;
  eventIndex: number;
  blockId: string;
  obligationId: string;
  githubUserId: string;
  grossMicro: string;
  netMicro: string;
  feeMicro: string;
  sourceDigest?: string;
  destination?: string;
  bindingVersion?: string;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const keccakText = (text: string) =>
  toHex(keccak_256(new TextEncoder().encode(text)));
/** Topic 0 of every ProjectEscrow v4 and EscrowFactory event, from its canonical signature. */
export const EVM_ESCROW_EVENT_SIGNATURES = Object.freeze({
  Deposited: "Deposited(address,uint128)",
  AwardCommitted: "AwardCommitted(bytes32,uint64,uint128,uint128,bytes32)",
  DestinationBound: "DestinationBound(uint64,address,uint64,bytes32,uint64)",
  BindingCancelled: "BindingCancelled(uint64,uint64)",
  Paid: "Paid(bytes32,uint64,address,uint64,uint128,uint128,uint128)",
  UnusedWithdrawn: "UnusedWithdrawn(address,uint128,uint128,uint128)",
  FeesClaimed: "FeesClaimed(address,uint128)",
  MonthlyCommitmentSet: "MonthlyCommitmentSet(uint128,bool)",
  VaultCreated: "VaultCreated(bytes32,address,address,address,uint8,uint8)",
  IdentityAuthorityRotationProposed:
    "IdentityAuthorityRotationProposed(address,address,uint64)",
  IdentityAuthorityRotationCancelled:
    "IdentityAuthorityRotationCancelled(address)",
  IdentityAuthorityRotated: "IdentityAuthorityRotated(address,address)",
});
export const EVM_ESCROW_EVENT_TOPICS = Object.freeze(
  Object.fromEntries(
    Object.entries(EVM_ESCROW_EVENT_SIGNATURES).map(([name, signature]) => [
      name,
      `0x${keccakText(signature)}`,
    ]),
  ) as Record<keyof typeof EVM_ESCROW_EVENT_SIGNATURES, string>,
);
const RESERVE_TOPIC = EVM_ESCROW_EVENT_TOPICS.AwardCommitted;
const PAYMENT_TOPIC = EVM_ESCROW_EVENT_TOPICS.Paid;
const BINDING_TOPIC = EVM_ESCROW_EVENT_TOPICS.DestinationBound;
const selector = (signature: string) => keccakText(signature).slice(0, 8);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const U64 = (1n << 64n) - 1n;
const U128 = (1n << 128n) - 1n;

type RpcObject = Record<string, unknown>;
function object(value: unknown): RpcObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid RPC object");
  }
  return value as RpcObject;
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    throw new Error("Invalid RPC quantity");
  }
  return BigInt(value);
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new Error("Invalid hash");
  }
  return value.toLowerCase();
}
function uint64(word: string): bigint {
  const value = BigInt(`0x${word}`);
  if (value > U64) throw new Error("Invalid uint64 event field");
  return value;
}
function uint128(word: string): bigint {
  const value = BigInt(`0x${word}`);
  if (value > U128) throw new Error("Invalid uint128 event field");
  return value;
}
async function rpc(config: EvmRpc, method: string, params: unknown[]) {
  if (config.request) return config.request(method, params);
  let body: RpcObject;
  try {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new EvmRpcUnavailable(`RPC HTTP failure: ${response.status}`);
    body = object(await response.json());
  } catch (error) {
    if (error instanceof EvmRpcUnavailable) throw error;
    // A refused connection, a timeout or an unreadable body. Keep the cause
    // for the caller; the URL and the response body are not in the message.
    throw new EvmRpcUnavailable("RPC request failed", { cause: error });
  }
  if (body.id !== 1) throw new EvmRpcUnavailable("RPC request failed");
  if (body.error) {
    const error = object(body.error);
    throw new EvmRpcError(
      error.data === "0x" &&
        typeof error.message === "string" &&
        /revert/i.test(error.message),
    );
  }
  if (!("result" in body)) {
    throw new EvmRpcUnavailable("RPC request failed");
  }
  return body.result;
}

/** Only a proved empty EVM revert means an older reviewed implementation lacks a method.
 * Transport, provider and malformed-response errors must never select a legacy fallback. */
export class EvmRpcError extends Error {
  constructor(
    public emptyRevert: boolean,
    message = "RPC request failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
/** The configured RPC endpoint gave no usable answer: a network failure, a
 * timeout, an HTTP error such as 429, or a malformed JSON-RPC response. It
 * proves nothing about chain state, so it is never a verification mismatch;
 * the caller can only try again later. */
export class EvmRpcUnavailable extends EvmRpcError {
  constructor(message: string, options?: ErrorOptions) {
    super(false, message, options);
  }
}
export {
  buildCommitMonthlyLeafCalldata,
  buildReserveMonthlyCalldata,
  EvmMonthlyAlreadyAdmitted,
  type EvmMonthlyReservation,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
  prepareEvmMonthlyReservation,
  readEvmMonthlyReserve,
} from "./monthly-reserve";
export { rpc as evmRpc };

/** Explicit wallet-consent action: read the actor's current version only from a verified vault. */
export async function readEvmBindingVersion(
  config: EvmEscrowConfig,
  actor: string,
) {
  if (!/^[1-9][0-9]*$/.test(actor) || BigInt(actor) > U64)
    throw new Error("Invalid binding actor");
  await verifyEvmDeployment(config);
  const result = await rpc(config, "eth_call", [
    { to: config.vault, data: `0xa45d1232${word(actor)}` },
    "finalized",
  ]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{320}$/.test(result))
    throw new Error("Binding version unavailable");
  return uint64(result.slice(66, 130)).toString();
}

/** The reviewed factory rotates the identity authority only after this notice period. */
export const EVM_AUTHORITY_ROTATION_DELAY = 0n;
function codeSha256(code: unknown) {
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code))
    throw new Error("Escrow runtime code unavailable");
  const bytes = Uint8Array.from(code.slice(2).match(/../g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );
  return Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function runtimeSha256(
  config: EvmRpc,
  address: string,
  blockTag: unknown,
) {
  return codeSha256(await rpc(config, "eth_getCode", [address, blockTag]));
}
/** The result of one independent read, or its failure, taken in check order. */
function settled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
async function getter(
  config: EvmRpc,
  to: string,
  signature: string,
  blockTag: unknown,
  argument = "",
) {
  const value = await rpc(config, "eth_call", [
    { to, data: `0x${selector(signature)}${argument}` },
    blockTag,
  ]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Malformed escrow state");
  return value.toLowerCase();
}
const addressWord = (value: string) =>
  `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;

/** The ProjectEscrow v5 purpose for a payout policy: 0 ordinary awards, 1 private bounties. */
export function evmVaultPurpose(policy: PayoutPolicy = "ordinary") {
  return policy === "security-bounty" ? 1n : 0n;
}
/** EscrowFactory.vaultKey: keccak256(abi.encode(owner, projectId, token, purpose)), also the CREATE2 salt. */
export function evmVaultKey(input: {
  owner: string;
  projectId: string;
  asset: string;
  payoutPolicy?: PayoutPolicy;
}) {
  if (![input.owner, input.asset].every((value) => ADDRESS.test(value)))
    throw new Error("Invalid vault key");
  return keccakHex(
    unhex(
      `${addressWord(input.owner).slice(2)}${hash(input.projectId).slice(2)}${addressWord(input.asset).slice(2)}${evmVaultPurpose(input.payoutPolicy).toString(16).padStart(64, "0")}`,
    ),
  );
}

/** Verify reviewed network infrastructure without requiring a project vault.
 * Code digests hash decoded runtime bytes. Creation also verifies the current
 * identity authority and the implementation selected for new vaults.
 */
export async function verifyEvmFactory(
  config: EvmFactoryConfig,
  blockTag: unknown = "finalized",
  {
    forCreation = false,
    eventBlock,
  }: {
    forCreation?: boolean;
    /** Accept historical reviews only for an event before their supersession. */
    eventBlock?: bigint;
  } = {},
) {
  if (
    ![
      config.identityAuthority,
      config.feeRecipient,
      config.factory,
      config.registrar,
    ].every((value) => ADDRESS.test(value)) ||
    !/^[0-9a-f]{64}$/.test(config.codeSha256) ||
    !/^[0-9a-f]{64}$/.test(config.factoryCodeSha256) ||
    !/^(0|[1-9][0-9]*)$/.test(config.bindingDelaySeconds) ||
    BigInt(config.bindingDelaySeconds) > U64
  )
    throw new Error("Reviewed deployment identity is incomplete");
  // Proxy bytecode alone does not identify the logic. Check its reviewed implementation.
  // Historical reviews apply only to the exact earlier payment event.
  const implementationSlot =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const upgrade = config.evmUpgrade;
  const reviews: EvmImplementationReview[] = upgrade
    ? [
        upgrade,
        ...(eventBlock === undefined
          ? []
          : (upgrade.history ?? []).filter(
              (review) =>
                /^[1-9][0-9]*$/.test(review.supersededAtBlock) &&
                eventBlock < BigInt(review.supersededAtBlock),
            )),
      ]
    : [];
  if (
    reviews.some(
      (review) =>
        ![
          review.authority,
          review.vaultImplementation,
          review.factoryImplementation,
        ].every((value) => ADDRESS.test(value)) ||
        ![
          review.vaultImplementationCodeSha256,
          review.factoryImplementationCodeSha256,
        ].every((digest) => /^[0-9a-f]{64}$/.test(digest)) ||
        [config.feeRecipient, config.identityAuthority].some(
          (value) => value.toLowerCase() === review.authority.toLowerCase(),
        ),
    )
  )
    throw new Error("Escrow upgrade review is invalid");
  // These reads are independent. Await every fact before accepting the factory,
  // without making owner recovery pay the network latency once per getter.
  const [
    chainId,
    factoryCode,
    slot,
    registrar,
    feeRecipient,
    bindingDelay,
    rotationDelay,
    authority,
    vaultImplementation,
    vaultCode,
    identityAuthority,
    currentFactoryCode,
  ] = await Promise.all([
    rpc(config, "eth_chainId", []),
    runtimeSha256(config, config.factory, blockTag),
    rpc(config, "eth_getStorageAt", [
      config.factory,
      implementationSlot,
      blockTag,
    ]),
    getter(config, config.factory, "registrar()", blockTag),
    getter(config, config.factory, "feeRecipient()", blockTag),
    getter(config, config.factory, "bindingDelay()", blockTag),
    getter(config, config.factory, "AUTHORITY_ROTATION_DELAY()", blockTag),
    upgrade
      ? getter(config, config.factory, "upgradeAuthority()", blockTag)
      : null,
    forCreation && upgrade
      ? getter(config, config.factory, "vaultImplementation()", blockTag)
      : null,
    forCreation && upgrade
      ? runtimeSha256(config, upgrade.vaultImplementation, blockTag)
      : null,
    forCreation
      ? getter(config, config.factory, "identityAuthority()", blockTag)
      : null,
    // The live slot normally names the current reviewed implementation. Its
    // raw code is hashed only if the slot names it, after the earlier checks.
    upgrade
      ? rpc(config, "eth_getCode", [upgrade.factoryImplementation, blockTag])
      : null,
  ]);
  if (quantity(chainId) !== config.chainId) throw new Error("Wrong chain");
  if (factoryCode !== config.factoryCodeSha256)
    throw new Error("Escrow factory code does not match reviewed deployment");
  if (typeof slot !== "string" || !HASH.test(slot))
    throw new Error("Invalid implementation slot");
  if (!upgrade && BigInt(slot) !== 0n)
    throw new Error("Proxy deployment has no reviewed implementation");
  if (upgrade) {
    const factorySlot = slot.toLowerCase();
    // Bind the preloaded current implementation to the live slot. Any other
    // slot, such as a historical event's, is read at its own address.
    const factoryDigest =
      factorySlot === addressWord(upgrade.factoryImplementation)
        ? codeSha256(currentFactoryCode)
        : await runtimeSha256(config, `0x${factorySlot.slice(-40)}`, blockTag);
    if (
      !reviews.some(
        (review) =>
          factorySlot === addressWord(review.factoryImplementation) &&
          factoryDigest === review.factoryImplementationCodeSha256,
      )
    )
      throw new Error(
        "Escrow implementation does not match reviewed deployment",
      );
    if (!reviews.some((review) => authority === addressWord(review.authority)))
      throw new Error(
        "Escrow upgrade authority does not match reviewed deployment",
      );
  }
  if (
    registrar !== addressWord(config.registrar) ||
    feeRecipient !== addressWord(config.feeRecipient)
  )
    throw new Error(
      "Escrow asset, factory or registrar does not match reviewed deployment",
    );
  if (
    BigInt(bindingDelay) !== BigInt(config.bindingDelaySeconds) ||
    BigInt(rotationDelay) !==
      (config.evmUpgrade ? EVM_AUTHORITY_ROTATION_DELAY : 604800n)
  )
    throw new Error("Escrow delays do not match reviewed deployment");
  if (forCreation) {
    if (
      !upgrade ||
      vaultImplementation !== addressWord(upgrade.vaultImplementation) ||
      vaultCode !== upgrade.vaultImplementationCodeSha256
    )
      throw new Error(
        "The factory's new-vault implementation is not reviewed.",
      );
    if (identityAuthority !== addressWord(config.identityAuthority))
      throw new Error(
        "The factory identity authority differs from the creation review.",
      );
  }
  return reviews;
}

/** Verify the factory plus the exact vault's code, owner, asset, purpose and mapping. */
export async function verifyEvmDeployment(
  config: EvmEscrowConfig,
  blockTag: unknown = "finalized",
  {
    expectedProjectId,
    eventBlock,
  }: { expectedProjectId?: string; eventBlock?: bigint } = {},
) {
  const reviews = await verifyEvmFactory(config, blockTag, { eventBlock });
  if (
    ![config.vault, config.asset, config.owner].every((value) =>
      ADDRESS.test(value),
    )
  )
    throw new Error("Reviewed deployment identity is incomplete");
  // Read the independent vault facts in one wave of nine reads, and the two
  // that depend on them in a second wave. Each check then runs in its
  // original order, so the first failed check keeps its refusal.
  const vaultGetter = (signature: string) =>
    getter(config, config.vault, signature, blockTag);
  const [
    code,
    slotRead,
    token,
    owner,
    feeRecipient,
    factory,
    bindingDelay,
    purpose,
    projectIdRead,
  ] = await Promise.allSettled([
    runtimeSha256(config, config.vault, blockTag),
    rpc(config, "eth_getStorageAt", [
      config.vault,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      blockTag,
    ]),
    vaultGetter("token()"),
    vaultGetter("owner()"),
    vaultGetter("feeRecipient()"),
    vaultGetter("factory()"),
    vaultGetter("bindingDelay()"),
    vaultGetter("purpose()"),
    vaultGetter("projectId()"),
  ]);
  if (settled(code) !== config.codeSha256)
    throw new Error("Escrow runtime code does not match reviewed deployment");
  const slot = settled(slotRead);
  if (typeof slot !== "string" || !HASH.test(slot))
    throw new Error("Invalid implementation slot");
  if (!config.evmUpgrade && BigInt(slot) !== 0n)
    throw new Error("Proxy deployment has no reviewed implementation");
  const [implementation, mapped] = await Promise.allSettled([
    config.evmUpgrade
      ? runtimeSha256(config, `0x${slot.slice(-40)}`, blockTag)
      : null,
    projectIdRead.status === "fulfilled"
      ? getter(
          config,
          config.factory,
          "vaults(bytes32)",
          blockTag,
          evmVaultKey({
            owner: config.owner,
            projectId: projectIdRead.value,
            asset: config.asset,
            payoutPolicy: config.payoutPolicy,
          }).slice(2),
        )
      : null,
  ]);
  if (config.evmUpgrade) {
    const digest = settled(implementation);
    if (
      !reviews.some(
        (review) =>
          slot.toLowerCase() === addressWord(review.vaultImplementation) &&
          digest === review.vaultImplementationCodeSha256,
      )
    )
      throw new Error(
        "Escrow implementation does not match reviewed deployment",
      );
  }
  for (const [read, expected] of [
    [token, config.asset],
    [owner, config.owner],
    [feeRecipient, config.feeRecipient],
    [factory, config.factory],
  ] as const) {
    if (settled(read) !== addressWord(expected))
      throw new Error(
        "Escrow asset, factory or registrar does not match reviewed deployment",
      );
  }
  if (BigInt(settled(bindingDelay)) !== BigInt(config.bindingDelaySeconds))
    throw new Error("Escrow delays do not match reviewed deployment");
  if (BigInt(settled(purpose)) !== evmVaultPurpose(config.payoutPolicy))
    throw new Error("Escrow purpose does not match the payout policy");
  const projectId = settled(projectIdRead);
  if (expectedProjectId && projectId !== hash(expectedProjectId))
    throw new Error("The vault belongs to a different registry project");
  if (settled(mapped) !== addressWord(config.vault))
    throw new Error("Escrow vault was not created by the reviewed factory");
}

/** The only award ID ProjectEscrow accepts: keccak256(abi.encode(chainId, vault, sourceDigest)). */
export function evmAwardId(
  chainId: bigint,
  vault: string,
  sourceDigest: string,
): string {
  if (!ADDRESS.test(vault) || chainId <= 0n || chainId > U64)
    throw new Error("Invalid award domain");
  const source = hash(sourceDigest);
  const encoded = `${chainId.toString(16).padStart(64, "0")}${vault.slice(2).toLowerCase().padStart(64, "0")}${source.slice(2)}`;
  const bytes = Uint8Array.from(encoded.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  return `0x${Array.from(keccak_256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function finalizedLog(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
) {
  if (
    !ADDRESS.test(config.vault) ||
    !Number.isSafeInteger(eventIndex) ||
    eventIndex < 0
  ) {
    throw new Error("Invalid deployment or event index");
  }
  const transactionHash = hash(transactionId);
  if (quantity(await rpc(config, "eth_chainId", [])) !== config.chainId) {
    throw new Error("Wrong chain");
  }
  const receipt = object(
    await rpc(config, "eth_getTransactionReceipt", [transactionHash]),
  );
  if (
    receipt.status !== "0x1" ||
    hash(receipt.transactionHash) !== transactionHash
  ) {
    throw new Error("Unsuccessful or mismatched receipt");
  }
  const blockNumber = quantity(receipt.blockNumber);
  const blockId = hash(receipt.blockHash);
  const finalized = object(
    await rpc(config, "eth_getBlockByNumber", ["finalized", false]),
  );
  if (blockNumber > quantity(finalized.number))
    throw new Error("Receipt is not finalized");
  const canonical = object(
    await rpc(config, "eth_getBlockByNumber", [receipt.blockNumber, false]),
  );
  if (
    hash(canonical.hash) !== blockId ||
    quantity(canonical.number) !== blockNumber
  ) {
    throw new Error("Receipt block is not canonical");
  }
  await verifyEvmDeployment(config, receipt.blockNumber, {
    eventBlock: blockNumber,
  });
  if (!Array.isArray(receipt.logs)) throw new Error("Missing receipt logs");
  const matches = receipt.logs
    .map(object)
    .filter((log) => quantity(log.logIndex) === BigInt(eventIndex));
  if (matches.length !== 1) throw new Error("Missing or duplicate event index");
  const log = matches[0];
  if (
    log.removed === true ||
    typeof log.address !== "string" ||
    log.address.toLowerCase() !== config.vault.toLowerCase() ||
    hash(log.transactionHash) !== transactionHash ||
    hash(log.blockHash) !== blockId ||
    quantity(log.blockNumber) !== blockNumber
  ) {
    throw new Error("Event deployment or block mismatch");
  }
  return { log, blockId, transactionHash };
}

async function verify(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  obligationId: string,
  paid: boolean,
): Promise<FinalizedEscrowEvent> {
  const awardId = hash(obligationId);
  const { log, blockId, transactionHash } = await finalizedLog(
    config,
    transactionId,
    eventIndex,
  );
  if (!Array.isArray(log.topics) || log.topics.length !== (paid ? 4 : 3)) {
    throw new Error("Wrong event topics");
  }
  const topics = log.topics.map(hash);
  if (
    topics[0] !== (paid ? PAYMENT_TOPIC : RESERVE_TOPIC) ||
    topics[1] !== awardId
  ) {
    throw new Error("Wrong event or obligation");
  }
  if (
    typeof log.data !== "string" ||
    !(paid ? /^0x[0-9a-fA-F]{256}$/ : /^0x[0-9a-fA-F]{192}$/).test(log.data)
  ) {
    throw new Error("Wrong event data");
  }
  const words = [
    log.data.slice(2, 66),
    log.data.slice(66, 130),
    log.data.slice(130, 194),
    ...(paid ? [log.data.slice(194, 258)] : []),
  ];
  const actor = uint64(topics[2].slice(2));
  const gross = uint128(words[paid ? 1 : 0]);
  const fee = uint128(words[paid ? 3 : 1]);
  const net = paid ? uint128(words[2]) : gross - fee;
  if (
    actor === 0n ||
    gross === 0n ||
    !acceptsPayoutFee(gross, fee, config.payoutPolicy) ||
    net !== gross - fee
  ) {
    throw new Error("Invalid award accounting");
  }
  const result: FinalizedEscrowEvent = {
    transactionId: transactionHash,
    eventIndex,
    blockId,
    obligationId: awardId,
    githubUserId: actor.toString(),
    grossMicro: gross.toString(),
    netMicro: net.toString(),
    feeMicro: fee.toString(),
  };
  if (paid) {
    if (!/^0x0{24}[0-9a-f]{40}$/.test(topics[3]))
      throw new Error("Invalid destination encoding");
    result.destination = `0x${topics[3].slice(-40)}`;
    const version = uint64(words[0]);
    if (BigInt(result.destination) === 0n || version === 0n)
      throw new Error("Invalid binding");
    result.bindingVersion = version.toString();
  } else {
    result.sourceDigest = `0x${words[2].toLowerCase()}`;
    if (BigInt(result.sourceDigest) === 0n)
      throw new Error("Missing award origin");
  }
  return result;
}

export function verifyReserve(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  obligationId: string,
) {
  return verify(config, transactionId, eventIndex, obligationId, false);
}

export function verifyPayment(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  obligationId: string,
) {
  return verify(config, transactionId, eventIndex, obligationId, true);
}

export async function verifyBinding(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  githubUserId: string,
) {
  const { log, blockId, transactionHash } = await finalizedLog(
    config,
    transactionId,
    eventIndex,
  );
  if (
    !Array.isArray(log.topics) ||
    log.topics.length !== 3 ||
    typeof log.data !== "string" ||
    !/^0x[0-9a-fA-F]{192}$/.test(log.data)
  ) {
    throw new Error("Wrong binding event encoding");
  }
  const topics = log.topics.map(hash);
  if (topics[0] !== BINDING_TOPIC || !/^0x0{24}[0-9a-f]{40}$/.test(topics[2])) {
    throw new Error("Wrong binding event");
  }
  const actor = uint64(topics[1].slice(2));
  const version = uint64(log.data.slice(2, 66));
  const destination = `0x${topics[2].slice(-40)}`;
  const claimDigest = `0x${log.data.slice(66, 130).toLowerCase()}`;
  const activatesAt = uint64(log.data.slice(130, 194));
  if (
    actor === 0n ||
    actor.toString() !== githubUserId ||
    version === 0n ||
    BigInt(destination) === 0n ||
    BigInt(claimDigest) === 0n
  ) {
    throw new Error("Invalid binding identity");
  }
  return {
    transactionId: transactionHash,
    eventIndex,
    blockId,
    githubUserId,
    destination,
    bindingVersion: version.toString(),
    claimDigest,
    activatesAt: activatesAt.toString(),
  };
}

function word(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > U64)
    throw new Error("Invalid uint64 input");
  return BigInt(value).toString(16).padStart(64, "0");
}
/** A token amount in base units: a decimal string or bigint from 1 to uint128 max. */
function amountWord(value: string | bigint) {
  const amount =
    typeof value === "bigint"
      ? value
      : /^(0|[1-9][0-9]*)$/.test(value)
        ? BigInt(value)
        : -1n;
  if (amount <= 0n || amount > U128)
    throw new Error("Amount must be 1 to uint128 max base units");
  return amount.toString(16).padStart(64, "0");
}

/** Unsigned call data only. Never selects signers or submits a transaction. */
export function buildPayCalldata(
  obligationId: string,
  expectedBindingVersion: string,
) {
  if (expectedBindingVersion === "0")
    throw new Error("Payment needs an active binding");
  return `0xcbcf057d${hash(obligationId).slice(2)}${word(expectedBindingVersion)}`;
}

export interface BindingInput {
  githubUserId: string;
  destination: string;
  expectedVersion: string;
  claimDigest: string;
  expiresAt: string;
}
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
function assertBindingInput(input: BindingInput) {
  if (
    !ADDRESS.test(input.destination) ||
    BigInt(input.destination) === 0n ||
    input.githubUserId === "0" ||
    BigInt(hash(input.claimDigest)) === 0n
  ) {
    throw new Error("Invalid binding input");
  }
}
const keccakHex = (bytes: Uint8Array) =>
  `0x${Array.from(keccak_256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
const unhex = (value: string) =>
  Uint8Array.from(value.replace(/^0x/, "").match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
/** keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)") */
const DOMAIN_TYPEHASH =
  "8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f";
/** keccak256("DestinationBinding(uint64 actorId,address destination,uint64 expectedVersion,bytes32 claimDigest,uint64 expiresAt)") */
const BINDING_TYPEHASH =
  "da5a17ebadee256f10c42cd35247bcea3c3b77ba8772bea3807f7d5023a4489e";
/** keccak256("MonthlyAllocation(uint32 period,bytes32 allocationRoot)") */
const MONTHLY_TYPEHASH =
  "76c1450f2bf1fd8f9417f688d54a1a8fb8bbdce95664adbbab3d5e9b064a3b25";
/** keccak256("SlopProjectEscrow") and keccak256("5"): the vault's EIP-712 name and version. */
const DOMAIN_NAME_HASH =
  "3c605d82f7aa4ceb74cffe80a28c3f9b810fb40c95cdc887dea666b075537518";
const DOMAIN_VERSION_HASH =
  "ceebf77a833b30520287ddd9478ff51abbdffa30aa90a8d655dba0e8a79ce0c1";
/** The EIP-712 domain version of ProjectEscrow v5. */
export const EVM_ESCROW_DOMAIN_VERSION = "5";
function domainSeparator(chainId: bigint, vault: string) {
  if (!ADDRESS.test(vault) || chainId <= 0n || chainId > U64)
    throw new Error("Invalid escrow domain");
  return keccakHex(
    unhex(
      `${DOMAIN_TYPEHASH}${DOMAIN_NAME_HASH}${DOMAIN_VERSION_HASH}${chainId.toString(16).padStart(64, "0")}${vault.slice(2).toLowerCase().padStart(64, "0")}`,
    ),
  );
}
/** The EIP-712 typed data a destination wallet signs to accept a binding (eth_signTypedData_v4). */
export function evmBindingTypedData(
  chainId: bigint,
  vault: string,
  input: BindingInput,
) {
  assertBindingInput(input);
  if (!ADDRESS.test(vault) || chainId <= 0n || chainId > U64)
    throw new Error("Invalid binding domain");
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      DestinationBinding: [
        { name: "actorId", type: "uint64" },
        { name: "destination", type: "address" },
        { name: "expectedVersion", type: "uint64" },
        { name: "claimDigest", type: "bytes32" },
        { name: "expiresAt", type: "uint64" },
      ],
    },
    primaryType: "DestinationBinding" as const,
    domain: {
      name: "SlopProjectEscrow",
      version: EVM_ESCROW_DOMAIN_VERSION,
      chainId: chainId.toString(),
      verifyingContract: vault.toLowerCase(),
    },
    message: {
      actorId: input.githubUserId,
      destination: input.destination.toLowerCase(),
      expectedVersion: input.expectedVersion,
      claimDigest: hash(input.claimDigest),
      expiresAt: input.expiresAt,
    },
  };
}
/** The digest ProjectEscrow.bindingDigest returns for the same fields; recover it to verify a wallet signature. */
export function evmBindingDigest(
  chainId: bigint,
  vault: string,
  input: BindingInput,
): string {
  assertBindingInput(input);
  const domain = domainSeparator(chainId, vault);
  const struct = keccakHex(
    unhex(
      `${BINDING_TYPEHASH}${word(input.githubUserId)}${input.destination.slice(2).toLowerCase().padStart(64, "0")}${word(input.expectedVersion)}${hash(input.claimDigest).slice(2)}${word(input.expiresAt)}`,
    ),
  );
  return keccakHex(unhex(`1901${domain.slice(2)}${struct.slice(2)}`));
}
/** bindDestination(uint64,address,uint64,bytes32,uint64,bytes): the authority's call carrying the wallet's signature. */
export function buildBindCalldata(
  input: BindingInput & { walletSignature: string },
) {
  assertBindingInput(input);
  if (!SIGNATURE.test(input.walletSignature))
    throw new Error("Invalid wallet signature encoding");
  const signature = input.walletSignature.slice(2).toLowerCase();
  return `0xac11944e${word(input.githubUserId)}${input.destination.slice(2).toLowerCase().padStart(64, "0")}${word(input.expectedVersion)}${hash(input.claimDigest).slice(2)}${word(input.expiresAt)}${"c0".padStart(64, "0")}${"41".padStart(64, "0")}${signature.padEnd(192, "0")}`;
}
export interface EvmAuthorityRotation {
  factory: string;
  identityAuthority: string;
  /** Null when no rotation is proposed. */
  pendingIdentityAuthority: string | null;
  effectiveAt: string | null;
}
/** The identity authority in force for a vault and any pending factory rotation, at the finalized block. */
export async function readEvmAuthorityRotation(
  config: EvmEscrowConfig,
  blockTag: unknown = "finalized",
): Promise<EvmAuthorityRotation> {
  if (!ADDRESS.test(config.vault)) throw new Error("Invalid vault");
  const read = async (to: string, selector: string, pattern: RegExp) => {
    const value = await rpc(config, "eth_call", [
      { to, data: selector },
      blockTag,
    ]);
    if (typeof value !== "string" || !pattern.test(value))
      throw new Error("Malformed factory state");
    return value;
  };
  const addressWord = /^0x0{24}[0-9a-fA-F]{40}$/;
  const factory = `0x${(await read(config.vault, "0xc45a0155", addressWord)).slice(-40).toLowerCase()}`;
  const identityAuthority = `0x${(await read(factory, "0x13fa3c08", addressWord)).slice(-40).toLowerCase()}`;
  const pending = `0x${(await read(factory, "0xc9a66a21", addressWord)).slice(-40).toLowerCase()}`;
  const effectiveAt = uint64(
    (await read(factory, "0x2c35d137", /^0x[0-9a-fA-F]{64}$/)).slice(2),
  );
  const proposed = BigInt(pending) !== 0n;
  return {
    factory,
    identityAuthority,
    pendingIdentityAuthority: proposed ? pending : null,
    effectiveAt: proposed ? effectiveAt.toString() : null,
  };
}

/** Permissionless: any sender deposits its own approved tokens into the free balance. */
export function buildDepositCalldata(grossMicro: string | bigint) {
  return `0x${selector("deposit(uint128)")}${amountWord(grossMicro)}`;
}
export function buildCommitAwardCalldata(input: {
  payoutPolicy?: PayoutPolicy;
  obligationId: string;
  githubUserId: string;
  grossMicro: string | bigint;
  sourceDigest: string;
}) {
  if (
    input.githubUserId === "0" ||
    BigInt(hash(input.obligationId)) === 0n ||
    BigInt(hash(input.sourceDigest)) === 0n
  )
    throw new Error("Invalid award input");
  payoutFee(BigInt(input.grossMicro), input.payoutPolicy);
  const method =
    input.payoutPolicy === "security-bounty"
      ? "commitBountyAward"
      : "commitAward";
  return `0x${selector(`${method}(bytes32,uint64,uint128,bytes32)`)}${hash(input.obligationId).slice(2)}${word(input.githubUserId)}${amountWord(input.grossMicro)}${hash(input.sourceDigest).slice(2)}`;
}
/** Owner-only: stops a pending binding before it can pay. */
export function buildCancelBindingCalldata(
  githubUserId: string,
  bindingVersion: string,
) {
  if (githubUserId === "0" || bindingVersion === "0")
    throw new Error("Invalid binding cancellation");
  return `0x92be84fc${word(githubUserId)}${word(bindingVersion)}`;
}
/** Permissionless: moves accrued fees to the configured fee recipient. */
export function buildClaimFeesCalldata() {
  return "0xd294f093";
}
/** Owner-only: refunds free funds to the refund destination less the 2% fee, ceil(gross / 50). */
export function buildWithdrawCalldata(grossMicro: string | bigint) {
  return `0x${selector("withdrawUnused(uint128)")}${amountWord(grossMicro)}`;
}
/** The owner's monthly commitment setting: a uint128 cap and the on/off flag. */
export interface EvmMonthlyCommitment {
  cap: string;
  enabled: boolean;
}
function monthlyCommitmentWords(cap: string | bigint, enabled: boolean) {
  const value =
    typeof cap === "bigint"
      ? cap
      : /^(0|[1-9][0-9]*)$/.test(cap)
        ? BigInt(cap)
        : -1n;
  if (value < 0n || value > U128)
    throw new Error("The monthly cap must be 0 to uint128 max base units");
  if (enabled && value === 0n)
    throw new Error("Turning on monthly commitments needs a positive cap");
  return `${value.toString(16).padStart(64, "0")}${(enabled ? 1n : 0n).toString(16).padStart(64, "0")}`;
}
/** Owner-only on an ordinary vault: sets the monthly cap (token base units) and turns the
 * signed monthly commitment on or off. The contract rejects "on" with a zero cap. */
export function buildSetMonthlyCommitmentCalldata(
  cap: string | bigint,
  enabled: boolean,
) {
  return `0x${selector("setMonthlyCommitment(uint128,bool)")}${monthlyCommitmentWords(cap, enabled)}`;
}
/** Reads monthlyCap() and monthlyEnabled() together at the latest finalized block. */
export async function readEvmMonthlyCommitment(
  config: EvmVaultTotalsConfig,
): Promise<EvmMonthlyCommitment & { blockNumber: string; blockTime: string }> {
  if (!ADDRESS.test(config.vault)) throw new Error("Invalid vault");
  if (quantity(await rpc(config, "eth_chainId", [])) !== config.chainId)
    throw new Error("Wrong chain");
  const block = object(
    await rpc(config, "eth_getBlockByNumber", ["finalized", false]),
  );
  const blockNumber = quantity(block.number);
  const blockTag = `0x${blockNumber.toString(16)}`;
  const cap = uint128(
    (await getter(config, config.vault, "monthlyCap()", blockTag)).slice(2),
  );
  const flag = await getter(config, config.vault, "monthlyEnabled()", blockTag);
  if (flag !== `0x${"0".repeat(64)}` && flag !== `0x${"0".repeat(63)}1`)
    throw new Error("Malformed monthly commitment state");
  return {
    cap: cap.toString(),
    enabled: flag.endsWith("1"),
    blockNumber: blockNumber.toString(),
    blockTime: new Date(Number(quantity(block.timestamp)) * 1000).toISOString(),
  };
}
/** Reconcile an owner's monthly commitment setting against its finalized vault event. */
export async function verifyMonthlyCommitmentSet(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  expected: EvmMonthlyCommitment,
) {
  const { log, blockId, transactionHash } = await finalizedLog(
    config,
    transactionId,
    eventIndex,
  );
  if (
    !Array.isArray(log.topics) ||
    log.topics.length !== 1 ||
    hash(log.topics[0]) !== EVM_ESCROW_EVENT_TOPICS.MonthlyCommitmentSet ||
    typeof log.data !== "string" ||
    log.data.toLowerCase() !==
      `0x${monthlyCommitmentWords(expected.cap, expected.enabled)}`
  )
    throw new Error("The finalized vault event does not match this setting");
  return { transactionId: transactionHash, blockId, ...expected };
}
/** Reconcile a user's deposit or free-fund withdrawal against its finalized vault event. */
export async function verifyVaultFundingAction(
  config: EvmEscrowConfig,
  transactionId: string,
  eventIndex: number,
  expected: {
    operation: "deposit" | "withdraw";
    address: string;
    gross: string;
  },
) {
  const { log, blockId, transactionHash } = await finalizedLog(
    config,
    transactionId,
    eventIndex,
  );
  const withdrawing = expected.operation === "withdraw";
  const gross = BigInt(expected.gross);
  if (!ADDRESS.test(expected.address) || gross <= 0n || gross > U128)
    throw new Error("Invalid funding action");
  const topic =
    EVM_ESCROW_EVENT_TOPICS[withdrawing ? "UnusedWithdrawn" : "Deposited"];
  // A vault not yet upgraded to rounded-up fees still takes floor(gross / 50).
  const fees = withdrawing
    ? [ordinaryFee(gross), gross / 50n].filter((fee) =>
        acceptsPayoutFee(gross, fee),
      )
    : [0n];
  const encoded = (fee: bigint) =>
    `0x${amountWord(gross)}${withdrawing ? `${(gross - fee).toString(16).padStart(64, "0")}${fee.toString(16).padStart(64, "0")}` : ""}`;
  const fee = fees.find(
    (candidate) =>
      typeof log.data === "string" &&
      log.data.toLowerCase() === encoded(candidate),
  );
  if (
    !Array.isArray(log.topics) ||
    log.topics.length !== 2 ||
    hash(log.topics[0]) !== topic ||
    hash(log.topics[1]) !== addressWord(expected.address) ||
    fee === undefined
  )
    throw new Error("The finalized vault event does not match this action");
  return {
    transactionId: transactionHash,
    blockId,
    gross: gross.toString(),
    fee: fee.toString(),
    net: (gross - fee).toString(),
  };
}
/** Permissionless: the sender creates and owns its vault for one project, token and purpose. */
export function buildCreateVaultCalldata(input: {
  projectId: string;
  asset: string;
  payoutPolicy?: PayoutPolicy;
  /** Required for ordinary vaults; base units chosen by the owner. */
  monthlyCap?: string | bigint;
  /** Defaults on; false records an explicit owner opt-out. */
  automaticMonthly?: boolean;
}) {
  if (BigInt(hash(input.projectId)) === 0n || !ADDRESS.test(input.asset))
    throw new Error("Invalid vault input");
  if (input.payoutPolicy === "security-bounty") {
    if (input.monthlyCap !== undefined || input.automaticMonthly !== undefined)
      throw new Error("Private bounty awards have no automatic monthly policy");
    return `0x${selector("create(bytes32,address,uint8)")}${hash(input.projectId).slice(2)}${addressWord(input.asset).slice(2)}${evmVaultPurpose(input.payoutPolicy).toString(16).padStart(64, "0")}`;
  }
  if (input.monthlyCap === undefined)
    throw new Error("The owner's monthly cap is required");
  return `0x${selector("createWithMonthlyCommitment(bytes32,address,uint128,bool)")}${hash(input.projectId).slice(2)}${addressWord(input.asset).slice(2)}${monthlyCommitmentWords(input.monthlyCap, input.automaticMonthly ?? true)}`;
}
/** Creation uses a reviewed existing vault only as the factory/code trust source. */
export interface EvmVaultCreation {
  projectId: string;
  asset: string;
  owner: string;
  monthlyCap: string;
  monthlyEnabled: boolean;
  payoutPolicy?: PayoutPolicy;
}
function creationData(input: EvmVaultCreation) {
  return buildCreateVaultCalldata({
    projectId: input.projectId,
    asset: input.asset,
    payoutPolicy: input.payoutPolicy,
    ...(input.payoutPolicy === "security-bounty"
      ? {}
      : {
          monthlyCap: input.monthlyCap,
          automaticMonthly: input.monthlyEnabled,
        }),
  });
}
async function creationVault(
  config: EvmFactoryConfig,
  input: EvmVaultCreation,
  block: string,
) {
  const key = evmVaultKey(input);
  const value = await getter(
    config,
    config.factory,
    "vaults(bytes32)",
    block,
    key.slice(2),
  );
  return `0x${value.slice(-40)}`;
}
/** Refuses unreviewed logic and factories that cannot atomically set monthly policy. */
export async function prepareEvmVaultCreation(
  config: EvmFactoryConfig,
  input: EvmVaultCreation,
) {
  await verifyEvmFactory(config, "finalized", { forCreation: true });
  const existingVault = await creationVault(config, input, "latest");
  const transaction = {
    from: input.owner,
    to: config.factory,
    data: creationData(input),
    value: "0x0",
  };
  if (BigInt(existingVault) !== 0n) return { existingVault, transaction };
  const result = await rpc(config, "eth_call", [transaction, "latest"]);
  if (typeof result !== "string" || !HASH.test(result) || BigInt(result) === 0n)
    throw new Error(
      "This reviewed factory does not support the requested vault creation.",
    );
  return { existingVault: null, transaction };
}
export class EvmVaultCreationFailed extends Error {}

/** Exact finalized creation, not a user-supplied deployment assertion. */
export async function verifyEvmVaultCreation(
  config: EvmFactoryConfig,
  input: EvmVaultCreation,
  transactionId: string,
) {
  const transactionHash = hash(transactionId);
  // Read independent facts together and check them in the original order, so
  // the first failed check keeps its refusal.
  const [receiptRead, transaction, finalizedRead] = await Promise.allSettled([
    rpc(config, "eth_getTransactionReceipt", [transactionHash]),
    rpc(config, "eth_getTransactionByHash", [transactionHash]),
    rpc(config, "eth_getBlockByNumber", ["finalized", false]),
  ]);
  const receiptValue = settled(receiptRead);
  if (!receiptValue) return null;
  const receipt = object(receiptValue);
  const finalized = object(settled(finalizedRead));
  if (quantity(receipt.blockNumber) > quantity(finalized.number)) return null;
  const [canonicalBlock, vaultRead] = await Promise.allSettled([
    rpc(config, "eth_getBlockByNumber", [receipt.blockNumber, false]),
    creationVault(config, input, String(receipt.blockNumber)),
  ]);
  const tx = object(settled(transaction));
  const canonical = object(settled(canonicalBlock));
  if (
    hash(receipt.transactionHash) !== transactionHash ||
    hash(tx.hash) !== transactionHash ||
    hash(canonical.hash) !== hash(receipt.blockHash) ||
    quantity(canonical.number) !== quantity(receipt.blockNumber)
  )
    throw new Error("The creation receipt does not match its canonical block.");
  if (
    String(tx.from).toLowerCase() !== input.owner.toLowerCase() ||
    String(tx.to).toLowerCase() !== config.factory.toLowerCase() ||
    String(tx.input).toLowerCase() !== creationData(input).toLowerCase() ||
    quantity(tx.value) !== 0n ||
    tx.blockHash !== receipt.blockHash
  )
    throw new Error(
      "The transaction does not match this owner's vault creation request.",
    );
  if (quantity(receipt.status) !== 1n)
    throw new EvmVaultCreationFailed(
      "The vault creation transaction failed. Review a new request.",
    );
  const vault = settled(vaultRead);
  const created = {
    ...config,
    vault,
    owner: input.owner,
    asset: input.asset,
    payoutPolicy: input.payoutPolicy,
  };
  // Both verifications and the policy reads are independent, so they run at
  // the same time. Each verification reads at most nine facts at once.
  const policyReads =
    input.payoutPolicy === "security-bounty"
      ? null
      : // Read the policy at the creation block: a later owner change must not block registration.
        Promise.allSettled([
          getter(created, vault, "monthlyCap()", receipt.blockNumber),
          getter(created, vault, "monthlyEnabled()", receipt.blockNumber),
        ]);
  const [atCreation, atFinalized] = await Promise.allSettled([
    verifyEvmDeployment(created, receipt.blockNumber, {
      expectedProjectId: input.projectId,
    }),
    verifyEvmDeployment(created, "finalized", {
      expectedProjectId: input.projectId,
    }),
  ]);
  settled(atCreation);
  settled(atFinalized);
  if (policyReads) {
    const [capRead, enabledRead] = await policyReads;
    const cap = BigInt(settled(capRead));
    const enabled = BigInt(settled(enabledRead));
    if (
      cap !== BigInt(input.monthlyCap) ||
      enabled !== (input.monthlyEnabled ? 1n : 0n)
    )
      throw new Error(
        "The vault's monthly policy differs from the reviewed creation request.",
      );
  }
  return vault;
}

/** One award of a monthly allocation, in allocation order. */
export interface MonthlyAllocationEntry {
  githubUserId: string;
  grossMicro: string | bigint;
  sourceDigest: string;
}
/** A period key "YYYY-MM" (the monthly coordinator's month) as the contract's YYYYMM number. */
function periodNumber(period: string) {
  const match = /^([2-9][0-9]{3})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error("Invalid monthly period");
  return BigInt(`${match[1]}${match[2]}`);
}
function monthlyLeaf(entry: MonthlyAllocationEntry) {
  if (entry.githubUserId === "0" || BigInt(hash(entry.sourceDigest)) === 0n)
    throw new Error("Invalid monthly award");
  // abi.encodePacked(uint8 0, uint64 actorId, uint128 gross, bytes32 sourceDigest)
  return keccakHex(
    unhex(
      `00${word(entry.githubUserId).slice(48)}${amountWord(entry.grossMicro).slice(32)}${hash(entry.sourceDigest).slice(2)}`,
    ),
  );
}
/** ProjectEscrow.allocationRoot: the Merkle root over the awards in order; an odd last node moves up. */
export function evmAllocationRoot(entries: readonly MonthlyAllocationEntry[]) {
  if (entries.length === 0) throw new Error("Empty monthly allocation");
  let level = entries.map(monthlyLeaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(
        i + 1 < level.length
          ? keccakHex(unhex(`01${level[i].slice(2)}${level[i + 1].slice(2)}`))
          : level[i],
      );
    level = next;
  }
  return level[0];
}
/** ProjectEscrow.monthlyDigest: the EIP-712 digest the identity authority signs for one period and root. */
export function evmMonthlyDigest(
  chainId: bigint,
  vault: string,
  period: string,
  allocationRoot: string,
) {
  const struct = keccakHex(
    unhex(
      `${MONTHLY_TYPEHASH}${periodNumber(period).toString(16).padStart(64, "0")}${hash(allocationRoot).slice(2)}`,
    ),
  );
  return keccakHex(
    unhex(`1901${domainSeparator(chainId, vault).slice(2)}${struct.slice(2)}`),
  );
}
/** Permissionless commitMonthly(uint32,(uint64,uint128,bytes32)[],bytes) with the authority's signature. */
export function buildCommitMonthlyCalldata(
  period: string,
  entries: readonly MonthlyAllocationEntry[],
  attestation: string,
) {
  if (!SIGNATURE.test(attestation)) throw new Error("Invalid attestation");
  evmAllocationRoot(entries);
  const count = BigInt(entries.length);
  const tail = entries
    .map(
      (entry) =>
        `${word(entry.githubUserId)}${amountWord(entry.grossMicro)}${hash(entry.sourceDigest).slice(2)}`,
    )
    .join("");
  const bytesOffset = 0x60n + 0x20n + count * 0x60n;
  return `0x${selector("commitMonthly(uint32,(uint64,uint128,bytes32)[],bytes)")}${periodNumber(period).toString(16).padStart(64, "0")}${0x60n.toString(16).padStart(64, "0")}${bytesOffset.toString(16).padStart(64, "0")}${count.toString(16).padStart(64, "0")}${tail}${65n.toString(16).padStart(64, "0")}${attestation.slice(2).toLowerCase().padEnd(192, "0")}`;
}

export type { VaultTotals } from "../vault-totals";
export type EvmVaultTotalsConfig = EvmRpc & {
  /** The registry network key, echoed in the result. */
  network: string;
  vault: string;
  chainId: bigint;
};
/**
 * Reads every counter of a vault with one totals() call, plus its token and decimals, all at one
 * pinned finalized block number. It checks the chain and the conservation identity
 * deposited = free + reserved + paid + payoutFees + withdrawnGross. It does not
 * verify the reviewed deployment; call verifyEvmDeployment first for that.
 */
export async function readVaultTotals(
  config: EvmVaultTotalsConfig,
): Promise<VaultTotals> {
  const { vault } = config;
  if (!ADDRESS.test(vault)) throw new Error("Invalid vault");
  if (quantity(await rpc(config, "eth_chainId", [])) !== config.chainId)
    throw new Error("Wrong chain");
  const block = object(
    await rpc(config, "eth_getBlockByNumber", ["finalized", false]),
  );
  const blockNumber = quantity(block.number);
  const blockTag = `0x${blockNumber.toString(16)}`;
  const data = await rpc(config, "eth_call", [
    { to: vault, data: `0x${selector("totals()")}` },
    blockTag,
  ]);
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{640}$/.test(data))
    throw new Error("Malformed vault totals");
  const words = Array.from({ length: 10 }, (_, i) =>
    data.slice(2 + i * 64, 66 + i * 64),
  );
  const [
    deposited,
    paid,
    payoutFees,
    withdrawnGross,
    withdrawalFees,
    free,
    reservedPrincipal,
    reservedFees,
    accruedFees,
  ] = words.slice(0, 9).map(uint128);
  const vaultBalance = BigInt(`0x${words[9]}`);
  const token = await getter(config, vault, "token()", blockTag);
  const decimals = BigInt(await getter(config, vault, "decimals()", blockTag));
  if (!/^0x0{24}[0-9a-f]{40}$/.test(token) || decimals > 255n)
    throw new Error("Malformed vault asset");
  if (`0x${token.slice(-40)}` === EVM_NATIVE_ASSET) {
    const nativeBalance = quantity(
      await rpc(config, "eth_getBalance", [vault, blockTag]),
    );
    if (decimals !== 18n || nativeBalance !== vaultBalance)
      throw new Error("Native vault totals do not match its ETH balance");
  }
  const accounted =
    free +
    reservedPrincipal +
    reservedFees +
    paid +
    payoutFees +
    withdrawnGross;
  // Legacy totals() keeps its ABI. When the counters have an unmaterialized monthly remainder,
  // require the V2 getter to prove that exact reserve at the same finalized block. A legacy vault
  // with inconsistent counters, or an unavailable getter, still fails closed.
  const pending =
    deposited > accounted
      ? BigInt(await getter(config, vault, "pendingMonthlyGross()", blockTag))
      : 0n;
  if (
    deposited !==
      free +
        reservedPrincipal +
        reservedFees +
        pending +
        paid +
        payoutFees +
        withdrawnGross ||
    pending > U128 ||
    vaultBalance <
      free + reservedPrincipal + reservedFees + pending + accruedFees
  )
    throw new Error("Vault totals do not conserve");
  return {
    network: config.network,
    vault: vault.toLowerCase(),
    asset: `0x${token.slice(-40)}`,
    decimals: Number(decimals),
    blockNumber: blockNumber.toString(),
    blockTime: new Date(Number(quantity(block.timestamp)) * 1000).toISOString(),
    totalDeposited: deposited.toString(),
    totalPaid: paid.toString(),
    totalPayoutFees: payoutFees.toString(),
    totalGrossWithdrawn: withdrawnGross.toString(),
    totalWithdrawalFees: withdrawalFees.toString(),
    freeBalance: free.toString(),
    reservedPrincipal: reservedPrincipal.toString(),
    reservedFees: reservedFees.toString(),
    accruedFees: accruedFees.toString(),
    reserved:
      pending > 0n
        ? (reservedPrincipal + reservedFees + pending).toString()
        : null,
  };
}
