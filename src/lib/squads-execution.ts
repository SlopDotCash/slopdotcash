/** Read-only one-plan/one-proposal binding. This is NOT an instruction or
 * settlement verifier. Callers supply complete trusted-base ledger history;
 * this parser cannot authenticate GitHub review or detect omitted base history.
 * Persist canonical bindings append-only through the trusted transition gate.
 */
import { assertRewardAllocationManifest } from "./rewards";
import { assertSettlementExecutionPlan } from "./settlement-plan";
import {
  compileSquadsBatchChild,
  MAX_SQUADS_CHILD_TRANSFERS,
} from "./squads-batch-message";
import { deriveSquadsVaultAddress } from "./squads-funding";
import { isSolanaAddress } from "./wallets";

export const SQUADS_EXECUTION_RPC_AUTHORITIES = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
] as const;

export interface SquadsSingleExecutionBinding {
  schemaVersion: "1";
  kind: "squads-execution-binding";
  projectId: string;
  cycleId: string;
  planSha256: string;
  multisig: string;
  vault: string;
  vaultIndex: number;
  transactionIndex: string;
  proposalAccount: string;
  vaultTransactionAccount: string;
}
export interface SquadsBatchChildBinding {
  transactionIndex: number;
  transactionAccount: string;
  /** SHA256 of the complete stored VaultTransactionMessage Borsh bytes. */
  messageSha256: string;
  /** Zero-based positions in the immutable parent plan, fee included. */
  transferIndexes: number[];
}
export interface SquadsBatchExecutionBinding
  extends Omit<
    SquadsSingleExecutionBinding,
    "schemaVersion" | "kind" | "vaultTransactionAccount"
  > {
  schemaVersion: "2";
  kind: "squads-batch-execution-binding";
  batchAccount: string;
  children: SquadsBatchChildBinding[];
}
export type SquadsExecutionBinding =
  | SquadsSingleExecutionBinding
  | SquadsBatchExecutionBinding;
export const isSquadsBatch = (
  binding: SquadsExecutionBinding,
): binding is SquadsBatchExecutionBinding =>
  binding.kind === "squads-batch-execution-binding";
export const squadsExecutionRootAccount = (
  binding: SquadsExecutionBinding,
): string =>
  isSquadsBatch(binding)
    ? binding.batchAccount
    : binding.vaultTransactionAccount;

export const MAX_EXECUTION_JSON_BYTES = 8 * 1024 * 1024;
const KEYS = [
  "schemaVersion",
  "kind",
  "projectId",
  "cycleId",
  "planSha256",
  "multisig",
  "vault",
  "vaultIndex",
  "transactionIndex",
  "proposalAccount",
  "vaultTransactionAccount",
] as const;

export function assertSquadsExecutionBinding(
  value: unknown,
): SquadsExecutionBinding {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid execution binding");
  const row = value as Record<string, unknown>;
  if (row.kind === "squads-batch-execution-binding") {
    exactObject(row, [
      ...KEYS.filter((key) => key !== "vaultTransactionAccount"),
      "batchAccount",
      "children",
    ]);
    if (
      row.schemaVersion !== "2" ||
      !Array.isArray(row.children) ||
      !row.children.length ||
      row.children.length > 40
    )
      throw new TypeError("Invalid bounded Batch binding");
    const { children: raw, batchAccount, ...common } = row;
    const single = assertSquadsExecutionBinding({
      ...common,
      schemaVersion: "1",
      kind: "squads-execution-binding",
      vaultTransactionAccount: batchAccount,
    }) as SquadsSingleExecutionBinding;
    const children = raw.map((value, index) => {
      const c = exactObject(value, [
        "transactionIndex",
        "transactionAccount",
        "messageSha256",
        "transferIndexes",
      ]);
      if (
        c.transactionIndex !== index + 1 ||
        !isSolanaAddress(c.transactionAccount) ||
        typeof c.messageSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(c.messageSha256) ||
        !Array.isArray(c.transferIndexes) ||
        !c.transferIndexes.length ||
        c.transferIndexes.length > MAX_SQUADS_CHILD_TRANSFERS ||
        c.transferIndexes.some((i) => !Number.isInteger(i) || i < 0 || i >= 200)
      )
        throw new TypeError("Invalid Batch child binding");
      return {
        transactionIndex: index + 1,
        transactionAccount: c.transactionAccount as string,
        messageSha256: c.messageSha256,
        transferIndexes: [...c.transferIndexes] as number[],
      };
    });
    const indexes = children.flatMap((c) => c.transferIndexes);
    const accounts = [
      single.multisig,
      single.vault,
      single.proposalAccount,
      single.vaultTransactionAccount,
      ...children.map((c) => c.transactionAccount),
    ];
    if (
      indexes.some((v, i) => v !== i) ||
      new Set(accounts).size !== accounts.length
    )
      throw new TypeError(
        "Batch coverage must be ordered, disjoint and non-replayed",
      );
    const { vaultTransactionAccount, ...fields } = single;
    return {
      ...fields,
      schemaVersion: "2",
      kind: "squads-batch-execution-binding",
      batchAccount: vaultTransactionAccount,
      children,
    };
  }
  if (
    Object.keys(row).sort().join() !== [...KEYS].sort().join() ||
    row.schemaVersion !== "1" ||
    row.kind !== "squads-execution-binding" ||
    typeof row.projectId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.projectId) ||
    row.projectId.length > 64 ||
    typeof row.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.cycleId) ||
    typeof row.planSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.planSha256) ||
    !Number.isInteger(row.vaultIndex) ||
    Number(row.vaultIndex) < 0 ||
    Number(row.vaultIndex) > 255 ||
    typeof row.transactionIndex !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(row.transactionIndex) ||
    BigInt(row.transactionIndex) > (1n << 64n) - 1n ||
    ![
      row.multisig,
      row.vault,
      row.proposalAccount,
      row.vaultTransactionAccount,
    ].every(isSolanaAddress) ||
    new Set([
      row.multisig,
      row.vault,
      row.proposalAccount,
      row.vaultTransactionAccount,
    ]).size !== 4
  )
    throw new TypeError("Invalid execution binding fields");
  return Object.fromEntries(
    KEYS.map((key) => [key, row[key]]),
  ) as unknown as SquadsExecutionBinding;
}

/** Stable bytes for ledger review, never a mutable explorer URL or signature. */
export function canonicalSquadsBinding(value: unknown): string {
  return JSON.stringify(assertSquadsExecutionBinding(value));
}

export function assertSquadsBindingLedger(
  value: unknown,
): SquadsExecutionBinding[] {
  if (!Array.isArray(value) || value.length > 4096)
    throw new TypeError("Invalid complete execution ledger");
  const rows = value.map(assertSquadsExecutionBinding);
  const seen = new Set<string>();
  for (const row of rows) {
    // Global proposal/plan uniqueness prevents cross-project replay. One cycle
    // cannot evade the restriction by submitting different plan bytes.
    for (const key of [
      `plan:${row.planSha256}`,
      `cycle:${row.projectId}:${row.cycleId}`,
      `proposal:${row.multisig}:${row.transactionIndex}`,
      `account:${row.proposalAccount}`,
      `account:${squadsExecutionRootAccount(row)}`,
      ...(isSquadsBatch(row)
        ? row.children.map((child) => `account:${child.transactionAccount}`)
        : []),
    ]) {
      if (seen.has(key))
        throw new TypeError("Duplicate or replayed execution binding");
      seen.add(key);
    }
  }
  return rows;
}

export function assertSquadsBindingTransition(
  base: unknown,
  next: unknown,
): SquadsExecutionBinding[] {
  const previous = assertSquadsBindingLedger(base);
  const following = assertSquadsBindingLedger(next);
  if (
    following.length < previous.length ||
    previous.some(
      (row, index) =>
        canonicalSquadsBinding(row) !==
        canonicalSquadsBinding(following[index]),
    )
  )
    throw new TypeError(
      "Execution binding history is immutable and append-only",
    );
  return following;
}

export async function executionSha256(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Exact input bytes are hashed before parsing; file readers enforce bounds. */
export function parseExecutionJson(bytes: Uint8Array): unknown {
  if (!bytes.length || bytes.length > MAX_EXECUTION_JSON_BYTES)
    throw new RangeError("Execution JSON exceeds byte bounds");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Ledger files use one canonical representation, rejecting duplicate keys. */
export function parseSquadsBindingLedger(
  bytes: Uint8Array,
): SquadsExecutionBinding[] {
  const rows = assertSquadsBindingLedger(parseExecutionJson(bytes));
  if (new TextDecoder().decode(bytes) !== `${JSON.stringify(rows)}\n`)
    throw new TypeError("Execution ledger must be canonical JSON plus newline");
  return rows;
}

export async function validateSquadsExecutionContext(input: {
  projectId: string;
  planBytes: Uint8Array;
  allocationBytes: Uint8Array;
  baseLedger: unknown;
  ledger: unknown;
}): Promise<SquadsExecutionBinding> {
  input = {
    ...input,
    planBytes: new Uint8Array(input.planBytes),
    allocationBytes: new Uint8Array(input.allocationBytes),
  };
  const ledger = assertSquadsBindingTransition(input.baseLedger, input.ledger);
  const allocation = assertRewardAllocationManifest(
    parseExecutionJson(input.allocationBytes),
  );
  const plan = assertSettlementExecutionPlan(
    parseExecutionJson(input.planBytes),
    allocation,
  );
  if (
    allocation.status !== "approved" ||
    plan.projectId !== input.projectId ||
    plan.allocationSha256 !== (await executionSha256(input.allocationBytes))
  )
    throw new TypeError(
      "Foreign project or mismatched approved allocation bytes",
    );
  const digest = await executionSha256(input.planBytes);
  const binding = ledger.find((row) => row.planSha256 === digest);
  if (
    !binding ||
    binding.projectId !== input.projectId ||
    binding.cycleId !== plan.cycleId ||
    binding.vault !== plan.sourceOwner
  )
    throw new TypeError("Plan bytes do not match execution binding");
  const identity = `squads-v4-vault:solana:${binding.multisig}:${binding.vaultIndex}:${binding.vault}`;
  if (
    allocation.fundingBasis?.instrumentId !== identity ||
    allocation.fundingBasis.fundingState !== "committed" ||
    binding.vault !==
      (await deriveSquadsVaultAddress(binding.multisig, binding.vaultIndex))
  )
    throw new TypeError(
      "Execution binding does not match frozen canonical Squads instrument",
    );
  if (isSquadsBatch(binding)) {
    if (
      binding.children.flatMap((c) => c.transferIndexes).length !==
      plan.transfers.length
    )
      throw new TypeError(
        "Batch must cover every parent transfer and fee exactly once",
      );
    for (const child of binding.children) {
      const message = await compileSquadsBatchChild(
        plan,
        child.transferIndexes,
      );
      if ((await executionSha256(message.storedBytes)) !== child.messageSha256)
        throw new TypeError(
          "Batch child hash differs from exact canonical parent subset",
        );
    }
  }
  return binding;
}

export interface SquadsExecutionObservation {
  verifier: "squads-execution-v1";
  binding: SquadsExecutionBinding;
  observedAt: string;
  status: "plan-matched" | "unverified";
  instructionVerification: "verified" | "unverified";
  paymentVerified: false;
  retirementVerified: false;
  batchProgress?: { totalChildren: number; executedChildren: number } | null;
  proposalStatus:
    | "draft"
    | "active"
    | "rejected"
    | "approved"
    | "executed"
    | "cancelled"
    | "unknown";
  accountEvidence: null | {
    authorities: string[];
    slots: number[];
    proposalSha256: string;
    vaultTransactionSha256: string;
    tokenAccountsSha256: string;
    lookupTablesSha256: string;
  };
  reason: string;
}

/** Static publication contains binding references only, never live success. */
export interface PublishedSquadsExecution {
  projectId: string;
  cycleId: string;
  allocationSha256: string;
  planSha256: string;
  binding: SquadsExecutionBinding;
  observationUrl: string;
  paymentVerified: false;
  retirementVerified: false;
}
export interface SquadsExecutionIndex {
  schemaVersion: 1;
  executions: PublishedSquadsExecution[];
}
export function assertSquadsExecutionIndex(
  value: unknown,
): SquadsExecutionIndex {
  const row = exactObject(value, ["schemaVersion", "executions"]);
  if (
    row.schemaVersion !== 1 ||
    !Array.isArray(row.executions) ||
    row.executions.length > 4096
  )
    throw new TypeError("Invalid execution index version");
  const executions = row.executions.map((value) => {
    const v = exactObject(value, [
      "projectId",
      "cycleId",
      "allocationSha256",
      "planSha256",
      "binding",
      "observationUrl",
      "paymentVerified",
      "retirementVerified",
    ]);
    const binding = assertSquadsExecutionBinding(v.binding);
    if (
      v.projectId !== binding.projectId ||
      v.cycleId !== binding.cycleId ||
      v.planSha256 !== binding.planSha256 ||
      typeof v.allocationSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(v.allocationSha256) ||
      v.observationUrl !==
        `https://api.slop.cash/api/v1/projects/${binding.projectId}/executions/${binding.cycleId}` ||
      v.paymentVerified !== false ||
      v.retirementVerified !== false
    )
      throw new TypeError("Foreign execution index reference");
    return {
      projectId: binding.projectId,
      cycleId: binding.cycleId,
      allocationSha256: v.allocationSha256,
      planSha256: binding.planSha256,
      binding,
      observationUrl: v.observationUrl as string,
      paymentVerified: false as const,
      retirementVerified: false as const,
    };
  });
  assertSquadsBindingLedger(executions.map((row) => row.binding));
  return { schemaVersion: 1, executions };
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw new TypeError("Invalid execution response fields");
  return value as Record<string, unknown>;
}

/** Browser boundary. Authenticity comes from the same-origin canonical endpoint,
 * not from this structural parser or any uploaded JSON. Match the selected
 * published binding before rendering an observation fetched with no-store.
 */
export function assertSquadsExecutionObservation(
  value: unknown,
  expected: SquadsExecutionBinding,
): SquadsExecutionObservation {
  const v = exactObject(value, [
    "verifier",
    "binding",
    "observedAt",
    "status",
    "instructionVerification",
    "paymentVerified",
    "retirementVerified",
    "proposalStatus",
    "accountEvidence",
    "reason",
    ...(isSquadsBatch(expected) ? ["batchProgress"] : []),
  ]);
  if (
    v.verifier !== "squads-execution-v1" ||
    canonicalSquadsBinding(v.binding) !== canonicalSquadsBinding(expected) ||
    typeof v.observedAt !== "string" ||
    !Number.isFinite(Date.parse(v.observedAt)) ||
    new Date(v.observedAt).toISOString() !== v.observedAt ||
    v.paymentVerified !== false ||
    v.retirementVerified !== false ||
    typeof v.reason !== "string" ||
    !v.reason.length ||
    v.reason.length > 1000 ||
    ![
      "draft",
      "active",
      "rejected",
      "approved",
      "executed",
      "cancelled",
      "unknown",
    ].includes(String(v.proposalStatus))
  )
    throw new TypeError("Invalid or foreign execution observation");
  const matched =
    v.status === "plan-matched" && v.instructionVerification === "verified";
  if (
    !matched &&
    (v.status !== "unverified" ||
      v.instructionVerification !== "unverified" ||
      v.accountEvidence !== null ||
      v.proposalStatus !== "unknown")
  )
    throw new TypeError("Inconsistent execution verification status");
  if (matched) {
    const evidence = exactObject(v.accountEvidence, [
      "authorities",
      "slots",
      "proposalSha256",
      "vaultTransactionSha256",
      "tokenAccountsSha256",
      "lookupTablesSha256",
    ]);
    if (
      v.proposalStatus === "unknown" ||
      !Array.isArray(evidence.authorities) ||
      evidence.authorities.length < 2 ||
      evidence.authorities.length > 3 ||
      new Set(evidence.authorities).size !== evidence.authorities.length ||
      evidence.authorities.some(
        (authority) =>
          !SQUADS_EXECUTION_RPC_AUTHORITIES.some(
            (fixed) => fixed === authority,
          ),
      ) ||
      !Array.isArray(evidence.slots) ||
      evidence.slots.length !== evidence.authorities.length ||
      evidence.slots.some((slot) => !Number.isSafeInteger(slot) || slot < 0) ||
      [
        evidence.proposalSha256,
        evidence.vaultTransactionSha256,
        evidence.tokenAccountsSha256,
        evidence.lookupTablesSha256,
      ].some(
        (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash),
      )
    )
      throw new TypeError("Invalid execution quorum evidence");
  }
  if (isSquadsBatch(expected)) {
    if (!matched && v.batchProgress !== null)
      throw new TypeError("Unverified Batch cannot claim progress");
    if (matched) {
      const progress = exactObject(v.batchProgress, [
        "totalChildren",
        "executedChildren",
      ]);
      if (
        progress.totalChildren !== expected.children.length ||
        !Number.isInteger(progress.executedChildren) ||
        Number(progress.executedChildren) < 0 ||
        Number(progress.executedChildren) > expected.children.length ||
        (v.proposalStatus === "executed") !==
          (progress.executedChildren === expected.children.length) ||
        (Number(progress.executedChildren) > 0 &&
          !["approved", "executed"].includes(String(v.proposalStatus)))
      )
        throw new TypeError("Inconsistent Batch execution progress");
    }
  }
  return {
    ...v,
    binding: assertSquadsExecutionBinding(v.binding),
  } as unknown as SquadsExecutionObservation;
}

/** UI wording never turns a Squads status into paid, available, or safe carry. */
export function squadsExecutionTrackerLabel(
  observation: SquadsExecutionObservation,
  now = Date.now(),
): string {
  const age = now - Date.parse(observation.observedAt);
  if (!Number.isFinite(age) || age < 0 || age >= 5 * 60_000)
    return "Execution observation stale · refresh required";
  if (observation.instructionVerification !== "verified")
    return "Proposal contents unverified";
  if (observation.batchProgress)
    return `Batch ${observation.batchProgress.executedChildren}/${observation.batchProgress.totalChildren} children executed · settlement unverified`;
  if (observation.proposalStatus === "executed")
    return "Proposal executed · settlement unverified";
  if (observation.proposalStatus === "approved")
    return "Proposal approved · execution pending";
  return `Plan matched · proposal ${observation.proposalStatus}`;
}
