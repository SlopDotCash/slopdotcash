// spec/settlement/feeReplacement.md, "Each step raises both fee fields by at least 10% and at most 25%, within three times the original and the absolute ceiling"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { nextReplacement, type Replacement } from "./feeReplacement.ts";

const fee = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: 1_000_000_000_000n }));

const step = Schema.Struct({ originalMax: fee, originalPriority: fee, latestMax: fee, latestPriority: fee, ceiling: fee });

type Step = typeof step.Type;

const replace = (s: Step) =>
  nextReplacement({
    original: { maxFeePerGas: s.originalMax, maxPriorityFeePerGas: s.originalPriority },
    latest: { maxFeePerGas: s.latestMax, maxPriorityFeePerGas: s.latestPriority },
    ceiling: s.ceiling,
  });

const bounded = (s: Step, result: Replacement) => {
  if (result.kind === "Keep") return true;
  const { maxFeePerGas: max, maxPriorityFeePerGas: priority } = result.fees;
  return s.originalMax > 0n && s.latestMax > 0n && s.ceiling > 0n
    && max <= s.originalMax * 3n && max <= s.ceiling && priority <= s.originalPriority * 3n && priority <= max
    && max * 100n >= s.latestMax * 110n && priority * 100n >= s.latestPriority * 110n
    && (max - 1n) * 100n < s.latestMax * 125n && (priority - 1n) * 100n < s.latestPriority * 125n;
};

export const replacementStepIsBounded = contract({ input: step, run: replace, deterministic: true, invariant: bounded });
