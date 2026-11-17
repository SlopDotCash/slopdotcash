//@ backend dafny
// spec/backend/identity.md, "At most one poll receives the flow's identity"

export function identityPollDelay(intervalSeconds: number, remaining: number): number {
  //@ requires 1 <= intervalSeconds && intervalSeconds <= 10
  //@ ensures \result <= 10000 && \result <= remaining
  //@ ensures remaining >= 0 ==> \result >= 0
  //@ ensures remaining <= intervalSeconds * 1000 ==> \result === remaining
  //@ ensures intervalSeconds * 1000 <= remaining ==> \result === intervalSeconds * 1000
  const wait = intervalSeconds * 1000;
  return wait <= remaining ? wait : remaining;
}
