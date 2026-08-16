/**
 * Read-only Squads v4 commitment verifier for Solana mainnet USDC. It queries
 * three fixed public RPC authorities at finalized commitment, requires two to
 * agree on the exact result, and emits reviewed commitment evidence. It never
 * reads a key, signs, broadcasts, or writes a commitment record.
 */

import {
  isFundingAddress,
  isSolanaTransactionId,
} from "../src/lib/funding-address.mjs";
import {
  assertFinalizedUsdcFundingTransfer,
  assertFinalizedUsdcTransfer,
  type VerifiedSolanaTransaction,
} from "../src/lib/solana-settlement";
import {
  assertSquadsVaultUsdcState,
  COMMITMENT_SQUADS_VERIFIER_VERSION,
  type VerifiedSquadsVaultState,
} from "../src/lib/squads-funding";

export const SOLANA_COMMITMENT_RPC_AUTHORITIES = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
] as const;
const SOLANA_COMMITMENT_RPC_QUORUM = 2;
export const MAX_SOLANA_COMMITMENT_RPC_BYTES = 8 * 1024 * 1024;

type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;

export type CommitmentVerificationMode =
  | "deposit"
  | "refund"
  | "release"
  | "state";

export interface CommitmentSquadsInput {
  amountMinor?: string;
  fetchImpl?: FetchLike;
  mode: CommitmentVerificationMode;
  recipient?: string;
  signature?: string;
  tokenAccount?: string;
  vault: string;
}

const CLI_ARGUMENTS = new Set([
  "--mode",
  "--vault",
  "--token-account",
  "--signature",
  "--recipient",
  "--amount-minor",
]);
const CLI_USAGE =
  "Usage: verify-commitment-squads.ts --mode state --vault <vault> --token-account <token-account> | --mode deposit --vault <vault> --signature <signature> --amount-minor <integer> | --mode <release|refund> --vault <vault> --recipient <owner> --signature <signature> --amount-minor <integer>";

export function parseCommitmentSquadsArguments(argv: readonly string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name ||
      !CLI_ARGUMENTS.has(name) ||
      !value ||
      value.startsWith("--") ||
      parsed.has(name)
    ) {
      throw new TypeError(CLI_USAGE);
    }
    parsed.set(name, value);
  }
  return {
    mode: parsed.get("--mode") ?? null,
    vault: parsed.get("--vault") ?? null,
    tokenAccount: parsed.get("--token-account") ?? null,
    signature: parsed.get("--signature") ?? null,
    recipient: parsed.get("--recipient") ?? null,
    amountMinor: parsed.get("--amount-minor") ?? null,
  };
}

async function boundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new TypeError("Solana RPC returned an invalid Content-Length");
    }
    if (parsedLength > MAX_SOLANA_COMMITMENT_RPC_BYTES) {
      throw new RangeError("Solana RPC response exceeded its size limit");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Solana RPC returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_SOLANA_COMMITMENT_RPC_BYTES) {
        throw new RangeError("Solana RPC response exceeded its size limit");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError("Solana RPC response is not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
  }
  if (byteLength === 0) throw new RangeError("Solana RPC response is empty");
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
    throw new Error(`Solana RPC ${method} returned HTTP ${response.status}`);
  }
  const responseBody = await boundedBody(response);
  let envelope: unknown;
  try {
    envelope = JSON.parse(responseBody);
  } catch (error) {
    throw new TypeError(`Solana RPC ${method} response is invalid JSON`, {
      cause: error,
    });
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new TypeError(`Solana RPC ${method} response is invalid`);
  }
  const body = envelope as Record<string, unknown>;
  if (body.jsonrpc !== "2.0" || body.id !== id) {
    throw new TypeError(`Solana RPC ${method} response identity is invalid`);
  }
  if (body.error !== undefined && body.error !== null) {
    throw new TypeError(
      `Solana RPC ${method} returned an error: ${JSON.stringify(body.error)}`,
    );
  }
  if (!("result" in body)) {
    throw new TypeError(`Solana RPC ${method} response has no result`);
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
    throw new TypeError("Solana RPC must be a credential-free HTTPS URL");
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

function quorumGroups<Result>(
  settled: readonly PromiseSettledResult<{
    authority: string;
    verified: Result;
  }>[],
  identity: (verified: Result) => string,
) {
  const groups = new Map<
    string,
    Array<{ authority: string; verified: Result }>
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
  if (!agreeing || agreeing.length < SOLANA_COMMITMENT_RPC_QUORUM) {
    throw new TypeError(
      "Solana RPC authorities did not reach commitment quorum",
    );
  }
  return agreeing;
}

async function verifyVaultState(
  vault: string,
  tokenAccount: string,
  fetchImpl: FetchLike,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const verified = assertSquadsVaultUsdcState(
        await request("getAccountInfo", [
          tokenAccount,
          { commitment: "finalized", encoding: "jsonParsed" },
        ]),
        vault,
        tokenAccount,
      );
      return { authority: rpc.toString(), verified };
    }),
  );
  const agreeing = quorumGroups<VerifiedSquadsVaultState>(
    settled,
    (verified) => verified.balanceMinor,
  );
  const checkedAt = new Date().toISOString();
  return {
    mode: "state" as const,
    state: "verified-on-chain" as const,
    vault,
    tokenAccount,
    balanceMinor: agreeing[0].verified.balanceMinor,
    slot: Math.max(...agreeing.map(({ verified }) => verified.slot)),
    verifier: {
      version: COMMITMENT_SQUADS_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://solscan.io/account/${vault}`,
      reason: null,
    },
    authorities: agreeing.map(({ authority, verified }) => ({
      authority,
      slot: verified.slot,
    })),
  };
}

async function verifyVaultTransaction(
  mode: "deposit" | "refund" | "release",
  input: {
    amountMinor: string;
    recipient: string | null;
    signature: string;
    vault: string;
  },
  fetchImpl: FetchLike,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const result = await request("getTransaction", [
        input.signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (result === null || result === undefined) {
        throw new TypeError(
          "Solana transaction is absent at finalized commitment",
        );
      }
      const verified =
        mode === "deposit"
          ? assertFinalizedUsdcFundingTransfer(
              result,
              input.signature,
              input.vault,
              input.amountMinor,
            )
          : assertFinalizedUsdcTransfer(result, input.signature, input.vault, [
              {
                amountMinor: input.amountMinor,
                recipientOwner: input.recipient as string,
              },
            ]);
      return { authority: rpc.toString(), verified };
    }),
  );
  const agreeing = quorumGroups<VerifiedSolanaTransaction>(
    settled,
    (verified) =>
      `${verified.signature}:${verified.slot}:${verified.blockTime}`,
  );
  const checkedAt = new Date().toISOString();
  return {
    mode,
    event: mode,
    state: "verified-on-chain" as const,
    finality: { kind: "finalized" as const },
    verifier: {
      version: COMMITMENT_SQUADS_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://solscan.io/tx/${input.signature}`,
      reason: null,
    },
    chainEvidence: agreeing[0].verified,
    authorities: agreeing.map(({ authority }) => ({ authority })),
  };
}

export async function verifyCommitmentSquads(input: CommitmentSquadsInput) {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!isFundingAddress("solana", input.vault)) {
    throw new TypeError("vault is not a Solana public key");
  }
  if (input.mode === "state") {
    if (
      input.signature !== undefined ||
      input.recipient !== undefined ||
      input.amountMinor !== undefined ||
      !isFundingAddress("solana", input.tokenAccount)
    ) {
      throw new TypeError("state mode requires only a vault token account");
    }
    return verifyVaultState(
      input.vault,
      input.tokenAccount as string,
      fetchImpl,
    );
  }
  if (
    input.mode !== "deposit" &&
    input.mode !== "release" &&
    input.mode !== "refund"
  ) {
    throw new TypeError("mode is invalid");
  }
  if (
    input.tokenAccount !== undefined ||
    typeof input.signature !== "string" ||
    !isSolanaTransactionId(input.signature) ||
    typeof input.amountMinor !== "string" ||
    input.amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(input.amountMinor)
  ) {
    throw new TypeError("signature or amount is invalid");
  }
  if (input.mode === "deposit") {
    if (input.recipient !== undefined) {
      throw new TypeError("deposit mode credits only the declared vault");
    }
  } else if (
    !isFundingAddress("solana", input.recipient) ||
    input.recipient === input.vault
  ) {
    throw new TypeError(
      `${input.mode} mode requires an explicit recipient distinct from the vault`,
    );
  }
  return verifyVaultTransaction(
    input.mode,
    {
      amountMinor: input.amountMinor,
      recipient: input.recipient ?? null,
      signature: input.signature,
      vault: input.vault,
    },
    fetchImpl,
  );
}

if (import.meta.main) {
  const parsed = parseCommitmentSquadsArguments(process.argv.slice(2));
  if (
    !parsed.mode ||
    !parsed.vault ||
    (parsed.mode === "state"
      ? !parsed.tokenAccount
      : !parsed.signature || !parsed.amountMinor)
  ) {
    throw new TypeError(CLI_USAGE);
  }
  process.stdout.write(
    `${JSON.stringify(
      await verifyCommitmentSquads({
        mode: parsed.mode as CommitmentVerificationMode,
        vault: parsed.vault,
        tokenAccount: parsed.tokenAccount ?? undefined,
        signature: parsed.signature ?? undefined,
        recipient: parsed.recipient ?? undefined,
        amountMinor: parsed.amountMinor ?? undefined,
      }),
      null,
      2,
    )}\n`,
  );
}
