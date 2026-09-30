/**
 * Read-only rule checks for the 2-of-3 project vault proposed in RFC #500.
 * Two rules are kept by signer agreement, not by the Squads program, so this
 * verifier checks them after the fact from finalized transaction history:
 * the fallback wait on one payout, and the absence of any spending limit. A
 * third mode checks that the creator seat is the vault of the creator's own
 * multisig. It uses the same fixed public RPC authorities and quorum as the
 * commitment verifier. It never reads a key, signs, broadcasts, or writes a record.
 */

import {
  isFundingAddress,
  isSolanaTransactionId,
} from "../src/lib/funding-address.mjs";
import {
  assertSquadsCreatorSeat,
  assertSquadsProjectVaultIdentity,
  deriveSquadsProposalAddress,
  PROJECT_VAULT_PERMISSIONS,
  type SquadsProjectVaultMembers,
  type VerifiedSquadsCreatorSeat,
  type VerifiedSquadsProjectVaultIdentity,
} from "../src/lib/squads-funding";
import {
  assertNoSpendingLimitHistory,
  assertProposalVoteHistory,
  assertSquadsHistoryEntry,
  type ProposalVoteReport,
  type SpendingLimitReport,
  type SquadsHistoryEntry,
} from "../src/lib/squads-history";
import {
  authorityRequest,
  type FetchLike,
  finalizedAccountValue,
  quorumGroups,
  SOLANA_COMMITMENT_RPC_AUTHORITIES,
} from "./verify-commitment-squads";

export const PROJECT_VAULT_RULES_VERIFIER_VERSION =
  "project-vault-rules-v1" as const;
const HISTORY_PAGE_SIZE = 1000;
const MAX_HISTORY_PAGES = 10;
const RATE_LIMIT_RETRIES = 5;

type RuleReport =
  | {
      creatorSeat: VerifiedSquadsCreatorSeat;
      rule: "creator-seat";
      slot: number;
    }
  | ({ rule: "fallback-wait" } & ProposalVoteReport)
  | ({ rule: "no-spending-limits" } & SpendingLimitReport);
interface RuleObservation {
  authority: string;
  verified: {
    identity: VerifiedSquadsProjectVaultIdentity;
    report: RuleReport;
  };
}

export interface ProjectVaultRulesInput extends SquadsProjectVaultMembers {
  creatorMultisig?: string;
  creatorVaultIndex?: number;
  fallbackWaitSeconds?: number;
  fetchImpl?: FetchLike;
  mode: "creator-seat" | "fallback-wait" | "spending-limits";
  multisig: string;
  retryDelayMs?: number;
  transactionIndex?: number;
  vault: string;
  vaultIndex: number;
}

const CLI_ARGUMENTS = new Set([
  "--mode",
  "--multisig",
  "--vault",
  "--vault-index",
  "--creator-member",
  "--slop-member",
  "--independent-member",
  "--transaction-index",
  "--fallback-wait-seconds",
  "--creator-multisig",
  "--creator-vault-index",
]);
const CLI_USAGE =
  "Usage: verify-project-vault-rules.ts --mode fallback-wait --multisig <multisig> --vault <vault> --vault-index <0..255> --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> --transaction-index <integer> --fallback-wait-seconds <integer> | --mode spending-limits --multisig <multisig> --vault <vault> --vault-index <0..255> --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> | --mode creator-seat --multisig <multisig> --vault <vault> --vault-index <0..255> --creator-member <pubkey> --slop-member <pubkey> --independent-member <pubkey> --creator-multisig <pubkey> [--creator-vault-index <0..255>]";

export function parseProjectVaultRulesArguments(argv: readonly string[]) {
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
  const mode = parsed.get("--mode");
  const integer = (name: string) => {
    const value = parsed.get(name);
    if (value === undefined) return undefined;
    if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) throw new TypeError(CLI_USAGE);
    return Number(value);
  };
  const input = {
    mode,
    multisig: parsed.get("--multisig"),
    vault: parsed.get("--vault"),
    vaultIndex: integer("--vault-index"),
    creatorMember: parsed.get("--creator-member"),
    slopMember: parsed.get("--slop-member"),
    independentMember: parsed.get("--independent-member"),
    transactionIndex: integer("--transaction-index"),
    fallbackWaitSeconds: integer("--fallback-wait-seconds"),
    creatorMultisig: parsed.get("--creator-multisig"),
    creatorVaultIndex: integer("--creator-vault-index"),
  };
  if (
    (mode !== "fallback-wait" &&
      mode !== "spending-limits" &&
      mode !== "creator-seat") ||
    !input.multisig ||
    !input.vault ||
    input.vaultIndex === undefined ||
    !input.creatorMember ||
    !input.slopMember ||
    !input.independentMember ||
    (mode === "fallback-wait") !== (input.transactionIndex !== undefined) ||
    (mode === "fallback-wait") !== (input.fallbackWaitSeconds !== undefined) ||
    (mode === "creator-seat") !== (input.creatorMultisig !== undefined) ||
    (mode !== "creator-seat" && input.creatorVaultIndex !== undefined)
  ) {
    throw new TypeError(CLI_USAGE);
  }
  return input as ProjectVaultRulesInput;
}

async function finalizedHistory(
  request: (method: string, params: readonly unknown[]) => Promise<unknown>,
  address: string,
): Promise<SquadsHistoryEntry[]> {
  const entries: SquadsHistoryEntry[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const listed = await request("getSignaturesForAddress", [
      address,
      { commitment: "finalized", limit: HISTORY_PAGE_SIZE, before },
    ]);
    if (!Array.isArray(listed) || listed.length > HISTORY_PAGE_SIZE) {
      throw new TypeError("Solana signature list is invalid");
    }
    for (const value of listed) {
      if (typeof value !== "object" || value === null) {
        throw new TypeError("Solana signature list entry is invalid");
      }
      const { err, signature } = value as Record<string, unknown>;
      if (typeof signature !== "string" || !isSolanaTransactionId(signature)) {
        throw new TypeError("Solana signature list entry is invalid");
      }
      before = signature;
      if (err !== null) continue;
      entries.push(
        assertSquadsHistoryEntry(
          await request("getTransaction", [
            signature,
            {
              commitment: "finalized",
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
            },
          ]),
          signature,
        ),
      );
    }
    if (listed.length < HISTORY_PAGE_SIZE) return entries;
  }
  throw new RangeError("Squads history exceeded its page limit");
}

/** Public endpoints rate limit history reads; only that refusal is retried. */
function patient(
  request: (method: string, params: readonly unknown[]) => Promise<unknown>,
  retryDelayMs: number,
) {
  return async (method: string, params: readonly unknown[]) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request(method, params);
      } catch (error) {
        if (
          attempt >= RATE_LIMIT_RETRIES ||
          !(error instanceof Error) ||
          !error.message.endsWith("returned HTTP 429")
        ) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs * (attempt + 1)),
        );
      }
    }
  };
}

export async function verifyProjectVaultRules(input: ProjectVaultRulesInput) {
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
  let wait: { fallbackWaitSeconds: number; transactionIndex: number } | null =
    null;
  if (input.mode === "fallback-wait") {
    const { fallbackWaitSeconds, transactionIndex } = input;
    if (
      !Number.isSafeInteger(transactionIndex) ||
      Number(transactionIndex) < 1 ||
      !Number.isSafeInteger(fallbackWaitSeconds) ||
      Number(fallbackWaitSeconds) < 0
    ) {
      throw new TypeError(
        "fallback-wait mode requires a transaction index and a wait in seconds",
      );
    }
    wait = {
      fallbackWaitSeconds: Number(fallbackWaitSeconds),
      transactionIndex: Number(transactionIndex),
    };
  } else if (
    (input.mode !== "spending-limits" && input.mode !== "creator-seat") ||
    input.transactionIndex !== undefined ||
    input.fallbackWaitSeconds !== undefined
  ) {
    throw new TypeError("only fallback-wait mode takes payout fields");
  }
  let seat: { creatorMultisig: string; creatorVaultIndex: number } | null =
    null;
  if (input.mode === "creator-seat") {
    const creatorVaultIndex = input.creatorVaultIndex ?? 0;
    if (
      !isFundingAddress("solana", input.creatorMultisig) ||
      input.creatorMultisig === multisig ||
      !Number.isInteger(creatorVaultIndex) ||
      creatorVaultIndex < 0 ||
      creatorVaultIndex > 255
    ) {
      throw new TypeError(
        "creator-seat mode requires a distinct creator multisig and a vault index",
      );
    }
    seat = {
      creatorMultisig: input.creatorMultisig as string,
      creatorVaultIndex,
    };
  } else if (
    input.creatorMultisig !== undefined ||
    input.creatorVaultIndex !== undefined
  ) {
    throw new TypeError("only creator-seat mode takes creator multisig fields");
  }
  const proposal = wait
    ? await deriveSquadsProposalAddress(multisig, wait.transactionIndex)
    : null;
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(
      async (authority, index): Promise<RuleObservation> => {
        const { rpc, request: direct } = authorityRequest(
          authority,
          index,
          fetchImpl,
        );
        const request = patient(direct, input.retryDelayMs ?? 2_000);
        const accounts = finalizedAccountValue(
          await request("getMultipleAccounts", [
            seat ? [multisig, seat.creatorMultisig] : [multisig],
            { commitment: "finalized", encoding: "base64" },
          ]),
        );
        if (
          !Array.isArray(accounts.value) ||
          accounts.value.length !== (seat ? 2 : 1)
        ) {
          throw new TypeError("Solana accounts response is invalid");
        }
        const identity = await assertSquadsProjectVaultIdentity(
          accounts.value[0],
          multisig,
          vault,
          vaultIndex,
          members,
        );
        if (seat) {
          return {
            authority: rpc.toString(),
            verified: {
              identity,
              report: {
                rule: "creator-seat" as const,
                creatorSeat: await assertSquadsCreatorSeat(
                  accounts.value[1],
                  seat.creatorMultisig,
                  members.creatorMember,
                  seat.creatorVaultIndex,
                ),
                slot: accounts.slot,
              },
            },
          };
        }
        const history = await finalizedHistory(request, proposal ?? multisig);
        const report: RuleReport =
          wait && proposal
            ? {
                rule: "fallback-wait" as const,
                ...assertProposalVoteHistory(history, {
                  ...wait,
                  members,
                  multisig,
                  proposal,
                }),
              }
            : {
                rule: "no-spending-limits" as const,
                ...assertNoSpendingLimitHistory(history, multisig),
              };
        return { authority: rpc.toString(), verified: { identity, report } };
      },
    ),
  );
  const agreeing = quorumGroups(settled, ({ identity, report }) =>
    JSON.stringify([
      identity.timeLockSeconds,
      report.rule === "creator-seat" ? { ...report, slot: null } : report,
    ]),
  );
  const { identity, report } = agreeing[0].verified;
  const outcome =
    report.rule === "no-spending-limits"
      ? {
          satisfied: report.satisfied,
          reason: "a spending limit was created or used on this multisig",
          evidenceUrl: `https://solscan.io/account/${multisig}`,
        }
      : report.rule === "fallback-wait"
        ? {
            satisfied: report.fallbackWait?.satisfied ?? true,
            reason:
              "a fallback approval came before the fallback wait had passed",
            evidenceUrl: `https://solscan.io/account/${proposal}`,
          }
        : {
            satisfied: true,
            reason: "",
            evidenceUrl: `https://solscan.io/account/${report.creatorSeat.creatorMultisig}`,
          };
  return {
    mode: input.mode,
    state: outcome.satisfied
      ? ("verified-on-chain" as const)
      : ("rule-not-met" as const),
    instrument: "squads-project-vault" as const,
    ...members,
    multisig,
    vault,
    vaultIndex,
    threshold: identity.threshold,
    permissions: PROJECT_VAULT_PERMISSIONS,
    configAuthority: null,
    timeLockSeconds: identity.timeLockSeconds,
    ...report,
    verifier: {
      version: PROJECT_VAULT_RULES_VERIFIER_VERSION,
      checkedAt: new Date().toISOString(),
      evidenceUrl: outcome.evidenceUrl,
      reason: outcome.satisfied ? null : outcome.reason,
    },
    authorities: agreeing.map(({ authority }) => ({ authority })),
  };
}

if (import.meta.main) {
  const result = await verifyProjectVaultRules(
    parseProjectVaultRulesArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.state !== "verified-on-chain") process.exitCode = 1;
}
