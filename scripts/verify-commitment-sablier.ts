/**
 * Read-only Sablier Lockup v4 commitment verifier for USDC streams on Base
 * and Ethereum. It queries three fixed public RPC authorities at their
 * finalized block, requires two to agree on the exact stream state, and emits
 * reviewed commitment evidence. It never reads a key, signs, broadcasts, or
 * writes a commitment record.
 */

import { isFundingAddress } from "../src/lib/funding-address.mjs";
import {
  assertSablierStreamState,
  COMMITMENT_SABLIER_VERIFIER_VERSION,
  EVM_FUNDING_USDC_CONTRACTS,
  isSablierStreamId,
  SABLIER_LOCKUP_V4_CONTRACTS,
  type SablierNetwork,
  type SablierStreamCall,
  sablierStreamCallData,
  type VerifiedSablierStream,
} from "../src/lib/sablier-funding";
import { parseValueArguments } from "./parse-value-arguments";

export const EVM_COMMITMENT_RPC_AUTHORITIES = Object.freeze({
  base: [
    "https://mainnet.base.org",
    "https://base.gateway.tenderly.co",
    "https://base.drpc.org",
  ],
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.drpc.org",
    "https://mainnet.gateway.tenderly.co",
  ],
} as const satisfies Record<SablierNetwork, readonly string[]>);
const EVM_COMMITMENT_RPC_QUORUM = 2;
export const MAX_EVM_COMMITMENT_RPC_BYTES = 1024 * 1024;

const EVM_CHAIN_IDS = Object.freeze({
  base: "0x2105",
  ethereum: "0x1",
} as const satisfies Record<SablierNetwork, string>);

const EVM_EXPLORER_AUTHORITIES = Object.freeze({
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
} as const satisfies Record<SablierNetwork, string>);

type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;

export interface CommitmentSablierInput {
  fetchImpl?: FetchLike;
  network: string;
  recipient: string;
  streamId: string;
}

const CLI_ARGUMENTS = new Set(["--network", "--stream-id", "--recipient"]);
const CLI_USAGE =
  "Usage: verify-commitment-sablier.ts --network <base|ethereum> --stream-id <integer> --recipient <0x-address>";

export function parseCommitmentSablierArguments(argv: readonly string[]) {
  const parsed = parseValueArguments(argv, CLI_ARGUMENTS, CLI_USAGE);
  return {
    network: parsed.get("--network") ?? null,
    streamId: parsed.get("--stream-id") ?? null,
    recipient: parsed.get("--recipient") ?? null,
  };
}

async function boundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      throw new TypeError("EVM RPC returned an invalid Content-Length");
    }
    if (parsedLength > MAX_EVM_COMMITMENT_RPC_BYTES) {
      throw new RangeError("EVM RPC response exceeded its size limit");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("EVM RPC returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_EVM_COMMITMENT_RPC_BYTES) {
        await reader.cancel("response exceeded size limit");
        throw new RangeError("EVM RPC response exceeded its size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError("EVM RPC response is not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) throw new RangeError("EVM RPC response is empty");
  return body;
}

async function rpcCall(
  rpc: URL,
  fetchImpl: FetchLike,
  method: string,
  params: readonly unknown[],
  id: string,
): Promise<unknown> {
  const response = await fetchImpl(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`EVM RPC ${method} returned HTTP ${response.status}`);
  }
  const responseBody = await boundedBody(response);
  let envelope: unknown;
  try {
    envelope = JSON.parse(responseBody);
  } catch (error) {
    throw new TypeError(`EVM RPC ${method} response is invalid JSON`, {
      cause: error,
    });
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new TypeError(`EVM RPC ${method} response is invalid`);
  }
  const body = envelope as Record<string, unknown>;
  if (body.jsonrpc !== "2.0" || body.id !== id) {
    throw new TypeError(`EVM RPC ${method} response identity is invalid`);
  }
  if (body.error !== undefined && body.error !== null) {
    throw new TypeError(
      `EVM RPC ${method} returned an error: ${JSON.stringify(body.error)}`,
    );
  }
  if (!("result" in body)) {
    throw new TypeError(`EVM RPC ${method} response has no result`);
  }
  return body.result;
}

function authorityRequest(
  authority: string,
  authorityIndex: number,
  fetchImpl: FetchLike,
) {
  const rpc = new URL(authority);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
    throw new TypeError("EVM RPC must be a credential-free HTTPS URL");
  }
  let requestIndex = 0;
  return {
    rpc,
    request: (method: string, params: readonly unknown[]) =>
      rpcCall(
        rpc,
        fetchImpl,
        method,
        params,
        `slop-commitment:${authorityIndex}:${requestIndex++}:${method}`,
      ),
  };
}

interface FinalizedEvmBlock {
  hash: string;
  number: number;
  numberHex: string;
}

/** Validates one authority's finalized block identity. */
export function assertEvmFinalizedBlock(value: unknown): FinalizedEvmBlock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("EVM finalized block is absent or invalid");
  }
  const block = value as Record<string, unknown>;
  if (
    typeof block.number !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(block.number)
  ) {
    throw new TypeError("EVM finalized block number is not canonical");
  }
  const number = BigInt(block.number);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("EVM finalized block number is out of range");
  }
  if (typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/u.test(block.hash)) {
    throw new TypeError("EVM finalized block hash is not canonical");
  }
  return { hash: block.hash, number: Number(number), numberHex: block.number };
}

function quorumGroups<Result>(
  settled: readonly PromiseSettledResult<{
    authority: string;
    block: FinalizedEvmBlock;
    verified: Result;
  }>[],
  identity: (verified: Result) => string,
) {
  const groups = new Map<
    string,
    Array<{ authority: string; block: FinalizedEvmBlock; verified: Result }>
  >();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const key = identity(result.value.verified);
    const group = groups.get(key) ?? [];
    group.push(result.value);
    groups.set(key, group);
  }
  const agreeing = [...groups.values()].sort(
    (left, right) => right.length - left.length,
  )[0];
  if (!agreeing || agreeing.length < EVM_COMMITMENT_RPC_QUORUM) {
    throw new TypeError("EVM RPC authorities did not reach commitment quorum");
  }
  return agreeing;
}

/** Reads one authority's stream state at its own finalized block. */
async function readStreamAtFinalizedBlock(
  network: SablierNetwork,
  streamId: string,
  recipient: string,
  authority: string,
  index: number,
  fetchImpl: FetchLike,
) {
  const contract = SABLIER_LOCKUP_V4_CONTRACTS[network];
  const { rpc, request } = authorityRequest(authority, index, fetchImpl);
  const chainId = await request("eth_chainId", []);
  if (chainId !== EVM_CHAIN_IDS[network]) {
    throw new TypeError("EVM RPC chain id is not the declared network");
  }
  const block = assertEvmFinalizedBlock(
    await request("eth_getBlockByNumber", ["finalized", false]),
  );
  const callResults: Partial<Record<SablierStreamCall, unknown>> = {};
  for (const [call, data] of Object.entries(sablierStreamCallData(streamId))) {
    callResults[call as SablierStreamCall] = await request("eth_call", [
      { to: contract, data },
      block.numberHex,
    ]);
  }
  const verified = assertSablierStreamState(
    callResults as Record<SablierStreamCall, unknown>,
    network,
    streamId,
    { blockNumber: block.number, recipient },
  );
  return { authority: rpc.toString(), block, request, verified };
}

/** One Base settlement source observation agreed by the RPC quorum. */
export interface BaseSourceObservation {
  network: "base";
  blockNumber: number;
  blockHash: string;
  recipient: string;
  recipientCode: string;
  balanceMinor: string;
  stream: {
    streamId: string;
    wasCanceled: boolean;
    isDepleted: boolean;
    lockedMinor: string;
  };
}

/**
 * RFC #472 release readiness for a Base stream. At each authority's finalized
 * block it proves the stream state (USDC, exact recipient, non-cancelable),
 * reads the recipient's code (an EOA has none) and its USDC balance. Two
 * authorities must agree on the same block and every value. Read-only.
 */
export async function observeBaseSettlementSource(input: {
  fetchImpl?: FetchLike;
  recipient: string;
  streamId: string;
}): Promise<BaseSourceObservation> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (
    !isSablierStreamId(input.streamId) ||
    !isFundingAddress("base", input.recipient)
  ) {
    throw new TypeError("stream id or recipient is not canonical");
  }
  const balanceCall = `0x70a08231${input.recipient.slice(2).padStart(64, "0")}`;
  const settled = await Promise.allSettled(
    EVM_COMMITMENT_RPC_AUTHORITIES.base.map(async (authority, index) => {
      const read = await readStreamAtFinalizedBlock(
        "base",
        input.streamId,
        input.recipient,
        authority,
        index,
        fetchImpl,
      );
      const code = await read.request("eth_getCode", [
        input.recipient,
        read.block.numberHex,
      ]);
      const balance = await read.request("eth_call", [
        { to: EVM_FUNDING_USDC_CONTRACTS.base, data: balanceCall },
        read.block.numberHex,
      ]);
      if (
        typeof code !== "string" ||
        !/^0x(?:[0-9a-f]{2})*$/u.test(code) ||
        typeof balance !== "string" ||
        !/^0x[0-9a-f]{64}$/u.test(balance)
      ) {
        throw new TypeError("EVM recipient code or balance is malformed");
      }
      return {
        authority: read.authority,
        block: read.block,
        verified: {
          network: "base" as const,
          blockNumber: read.block.number,
          blockHash: read.block.hash,
          recipient: input.recipient,
          recipientCode: code,
          balanceMinor: BigInt(balance).toString(),
          stream: {
            streamId: input.streamId,
            wasCanceled: read.verified.wasCanceled,
            isDepleted: read.verified.isDepleted,
            lockedMinor: read.verified.lockedMinor,
          },
        },
      };
    }),
  );
  // Authorities may sit at adjacent finalized blocks; every observed value
  // must agree, and the result reports the newest agreeing block.
  const agreeing = quorumGroups<BaseSourceObservation>(
    settled,
    ({ blockNumber: _number, blockHash: _hash, ...values }) =>
      JSON.stringify(values),
  );
  return agreeing.reduce((newest, entry) =>
    entry.verified.blockNumber > newest.verified.blockNumber ? entry : newest,
  ).verified;
}

async function verifyStreamState(
  network: SablierNetwork,
  streamId: string,
  recipient: string,
  fetchImpl: FetchLike,
) {
  const contract = SABLIER_LOCKUP_V4_CONTRACTS[network];
  const settled = await Promise.allSettled(
    EVM_COMMITMENT_RPC_AUTHORITIES[network].map(async (authority, index) => {
      const { request: _request, ...read } = await readStreamAtFinalizedBlock(
        network,
        streamId,
        recipient,
        authority,
        index,
        fetchImpl,
      );
      return read;
    }),
  );
  const agreeing = quorumGroups<VerifiedSablierStream>(settled, (verified) =>
    JSON.stringify([
      verified.streamId,
      verified.recipient,
      verified.sender,
      verified.depositedMinor,
      verified.withdrawnMinor,
      verified.refundedMinor,
      verified.lockedMinor,
      verified.endTime,
      verified.wasCanceled,
      verified.isDepleted,
      contract,
    ]),
  );
  const checkedAt = new Date().toISOString();
  const canonical = agreeing[0].verified;
  return {
    mode: "state" as const,
    state: "verified-on-chain" as const,
    network,
    contract,
    streamId,
    recipient,
    sender: canonical.sender,
    depositedMinor: canonical.depositedMinor,
    withdrawnMinor: canonical.withdrawnMinor,
    refundedMinor: canonical.refundedMinor,
    lockedMinor: canonical.lockedMinor,
    endTime: canonical.endTime,
    wasCanceled: canonical.wasCanceled,
    isDepleted: canonical.isDepleted,
    blockNumber: Math.max(...agreeing.map(({ block }) => block.number)),
    verifier: {
      version: COMMITMENT_SABLIER_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `${EVM_EXPLORER_AUTHORITIES[network]}/address/${contract}`,
      reason: null,
    },
    authorities: agreeing.map(({ authority, block }) => ({
      authority,
      blockNumber: block.number,
      blockHash: block.hash,
    })),
  };
}

export async function verifyCommitmentSablier(input: CommitmentSablierInput) {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.network !== "base" && input.network !== "ethereum") {
    throw new TypeError("network must be base or ethereum");
  }
  if (!isSablierStreamId(input.streamId)) {
    throw new TypeError("stream id is not a canonical uint256 integer");
  }
  if (!isFundingAddress(input.network, input.recipient)) {
    throw new TypeError("recipient is not a canonical EVM address");
  }
  return verifyStreamState(
    input.network,
    input.streamId,
    input.recipient,
    fetchImpl,
  );
}

if (import.meta.main) {
  const parsed = parseCommitmentSablierArguments(process.argv.slice(2));
  if (!parsed.network || !parsed.streamId || !parsed.recipient) {
    throw new TypeError(CLI_USAGE);
  }
  process.stdout.write(
    `${JSON.stringify(
      await verifyCommitmentSablier({
        network: parsed.network,
        streamId: parsed.streamId,
        recipient: parsed.recipient,
      }),
      null,
      2,
    )}\n`,
  );
}
