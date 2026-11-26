//@ backend dafny
// spec/contributor/evidence.md, "A signed receipt binds the exact disclosure and either no trace or the stored trace"; spec/contributor/evidence.md, "A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key"

export interface Disclosure {
  policyRevision: string;
  licenseSha256: string;
  inboundTermsSha256: string;
  prizeRulesSha256: string;
}

export interface PinnedBinding {
  disclosure: Disclosure;
  activatedAt: number;
}

export interface Join {
  sameProject: boolean;
  v1Schema: boolean;
  acknowledged: boolean;
  acknowledgement: Disclosure;
  startedAt: number;
  completedAt: number;
  active: boolean;
  activatedAt: number;
  disclosed: Disclosure;
  bindings: PinnedBinding[];
}

export type JoinVerdict = "Joined" | "OtherProject" | "LegacyAfterActivation" | "DisclosureMismatch" | "StartedBeforeActivation" | "PinnedMismatch";

export interface UsageFigures {
  measured: boolean;
  available: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costIsZero: boolean;
  sessionCount: number;
}

export type UsageVerdict = "Consistent" | "UnavailableNotZero" | "AvailableEmpty";

//@ pure
export function sameDisclosure(a: Disclosure, b: Disclosure): boolean {
  return a.policyRevision === b.policyRevision && a.licenseSha256 === b.licenseSha256
    && a.inboundTermsSha256 === b.inboundTermsSha256 && a.prizeRulesSha256 === b.prizeRulesSha256;
}

export function pinnedIndex(bindings: PinnedBinding[], policyRevision: string): number {
  //@ ensures -1 <= \result && \result < bindings.length
  //@ ensures \result >= 0 ==> bindings[\result].disclosure.policyRevision === policyRevision
  let i = 0;
  while (i < bindings.length) {
    //@ invariant 0 <= i && i <= bindings.length
    if (bindings[i].disclosure.policyRevision === policyRevision) return i;
    i = i + 1;
  }
  return -1;
}

export function policyJoin(j: Join): JoinVerdict {
  //@ ensures \result === "Joined" ==> j.sameProject
  //@ ensures \result === "Joined" && j.v1Schema && j.active ==> j.completedAt < j.activatedAt
  //@ ensures \result === "Joined" && !j.v1Schema ==> j.acknowledged
  //@ ensures \result === "Joined" && !j.v1Schema && !j.active ==> sameDisclosure(j.acknowledgement, j.disclosed)
  //@ ensures \result === "Joined" && !j.v1Schema && j.active ==> j.activatedAt <= j.startedAt
  if (!j.sameProject) return "OtherProject";
  if (j.v1Schema) {
    if (j.active && j.completedAt >= j.activatedAt) return "LegacyAfterActivation";
    return "Joined";
  }
  if (!j.active) {
    if (!j.acknowledged || !sameDisclosure(j.acknowledgement, j.disclosed)) return "DisclosureMismatch";
    return "Joined";
  }
  if (j.startedAt < j.activatedAt) return "StartedBeforeActivation";
  if (!j.acknowledged) return "PinnedMismatch";
  const index = pinnedIndex(j.bindings, j.acknowledgement.policyRevision);
  if (index < 0) return "PinnedMismatch";
  if (j.startedAt < j.bindings[index].activatedAt || !sameDisclosure(j.bindings[index].disclosure, j.acknowledgement)) return "PinnedMismatch";
  return "Joined";
}

export function usageVerdict(u: UsageFigures): UsageVerdict {
  //@ ensures \result === "Consistent" && !u.available ==> u.totalTokens === 0 && u.sessionCount === 0 && u.costIsZero
  //@ ensures \result === "Consistent" && u.available ==> u.measured && u.totalTokens !== 0 && u.sessionCount !== 0
  if (!u.available) {
    if (u.inputTokens !== 0 || u.outputTokens !== 0 || u.cacheCreationTokens !== 0 || u.cacheReadTokens !== 0
      || u.totalTokens !== 0 || !u.costIsZero || u.sessionCount !== 0) return "UnavailableNotZero";
    return "Consistent";
  }
  if (!u.measured || u.totalTokens === 0 || u.sessionCount === 0) return "AvailableEmpty";
  return "Consistent";
}
