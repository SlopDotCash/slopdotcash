import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import { dropHexMisreadFinding, hexMisreadFinding } from "./review";

const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";

function lowQuality(partial: Partial<Verdict>): Verdict {
  return {
    category: "low_quality",
    confidence: 0.72,
    rule_refs: [],
    evidence: [],
    summary: "placeholder",
    limitations: [],
    objective_defect: null,
    ...partial,
  };
}

test("hexMisreadFinding drops SHA-256 digests called invalid", () => {
  const verdict = lowQuality({
    summary: `The asserted digest ${DIGEST} is not a sha256 hex value, so the hash assertion should fail.`,
    evidence: [DIGEST],
  });
  expect(hexMisreadFinding(verdict)).toBe(true);
  const dropped = dropHexMisreadFinding(verdict);
  expect(dropped.category).toBe("none");
  expect(dropped.rule_refs).toEqual([]);
  expect(dropped.evidence).toEqual([]);
  expect(dropped.objective_defect).toBeNull();
  expect(dropped.limitations.at(-1)).toContain("deterministic hex digest");
});

test("hexMisreadFinding drops 0x integer literals called undefined names", () => {
  const verdict = lowQuality({
    summary:
      "SLOT_TOKEN_SIDE = 0x57738c8 assigns that value to an undefined name and should raise NameError.",
    evidence: ["SLOT_TOKEN_SIDE = 0x57738c8"],
    limitations: [
      "The slice uses an undefined name, `0xF4`, where 0xF4 appears intended.",
    ],
  });
  expect(hexMisreadFinding(verdict)).toBe(true);
});

test("hexMisreadFinding ignores unrelated low_quality findings", () => {
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: "The change removes required tests without replacement.",
        evidence: ["deleted tests/integration/foo.test.ts"],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding ignores hex claims outside low_quality", () => {
  expect(
    hexMisreadFinding({
      category: "busywork",
      confidence: 0.9,
      rule_refs: [],
      evidence: [DIGEST],
      summary: `${DIGEST} is not a sha256 hex value`,
      limitations: [],
      objective_defect: null,
    }),
  ).toBe(false);
});

test("hexMisreadFinding requires both the claim language and a matching token", () => {
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: "The hash is not a sha256 hex value.",
        evidence: ["the hash assertion should fail"],
      }),
    ),
  ).toBe(false);
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `Mentions digest ${DIGEST} without calling it invalid.`,
        evidence: [DIGEST],
      }),
    ),
  ).toBe(false);
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: "Uses an undefined name somewhere in the patch.",
        evidence: ["missing_helper"],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding catches invalid-sha256 phrasing around a digest", () => {
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `The finding cites an invalid sha256 digest ${DIGEST}.`,
        evidence: [DIGEST],
      }),
    ),
  ).toBe(true);
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `The sha256 is invalid: ${DIGEST}`,
        evidence: [DIGEST],
      }),
    ),
  ).toBe(true);
});
