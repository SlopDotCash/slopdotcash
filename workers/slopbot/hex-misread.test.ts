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

const TRUNCATED_CHECKSUM = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b"; // 48 hex chars

test("hexMisreadFinding keeps truncated checksum findings", () => {
  // Genuine finding: pinned value really is truncated. Evidence quotes the
  // correct 64-char reference digest for comparison; that incidental token
  // must not suppress the claim about the truncated checksum.
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `Pinned checksum ${TRUNCATED_CHECKSUM} is not a valid sha256 hex value.`,
        evidence: [
          `Reference digest ${DIGEST} matches the canonical artifact.`,
        ],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding keeps findings that the code misreads digests", () => {
  // Genuine finding: the model correctly reports that production code treats
  // a valid digest as invalid. "as not a …" is reporting code behavior, not
  // a model misread of the digest itself.
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `validators.ts: the production regex treats ${DIGEST} as not a sha256 hex value when checking pinned artifacts.`,
        evidence: [DIGEST],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding keeps real undefined-variable findings near 0x literals", () => {
  // Genuine finding about slot_registry. A nearby 0x literal inside the
  // assigns…undefined window must not be treated as the undefined name.
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "The patch assigns slot_registry from config but leaves it undefined at the call site. Constant 0x57738c8 is the expected slot id.",
        evidence: ["slot_registry", "0x57738c8"],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding drops #1930 'was called an undefined name' phrasing", () => {
  // Summary-only shape from the live #1930 reviews: a reporting verb sits
  // between the 0x literal and the claim. Must not anchor on "called".
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "SLOT_TOKEN_SIDE = 0x57738c8 was called an undefined name that should raise NameError.",
        evidence: ["SLOT_TOKEN_SIDE = 0x57738c8"],
      }),
    ),
  ).toBe(true);
});

test("hexMisreadFinding drops #1930 'assigns that value' anaphora", () => {
  // Same summary as the existing positive test, but without the incidental
  // 0xF4 limitations line that previously made the test pass for the wrong
  // reason. The literal is only referenced as "that value".
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "SLOT_TOKEN_SIDE = 0x57738c8 assigns that value to an undefined name and should raise NameError.",
        evidence: ["SLOT_TOKEN_SIDE = 0x57738c8"],
      }),
    ),
  ).toBe(true);
});

test("hexMisreadFinding drops #1930 truncated digest quote 8190d3f7…f697", () => {
  // Live reviews cited a truncated digest in the summary while evidence held
  // the full 64-hex token. Expand the quote before correlating.
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "The pinned value 8190d3f7…f697 is not a sha256 hex value, so the hash assertion cannot succeed.",
        evidence: [`assert.equal(digest, "${DIGEST}");`],
      }),
    ),
  ).toBe(true);
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "The pinned value 8190d3f7...f697 is not a sha256 hex value, so the hash assertion cannot succeed.",
        evidence: [DIGEST],
      }),
    ),
  ).toBe(true);
});
