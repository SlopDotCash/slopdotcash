//@ backend dafny
// spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Wallet references identify later lookups and uncertainty preserves the intent"; spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"

export type Settled = "pending" | "included" | "failed" | "finalized" | "notCanonical" | "unknownStatus";
export type ReceiptStatus = "success" | "reverted" | "other";
export type BatchStatus = "pending" | "notSent" | "partial" | "landed";
export type DeploymentCheck = "ok" | "code" | "slotInvalid" | "noImplementation" | "implementation" | "identity" | "delays" | "purpose" | "factory";

export interface MonthlySetting {
  readonly cap: bigint;
  readonly enabled: boolean;
}

export interface DeploymentAnswers {
  readonly code: string;
  readonly slotValid: boolean;
  readonly slotZero: boolean;
  readonly slot: string;
  readonly implementationCode: string;
  readonly token: string;
  readonly owner: string;
  readonly feeRecipient: string;
  readonly factory: string;
  readonly bindingDelay: bigint;
  readonly purpose: bigint;
  readonly mapped: string;
}

export interface DeploymentExpected {
  readonly code: string;
  readonly upgraded: boolean;
  readonly implementationSlot: string;
  readonly implementationCode: string;
  readonly token: string;
  readonly owner: string;
  readonly feeRecipient: string;
  readonly factory: string;
  readonly bindingDelay: bigint;
  readonly purpose: bigint;
  readonly vault: string;
}

/** @throws {never} */
//@ pure
export function settled(canonical: boolean, final: boolean, finalityRequired: boolean, status: ReceiptStatus): Settled {
  //@ ensures \result === "finalized" ==> canonical && final && status === "success"
  //@ ensures \result === "failed" ==> canonical && final && status === "reverted"
  //@ ensures \result === "included" ==> canonical && !final && status === "success"
  //@ ensures \result === "notCanonical" ==> !canonical && finalityRequired && final
  //@ ensures \result === "unknownStatus" ==> canonical && final && status === "other"
  if (!canonical) return finalityRequired && final ? "notCanonical" : "pending";
  if (!final) return status === "success" ? "included" : "pending";
  if (status === "reverted") return "failed";
  return status === "success" ? "finalized" : "unknownStatus";
}

/** @throws {never} */
//@ pure
export function batchStatus(status: number): BatchStatus {
  //@ ensures \result === "landed" <==> (status === 200 || status === 500)
  //@ ensures \result === "pending" <==> (100 <= status && status < 200)
  //@ ensures \result === "notSent" <==> (400 <= status && status < 500)
  if (status >= 100 && status < 200) return "pending";
  if (status >= 400 && status < 500) return "notSent";
  return status === 200 || status === 500 ? "landed" : "partial";
}

/** @throws {never} */
//@ pure
export function batchRefused(code: number): boolean {
  //@ ensures \result <==> (code === 4200 || code === -32601 || code === 5700 || code === 5710 || code === 5740 || code === 5750 || code === 5760)
  return code === 4200 || code === -32601 || code === 5700 || code === 5710 || code === 5740 || code === 5750 || code === 5760;
}

/** @throws {never} */
//@ pure
export function settingTarget(automatic: boolean, projectCap: bigint, current: MonthlySetting): MonthlySetting {
  //@ requires !automatic || projectCap > 0
  //@ ensures \result.enabled === automatic
  //@ ensures automatic ==> \result.cap === projectCap
  //@ ensures !automatic ==> \result.cap === current.cap
  return automatic ? { cap: projectCap, enabled: true } : { cap: current.cap, enabled: false };
}

/** @throws {never} */
//@ pure
export function deploymentCheck(read: DeploymentAnswers, expected: DeploymentExpected): DeploymentCheck {
  //@ ensures \result === "ok" <==> (read.code === expected.code && read.slotValid && (expected.upgraded ? (read.slot === expected.implementationSlot && read.implementationCode === expected.implementationCode) : read.slotZero) && read.token === expected.token && read.owner === expected.owner && read.feeRecipient === expected.feeRecipient && read.factory === expected.factory && read.bindingDelay === expected.bindingDelay && read.purpose === expected.purpose && read.mapped === expected.vault)
  if (read.code !== expected.code) return "code";
  if (!read.slotValid) return "slotInvalid";
  if (!expected.upgraded && !read.slotZero) return "noImplementation";
  if (expected.upgraded && (read.slot !== expected.implementationSlot || read.implementationCode !== expected.implementationCode)) return "implementation";
  if (read.token !== expected.token || read.owner !== expected.owner || read.feeRecipient !== expected.feeRecipient || read.factory !== expected.factory) return "identity";
  if (read.bindingDelay !== expected.bindingDelay) return "delays";
  if (read.purpose !== expected.purpose) return "purpose";
  return read.mapped === expected.vault ? "ok" : "factory";
}
