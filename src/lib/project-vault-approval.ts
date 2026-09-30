/**
 * RFC #500 section 3, the approval-binding rule for a 2-of-3 project vault.
 *
 * Creator approval keeps its meaning in `allocation.json`. On a project vault
 * one step is added: the creator creates the Squads proposal for the exact
 * execution plan, and that binding is recorded in
 * `funding/executions/ledger.json` through the trusted transition gate. Until
 * the binding exists, an approved allocation is `approved-unbound`: it is an
 * immutable payout intent, but nothing exists on chain for any signer to
 * release, so it is not approved for payment purposes. Read-only. It grants
 * nothing, signs nothing, and never turns a binding into `paid`.
 */

import { assertRewardAllocationManifest } from "./rewards";
import { assertSettlementExecutionPlan } from "./settlement-plan";
import {
  assertSquadsBindingLedger,
  executionSha256,
  parseExecutionJson,
  type SquadsExecutionBinding,
} from "./squads-execution";
import { deriveSquadsVaultAddress } from "./squads-funding";

export const PROJECT_VAULT_INSTRUMENT_PREFIX = "squads-project-vault:solana:";

const PROJECT_VAULT_INSTRUMENT_ID =
  /^squads-project-vault:solana:([1-9A-HJ-NP-Za-km-z]{32,44}):(0|[1-9][0-9]{0,2}):([1-9A-HJ-NP-Za-km-z]{32,44})$/u;

export interface ProjectVaultInstrumentIdentity {
  multisig: string;
  vaultIndex: number;
  vault: string;
}

export function isProjectVaultInstrumentId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_VAULT_INSTRUMENT_ID.test(value);
}

export function parseProjectVaultInstrumentId(
  value: unknown,
): ProjectVaultInstrumentIdentity {
  const match =
    typeof value === "string" ? PROJECT_VAULT_INSTRUMENT_ID.exec(value) : null;
  if (!match || Number(match[2]) > 255)
    throw new TypeError("Not a project vault instrument identity");
  return { multisig: match[1], vaultIndex: Number(match[2]), vault: match[3] };
}

export type ProjectVaultApprovalState =
  | "not-a-project-vault"
  | "not-approved"
  | "approved-unbound"
  | "approved-bound";

export interface ProjectVaultApprovalReport {
  state: ProjectVaultApprovalState;
  instrumentId: string | null;
  binding: SquadsExecutionBinding | null;
  reasons: string[];
}

/**
 * Reports whether an approved project vault allocation has its creator-written
 * proposal bound to the exact execution plan. Contradictions between the
 * allocation, the plan, and a ledger row for the same cycle throw, because a
 * row that names another vault or another plan is never a weaker approval.
 */
export async function projectVaultApprovalState(input: {
  allocation: unknown;
  planBytes: Uint8Array;
  ledger: unknown;
}): Promise<ProjectVaultApprovalReport> {
  const allocation = assertRewardAllocationManifest(input.allocation);
  const instrumentId = allocation.fundingBasis?.instrumentId ?? null;
  if (!isProjectVaultInstrumentId(instrumentId))
    return {
      state: "not-a-project-vault",
      instrumentId,
      binding: null,
      reasons: ["Allocation is not funded by a project vault"],
    };
  const identity = parseProjectVaultInstrumentId(instrumentId);
  if (
    identity.vault !==
    (await deriveSquadsVaultAddress(identity.multisig, identity.vaultIndex))
  )
    throw new TypeError(
      "Project vault identity is not the canonical Squads PDA for its multisig",
    );
  if (allocation.fundingBasis?.fundingState !== "committed")
    throw new TypeError("Project vault allocation must be committed funding");
  if (allocation.status !== "approved" || !allocation.approvedAt)
    return {
      state: "not-approved",
      instrumentId,
      binding: null,
      reasons: ["Allocation is not approved"],
    };
  const planBytes = new Uint8Array(input.planBytes);
  const plan = assertSettlementExecutionPlan(
    parseExecutionJson(planBytes),
    allocation,
  );
  if (
    plan.projectId !== allocation.projectId ||
    plan.cycleId !== allocation.cycleId ||
    plan.sourceOwner !== identity.vault
  )
    throw new TypeError(
      "Execution plan does not draw this cycle from the project vault",
    );
  const planSha256 = await executionSha256(planBytes);
  const rows = assertSquadsBindingLedger(input.ledger).filter(
    (row) =>
      row.projectId === allocation.projectId &&
      row.cycleId === allocation.cycleId,
  );
  if (rows.length === 0)
    return {
      state: "approved-unbound",
      instrumentId,
      binding: null,
      reasons: [
        "Creator has not bound an on-chain proposal for this cycle; nothing exists for a signer to release",
      ],
    };
  // The ledger validator already forbids two rows for one cycle.
  const binding = rows[0];
  if (
    binding.multisig !== identity.multisig ||
    binding.vaultIndex !== identity.vaultIndex ||
    binding.vault !== identity.vault
  )
    throw new TypeError(
      "Execution binding for this cycle names a different vault than the frozen instrument",
    );
  if (binding.planSha256 !== planSha256)
    throw new TypeError(
      "Execution binding for this cycle was written for different plan bytes",
    );
  return { state: "approved-bound", instrumentId, binding, reasons: [] };
}

/** One necessary settlement check on a project vault; never payment authority. */
export async function assertProjectVaultApprovalBinding(input: {
  allocation: unknown;
  planBytes: Uint8Array;
  ledger: unknown;
}): Promise<SquadsExecutionBinding> {
  const report = await projectVaultApprovalState(input);
  if (report.state !== "approved-bound" || !report.binding)
    throw new TypeError(
      `Project vault approval is ${report.state}: ${report.reasons.join("; ")}`,
    );
  return report.binding;
}
