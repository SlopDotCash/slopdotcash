import { describe, expect, it } from "bun:test";
import {
  requireProofIntegrity,
  requireProofObligations,
} from "./lemmascript-integrity.mjs";

const generated = `
function increment(x: int): int { x + 1 }
lemma increment_ensures(x: int)
  ensures increment(x) > x
{ }
method count(x: int) returns (result: int)
  ensures result == x + 1
{ result := x + 1; }
`;

describe("generated proof integrity boundary", () => {
  it("allows proved lemma bodies and ghost assertion blocks without changing executable tokens", () => {
    const proof = generated
      .replace("{ }", "{ assert increment(x) > x; }")
      .replace("result :=", "assert x + 1 > x by { } result :=");
    expect(() => requireProofIntegrity(generated, proof)).not.toThrow();
  });

  it.each([
    [
      "an inserted early return",
      generated.replace(
        "result := x + 1;",
        "result := 0; return; result := x + 1;",
      ),
    ],
    [
      "an executable function rewrite",
      generated.replace("{ x + 1 }", "{ x + 2 }"),
    ],
    [
      "a weakened generated postcondition",
      generated.replace("ensures result == x + 1", "ensures true"),
    ],
    ["an assumed obligation", generated.replace("{ }", "{ assume false; }")],
    [
      "a verifier-disabled lemma",
      generated.replace(
        "lemma increment_ensures",
        "lemma {:verify false} increment_ensures",
      ),
    ],
    [
      "a bodyless trusted helper",
      `${generated}\nfunction trusted(x: int): bool`,
    ],
    ["an unchecked include", `${generated}\ninclude "external.dfy"`],
    [
      "a duplicate declaration",
      `${generated}\nfunction increment(x: int): int { 0 }`,
    ],
  ])("rejects %s", (_name, proof) => {
    expect(() => requireProofIntegrity(generated, proof)).toThrow();
  });

  it("requires a generated postcondition for every selected runtime function", () => {
    const source = `//@ verify\nexport function increment(x: bigint): bigint { return x + 1n; }`;
    expect(requireProofObligations(source, generated)).toEqual(["increment"]);
    expect(() =>
      requireProofObligations(
        source,
        "function increment(x: int): int { x + 1 }",
      ),
    ).toThrow();
    expect(() =>
      requireProofObligations("export const value = 1;", generated),
    ).toThrow();
  });

  it("finds compiler-supported body-header contracts and rejects nested targets", () => {
    const source = `export function increment(x: bigint): bigint {
      //@ verify
      //@ ensures \\result > x
      return x + 1n;
    }`;
    expect(requireProofObligations(source, generated)).toEqual(["increment"]);
    const nested = `export function outer() {
      const x = 1;
      function increment(x: bigint): bigint {
        //@ verify
        return x + 1n;
      }
    }`;
    expect(() => requireProofObligations(nested, generated)).toThrow();
  });
});
