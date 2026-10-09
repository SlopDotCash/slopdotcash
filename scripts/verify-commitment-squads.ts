/**
 * Read-only Squads v4 commitment verifier for Solana mainnet USDC. It queries
 * three fixed public RPC authorities at finalized commitment, requires two to
 * agree on the exact result, and emits reviewed commitment evidence. It checks
 * the 2-of-2 commitment shape or, when the three project vault members are
 * given, the 2-of-3 project vault shape. It never reads a key, signs,
 * broadcasts, or writes a commitment record.
 */

import {
  isFundingAddress,
  isSolanaTransactionId,
} from "../src/lib/funding-address.mjs";
import {
  type FetchLike,
  fetchWithRateLimitRetry,
} from "../src/lib/rate-limited-fetch";
import {
  assertFinalizedUsdcFundingTransfer,
  assertFinalizedUsdcTransfer,
  type VerifiedSolanaTransaction,
} from "../src/lib/solana-settlement";
import {
  assertSquadsProjectVaultIdentity,
  assertSquadsProjectVaultUsdcState,
  assertSquadsVaultIdentity,
  assertSquadsVaultUsdcState,
  COMMITMENT_SQUADS_VERIFIER_VERSION,
  PROJECT_VAULT_PERMISSIONS,
  PROJECT_VAULT_SQUADS_VERIFIER_VERSION,
  type SquadsProjectVaultMembers,
  type VerifiedSquadsProjectVaultIdentity,
  type VerifiedSquadsProjectVaultState,
  type VerifiedSquadsVaultState,
} from "../src/lib/squads-funding";
import { parseValueArguments } from "./parse-value-arguments";

export const SOLANA_COMMITMENT_RPC_AUTHORITIES = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://public.rpc.solanavibestation.com",
] as const;
const SOLANA_COMMITMENT_RPC_QUORUM = 2;
export const MAX_SOLANA_COMMITMENT_RPC_BYTES = 8 * 1024 * 1024;

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

export interface ProjectVaultSquadsInput extends SquadsProjectVaultMembers {
  amountMinor?: string;
  fetchImpl?: FetchLike;
  mode: CommitmentVerificationMode;
  recipient?: string;
  signature?: string;
  tokenAccount?: string;
  multisig: string;
  vault: string;
  vaultIndex: number;
}

const CLI_ARGUMENTS = new Set([
  "--mode",
  "--creator-member",
  "--funder-member",
  "--independent-member",
  "--slop-member",
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
  "Usage: verify-commitment-squads.ts --mode state --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --token-account <token-account> | --mode deposit --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --signature <signature> --amount-minor <integer> | --mode <release|refund> --multisig <multisig> --vault <vault> --vault-index <0..255> --funder-member <pubkey> --steward-member <pubkey> --recipient <owner> --signature <signature> --amount-minor <integer>. For a 2-of-3 project vault, replace --funder-member and --steward-member in any mode with --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey>";

export function parseCommitmentSquadsArguments(argv: readonly string[]) {
  const parsed = parseValueArguments(argv, CLI_ARGUMENTS, CLI_USAGE);
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
    creatorMember: parsed.get("--creator-member") ?? null,
    slopMember: parsed.get("--slop-member") ?? null,
    independentMember: parsed.get("--independent-member") ?? null,
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
  const response = await fetchWithRateLimitRetry(fetchImpl, rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "error",
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

export function authorityRequest(
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

export function quorumGroups<Result>(
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

export function finalizedAccountValue(resultValue: unknown): {
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

async function observeVaultState<State>(
  multisig: string,
  tokenAccount: string,
  fetchImpl: FetchLike,
  assertState: (result: unknown) => Promise<State>,
  identity: (verified: State) => string,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const verified = await assertState(
        await request("getMultipleAccounts", [
          [multisig, tokenAccount],
          { commitment: "finalized", encoding: "jsonParsed" },
        ]),
      );
      return { authority: rpc.toString(), verified };
    }),
  );
  return quorumGroups<State>(settled, identity);
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
  const agreeing = await observeVaultState<VerifiedSquadsVaultState>(
    multisig,
    tokenAccount,
    fetchImpl,
    (result) =>
      assertSquadsVaultUsdcState(
        result,
        multisig,
        vault,
        vaultIndex,
        tokenAccount,
        funderMember,
        stewardMember,
      ),
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

async function observeVaultTransaction<Identity>(
  mode: "deposit" | "refund" | "release",
  input: {
    amountMinor: string;
    multisig: string;
    recipient: string | null;
    signature: string;
    vault: string;
  },
  fetchImpl: FetchLike,
  assertIdentity: (account: unknown) => Promise<Identity>,
  identityKey: (identity: Identity) => string,
) {
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      const { rpc, request } = authorityRequest(authority, index, fetchImpl);
      const multisigResult = await request("getAccountInfo", [
        input.multisig,
        { commitment: "finalized", encoding: "base64" },
      ]);
      const multisigEnvelope = finalizedAccountValue(multisigResult);
      const identity = await assertIdentity(multisigEnvelope.value);
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
  return quorumGroups<{
    identity: Identity;
    transaction: VerifiedSolanaTransaction;
  }>(
    settled,
    (verified) =>
      `${identityKey(verified.identity)}:${verified.transaction.signature}:${verified.transaction.slot}:${verified.transaction.blockTime}`,
  );
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
  const agreeing = await observeVaultTransaction(
    mode,
    input,
    fetchImpl,
    (account) =>
      assertSquadsVaultIdentity(
        account,
        input.multisig,
        input.vault,
        input.vaultIndex,
        input.funderMember,
        input.stewardMember,
      ),
    (identity) => `${identity.multisig}:${identity.vaultIndex}`,
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

function transactionFields(input: {
  amountMinor?: string;
  mode: CommitmentVerificationMode;
  recipient?: string;
  signature?: string;
  tokenAccount?: string;
  vault: string;
}) {
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
  return {
    amountMinor: input.amountMinor,
    mode: input.mode,
    recipient: input.recipient ?? null,
    signature: input.signature,
  };
}

function projectVaultEvidence(
  identity: VerifiedSquadsProjectVaultIdentity,
  checkedAt: string,
  evidenceUrl: string,
) {
  return {
    instrument: "squads-project-vault" as const,
    creatorMember: identity.creatorMember,
    slopMember: identity.slopMember,
    independentMember: identity.independentMember,
    multisig: identity.multisig,
    vault: identity.vault,
    vaultIndex: identity.vaultIndex,
    threshold: identity.threshold,
    permissions: PROJECT_VAULT_PERMISSIONS,
    configAuthority: null,
    timeLockSeconds: identity.timeLockSeconds,
    verifier: {
      version: PROJECT_VAULT_SQUADS_VERIFIER_VERSION,
      checkedAt,
      evidenceUrl,
      reason: null,
    },
  };
}

/**
 * Read-only evidence for the 2-of-3 project vault shape. The same quorum,
 * modes, and transfer checks as the 2-of-2 commitment; only the reviewed
 * multisig shape differs. A changed time lock splits the quorum.
 */
export async function verifyProjectVaultSquads(input: ProjectVaultSquadsInput) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const members = {
    creatorMember: input.creatorMember,
    slopMember: input.slopMember,
    independentMember: input.independentMember,
  };
  if (
    !isFundingAddress("solana", input.multisig) ||
    !isFundingAddress("solana", input.vault) ||
    !isFundingAddress("solana", input.creatorMember) ||
    !isFundingAddress("solana", input.slopMember) ||
    !isFundingAddress("solana", input.independentMember) ||
    new Set(Object.values(members)).size !== 3 ||
    !Number.isInteger(input.vaultIndex) ||
    input.vaultIndex < 0 ||
    input.vaultIndex > 255
  ) {
    throw new TypeError("multisig, vault, or vault index is invalid");
  }
  const { multisig, vault, vaultIndex } = input;
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
    const tokenAccount = input.tokenAccount as string;
    const agreeing = await observeVaultState<VerifiedSquadsProjectVaultState>(
      multisig,
      tokenAccount,
      fetchImpl,
      (result) =>
        assertSquadsProjectVaultUsdcState(
          result,
          multisig,
          vault,
          vaultIndex,
          tokenAccount,
          members,
        ),
      (verified) => `${verified.balanceMinor}:${verified.timeLockSeconds}`,
    );
    return {
      mode: "state" as const,
      state: "verified-on-chain" as const,
      ...projectVaultEvidence(
        agreeing[0].verified,
        new Date().toISOString(),
        `https://solscan.io/account/${vault}`,
      ),
      tokenAccount,
      balanceMinor: agreeing[0].verified.balanceMinor,
      slot: Math.max(...agreeing.map(({ verified }) => verified.slot)),
      authorities: agreeing.map(({ authority, verified }) => ({
        authority,
        slot: verified.slot,
      })),
    };
  }
  const transfer = transactionFields(input);
  const agreeing = await observeVaultTransaction(
    transfer.mode,
    { ...transfer, multisig, vault },
    fetchImpl,
    (account) =>
      assertSquadsProjectVaultIdentity(
        account,
        multisig,
        vault,
        vaultIndex,
        members,
      ),
    (identity) =>
      `${identity.multisig}:${identity.vaultIndex}:${identity.timeLockSeconds}`,
  );
  return {
    mode: transfer.mode,
    event: transfer.mode,
    state: "verified-on-chain" as const,
    ...projectVaultEvidence(
      agreeing[0].verified.identity,
      new Date().toISOString(),
      `https://solscan.io/tx/${transfer.signature}`,
    ),
    finality: { kind: "finalized" as const },
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
  const transfer = transactionFields(input);
  return verifyVaultTransaction(
    transfer.mode,
    {
      amountMinor: transfer.amountMinor,
      funderMember: input.funderMember,
      multisig: input.multisig,
      recipient: transfer.recipient,
      signature: transfer.signature,
      stewardMember: input.stewardMember,
      vault: input.vault,
      vaultIndex: input.vaultIndex,
    },
    fetchImpl,
  );
}

if (import.meta.main) {
  const parsed = parseCommitmentSquadsArguments(process.argv.slice(2));
  const projectVault = Boolean(
    parsed.creatorMember || parsed.slopMember || parsed.independentMember,
  );
  if (
    !parsed.mode ||
    !parsed.multisig ||
    !parsed.vault ||
    parsed.vaultIndex === null ||
    (projectVault
      ? !parsed.creatorMember ||
        !parsed.slopMember ||
        !parsed.independentMember ||
        parsed.funderMember ||
        parsed.stewardMember
      : !parsed.funderMember || !parsed.stewardMember) ||
    (parsed.mode === "state"
      ? !parsed.tokenAccount
      : !parsed.signature || !parsed.amountMinor)
  ) {
    throw new TypeError(CLI_USAGE);
  }
  const shared = {
    mode: parsed.mode as CommitmentVerificationMode,
    multisig: parsed.multisig,
    vault: parsed.vault,
    vaultIndex: Number(parsed.vaultIndex),
    tokenAccount: parsed.tokenAccount ?? undefined,
    signature: parsed.signature ?? undefined,
    recipient: parsed.recipient ?? undefined,
    amountMinor: parsed.amountMinor ?? undefined,
  };
  process.stdout.write(
    `${JSON.stringify(
      projectVault
        ? await verifyProjectVaultSquads({
            ...shared,
            creatorMember: parsed.creatorMember as string,
            slopMember: parsed.slopMember as string,
            independentMember: parsed.independentMember as string,
          })
        : await verifyCommitmentSquads({
            ...shared,
            funderMember: parsed.funderMember as string,
            stewardMember: parsed.stewardMember as string,
          }),
      null,
      2,
    )}\n`,
  );
}
