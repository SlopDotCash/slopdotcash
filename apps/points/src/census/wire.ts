//@ backend dafny
// spec/points/census.md, "Every retained item has a deterministic, fail-closed selection decision with all its reasons"
import { type Reason } from "../../gen/points__census.ts";

export const wireCount = 10;

export const blockedWire = 5;

export const draftWire = 6;

//@ pure
export function wireOf(reason: Reason): number {
  //@ ensures -1 <= \result && \result < 10
  //@ ensures \result === -1 <==> (reason === "Closed" || reason === "HumanGated")
  return reason === "AuthorUnknown" ? 0
    : reason === "BotAuthored" ? 1
    : reason === "SecurityLabel" ? 2
    : reason === "Untriaged" || reason === "Epic" ? 3
    : reason === "Assigned" || reason === "Claimed" ? 4
    : reason === "Blocked" || reason === "DiffUnavailable" ? 5
    : reason === "DraftItem" ? 6
    : reason === "ReviewRequested" ? 7
    : reason === "Approved" ? 8
    : reason === "ChangesRequested" ? 9
    : -1;
}

export function hasWire(reasons: Reason[], wire: number): boolean {
  //@ ensures \result <==> exists(j, 0 <= j && j < reasons.length && wireOf(reasons[j]) === wire)
  let j = 0;
  while (j < reasons.length) {
    //@ invariant 0 <= j && j <= reasons.length
    //@ invariant forall(i, 0 <= i && i < j ==> wireOf(reasons[i]) !== wire)
    //@ decreases reasons.length - j
    if (wireOf(reasons[j]) === wire) return true;
    j = j + 1;
  }
  return false;
}

export function unstated(reasons: Reason[]): number {
  //@ ensures -1 <= \result && \result < reasons.length
  //@ ensures \result >= 0 ==> wireOf(reasons[\result]) === -1
  //@ ensures \result === -1 ==> forall(j, 0 <= j && j < reasons.length ==> wireOf(reasons[j]) >= 0)
  let j = 0;
  while (j < reasons.length) {
    //@ invariant 0 <= j && j <= reasons.length
    //@ invariant forall(i, 0 <= i && i < j ==> wireOf(reasons[i]) >= 0)
    //@ decreases reasons.length - j
    if (wireOf(reasons[j]) === -1) return j;
    j = j + 1;
  }
  return -1;
}

function findWire(reasons: Reason[], wire: number): number {
  //@ ensures -1 <= \result && \result < reasons.length
  //@ ensures \result >= 0 ==> wireOf(reasons[\result]) === wire
  //@ ensures \result === -1 ==> forall(j, 0 <= j && j < reasons.length ==> wireOf(reasons[j]) !== wire)
  let j = 0;
  while (j < reasons.length) {
    //@ invariant 0 <= j && j <= reasons.length
    //@ invariant forall(i, 0 <= i && i < j ==> wireOf(reasons[i]) !== wire)
    //@ decreases reasons.length - j
    if (wireOf(reasons[j]) === wire) return j;
    j = j + 1;
  }
  return -1;
}

export function wireReasons(reasons: Reason[]): number[] {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> 0 <= \result[k] && \result[k] < wireCount)
  //@ ensures forall(k, 0 < k && k < \result.length ==> \result[k - 1] < \result[k])
  //@ ensures forall(k, 0 <= k && k < \result.length ==> exists(j, 0 <= j && j < reasons.length && wireOf(reasons[j]) === \result[k]))
  //@ ensures forall(j, 0 <= j && j < reasons.length && wireOf(reasons[j]) >= 0 && wireOf(reasons[j]) !== blockedWire ==> exists(k, 0 <= k && k < \result.length && \result[k] === wireOf(reasons[j])))
  //@ ensures exists(j, 0 <= j && j < reasons.length && wireOf(reasons[j]) === draftWire) ==> forall(k, 0 <= k && k < \result.length ==> \result[k] !== blockedWire)
  const hideBlocked = hasWire(reasons, draftWire);
  const named: number[] = [];
  //@ ghost let sources: number[] = []
  //@ ghost let positions: number[] = []
  let w = 0;
  while (w < wireCount) {
    //@ invariant 0 <= w && w <= wireCount
    //@ invariant named.length <= w
    //@ invariant sources.length === named.length
    //@ invariant positions.length === w
    //@ invariant forall(k, 0 <= k && k < named.length ==> 0 <= named[k] && named[k] < w)
    //@ invariant forall(k, 0 < k && k < named.length ==> named[k - 1] < named[k])
    //@ invariant forall(k, 0 <= k && k < named.length ==> 0 <= sources[k] && sources[k] < reasons.length && wireOf(reasons[sources[k]]) === named[k])
    //@ invariant forall(v, 0 <= v && v < w ==> -1 <= positions[v] && positions[v] < named.length && (positions[v] >= 0 ==> named[positions[v]] === v))
    //@ invariant forall(j, 0 <= j && j < reasons.length && 0 <= wireOf(reasons[j]) && wireOf(reasons[j]) < w && wireOf(reasons[j]) !== blockedWire ==> positions[wireOf(reasons[j])] >= 0)
    //@ invariant hideBlocked ==> forall(k, 0 <= k && k < named.length ==> named[k] !== blockedWire)
    //@ decreases wireCount - w
    const found = findWire(reasons, w);
    const include = found >= 0 && !(w === blockedWire && hideBlocked);
    //@ ghost positions = positions.concat([include ? named.length : -1])
    if (include) {
      named.push(w);
      //@ ghost sources = sources.concat([found])
    }
    w = w + 1;
  }
  //@ assert 0 < named.length ==> wireOf(reasons[sources[0]]) === named[0]
  //@ assert 1 < named.length ==> wireOf(reasons[sources[1]]) === named[1]
  //@ assert 2 < named.length ==> wireOf(reasons[sources[2]]) === named[2]
  //@ assert 3 < named.length ==> wireOf(reasons[sources[3]]) === named[3]
  //@ assert 4 < named.length ==> wireOf(reasons[sources[4]]) === named[4]
  //@ assert 5 < named.length ==> wireOf(reasons[sources[5]]) === named[5]
  //@ assert 6 < named.length ==> wireOf(reasons[sources[6]]) === named[6]
  //@ assert 7 < named.length ==> wireOf(reasons[sources[7]]) === named[7]
  //@ assert 8 < named.length ==> wireOf(reasons[sources[8]]) === named[8]
  //@ assert 9 < named.length ==> wireOf(reasons[sources[9]]) === named[9]
  return named;
}
