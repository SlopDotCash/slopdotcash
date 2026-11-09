export interface AcceptedCommit {
  sha: string;
  parentCount: number;
}
export type AcceptanceScope =
  | { kind: "direct" }
  | { kind: "indirect"; shas: string[] };

//@ verify
//@ ensures \result <==> StringsContain(values, target)
function containsString(values: readonly string[], target: string): boolean {
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant !StringsContain(values.slice(0, i), target)
    if (values[i] === target) return true;
    i += 1;
  }
  return false;
}

/** Complete original-order selection; callers retain the original commits. */
//@ verify
//@ ensures \result == AcceptedIndices(commits, resolutions, scope)
//@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < commits.length)
//@ ensures forall(i, 0 <= i && i < \result.length ==> forall(j, i < j && j < \result.length ==> \result[i] < \result[j]))
export function selectAcceptedCommitIndices(
  commits: readonly AcceptedCommit[],
  resolutions: readonly string[],
  scope: AcceptanceScope,
): number[] {
  const result: number[] = [];
  let i = 0;
  while (i < commits.length) {
    //@ invariant 0 <= i && i <= commits.length
    //@ invariant result == AcceptedIndices(commits.slice(0, i), resolutions, scope)
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < i)
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(j, k < j && j < result.length ==> result[k] < result[j]))
    const commit = commits[i];
    if (commit.parentCount <= 1 || containsString(resolutions, commit.sha)) {
      let accepted = true;
      if (scope.kind === "indirect")
        accepted = containsString(scope.shas, commit.sha);
      if (accepted) result.push(i);
    }
    i += 1;
  }
  return result;
}

export type ParentRecord =
  | { kind: "missing" }
  | { kind: "stored"; projectId: string; sourceKeys: string[] };
export interface HistoryParent {
  digest: string;
  index: number;
  record: ParentRecord;
}
export type CurrentOwner =
  | { kind: "unowned" }
  | { kind: "owned"; digest: string };
export interface CurrentMember {
  key: string;
  owner: CurrentOwner;
}
export interface CurrentClaim {
  key: string;
  owner: string;
}
export interface OwnershipPlan {
  kind: "predecessor" | "source" | "claim" | "ready";
  owner: string;
  retire: number[];
  removeClaims: string[];
  setSources: string[];
  setClaims: string[];
}

//@ verify
//@ ensures \result <==> ParentContains(parents, digest)
function containsParent(
  parents: readonly HistoryParent[],
  digest: string,
): boolean {
  let i = 0;
  while (i < parents.length) {
    //@ invariant 0 <= i && i <= parents.length
    //@ invariant !ParentContains(parents.slice(0, i), digest)
    if (parents[i].digest === digest) return true;
    i += 1;
  }
  return false;
}

//@ verify
//@ ensures \result <==> MemberContains(members, key)
function containsMember(
  members: readonly CurrentMember[],
  key: string,
): boolean {
  let i = 0;
  while (i < members.length) {
    //@ invariant 0 <= i && i <= members.length
    //@ invariant !MemberContains(members.slice(0, i), key)
    if (members[i].key === key) return true;
    i += 1;
  }
  return false;
}

/** Complete per-record refusal and map-operation plan, with no native Map. */
//@ verify
//@ requires forall(i, 0 <= i && i < parents.length ==> parents[i].record.kind == "missing" || (0 <= parents[i].index && parents[i].index < used.length))
//@ ensures \result.owner == digest
//@ ensures \result.kind == "ready" ==> forall(i, 0 <= i && i < \result.retire.length ==> 0 <= \result.retire[i] && \result.retire[i] < used.length)
//@ ensures \result.kind == "predecessor" <==> !ValidParents(parents, used, projectId, members)
//@ ensures \result.kind == "source" <==> ValidParents(parents, used, projectId, members) && !OwnersAllowed(members, parents)
//@ ensures \result.kind == "claim" <==> ValidParents(parents, used, projectId, members) && OwnersAllowed(members, parents) && !OwnersAllowed(claims, parents)
//@ ensures \result.kind == "ready" <==> ValidParents(parents, used, projectId, members) && OwnersAllowed(members, parents) && OwnersAllowed(claims, parents)
//@ ensures \result.kind != "ready" ==> \result.retire.length == 0 && \result.removeClaims.length == 0 && \result.setSources.length == 0 && \result.setClaims.length == 0
//@ ensures \result.kind == "ready" ==> \result.retire == ParentIndices(parents) && \result.removeClaims == RemovedClaims(parents, currentClaims) && \result.setSources == MemberKeys(members) && \result.setClaims == MemberKeys(claims)
export function planOwnershipTransition(
  projectId: string,
  digest: string,
  parents: readonly HistoryParent[],
  used: readonly boolean[],
  members: readonly CurrentMember[],
  claims: readonly CurrentMember[],
  currentClaims: readonly CurrentClaim[],
): OwnershipPlan {
  let i = 0;
  while (i < parents.length) {
    //@ invariant 0 <= i && i <= parents.length
    //@ invariant ValidParents(parents.slice(0, i), used, projectId, members)
    const parent = parents[i];
    if (
      parent.record.kind === "missing" ||
      used[parent.index] ||
      parent.record.projectId !== projectId
    )
      return {
        kind: "predecessor",
        owner: digest,
        retire: [],
        removeClaims: [],
        setSources: [],
        setClaims: [],
      };
    let j = 0;
    while (j < parent.record.sourceKeys.length) {
      //@ invariant 0 <= j && j <= parent.record.sourceKeys.length
      //@ invariant forall(k, 0 <= k && k < j ==> MemberContains(members, parent.record.sourceKeys[k]))
      if (!containsMember(members, parent.record.sourceKeys[j]))
        return {
          kind: "predecessor",
          owner: digest,
          retire: [],
          removeClaims: [],
          setSources: [],
          setClaims: [],
        };
      j += 1;
    }
    i += 1;
  }
  const setSources: string[] = [];
  i = 0;
  while (i < members.length) {
    //@ invariant 0 <= i && i <= members.length
    //@ invariant OwnersAllowed(members.slice(0, i), parents)
    //@ invariant setSources == MemberKeys(members.slice(0, i))
    const member = members[i];
    if (member.owner.kind === "owned") {
      if (!containsParent(parents, member.owner.digest))
        return {
          kind: "source",
          owner: digest,
          retire: [],
          removeClaims: [],
          setSources: [],
          setClaims: [],
        };
    }
    setSources.push(member.key);
    i += 1;
  }
  const setClaims: string[] = [];
  i = 0;
  while (i < claims.length) {
    //@ invariant 0 <= i && i <= claims.length
    //@ invariant OwnersAllowed(claims.slice(0, i), parents)
    //@ invariant setClaims == MemberKeys(claims.slice(0, i))
    const claim = claims[i];
    if (claim.owner.kind === "owned") {
      if (!containsParent(parents, claim.owner.digest))
        return {
          kind: "claim",
          owner: digest,
          retire: [],
          removeClaims: [],
          setSources: [],
          setClaims: [],
        };
    }
    setClaims.push(claim.key);
    i += 1;
  }
  const retire: number[] = [];
  const removeClaims: string[] = [];
  i = 0;
  while (i < parents.length) {
    //@ invariant 0 <= i && i <= parents.length
    //@ invariant retire == ParentIndices(parents.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < retire.length ==> 0 <= retire[k] && retire[k] < used.length)
    //@ invariant removeClaims == RemovedClaims(parents.slice(0, i), currentClaims)
    const parent = parents[i];
    retire.push(parent.index);
    let j = 0;
    while (j < currentClaims.length) {
      //@ invariant 0 <= j && j <= currentClaims.length
      //@ invariant removeClaims == RemovedClaims(parents.slice(0, i), currentClaims) + ClaimsOwnedBy(currentClaims.slice(0, j), parent.digest)
      if (currentClaims[j].owner === parent.digest)
        removeClaims.push(currentClaims[j].key);
      j += 1;
    }
    i += 1;
  }
  return {
    kind: "ready",
    owner: digest,
    retire,
    removeClaims,
    setSources,
    setClaims,
  };
}
