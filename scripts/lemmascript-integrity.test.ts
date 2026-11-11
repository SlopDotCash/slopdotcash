import { describe, expect, it } from "bun:test";
import {
  requireMeaningfulSpecifications,
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

  it("allows only defined opaque functions and predicates with unchanged generated tokens", () => {
    const added = `${generated}
opaque function sumMeaning(x: int): int { x + 1 }
opaque predicate positive(x: int) { x > 0 }
`;
    expect(() => requireProofIntegrity(generated, added)).not.toThrow();
    expect(() => requireProofIntegrity(added, added)).not.toThrow();
    for (const [from, to] of [
      [
        "sumMeaning(x: int): int { x + 1 }",
        "sumMeaning(x: int): int { x + 2 }",
      ],
      ["sumMeaning(x: int)", "sumMeaning(x: nat)"],
      ["{ x > 0 }", "{ assume false; x > 0 }"],
      ["opaque function sumMeaning", "opaque function {:axiom} sumMeaning"],
    ]) {
      expect(() =>
        requireProofIntegrity(added, added.replace(from, to)),
      ).toThrow();
    }
    for (const extra of [
      "opaque function missing(x: int): int",
      "opaque predicate missing(x: int)",
      "opaque method missing() { }",
      "opaque lemma missing() { }",
      "opaque opaque function missing(): int { 0 }",
      "opaque function increment(x: int): int { 0 }",
      "opaque predicate hidden() { assume false; true }",
      "opaque function {:verify false} hidden(): int { 0 }",
    ]) {
      expect(() =>
        requireProofIntegrity(generated, `${generated}\n${extra}`),
      ).toThrow();
    }
    expect(() =>
      requireProofIntegrity(
        generated,
        generated.replace("function increment", "opaque function increment"),
      ),
    ).toThrow();
  });

  it("allows only defined ghost functions and predicates with unchanged generated tokens", () => {
    const added = `${generated}
ghost function sumMeaning(x: int): int { x + 1 }
ghost predicate closed(values: seq<bool>) { forall i: int :: 0 <= i < |values| ==> values[i] }
`;
    expect(() => requireProofIntegrity(generated, added)).not.toThrow();
    expect(() => requireProofIntegrity(added, added)).not.toThrow();
    for (const [from, to] of [
      [
        "sumMeaning(x: int): int { x + 1 }",
        "sumMeaning(x: int): int { x + 2 }",
      ],
      ["sumMeaning(x: int)", "sumMeaning(x: nat)"],
      ["ghost function sumMeaning", "function sumMeaning"],
      ["ghost predicate closed", "predicate closed"],
      ["{ x + 1 }", "{ assume false; x + 1 }"],
      ["ghost predicate closed", "ghost predicate {:verify false} closed"],
    ]) {
      expect(() =>
        requireProofIntegrity(added, added.replace(from, to)),
      ).toThrow();
    }
    for (const extra of [
      "ghost function missing(x: int): int",
      "ghost predicate missing(x: int)",
      "ghost method missing() { }",
      "ghost lemma missing() { }",
      "ghost ghost function missing(): int { 0 }",
      "ghost opaque function missing(): int { 0 }",
      "opaque ghost predicate missing() { true }",
      "ghost function increment(x: int): int { 0 }",
      "ghost predicate hidden() { assume false; true }",
      'ghost predicate hidden() { include "external.dfy"; true }',
      "ghost function {:axiom} hidden(): int { 0 }",
      "ghost function {:verify false} hidden(): int { 0 }",
    ]) {
      expect(() =>
        requireProofIntegrity(generated, `${generated}\n${extra}`),
      ).toThrow();
    }
    expect(() =>
      requireProofIntegrity(
        generated,
        generated.replace("function increment", "ghost function increment"),
      ),
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

describe("tautological specification lint", () => {
  it.each([
    "//@ ensures true",
    "//@ ensures (true)",
    "//@ ensures \\result == \\result",
    "//@ ensures \\result === (\\result)",
    "//@ ensures x ==> x",
    "//@ ensures ok <==> ok",
    "//@ invariant i <= i",
    "//@ requires (a + b) == (a+b)",
    "//@ ensures \\result >= 0 && \\result == \\result",
    "//@ ensures x == 1 || x == x",
    "//@ ensures p || true",
    "//@ ensures true || p",
    "//@ ensures p ==> true",
    "//@ ensures a ==> b ==> b == b",
    "//@ ensures a ==> (b || true)",
    "//@ ensures x == x || p ==> q || true",
    "//@ ensures p || q && x == x",
  ])("rejects %s", (clause) => {
    expect(() =>
      requireMeaningfulSpecifications(`${clause}\nexport function f() {}`),
    ).toThrow(/Tautological/);
  });

  it.each([
    "//@ ensures \\result == x",
    "//@ ensures a ==> b",
    "//@ ensures f(x) == f(y)",
    "//@ ensures x == 1 || x == 2",
    "//@ ensures p ==> q || r",
    "//@ ensures x == x || p ==> q",
    "//@ ensures true || b ==> c",
    "//@ ensures p && x == x ==> q",
    "//@ ensures a <==> b",
    "//@ ensures c ? x == x : y || true",
    '//@ ensures "a==a" == s',
    "//@ requires actors >= 1 && total >= minimumPerActor",
    "//@ ensures \\result != \\result",
  ])("accepts %s", (clause) => {
    expect(() => requireMeaningfulSpecifications(clause)).not.toThrow();
  });
});
