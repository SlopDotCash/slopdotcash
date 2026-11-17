//@ backend dafny
// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";

export interface Saved {
  readonly identity: string;
  readonly hash: string;
  readonly candidate: string;
}

//@ pure
export function directAttempt(saved: Saved, bytesId: string, legacy: string): Attempt {
  //@ requires legacy !== ""
  //@ ensures \result.bytesId === bytesId && \result.hash === saved.hash
  //@ ensures saved.identity !== "" ==> \result.identity === saved.identity && \result.candidate === saved.candidate
  //@ ensures saved.identity === "" && saved.candidate !== "" ==> \result.identity === "" && \result.candidate === saved.candidate
  //@ ensures saved.identity === "" && saved.candidate === "" && saved.hash !== "" ==> \result.identity === "" && \result.candidate === saved.hash
  //@ ensures saved.identity === "" && saved.candidate === "" && saved.hash === "" ==> \result.identity === legacy && \result.candidate === ""
  if (saved.identity !== "") return { identity: saved.identity, bytesId, hash: saved.hash, candidate: saved.candidate };
  const found = saved.candidate !== "" ? saved.candidate : saved.hash;
  return { identity: found !== "" ? "" : legacy, bytesId, hash: saved.hash, candidate: found };
}

//@ pure
export function solanaAttempt(saved: Saved, bytesId: string, legacy: string): Attempt {
  //@ requires legacy !== ""
  //@ ensures \result.bytesId === bytesId && \result.hash === saved.hash && \result.candidate === saved.candidate
  //@ ensures saved.identity !== "" ==> \result.identity === saved.identity
  //@ ensures saved.identity === "" ==> \result.identity === legacy
  return { identity: saved.identity !== "" ? saved.identity : legacy, bytesId, hash: saved.hash, candidate: saved.candidate };
}

//@ pure
export function savedOf(attempt: Attempt, legacy: string): Saved {
  //@ requires legacy !== ""
  //@ ensures \result.hash === attempt.hash && \result.candidate === attempt.candidate
  //@ ensures attempt.identity !== legacy ==> \result.identity === attempt.identity
  //@ ensures attempt.identity === legacy ==> \result.identity === ""
  return { identity: attempt.identity === legacy ? "" : attempt.identity, hash: attempt.hash, candidate: attempt.candidate };
}

