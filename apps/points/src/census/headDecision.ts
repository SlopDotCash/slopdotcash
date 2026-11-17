//@ backend dafny
// spec/points/census.md, "Every retained item has a deterministic, fail-closed selection decision with all its reasons"

export type HeadState = "Approved" | "ChangesRequested" | "Dismissed";

export type HeadVerdict = "Approved" | "ChangesRequested" | "None";

export interface HeadVote { reviewer: number; submittedAt: number; state: HeadState; atHead: boolean }

export function superseded(votes: HeadVote[], k: number): boolean {
  //@ requires 0 <= k && k < votes.length
  //@ ensures \result <==> exists(j, 0 <= j && j < votes.length && votes[j].reviewer === votes[k].reviewer && votes[j].submittedAt > votes[k].submittedAt)
  let j = 0;
  while (j < votes.length) {
    //@ invariant 0 <= j && j <= votes.length
    //@ invariant forall(i, 0 <= i && i < j ==> !(votes[i].reviewer === votes[k].reviewer && votes[i].submittedAt > votes[k].submittedAt))
    //@ decreases votes.length - j
    if (votes[j].reviewer === votes[k].reviewer && votes[j].submittedAt > votes[k].submittedAt) return true;
    j = j + 1;
  }
  return false;
}

export function headDecision(votes: HeadVote[]): HeadVerdict {
  //@ ensures \result === "ChangesRequested" <==> exists(k, 0 <= k && k < votes.length && votes[k].atHead && votes[k].state === "ChangesRequested" && forall(j, 0 <= j && j < votes.length ==> !(votes[j].reviewer === votes[k].reviewer && votes[j].submittedAt > votes[k].submittedAt)))
  //@ ensures \result === "Approved" ==> exists(k, 0 <= k && k < votes.length && votes[k].atHead && votes[k].state === "Approved" && forall(j, 0 <= j && j < votes.length ==> !(votes[j].reviewer === votes[k].reviewer && votes[j].submittedAt > votes[k].submittedAt)))
  //@ ensures \result === "None" ==> forall(k, 0 <= k && k < votes.length && votes[k].atHead && votes[k].state !== "Dismissed" ==> exists(j, 0 <= j && j < votes.length && votes[j].reviewer === votes[k].reviewer && votes[j].submittedAt > votes[k].submittedAt))
  let approved = false;
  let k = 0;
  while (k < votes.length) {
    //@ invariant 0 <= k && k <= votes.length
    //@ invariant forall(i, 0 <= i && i < k && votes[i].atHead && votes[i].state === "ChangesRequested" ==> exists(j, 0 <= j && j < votes.length && votes[j].reviewer === votes[i].reviewer && votes[j].submittedAt > votes[i].submittedAt))
    //@ invariant approved ==> exists(i, 0 <= i && i < k && votes[i].atHead && votes[i].state === "Approved" && forall(j, 0 <= j && j < votes.length ==> !(votes[j].reviewer === votes[i].reviewer && votes[j].submittedAt > votes[i].submittedAt)))
    //@ invariant !approved ==> forall(i, 0 <= i && i < k && votes[i].atHead && votes[i].state === "Approved" ==> exists(j, 0 <= j && j < votes.length && votes[j].reviewer === votes[i].reviewer && votes[j].submittedAt > votes[i].submittedAt))
    //@ decreases votes.length - k
    if (votes[k].atHead && !superseded(votes, k)) {
      if (votes[k].state === "ChangesRequested") return "ChangesRequested";
      if (votes[k].state === "Approved") approved = true;
    }
    k = k + 1;
  }
  return approved ? "Approved" : "None";
}
