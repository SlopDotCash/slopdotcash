import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import {
  dropHexMisreadFinding,
  guardHexMisread,
  hexMisreadFinding,
} from "./hex-misread";

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

test("a valid 64-character SHA-256 digest is kept and the finding is dropped", () => {
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
  expect(guardHexMisread(verdict).category).toBe("none");
});

test("an uppercase 64-character SHA-256 digest is a valid hex digest", () => {
  const upper = DIGEST.toUpperCase();
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `Pinned checksum ${upper} is not a valid sha256 hex value.`,
        evidence: [upper],
      }),
    ),
  ).toBe(true);
});

test("a 0x hex integer literal is kept and is not an undefined name", () => {
  const verdict = lowQuality({
    summary:
      "SLOT_TOKEN_SIDE = 0x57738c8 assigns that value to an undefined name and should raise NameError.",
    evidence: ["SLOT_TOKEN_SIDE = 0x57738c8"],
    limitations: [
      "The slice uses an undefined name, `0xF4`, where 0xF4 appears intended.",
    ],
  });
  expect(hexMisreadFinding(verdict)).toBe(true);
  expect(guardHexMisread(verdict).category).toBe("none");
});

test("a backtick 0xF4 literal is not an undefined name", () => {
  expect(
    hexMisreadFinding(
      lowQuality({
        summary:
          "The slice uses an undefined name, `0xF4`, where 0xF4 appears intended.",
        evidence: ["0xF4"],
      }),
    ),
  ).toBe(true);
});

test("hexMisreadFinding drops a 0x literal that was called an undefined name", () => {
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

test("hexMisreadFinding drops a shortened digest quote that matches a full digest", () => {
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

test("hexMisreadFinding ignores unrelated low_quality findings", () => {
  const verdict = lowQuality({
    summary: "The change removes required tests without replacement.",
    evidence: ["deleted tests/integration/foo.test.ts"],
  });
  expect(hexMisreadFinding(verdict)).toBe(false);
  expect(guardHexMisread(verdict)).toEqual(verdict);
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

const TRUNCATED_CHECKSUM = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b";

test("hexMisreadFinding keeps a truncated checksum finding", () => {
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

test("hexMisreadFinding keeps a report that code treats a digest as invalid", () => {
  expect(
    hexMisreadFinding(
      lowQuality({
        summary: `validators.ts: the production regex treats ${DIGEST} as not a sha256 hex value when checking pinned artifacts.`,
        evidence: [DIGEST],
      }),
    ),
  ).toBe(false);
});

test("hexMisreadFinding keeps a real undefined name near a 0x literal", () => {
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
