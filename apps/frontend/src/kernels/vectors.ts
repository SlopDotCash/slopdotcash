// spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import { Arbitrary } from "effect";
import { type Contract, contract } from "vibestack/testing";

const shown = (value: unknown) => String(JSON.stringify(value, (_key, part: unknown) => (typeof part === "bigint" ? `${part}n` : part)));

export function vectors<I, O>(cases: ReadonlyArray<readonly [I, O]>, run: (input: I) => O): Contract<ReadonlyArray<readonly [I, O]>, string[]> {
  return contract({
    input: Arbitrary.Constant(cases),
    run: (all) => all.map(([input]) => shown(run(input))),
    invariant: (all, outcomes) => all.every(([, expected], index) => outcomes[index] === shown(expected)),
  });
}
