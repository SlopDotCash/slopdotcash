import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
/** Finalized escrow events from a reviewed deployment. The configured RPC and vault are trust roots. */
export interface BaseEscrowConfig {
  rpcUrl: string;
  chainId: bigint;
  vault: string;
  asset: string;
  owner: string;
  identityAuthority: string;
  feeRecipient: string;
  codeSha256: string;
  /** Reviewed delay, in seconds, before a destination binding can pay. */
  bindingDelaySeconds: string;
}

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

const RESERVE_TOPIC =
  "0xd42548deb9ef20b582fe02f194f3c5e39fd0b7d1803321cd197e4ce48c30a857";
const PAYMENT_TOPIC =
  "0x4bf296cb04d665f3fe904ce30894876ea577c828bbc117e8bacad4c4bcb757f7";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const U64 = (1n << 64n) - 1n;

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
async function rpc(
  config: BaseEscrowConfig,
  method: string,
  params: unknown[],
) {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP failure: ${response.status}`);
  const body = object(await response.json());
  if (body.error || body.id !== 1 || !("result" in body)) {
    throw new Error("RPC request failed");
  }
  return body.result;
}

/** codeSha256 hashes decoded immutable runtime code bytes, not hex text or creation code. */
export async function verifyBaseDeployment(
  config: BaseEscrowConfig,
  blockTag: unknown = "finalized",
) {
  if (
    ![
      config.vault,
      config.asset,
      config.owner,
      config.identityAuthority,
      config.feeRecipient,
    ].every((value) => ADDRESS.test(value)) ||
    !/^[0-9a-f]{64}$/.test(config.codeSha256) ||
    !/^(0|[1-9][0-9]*)$/.test(config.bindingDelaySeconds) ||
    BigInt(config.bindingDelaySeconds) > U64
  )
    throw new Error("Reviewed deployment identity is incomplete");
  if (quantity(await rpc(config, "eth_chainId", [])) !== config.chainId)
    throw new Error("Wrong chain");
  const code = await rpc(config, "eth_getCode", [config.vault, blockTag]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code))
    throw new Error("Escrow runtime code unavailable");
  const bytes = Uint8Array.from(code.slice(2).match(/../g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );
  const actual = Array.from(sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== config.codeSha256)
    throw new Error("Escrow runtime code does not match reviewed deployment");
  for (const [getter, expected] of [
    ["token()", config.asset],
    ["owner()", config.owner],
    ["refundDestination()", config.owner],
    ["identityAuthority()", config.identityAuthority],
    ["feeRecipient()", config.feeRecipient],
  ]) {
    const selector =
      "0x" +
      Array.from(
        keccak_256(new TextEncoder().encode(getter)).slice(0, 4),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    const value = await rpc(config, "eth_call", [
      { to: config.vault, data: selector },
      blockTag,
    ]);
    if (
      typeof value !== "string" ||
      !/^0x0{24}[0-9a-fA-F]{40}$/.test(value) ||
      value.slice(-40).toLowerCase() !== expected.slice(2).toLowerCase()
    )
      throw new Error(
        "Escrow asset or authority does not match reviewed deployment",
      );
  }
  const delay = await rpc(config, "eth_call", [
    { to: config.vault, data: "0x7b5290e8" },
    blockTag,
  ]);
  if (
    typeof delay !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(delay) ||
    BigInt(delay) !== BigInt(config.bindingDelaySeconds)
  )
    throw new Error("Escrow binding delay does not match reviewed deployment");
}

/** The only award ID ProjectEscrow accepts: keccak256(abi.encode(chainId, vault, sourceDigest)). */
export function baseAwardId(
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
  config: BaseEscrowConfig,
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
  await verifyBaseDeployment(config, receipt.blockNumber);
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
  config: BaseEscrowConfig,
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
  const gross = uint64(words[paid ? 1 : 0]);
  const fee = uint64(words[paid ? 3 : 1]);
  const net = paid ? uint64(words[2]) : gross - fee;
  if (
    actor === 0n ||
    gross === 0n ||
    fee !== gross / 50n ||
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
  config: BaseEscrowConfig,
  transactionId: string,
  eventIndex: number,
  obligationId: string,
) {
  return verify(config, transactionId, eventIndex, obligationId, false);
}

export function verifyPayment(
  config: BaseEscrowConfig,
  transactionId: string,
  eventIndex: number,
  obligationId: string,
) {
  return verify(config, transactionId, eventIndex, obligationId, true);
}

export async function verifyBinding(
  config: BaseEscrowConfig,
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
  if (
    topics[0] !==
      "0xa228a74ce6410fbd6c2c835cf0114180aa30e657287b2f9d47a1ed6c06a2b4b4" ||
    !/^0x0{24}[0-9a-f]{40}$/.test(topics[2])
  ) {
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

/** Unsigned call data only. Never selects signers or submits a transaction. */
export function buildPayCalldata(
  obligationId: string,
  expectedBindingVersion: string,
) {
  if (expectedBindingVersion === "0")
    throw new Error("Payment needs an active binding");
  return `0xcbcf057d${hash(obligationId).slice(2)}${word(expectedBindingVersion)}`;
}

export function buildBindCalldata(input: {
  githubUserId: string;
  destination: string;
  expectedVersion: string;
  claimDigest: string;
  expiresAt: string;
}) {
  if (
    !ADDRESS.test(input.destination) ||
    BigInt(input.destination) === 0n ||
    input.githubUserId === "0" ||
    BigInt(hash(input.claimDigest)) === 0n
  ) {
    throw new Error("Invalid binding input");
  }
  return `0x9865ee3f${word(input.githubUserId)}${input.destination.slice(2).toLowerCase().padStart(64, "0")}${word(input.expectedVersion)}${hash(input.claimDigest).slice(2)}${word(input.expiresAt)}`;
}

export function buildDepositCalldata(grossMicro: string) {
  if (grossMicro === "0") throw new Error("Deposit must be positive");
  return `0x13765838${word(grossMicro)}`;
}
export function buildCommitAwardCalldata(input: {
  obligationId: string;
  githubUserId: string;
  grossMicro: string;
  sourceDigest: string;
}) {
  if (
    input.githubUserId === "0" ||
    input.grossMicro === "0" ||
    BigInt(hash(input.obligationId)) === 0n ||
    BigInt(hash(input.sourceDigest)) === 0n
  )
    throw new Error("Invalid award input");
  return `0x126db652${hash(input.obligationId).slice(2)}${word(input.githubUserId)}${word(input.grossMicro)}${hash(input.sourceDigest).slice(2)}`;
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
/** Permissionless: moves accrued fees to the immutable fee recipient. */
export function buildClaimFeesCalldata() {
  return "0xd294f093";
}
export function buildWithdrawCalldata(grossMicro: string) {
  if (grossMicro === "0") throw new Error("Withdrawal must be positive");
  return `0x3b6ba63d${word(grossMicro)}`;
}
