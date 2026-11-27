//@ backend dafny
// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";

export interface Saved {
  readonly identity: string;
  readonly hash: string;
  readonly candidate: string;
}

//@ pure
export function directAttempt(saved: Saved, bytesId: string, fallback: string): Attempt {
  //@ requires fallback !== ""
  //@ ensures \result.bytesId === bytesId && \result.hash === saved.hash
  //@ ensures saved.identity !== "" ==> \result.identity === saved.identity && \result.candidate === saved.candidate
  //@ ensures saved.identity === "" && saved.candidate !== "" ==> \result.identity === "" && \result.candidate === saved.candidate
  //@ ensures saved.identity === "" && saved.candidate === "" && saved.hash !== "" ==> \result.identity === "" && \result.candidate === saved.hash
  //@ ensures saved.identity === "" && saved.candidate === "" && saved.hash === "" ==> \result.identity === fallback && \result.candidate === ""
  if (saved.identity !== "") return { identity: saved.identity, bytesId, hash: saved.hash, candidate: saved.candidate };
  const found = saved.candidate !== "" ? saved.candidate : saved.hash;
  return { identity: found !== "" ? "" : fallback, bytesId, hash: saved.hash, candidate: found };
}

//@ pure
export function solanaAttempt(saved: Saved, bytesId: string, fallback: string): Attempt {
  //@ requires fallback !== ""
  //@ ensures \result.bytesId === bytesId && \result.hash === saved.hash && \result.candidate === saved.candidate
  //@ ensures saved.identity !== "" ==> \result.identity === saved.identity
  //@ ensures saved.identity === "" ==> \result.identity === fallback
  return { identity: saved.identity !== "" ? saved.identity : fallback, bytesId, hash: saved.hash, candidate: saved.candidate };
}

//@ pure
export function savedOf(attempt: Attempt, fallback: string): Saved {
  //@ requires fallback !== ""
  //@ ensures \result.hash === attempt.hash && \result.candidate === attempt.candidate
  //@ ensures attempt.identity !== fallback ==> \result.identity === attempt.identity
  //@ ensures attempt.identity === fallback ==> \result.identity === ""
  return { identity: attempt.identity === fallback ? "" : attempt.identity, hash: attempt.hash, candidate: attempt.candidate };
}

