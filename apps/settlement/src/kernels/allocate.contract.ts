// spec/settlement/allocation.md, "The largest remainders receive the remaining units exactly once"; spec/settlement/allocation.md, "Each floor and remainder comes from full-width multiplication and division"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Allocation, allocate, type WeightedActor } from "./allocate.ts";
import { MAX_BASE_UNITS } from "./amounts.ts";

const pool = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: MAX_BASE_UNITS }));

const recipients = (largestWeight: bigint) =>
  Arbitrary.schema(Schema.Struct({
    total: pool,
    weights: Schema.Array(Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: largestWeight }))).check(Schema.isMaxLength(12)),
  })).pipe(Arbitrary.map(({ total, weights }) => ({ total, recipients: weights.map((weight, index) => ({ actor: weights.length - index, weight })) })));

type Input = { total: bigint; recipients: readonly WeightedActor[] };

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

const expected = ({ total, recipients }: Input): bigint[] | undefined => {
  const denominator = sum(recipients.map((r) => r.weight));
  if (recipients.length === 0) return total === 0n ? [] : undefined;
  if (recipients.some((r) => r.weight === 0n)) return undefined;
  if (recipients.length === 1) return [total];
  const floors = recipients.map((r) => (total * r.weight) / denominator);
  const remainders = recipients.map((r) => (total * r.weight) % denominator);
  const ranked = recipients.map((r, index) => ({ index, actor: r.actor, remainder: remainders[index] }))
    .sort((a, b) => (a.remainder === b.remainder ? a.actor - b.actor : a.remainder > b.remainder ? -1 : 1));
  const leftover = Number(total - sum(floors));
  const bonus = new Set(ranked.slice(0, leftover).map((entry) => entry.index));
  return floors.map((floor, index) => floor + (bonus.has(index) ? 1n : 0n));
};

const matches = (input: Input, result: Allocation) => {
  const amounts = expected(input);
  if (amounts === undefined) return result.kind === "Refused";
  return result.kind === "Allocated"
    && sum(result.shares.map((share) => share.amount)) === input.total
    && result.shares.length === amounts.length
    && result.shares.every((share, index) => share.actor === input.recipients[index].actor && share.amount === amounts[index]);
};

const run = (input: Input) => allocate(input.total, input.recipients);

export const largeWeightsAllocateExactly = contract({ input: recipients(1n << 96n), run, deterministic: true, invariant: matches });

export const tiedWeightsBreakByActor = contract({ input: recipients(3n), run, invariant: matches });
