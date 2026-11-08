import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import {
  removeRefutedSha256Claim,
  suppressRefutedSha256Claim,
} from "./sha256-claim";

// The SPL Token ELF digest pinned by pumpfun-source #3297, #3302, #3303 and
// #3392, from issue #1930: Slopbot called this value "not a sha256 hex value".
const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";

function finding(summary: string): Verdict {
  return {
    category: "low_quality",
    confidence: 0.9,
    rule_refs: [{ source: "CONTRIBUTING.md", quote: "tests must pass" }],
    evidence: [`+EXPECTED_SHA256 = "${DIGEST}"`],
    summary,
    limitations: ["reviewed the diff only"],
    objective_defect: DIGEST,
  };
}

// Everything except the summary must come through byte-identical: the
// suppression is claim-level, never verdict-level.
function expectVerdictPreserved(before: Verdict, after: Verdict) {
  expect(after.category).toBe(before.category);
  expect(after.confidence).toBe(before.confidence);
  expect(after.rule_refs).toEqual(before.rule_refs);
  expect(after.evidence).toEqual(before.evidence);
  expect(after.limitations).toEqual(before.limitations);
  expect(after.objective_defect).toBe(before.objective_defect);
}

test("removes only the refuted claim; the sibling claim and verdict survive verbatim", () => {
  const sibling =
    "The test also never asserts the comparison helper runs, so a wrong digest would pass silently.";
  const summary = `The pinned digest \`${DIGEST}\` is not a valid sha256 hex value. ${sibling}`;
  // PR #2260 kept this whole verdict because a second claim existed; the
  // claim-level edit keeps the second claim and removes only the first.
  expect(removeRefutedSha256Claim(summary)).toBe(sibling);
  const before = finding(summary);
  const after = suppressRefutedSha256Claim(before);
  if (after === null) throw new Error("claim was not suppressed");
  expect(after.summary).toBe(sibling);
  expectVerdictPreserved(before, after);
});

test("the issue #1930 finding: sole claim is replaced by a removal note, verdict intact", () => {
  const summary = `The test pins the SPL Token ELF as \`${DIGEST}\`, but that value is not a sha256 hex value, so the hash assertion should fail.`;
  const before = finding(summary);
  const after = suppressRefutedSha256Claim(before);
  if (after === null) throw new Error("claim was not suppressed");
  expect(after.summary).toContain("only claim was removed");
  expect(after.summary).toContain(DIGEST);
  expect(after.summary).toContain("64 hex characters");
  expect(after.summary).toContain("not whether the digest matches any file");
  expect(after.summary).not.toContain("so the hash assertion should fail");
  expectVerdictPreserved(before, after);
});

test("removes a denial stated in its own sentence, keeping the pin sentence", () => {
  const pin = `The change pins the digest \`${DIGEST}\` for the deployed ELF.`;
  const summary = `${pin} That value is not a sha256 hex value, so the assertion cannot pass.`;
  expect(removeRefutedSha256Claim(summary)).toBe(pin);
});

test("suppresses the claim for an uppercase digest", () => {
  const summary = `The constant \`${DIGEST.toUpperCase()}\` is an invalid sha256 digest and must be replaced. The helper also lacks any test.`;
  expect(removeRefutedSha256Claim(summary)).toBe(
    "The helper also lacks any test.",
  );
});

test("a scam verdict loses only the false sentence, never its force (PR #2260 closure)", () => {
  const other = "The repository was registered three days before this change.";
  const verdict: Verdict = {
    ...finding(`The value \`${DIGEST}\` is not a sha256 hex value. ${other}`),
    category: "scam",
  };
  const after = suppressRefutedSha256Claim(verdict);
  if (after === null) throw new Error("claim was not suppressed");
  expect(after.category).toBe("scam");
  expect(after.summary).toBe(other);
  expectVerdictPreserved(verdict, after);
});

test("keeps a correctness claim: the digest does not match the file's sha256", () => {
  const summary = `The pinned digest \`${DIGEST}\` does not match the sha256 of the deployed ELF in this repository, so the test fails against the real file.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
  expect(suppressRefutedSha256Claim(finding(summary))).toBeNull();
});

test("keeps the bare 'sha256 is not valid' phrasing: format or mismatch is ambiguous", () => {
  const summary = `The recorded sha256 \`${DIGEST}\` is not valid, so the checksum test should fail.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("keeps mismatch wordings that name a comparison target", () => {
  for (const summary of [
    `The pinned checksum \`${DIGEST}\` is not a valid sha256 for v1.2.0; the real digest differs.`,
    `The recorded sha256 \`${DIGEST}\` is not valid for the tarball, so verification can never pass.`,
    `The recorded sha256 \`${DIGEST}\` is not valid, the deployed ELF changed since this digest was pinned.`,
  ]) {
    expect(removeRefutedSha256Claim(summary)).toBeNull();
  }
});

test("keeps a claim about a short value that really is not a sha256", () => {
  const summary =
    "The constant `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce` is not a sha256 hex value; it is only 40 characters.";
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("keeps contrast sentences: the denial may be aimed at the short constant", () => {
  const short = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce";
  for (const summary of [
    `Unlike \`${DIGEST}\`, the constant \`${short}\` is not a valid sha256 hex value.`,
    `Unlike ${DIGEST}, the constant ${short} is not a valid sha256 hex value.`,
    `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant \`${short}\` is not a sha256 hex value.`,
  ]) {
    expect(removeRefutedSha256Claim(summary)).toBeNull();
  }
});

test("keeps a sentence that mixes the refuted claim with an independent one", () => {
  // Sentence-level removal cannot take half a sentence; the mixed sentence
  // goes to the maintainer whole rather than dropping its second claim.
  const summary = `The value \`${DIGEST}\` is not a sha256 hex value and the test never asserts the comparison helper runs.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("does not attribute a lone denial sentence when two digests are named", () => {
  const other =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const summary = `The change pins \`${DIGEST}\` and \`${other}\`. That value is not a sha256 hex value.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("keeps a cross-sentence denial about a different value: the signature (PR #2413 F1)", () => {
  const summary = `The pinned digest \`${DIGEST}\` is the sha256 of the ELF. The recorded signature is not a valid sha256 hex value, so verification is impossible.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("keeps a same-sentence denial about a different value: the tag (PR #2413 F1)", () => {
  const summary = `The pinned digest \`${DIGEST}\` is correct, but the recorded tag \`v1.2.0\` is not a valid sha256 hex value, so the check fails.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("keeps a same-sentence denial about an unquoted signature", () => {
  const summary = `The pinned digest \`${DIGEST}\` is correct, but the recorded signature is not a valid sha256 hex value, so the check fails.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("removes a denial of a 0x-prefixed digest (PR #2413 F2)", () => {
  const summary = `The pinned digest \`0x${DIGEST}\` is not a sha256 hex value, so the assertion cannot pass. The helper also lacks any test.`;
  expect(removeRefutedSha256Claim(summary)).toBe(
    "The helper also lacks any test.",
  );
});

test("the 0x-prefixed sole claim is replaced by a note quoting the 0x value", () => {
  const summary = `The pinned digest \`0x${DIGEST}\` is not a sha256 hex value, so the assertion cannot pass.`;
  const after = removeRefutedSha256Claim(summary);
  expect(after).toContain("only claim was removed");
  expect(after).toContain(`0x${DIGEST}`);
});

test("removes a lone denial that points back with 'the digest' or 'it'", () => {
  const pin = `The change pins the digest \`${DIGEST}\` for the deployed ELF.`;
  expect(
    removeRefutedSha256Claim(`${pin} The digest is not a sha256 hex value.`),
  ).toBe(pin);
  expect(removeRefutedSha256Claim(`${pin} It is not a sha256 hex value.`)).toBe(
    pin,
  );
});

test("keeps a finding that negates something else about a digest", () => {
  const summary = `The value \`${DIGEST}\` is not a placeholder; it is the sha256 of the ELF, but no test exercises the comparison helper.`;
  expect(removeRefutedSha256Claim(summary)).toBeNull();
});

test("leaves an unrelated finding untouched", () => {
  const summary =
    "The change adds a network call inside the render loop with no caching, so the page issues a request per row.";
  expect(removeRefutedSha256Claim(summary)).toBeNull();
  expect(suppressRefutedSha256Claim(finding(summary))).toBeNull();
});
