/** Read-only checks over finalized Squads v4 transaction history: who voted
 * on a project vault payout and when, and whether a spending limit was ever
 * created on the multisig. History is used because a proposal keeps only its
 * latest status timestamp and spending limits are not listed on the multisig. */
import {
  decodeBase58Bytes,
  SQUADS_V4_PROGRAM_ID,
  type SquadsProjectVaultMembers,
} from "./squads-funding";
import { isSolanaAddress } from "./wallets";

const SQUADS_INSTRUCTIONS = Object.freeze({
  "50,221,199,93,40,245,139,233": "multisig_create_v2",
  "122,77,80,159,84,88,90,197": "multisig_create",
  "11,242,159,42,86,197,89,115": "multisig_add_spending_limit",
  "155,236,87,228,137,75,81,39": "config_transaction_create",
  "114,146,244,189,252,140,36,40": "config_transaction_execute",
  "16,57,130,127,193,20,155,134": "spending_limit_use",
  "220,60,73,224,30,108,79,159": "proposal_create",
  "11,34,92,248,154,27,51,106": "proposal_activate",
  "144,37,164,136,188,216,42,248": "proposal_approve",
  "243,62,134,156,230,106,246,135": "proposal_reject",
  "194,8,161,87,153,164,25,171": "vault_transaction_execute",
  "172,44,179,152,21,127,234,180": "batch_execute_transaction",
} as const);
type SquadsInstructionName =
  (typeof SQUADS_INSTRUCTIONS)[keyof typeof SQUADS_INSTRUCTIONS];

/** Config action tags in Squads v4 declaration order. */
const ADD_SPENDING_LIMIT_ACTION = 4;
const CONFIG_ACTION_COUNT = 7;

export interface SquadsInstruction {
  accounts: readonly string[];
  data: Uint8Array;
  name: SquadsInstructionName | null;
}
export interface SquadsHistoryEntry {
  blockTime: number;
  instructions: readonly SquadsInstruction[];
  signature: string;
  slot: number;
}
export type ProjectVaultRole = "creator" | "independent" | "slop";
export interface VoteEvidence {
  at: number;
  member: string;
  role: ProjectVaultRole;
  signature: string;
  slot: number;
}
export interface ProposalVoteReport {
  approvals: readonly VoteEvidence[];
  approved: { at: number; by: readonly ProjectVaultRole[] } | null;
  executions: readonly VoteEvidence[];
  fallbackWait: {
    requiredSeconds: number;
    satisfied: boolean;
    shortestObservedSeconds: number;
  } | null;
  openedForVotes: VoteEvidence;
  proposal: string;
  releasePath: "creator" | "fallback" | "pending";
  transactionIndex: number;
}
export interface SpendingLimitReport {
  created: readonly string[];
  proposed: readonly string[];
  satisfied: boolean;
  transactionCount: number;
  used: readonly string[];
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  return value as Record<string, unknown>;
}
function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new TypeError(`${field} must be a non-negative safe integer`);
  return Number(value);
}

function squadsInstruction(value: unknown): SquadsInstruction | null {
  const instruction = record(value, "Solana instruction");
  if (instruction.programId !== SQUADS_V4_PROGRAM_ID) return null;
  if (
    !Array.isArray(instruction.accounts) ||
    !instruction.accounts.every(
      (account): account is string =>
        typeof account === "string" && isSolanaAddress(account),
    ) ||
    typeof instruction.data !== "string" ||
    instruction.data.length > 4096
  )
    throw new TypeError("Squads instruction is not raw accounts and data");
  const data = decodeBase58Bytes(instruction.data);
  if (data.length < 8)
    throw new TypeError("Squads instruction has no discriminator");
  const discriminator = data.slice(0, 8).join(",");
  return {
    accounts: instruction.accounts,
    data,
    name:
      discriminator in SQUADS_INSTRUCTIONS
        ? SQUADS_INSTRUCTIONS[discriminator as keyof typeof SQUADS_INSTRUCTIONS]
        : null,
  };
}

/**
 * Extracts every Squads v4 instruction, top level and inner, in execution
 * order from one successful finalized jsonParsed getTransaction result. Inner
 * instructions matter: a member that is itself a multisig vault acts by CPI.
 */
export function assertSquadsHistoryEntry(
  resultValue: unknown,
  signature: string,
): SquadsHistoryEntry {
  if (resultValue === null || resultValue === undefined)
    throw new TypeError("Solana transaction is absent at finalized commitment");
  const result = record(resultValue, "Solana transaction");
  const meta = record(result.meta, "Solana transaction meta");
  if (meta.err !== null)
    throw new TypeError("Solana transaction listed as successful has failed");
  const transaction = record(result.transaction, "Solana transaction body");
  if (
    !Array.isArray(transaction.signatures) ||
    transaction.signatures[0] !== signature
  )
    throw new TypeError("Solana transaction does not match its signature");
  const message = record(transaction.message, "Solana transaction message");
  if (!Array.isArray(message.instructions))
    throw new TypeError("Solana transaction has no instruction list");
  const inner = new Map<number, unknown[]>();
  if (meta.innerInstructions !== null && meta.innerInstructions !== undefined) {
    if (!Array.isArray(meta.innerInstructions))
      throw new TypeError("Solana inner instructions are invalid");
    for (const groupValue of meta.innerInstructions) {
      const group = record(groupValue, "Solana inner instruction group");
      const index = nonNegativeInteger(group.index, "inner instruction index");
      if (!Array.isArray(group.instructions) || inner.has(index))
        throw new TypeError("Solana inner instructions are invalid");
      inner.set(index, group.instructions);
    }
  }
  const instructions: SquadsInstruction[] = [];
  message.instructions.forEach((outer, index) => {
    for (const value of [outer, ...(inner.get(index) ?? [])]) {
      const instruction = squadsInstruction(value);
      if (instruction) instructions.push(instruction);
    }
  });
  return {
    blockTime: nonNegativeInteger(result.blockTime, "transaction block time"),
    instructions,
    signature,
    slot: nonNegativeInteger(result.slot, "transaction slot"),
  };
}

function chronological(
  entries: readonly SquadsHistoryEntry[],
): SquadsHistoryEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.signature))
      throw new TypeError("Squads history repeats a transaction");
    seen.add(entry.signature);
  }
  // getSignaturesForAddress lists newest first and keeps in-slot order, so a
  // stable sort on the reversed list preserves order inside one slot.
  return [...entries].reverse().sort((left, right) => left.slot - right.slot);
}

/**
 * Replays the finalized votes on one proposal. The release path is "fallback"
 * when the two approvals that reached the threshold exclude the creator. On
 * that path every counted approval must come at least `fallbackWaitSeconds`
 * after the proposal was opened for votes. Times are Solana block times.
 */
export function assertProposalVoteHistory(
  entries: readonly SquadsHistoryEntry[],
  input: {
    fallbackWaitSeconds: number;
    members: SquadsProjectVaultMembers;
    multisig: string;
    proposal: string;
    transactionIndex: number;
  },
): ProposalVoteReport {
  if (
    !Number.isSafeInteger(input.fallbackWaitSeconds) ||
    input.fallbackWaitSeconds < 0
  )
    throw new TypeError("fallback wait must be a non-negative whole number");
  const roles = new Map<string, ProjectVaultRole>([
    [input.members.creatorMember, "creator"],
    [input.members.slopMember, "slop"],
    [input.members.independentMember, "independent"],
  ]);
  if (roles.size !== 3)
    throw new TypeError("reviewed members must be distinct");
  let opened: VoteEvidence | null = null;
  let approvedAt: number | null = null;
  const approved = new Map<string, VoteEvidence>();
  const executions: VoteEvidence[] = [];
  for (const entry of chronological(entries)) {
    for (const { accounts, data, name } of entry.instructions) {
      const position =
        name === "proposal_create" || name === "vault_transaction_execute"
          ? 1
          : name === "proposal_activate" ||
              name === "proposal_approve" ||
              name === "proposal_reject" ||
              name === "batch_execute_transaction"
            ? 2
            : null;
      if (position === null || accounts[position] !== input.proposal) continue;
      if (accounts[0] !== input.multisig)
        throw new TypeError("proposal instruction names another multisig");
      const member =
        name === "proposal_create"
          ? accounts[2]
          : name === "vault_transaction_execute"
            ? accounts[3]
            : accounts[1];
      const role = roles.get(member);
      if (!role)
        throw new TypeError("proposal was acted on by an unreviewed member");
      const evidence = {
        at: entry.blockTime,
        member,
        role,
        signature: entry.signature,
        slot: entry.slot,
      };
      if (name === "proposal_create") {
        if (
          data.length !== 17 ||
          new DataView(data.buffer, data.byteOffset).getBigUint64(8, true) !==
            BigInt(input.transactionIndex) ||
          data[16] > 1 ||
          opened
        )
          throw new TypeError("proposal creation does not match its index");
        if (data[16] === 0) opened = evidence;
      } else if (name === "proposal_activate") {
        if (opened) throw new TypeError("proposal was opened for votes twice");
        opened = evidence;
      } else if (
        name === "vault_transaction_execute" ||
        name === "batch_execute_transaction"
      ) {
        if (approvedAt === null)
          throw new TypeError("proposal executed before it was approved");
        executions.push(evidence);
      } else {
        if (!opened || approvedAt !== null)
          throw new TypeError("proposal vote is outside its voting period");
        if (name === "proposal_reject") approved.delete(member);
        else approved.set(member, evidence);
        if (approved.size >= 2) approvedAt = entry.blockTime;
      }
    }
  }
  if (!opened)
    throw new TypeError("proposal history does not show it opened for votes");
  const openedAt = opened.at;
  const approvals = [...approved.values()];
  const fallback =
    approvedAt !== null && !approved.has(input.members.creatorMember);
  const shortest = Math.min(...approvals.map(({ at }) => at - openedAt));
  return {
    approvals,
    approved:
      approvedAt === null
        ? null
        : { at: approvedAt, by: approvals.map(({ role }) => role) },
    executions,
    fallbackWait: fallback
      ? {
          requiredSeconds: input.fallbackWaitSeconds,
          satisfied: shortest >= input.fallbackWaitSeconds,
          shortestObservedSeconds: shortest,
        }
      : null,
    openedForVotes: opened,
    proposal: input.proposal,
    releasePath:
      approvedAt === null ? "pending" : fallback ? "fallback" : "creator",
    transactionIndex: input.transactionIndex,
  };
}

function proposesSpendingLimit(data: Uint8Array): boolean {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const failure = "Squads config transaction actions are not canonical";
  let offset = 8;
  const take = (length: number) => {
    if (offset + length > data.length) throw new TypeError(failure);
    offset += length;
    return offset - length;
  };
  const count = view.getUint32(take(4), true);
  let found = false;
  for (let index = 0; index < count; index += 1) {
    const tag = data[take(1)];
    if (tag >= CONFIG_ACTION_COUNT) throw new TypeError(failure);
    if (tag === ADD_SPENDING_LIMIT_ACTION) {
      found = true;
      // create key, vault index, mint, amount, period
      take(32 + 1 + 32 + 8 + 1);
      take(32 * view.getUint32(take(4), true));
      take(32 * view.getUint32(take(4), true));
    } else if (tag === 6) {
      const option = data[take(1)];
      if (option > 1) throw new TypeError(failure);
      take(32 * option);
    } else take(tag === 0 ? 33 : tag === 2 ? 2 : tag === 3 ? 4 : 32);
  }
  return found;
}

/**
 * Scans the complete finalized history of a multisig for any spending limit
 * that was created or used. A spending limit lets one listed key move funds
 * with no vote and no time lock, so a project vault must never have had one.
 * The history must reach the transaction that created the multisig.
 */
export function assertNoSpendingLimitHistory(
  entries: readonly SquadsHistoryEntry[],
  multisig: string,
): SpendingLimitReport {
  const ordered = chronological(entries);
  if (
    !ordered[0]?.instructions.some(
      ({ accounts, name }) =>
        (name === "multisig_create" || name === "multisig_create_v2") &&
        accounts.includes(multisig),
    )
  )
    throw new TypeError(
      "Squads history does not reach the creation of the multisig",
    );
  const proposals = new Map<string, string>();
  const configTransactions = new Set<string>();
  const created: string[] = [];
  const used: string[] = [];
  for (const entry of ordered) {
    for (const { accounts, data, name } of entry.instructions) {
      if (accounts[0] !== multisig) continue;
      if (name === "config_transaction_create") {
        configTransactions.add(accounts[1]);
        if (proposesSpendingLimit(data))
          proposals.set(accounts[1], entry.signature);
      } else if (name === "config_transaction_execute") {
        if (!configTransactions.has(accounts[3]))
          throw new TypeError(
            "Squads history is missing an executed config transaction",
          );
        if (proposals.has(accounts[3])) created.push(entry.signature);
      } else if (name === "multisig_add_spending_limit")
        created.push(entry.signature);
      else if (name === "spending_limit_use") used.push(entry.signature);
    }
  }
  return {
    created,
    proposed: [...proposals.values()],
    satisfied: created.length === 0 && used.length === 0,
    transactionCount: ordered.length,
    used,
  };
}
