// Regression for #1930 items 1–2: drop low_quality claims that treat a
// SHA-256 hex digest or a 0x integer literal in the item as invalid or undefined.
import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import { contradictedHexOrLiteralClaim } from "./review";

const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";

function verdict(
  partial: Partial<Verdict> & Pick<Verdict, "summary">,
): Verdict {
  return {
    category: "low_quality",
    confidence: 0.7,
    rule_refs: [
      { source: "CONTRIBUTING.md", quote: "prove the result with tests" },
    ],
    evidence: [],
    limitations: [],
    objective_defect: null,
    ...partial,
  };
}

test("SHA-256 hex digest called invalid is contradicted when present in the item", () => {
  const item = `expect(hash).toBe("${DIGEST}");`;
  const finding = verdict({
    summary: `The asserted digest ${DIGEST} is not a sha256 hex value, so the hash assertion should fail.`,
    evidence: [`${DIGEST} is not a sha256 hex value`],
  });
  expect(contradictedHexOrLiteralClaim(finding, item)).toBe(true);
});

test("Python 0x integer literal called an undefined name is contradicted", () => {
  const item = "SLOT_TOKEN_SIDE = 0x57738c8\nMASK = 0xF4\n";
  const finding = verdict({
    summary:
      "SLOT_TOKEN_SIDE = 0x57738c8 assigns the side to an undefined name and should raise NameError.",
    evidence: [
      "the slice uses an undefined name, `0xF4`, where 0xF4 appears intended",
    ],
  });
  expect(contradictedHexOrLiteralClaim(finding, item)).toBe(true);
});

test("does not drop when the cited digest is absent from the item", () => {
  const finding = verdict({
    summary: `The asserted digest ${DIGEST} is not a sha256 hex value.`,
    evidence: [DIGEST],
  });
  expect(
    contradictedHexOrLiteralClaim(finding, "expect(hash).toBe('deadbeef');"),
  ).toBe(false);
});

test("does not drop when the claim never calls the value invalid or undefined", () => {
  const item = `pinned = "${DIGEST}"\nvalue = 0x57738c8\n`;
  const finding = verdict({
    summary:
      "The change only pins a digest and a slot constant; evidence is weak.",
    evidence: [DIGEST, "0x57738c8"],
  });
  expect(contradictedHexOrLiteralClaim(finding, item)).toBe(false);
});

test("does not drop a verified objective defect", () => {
  const item = `expect(hash).toBe("${DIGEST}");`;
  const finding = verdict({
    summary: `The asserted digest ${DIGEST} is not a sha256 hex value.`,
    evidence: [DIGEST],
    objective_defect: "a".repeat(64),
  });
  expect(contradictedHexOrLiteralClaim(finding, item)).toBe(false);
});

test("does not drop non-low_quality categories", () => {
  const item = `expect(hash).toBe("${DIGEST}");`;
  const finding = verdict({
    category: "missing_evidence",
    summary: `The asserted digest ${DIGEST} is not a sha256 hex value.`,
    evidence: [DIGEST],
  });
  expect(contradictedHexOrLiteralClaim(finding, item)).toBe(false);
});
