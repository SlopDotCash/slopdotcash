/**
 * The public record of a project vault windup against a bound proposal
 * (RFC #500 section 10). The creator may return the vault's balance to the
 * creator's own wallet at any time; Slop takes no part and cannot prevent it.
 * When that happens after the creator bound a proposal, the proposal cannot
 * execute for lack of balance, and the approved rows cannot be paid while the
 * balance stays short.
 *
 * The reserved `allocation.json` is permanently immutable, so the rows are not
 * rewritten. This record sits beside it as `windup.json`, names the finalized
 * refund transactions that emptied the vault, and marks every approved row
 * `held` with one public reason. It is derived from verified public evidence
 * only: the frozen allocation and plan, the execution binding, the verified
 * refund records in the funding ledger, and one finalized vault observation.
 * The validator always requires the verified funding ledger: every named
 * refund must be a verified record there, and the ledger's own verified
 * balance as of the observation must fall short of the plan, so a record
 * cannot hold rows on a self-reported figure alone.
 *
 * A windup is not a cancellation. An approved Squads proposal stays approved
 * on chain; if funds return to the vault, an executor can still execute the
 * exact bound plan. So this record never grants, releases, retires, or
 * carries anything, and it does not end the cycle: finalized payment of the
 * bound proposal is recorded beside it in `transactions.json` and
 * `settlement.json` without rewriting this history. A held row keeps its
 * approved amount in the record with no funded backing until then; a
 * reserved intent is never reissued or imported as carry.
 */

import {
  currentProjectCommitmentRecords,
  type ProjectCommitmentRecord,
} from "./funding-commitment";
import { projectVaultApprovalState } from "./project-vault-approval";
import { assertRewardAllocationManifest } from "./rewards";
import { assertSettlementExecutionPlan } from "./settlement-plan";
import { executionSha256, parseExecutionJson } from "./squads-execution";

export const PROJECT_VAULT_WINDUP_SCHEMA_VERSION = "1" as const;
export const PROJECT_VAULT_WINDUP_FILE = "windup.json" as const;

export interface ProjectVaultWindupRefund {
  recordId: string;
  transactionId: string;
  amountMinor: string;
  observedAt: string;
}
export interface ProjectVaultWindupRow {
  intentId: string;
  approvedMinor: string;
  state: "held";
}
export interface ProjectVaultWindupRecord {
  schemaVersion: typeof PROJECT_VAULT_WINDUP_SCHEMA_VERSION;
  kind: "project-vault-windup";
  projectId: string;
  cycleId: string;
  instrumentId: string;
  allocationSha256: string;
  planSha256: string;
  binding: { transactionIndex: string; proposalAccount: string };
  refunds: ProjectVaultWindupRefund[];
  /** Finalized observation of the vault's USDC balance after the refunds. */
  observedAt: string;
  vaultBalanceMinor: string;
  /** The plan's total vault outflow, which the balance no longer covers. */
  requiredMinor: string;
  recordedAt: string;
  reason: string;
  rows: ProjectVaultWindupRow[];
}

export interface ProjectVaultWindupContext {
  allocation: unknown;
  allocationSha256: string;
  planBytes: Uint8Array;
  /** The execution binding ledger (`funding/executions/ledger.json`). */
  ledger: unknown;
  /**
   * The project's verified funding commitment ledger. Required: every named
   * refund must be a verified record here, and the ledger's verified balance
   * as of the observation must fall short of the bound plan.
   */
  fundingRecords: readonly ProjectCommitmentRecord[];
}

const SHA256 = /^[a-f0-9]{64}$/u;
const KEYS = [
  "allocationSha256",
  "binding",
  "cycleId",
  "instrumentId",
  "kind",
  "observedAt",
  "planSha256",
  "projectId",
  "reason",
  "recordedAt",
  "refunds",
  "requiredMinor",
  "rows",
  "schemaVersion",
  "vaultBalanceMinor",
] as const;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0"))
    throw new TypeError(`${field} has unexpected or missing fields`);
}
function minor(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^(?:0|[1-9]\d*)$/u.test(value)
  )
    throw new TypeError(`${field} must be canonical integer minor units`);
  return value;
}
function iso(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError(`${field} must be an exact UTC timestamp`);
  return value;
}
function text(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new TypeError(`${field} is invalid`);
  return value;
}

/** The one public reason every held row carries. Deterministic from evidence. */
export function projectVaultWindupReason(
  refunds: readonly ProjectVaultWindupRefund[],
  requiredMinor: string,
  vaultBalanceMinor: string,
): string {
  const signatures = refunds.map((refund) => refund.transactionId).join(", ");
  return `The creator returned vault funds to the creator's wallet after binding this cycle's proposal (finalized transaction${refunds.length === 1 ? "" : "s"} ${signatures}). The vault holds ${vaultBalanceMinor} of the ${requiredMinor} USDC minor units the bound proposal needs, so it cannot execute while the balance stays short. Every approved row is held with no funded backing. This is a windup by the creator, not a decision against any contributor and not a cancellation of the bound proposal: nothing is carried or reissued, and a held row is recorded as paid only if the vault is refunded and the exact bound proposal executes with finalized on-chain evidence.`;
}

/**
 * Selects the verified refunds that emptied the vault after approval. A refund
 * observed before the allocation was approved is ordinary funding history that
 * readiness already accounted for, not a windup against this proposal.
 */
export function projectVaultWindupRefunds(
  fundingRecords: readonly ProjectCommitmentRecord[],
  instrument: { multisig: string; vault: string; vaultIndex: number },
  approvedAt: string,
): ProjectVaultWindupRefund[] {
  return fundingRecords
    .filter(
      (row) =>
        row.event === "refund" &&
        row.state === "verified-on-chain" &&
        row.network === "solana" &&
        "multisig" in row.instrument &&
        row.instrument.multisig === instrument.multisig &&
        row.instrument.vault === instrument.vault &&
        row.instrument.vaultIndex === instrument.vaultIndex &&
        Date.parse(row.observedAt) >= Date.parse(approvedAt),
    )
    .sort(
      (a, b) =>
        a.observedAt.localeCompare(b.observedAt) ||
        a.recordId.localeCompare(b.recordId),
    )
    .map((row) => ({
      recordId: row.recordId,
      transactionId: row.transactionId,
      amountMinor: row.amountMinor,
      observedAt: row.observedAt,
    }));
}

/**
 * The verified funding ledger's own view of the vault balance as of one
 * instant: verified deposits minus verified refunds and releases observed at
 * or before it, for this instrument only. Later records never change it, so a
 * committed windup stays valid when funds return afterwards.
 */
export function projectVaultVerifiedBalanceMinor(
  fundingRecords: readonly ProjectCommitmentRecord[],
  instrument: { multisig: string; vault: string; vaultIndex: number },
  asOf: string,
): bigint {
  let balance = 0n;
  for (const row of currentProjectCommitmentRecords(
    fundingRecords.filter(
      (row) => Date.parse(row.observedAt) <= Date.parse(asOf),
    ),
  )) {
    if (
      row.state !== "verified-on-chain" ||
      row.network !== "solana" ||
      !("multisig" in row.instrument) ||
      row.instrument.multisig !== instrument.multisig ||
      row.instrument.vault !== instrument.vault ||
      row.instrument.vaultIndex !== instrument.vaultIndex
    )
      continue;
    const amount = BigInt(row.amountMinor);
    balance += row.event === "deposit" ? amount : -amount;
  }
  return balance;
}

async function boundContext(context: ProjectVaultWindupContext) {
  const allocation = assertRewardAllocationManifest(context.allocation);
  if (!SHA256.test(context.allocationSha256))
    throw new TypeError("Windup requires the allocation digest");
  const planBytes = new Uint8Array(context.planBytes);
  const plan = assertSettlementExecutionPlan(
    parseExecutionJson(planBytes),
    allocation,
  );
  if (plan.allocationSha256 !== context.allocationSha256)
    throw new TypeError("Windup plan does not bind the allocation digest");
  const approval = await projectVaultApprovalState({
    allocation,
    planBytes,
    ledger: context.ledger,
  });
  if (approval.state !== "approved-bound" || !approval.binding)
    throw new TypeError(
      `A windup is recorded only against a bound proposal; approval is ${approval.state}`,
    );
  if (!allocation.approvedAt) throw new TypeError("Allocation is not approved");
  return {
    allocation,
    approvedAt: allocation.approvedAt,
    binding: approval.binding,
    instrumentId: approval.instrumentId as string,
    plan,
    planSha256: await executionSha256(planBytes),
    rows: allocation.allocations
      .filter((row) => row.state === "approved")
      .map(
        (row): ProjectVaultWindupRow => ({
          intentId: row.intentId,
          approvedMinor: row.approvedMinor,
          state: "held",
        }),
      ),
  };
}

/** Derives the windup record from public evidence. Throws when there is no windup to record. */
export async function deriveProjectVaultWindup(
  input: ProjectVaultWindupContext & {
    vaultBalanceMinor: string;
    observedAt: string;
    recordedAt: string;
  },
): Promise<ProjectVaultWindupRecord> {
  const bound = await boundContext(input);
  const refunds = projectVaultWindupRefunds(
    input.fundingRecords,
    bound.binding,
    bound.approvedAt,
  );
  if (refunds.length === 0)
    throw new TypeError(
      "No verified refund after approval; there is no windup to record",
    );
  const requiredMinor = bound.plan.totals.totalMinor;
  const vaultBalanceMinor = minor(input.vaultBalanceMinor, "vaultBalanceMinor");
  if (BigInt(vaultBalanceMinor) >= BigInt(requiredMinor))
    throw new TypeError(
      "The vault still covers the bound proposal; there is no windup to record",
    );
  const observedAt = iso(input.observedAt, "observedAt");
  if (refunds.some((r) => Date.parse(r.observedAt) > Date.parse(observedAt)))
    throw new TypeError("Vault balance must be observed after every refund");
  const recordedAt = iso(input.recordedAt, "recordedAt");
  if (Date.parse(recordedAt) < Date.parse(observedAt))
    throw new TypeError("Windup cannot be recorded before its observation");
  return assertProjectVaultWindup(
    {
      schemaVersion: PROJECT_VAULT_WINDUP_SCHEMA_VERSION,
      kind: "project-vault-windup",
      projectId: bound.allocation.projectId,
      cycleId: bound.allocation.cycleId,
      instrumentId: bound.instrumentId,
      allocationSha256: input.allocationSha256,
      planSha256: bound.planSha256,
      binding: {
        transactionIndex: bound.binding.transactionIndex,
        proposalAccount: bound.binding.proposalAccount,
      },
      refunds,
      observedAt,
      vaultBalanceMinor,
      requiredMinor,
      recordedAt,
      reason: projectVaultWindupReason(
        refunds,
        requiredMinor,
        vaultBalanceMinor,
      ),
      rows: bound.rows,
    },
    input,
  );
}

/**
 * Validates a stored windup record against the frozen allocation, plan, and
 * execution binding. Every field is recomputed from those files; a record that
 * names another vault, another plan, a covering balance, or a different set of
 * rows is rejected. It grants nothing.
 */
export async function assertProjectVaultWindup(
  value: unknown,
  context: ProjectVaultWindupContext,
): Promise<ProjectVaultWindupRecord> {
  const raw = record(value, "windup");
  exactKeys(raw, KEYS, "windup");
  if (
    raw.schemaVersion !== PROJECT_VAULT_WINDUP_SCHEMA_VERSION ||
    raw.kind !== "project-vault-windup"
  )
    throw new TypeError("windup kind or schema version is invalid");
  const bound = await boundContext(context);
  const binding = record(raw.binding, "windup.binding");
  exactKeys(binding, ["proposalAccount", "transactionIndex"], "windup.binding");
  if (
    raw.projectId !== bound.allocation.projectId ||
    raw.cycleId !== bound.allocation.cycleId ||
    raw.instrumentId !== bound.instrumentId ||
    raw.allocationSha256 !== context.allocationSha256 ||
    raw.planSha256 !== bound.planSha256 ||
    binding.transactionIndex !== bound.binding.transactionIndex ||
    binding.proposalAccount !== bound.binding.proposalAccount
  )
    throw new TypeError(
      "windup does not bind this cycle's allocation, plan, and proposal",
    );
  if (!Array.isArray(raw.refunds) || raw.refunds.length === 0)
    throw new TypeError("windup names no refund transaction");
  if (raw.refunds.length > 1000)
    throw new TypeError("windup refunds exceed their bound");
  const seen = new Set<string>();
  const refunds = raw.refunds.map((entry, index): ProjectVaultWindupRefund => {
    const field = `windup.refunds[${index}]`;
    const refund = record(entry, field);
    exactKeys(
      refund,
      ["amountMinor", "observedAt", "recordId", "transactionId"],
      field,
    );
    const transactionId = text(
      refund.transactionId,
      `${field}.transactionId`,
      /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u,
    );
    if (seen.has(transactionId))
      throw new TypeError(`${field} repeats a refund transaction`);
    seen.add(transactionId);
    const observedAt = iso(refund.observedAt, `${field}.observedAt`);
    if (Date.parse(observedAt) < Date.parse(bound.approvedAt))
      throw new TypeError(`${field} was observed before approval`);
    return {
      recordId: text(
        refund.recordId,
        `${field}.recordId`,
        /^cmt_[a-z0-9](?:[a-z0-9_-]{6,79})$/u,
      ),
      transactionId,
      amountMinor: minor(refund.amountMinor, `${field}.amountMinor`),
      observedAt,
    };
  });
  const verified = projectVaultWindupRefunds(
    context.fundingRecords,
    bound.binding,
    bound.approvedAt,
  );
  for (const refund of refunds) {
    if (!verified.some((row) => JSON.stringify(row) === JSON.stringify(refund)))
      throw new TypeError(
        "windup names a refund that the verified funding ledger does not hold",
      );
  }
  const observedAt = iso(raw.observedAt, "windup.observedAt");
  if (refunds.some((r) => Date.parse(r.observedAt) > Date.parse(observedAt)))
    throw new TypeError("windup balance was observed before a named refund");
  const recordedAt = iso(raw.recordedAt, "windup.recordedAt");
  if (Date.parse(recordedAt) < Date.parse(observedAt))
    throw new TypeError("windup was recorded before its observation");
  const requiredMinor = minor(raw.requiredMinor, "windup.requiredMinor");
  const vaultBalanceMinor = minor(
    raw.vaultBalanceMinor,
    "windup.vaultBalanceMinor",
  );
  if (requiredMinor !== bound.plan.totals.totalMinor)
    throw new TypeError("windup requiredMinor is not the plan's vault outflow");
  if (BigInt(vaultBalanceMinor) >= BigInt(requiredMinor))
    throw new TypeError(
      "windup balance still covers the bound proposal; nothing is held",
    );
  // The observed balance is one quorum reading; the held state also needs
  // the verified ledger's own arithmetic, as of that observation, to fall
  // short of the plan. Records observed later do not enter this figure.
  if (
    projectVaultVerifiedBalanceMinor(
      context.fundingRecords,
      bound.binding,
      observedAt,
    ) >= BigInt(requiredMinor)
  )
    throw new TypeError(
      "windup is not supported by the verified funding ledger; its verified balance as of the observation still covers the bound proposal",
    );
  if (
    raw.reason !==
    projectVaultWindupReason(refunds, requiredMinor, vaultBalanceMinor)
  )
    throw new TypeError("windup reason is not the canonical public reason");
  if (!Array.isArray(raw.rows) || raw.rows.length !== bound.rows.length)
    throw new TypeError("windup rows do not match the approved intents");
  const rows = raw.rows.map((entry, index): ProjectVaultWindupRow => {
    const field = `windup.rows[${index}]`;
    const row = record(entry, field);
    exactKeys(row, ["approvedMinor", "intentId", "state"], field);
    const expected = bound.rows[index];
    if (
      row.intentId !== expected.intentId ||
      row.approvedMinor !== expected.approvedMinor ||
      row.state !== "held"
    )
      throw new TypeError(`${field} does not match its approved intent`);
    return { ...expected };
  });
  return {
    schemaVersion: PROJECT_VAULT_WINDUP_SCHEMA_VERSION,
    kind: "project-vault-windup",
    projectId: bound.allocation.projectId,
    cycleId: bound.allocation.cycleId,
    instrumentId: bound.instrumentId,
    allocationSha256: context.allocationSha256,
    planSha256: bound.planSha256,
    binding: {
      transactionIndex: bound.binding.transactionIndex,
      proposalAccount: bound.binding.proposalAccount,
    },
    refunds,
    observedAt,
    vaultBalanceMinor,
    requiredMinor,
    recordedAt,
    reason: raw.reason,
    rows,
  };
}
