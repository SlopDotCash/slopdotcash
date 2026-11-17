//@ backend dafny
// spec/slopbot/spendAlerts.md, "Each new call appends an immutable cost row with zero customer charge"

export const priceVersion = "2026-10-09";

export interface Rate {
  input: bigint;
  cacheWrite: bigint;
  cacheRead: bigint;
  output: bigint;
  listPrice: boolean;
}

export interface TokenUsage {
  input: bigint;
  cacheWrite: bigint;
  cacheRead: bigint;
  output: bigint;
}

/** @throws {never} */
export function rateOf(key: string): Rate | null {
  //@ ensures \result !== null ==> \result.input >= 0 && \result.cacheWrite >= 0 && \result.cacheRead >= 0 && \result.output >= 0
  if (key === "orbio/anthropic/claude-sonnet-5.5") return { input: 2000000n, cacheWrite: 2500000n, cacheRead: 100000n, output: 10000000n, listPrice: true };
  if (key === "orbio/openai/gpt-6.1-terra") return { input: 1000000n, cacheWrite: 1250000n, cacheRead: 50000n, output: 5000000n, listPrice: true };
  if (key === "surplus/claude-sonnet-5.5") return { input: 2000000n, cacheWrite: 2500000n, cacheRead: 100000n, output: 10000000n, listPrice: false };
  if (key === "surplus/gpt-6.1-terra") return { input: 1000000n, cacheWrite: 1250000n, cacheRead: 50000n, output: 5000000n, listPrice: false };
  if (key === "surplus/claude-opus-5.5") return { input: 600000n, cacheWrite: 600000n, cacheRead: 600000n, output: 3000000n, listPrice: false };
  if (key === "surplus/gpt-6.1-sol") return { input: 2000000n, cacheWrite: 2000000n, cacheRead: 100000n, output: 10000000n, listPrice: false };
  return null;
}

//@ pure
export function tokenCost(rate: Rate, usage: TokenUsage): bigint {
  return usage.input * rate.input + usage.cacheWrite * rate.cacheWrite + usage.cacheRead * rate.cacheRead + usage.output * rate.output;
}

/** @throws {never} */
export function costMicroUsd(rate: Rate, usage: TokenUsage): bigint {
  //@ requires rate.input >= 0
  //@ requires rate.cacheWrite >= 0
  //@ requires rate.cacheRead >= 0
  //@ requires rate.output >= 0
  //@ requires usage.input >= 0
  //@ requires usage.cacheWrite >= 0
  //@ requires usage.cacheRead >= 0
  //@ requires usage.output >= 0
  //@ ensures \result >= 0
  //@ ensures (\result - 1) * 1000000 < tokenCost(rate, usage)
  //@ ensures tokenCost(rate, usage) <= \result * 1000000
  return (tokenCost(rate, usage) + 999999n) / 1000000n;
}
