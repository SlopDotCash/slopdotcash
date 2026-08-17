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
  assertSquadsVaultIdentity,
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
  funderMember: string;
  mode: CommitmentVerificationMode;
  recipient?: string;
  signature?: string;
  stewardMember: string;
  tokenAccount?: string;
  multisig: string;
  vault: string;
  vaultIndex: number;
}

const CLI_ARGUMENTS = new Set([
  "--mode",
  "--funder-member",
  "--multisig",
  "--vault",
  "--vault-index",
  "--token-account",
  "--signature",
  "--recipient",
  "--steward-member",
  "--amount-minor",
]);
const CLI_USAGE =
  "Usage: verify-commitment-squads.ts --mode state --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --token-account <token-account> | --mode deposit --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --signature <signature> --amount-minor <integer> | --mode <release|refund> --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --recipient <owner> --signature <signature> --amount-minor <integer>";

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
    multisig: parsed.get("--multisig") ?? null,
    vault: parsed.get("--vault") ?? null,
    vaultIndex: parsed.get("--vault-index") ?? null,
    tokenAccount: parsed.get("--token-account") ?? null,
    signature: parsed.get("--signature") ?? null,
    recipient: parsed.get("--recipient") ?? null,
    amountMinor: parsed.get("--amount-minor") ?? null,
    funderMember: parsed.get("--funder-member") ?? null,
    stewardMember: parsed.get("--steward-member") ?? null,
  };
}

async function boundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
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
        await reader.cancel("response exceeded size limit");
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
  } finally {
    reader.releaseLock();
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

function finalizedAccountValue(resultValue: unknown): {
  slot: number;
  value: unknown;
} {
  if (
    typeof resultValue !== "object" ||
    resultValue === null ||
    Array.isArray(resultValue)
  ) {
    throw new TypeError("Solana multisig account response is invalid");
  }
  const result = resultValue as Record<string, unknown>;
  if (
    typeof result.context !== "object" ||
    result.context === null ||
    Array.isArray(result.context)
  ) {
    throw new TypeError("Solana multisig account response context is invalid");
  }
  const observedSlot = (result.context as Record<string, unknown>).slot;
  if (!Number.isSafeInteger(observedSlot) || Number(observedSlot) < 0) {
    throw new TypeError("Solana multisig account response slot is invalid");
  }
  if (!("value" in result)) {
    throw new TypeError("Solana multisig account response has no value");
  }
  return { slot: Number(observedSlot), value: result.value };
}

async function verifyVaultState(
  funderMember: string,
  multisig: string,
  vault: string,
  vaultIndex: number,
  tokenAccount: string,
  stewardMember: string,
  fetchImpl: FetchLike,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const verified = await assertSquadsVaultUsdcState(
        await request("getMultipleAccounts", [
          [multisig, tokenAccount],
          { commitment: "finalized", encoding: "jsonParsed" },
        ]),
        multisig,
        vault,
        vaultIndex,
        tokenAccount,
        funderMember,
        stewardMember,
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
    funderMember,
    multisig,
    vault,
    vaultIndex,
    tokenAccount,
    balanceMinor: agreeing[0].verified.balanceMinor,
    slot: Math.max(...agreeing.map(({ verified }) => verified.slot)),
    stewardMember,
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
    funderMember: string;
    multisig: string;
    recipient: string | null;
    signature: string;
    stewardMember: string;
    vault: string;
    vaultIndex: number;
  },
  fetchImpl: FetchLike,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const multisigResult = await request("getAccountInfo", [
        input.multisig,
        { commitment: "finalized", encoding: "base64" },
      ]);
      const multisigEnvelope = finalizedAccountValue(multisigResult);
      const identity = await assertSquadsVaultIdentity(
        multisigEnvelope.value,
        input.multisig,
        input.vault,
        input.vaultIndex,
        input.funderMember,
        input.stewardMember,
      );
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
      const transaction =
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
      return { authority: rpc.toString(), verified: { identity, transaction } };
    }),
  );
  const agreeing = quorumGroups<{
    identity: Awaited<ReturnType<typeof assertSquadsVaultIdentity>>;
    transaction: VerifiedSolanaTransaction;
  }>(
    settled,
    (verified) =>
      `${verified.identity.multisig}:${verified.identity.vaultIndex}:${verified.transaction.signature}:${verified.transaction.slot}:${verified.transaction.blockTime}`,
  );
  const checkedAt = new Date().toISOString();
  return {
    mode,
    event: mode,
    state: "verified-on-chain" as const,
    funderMember: input.funderMember,
    multisig: input.multisig,
    vault: input.vault,
    vaultIndex: input.vaultIndex,
    finality: { kind: "finalized" as const },
    stewardMember: input.stewardMember,
    verifier: {
      version: COMMITMENT_SQUADS_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl: `https://solscan.io/tx/${input.signature}`,
      reason: null,
    },
    chainEvidence: agreeing[0].verified.transaction,
    authorities: agreeing.map(({ authority }) => ({ authority })),
  };
}

export async function verifyCommitmentSquads(input: CommitmentSquadsInput) {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (
    !isFundingAddress("solana", input.multisig) ||
    !isFundingAddress("solana", input.vault) ||
    !isFundingAddress("solana", input.funderMember) ||
    !isFundingAddress("solana", input.stewardMember) ||
    input.funderMember === input.stewardMember ||
    !Number.isInteger(input.vaultIndex) ||
    input.vaultIndex < 0 ||
    input.vaultIndex > 255
  ) {
    throw new TypeError("multisig, vault, or vault index is invalid");
  }
  if (input.mode === "state") {
    if (
      input.signature !== undefined ||
      input.recipient !== undefined ||
      input.amountMinor !== undefined ||
      !isFundingAddress("solana", input.tokenAccount)
    ) {
      throw new TypeError(
        "state mode requires a vault token account and no transaction fields",
      );
    }
    return verifyVaultState(
      input.funderMember,
      input.multisig,
      input.vault,
      input.vaultIndex,
      input.tokenAccount as string,
      input.stewardMember,
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
      funderMember: input.funderMember,
      multisig: input.multisig,
      recipient: input.recipient ?? null,
      signature: input.signature,
      stewardMember: input.stewardMember,
      vault: input.vault,
      vaultIndex: input.vaultIndex,
    },
    fetchImpl,
  );
}

if (import.meta.main) {
  const parsed = parseCommitmentSquadsArguments(process.argv.slice(2));
  if (
    !parsed.mode ||
    !parsed.funderMember ||
    !parsed.multisig ||
    !parsed.stewardMember ||
    !parsed.vault ||
    parsed.vaultIndex === null ||
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
        funderMember: parsed.funderMember,
        multisig: parsed.multisig,
        vault: parsed.vault,
        vaultIndex: Number(parsed.vaultIndex),
        tokenAccount: parsed.tokenAccount ?? undefined,
        signature: parsed.signature ?? undefined,
        stewardMember: parsed.stewardMember,
        recipient: parsed.recipient ?? undefined,
        amountMinor: parsed.amountMinor ?? undefined,
      }),
      null,
      2,
    )}\n`,
  );
}
