import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import { downgradeLiteralMisread, refutedSha256Token } from "./literal-misread";

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
    limitations: [],
  };
}

test("refutes the issue #1930 finding: a 64-hex digest called not a sha256 hex value", () => {
  const summary = `The test pins the SPL Token ELF as \`${DIGEST}\`, but that value is not a sha256 hex value, so the hash assertion should fail.`;
  expect(refutedSha256Token(summary)).toBe(DIGEST);
  const downgraded = downgradeLiteralMisread(finding(summary));
  if (downgraded === null) throw new Error("finding was not downgraded");
  expect(downgraded.category).toBe("none");
  expect(downgraded.objective_defect).toBeNull();
  expect(downgraded.rule_refs).toEqual([]);
  expect(downgraded.evidence).toEqual([]);
  expect(downgraded.summary).toContain(DIGEST);
  expect(downgraded.summary).toContain("64 hex characters");
});

test("refutes when the digest and the denial sit in different sentences", () => {
  const summary = `The change pins the digest \`${DIGEST}\` for the deployed ELF. That value is not a sha256 hex value, so the assertion cannot pass.`;
  expect(refutedSha256Token(summary)).toBe(DIGEST);
});

test("refutes an uppercase digest called an invalid sha256", () => {
  const summary = `The constant \`${DIGEST.toUpperCase()}\` is an invalid sha256 digest and must be replaced.`;
  expect(refutedSha256Token(summary)).toBe(DIGEST.toUpperCase());
});

test("keeps the bare 'sha256 is not valid' phrasing: format or mismatch is ambiguous (PR #2260 review)", () => {
  const summary = `The recorded sha256 \`${DIGEST}\` is not valid, so the checksum test should fail.`;
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("keeps a mismatch wording that names a comparison target (PR #2260 review)", () => {
  for (const summary of [
    `The pinned checksum \`${DIGEST}\` is not a valid sha256 for v1.2.0; the real digest differs.`,
    `The recorded sha256 \`${DIGEST}\` is not valid for the tarball, so verification can never pass.`,
    `The recorded sha256 \`${DIGEST}\` is not valid, the deployed ELF changed since this digest was pinned.`,
  ]) {
    expect(refutedSha256Token(summary)).toBeNull();
    expect(downgradeLiteralMisread(finding(summary))).toBeNull();
  }
});

test("keeps a verdict with a second, independent defect claim (PR #2260 review)", () => {
  const summary = `The pinned digest \`${DIGEST}\` is not a valid sha256 hex value. The test also never asserts the comparison helper runs, so a wrong digest would pass silently.`;
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("does not downgrade a non-low_quality verdict (PR #2260 review)", () => {
  const verdict: Verdict = {
    ...finding(`The value \`${DIGEST}\` is not a sha256 hex value.`),
    category: "scam",
  };
  expect(downgradeLiteralMisread(verdict)).toBeNull();
});

test("keeps a correctness claim: the digest does not match the file's sha256", () => {
  const summary = `The pinned digest \`${DIGEST}\` does not match the sha256 of the deployed ELF in this repository, so the test fails against the real file.`;
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("keeps a finding that negates something else about a digest", () => {
  const summary = `The value \`${DIGEST}\` is not a placeholder; it is the sha256 of the ELF, but no test exercises the comparison helper.`;
  expect(refutedSha256Token(summary)).toBeNull();
});

test("keeps a claim about a short value that really is not a sha256", () => {
  const summary =
    "The constant `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce` is not a sha256 hex value; it is only 40 characters.";
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("does not downgrade a verdict that already has no finding", () => {
  const verdict: Verdict = {
    ...finding(`The value \`${DIGEST}\` is not a sha256 hex value.`),
    category: "none",
  };
  expect(downgradeLiteralMisread(verdict)).toBeNull();
});

test("keeps a finding that contrasts a valid digest with a short constant in one sentence (PR #2260 review)", () => {
  const summary = `Unlike \`${DIGEST}\`, the constant \`8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce\` is not a valid sha256 hex value.`;
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("keeps a finding when the short constant's denial sits in the next sentence", () => {
  const summary = `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant \`8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce\` is not a sha256 hex value.`;
  expect(refutedSha256Token(summary)).toBeNull();
  expect(downgradeLiteralMisread(finding(summary))).toBeNull();
});

test("keeps contrast sentences whatever the short constant's quoting (PR #2260 review)", () => {
  const short = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce";
  for (const summary of [
    `Unlike ${DIGEST}, the constant ${short} is not a valid sha256 hex value.`,
    `Unlike \`${DIGEST}\`, the constant '${short}' is not a valid sha256 hex value.`,
    `Unlike \`${DIGEST}\`, the constant "${short}" is not a valid sha256 hex value.`,
    `Unlike \`${DIGEST}\`, the constant \`0x${short}\` is not a valid sha256 hex value.`,
    `Unlike ${DIGEST}, the constant 0x${short} is not a valid sha256 hex value.`,
  ]) {
    expect(refutedSha256Token(summary)).toBeNull();
    expect(downgradeLiteralMisread(finding(summary))).toBeNull();
  }
});

test("keeps contrast sentences in the next sentence whatever the short constant's quoting (PR #2260 review)", () => {
  const short = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce";
  for (const summary of [
    `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant ${short} is not a sha256 hex value.`,
    `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant '${short}' is not a sha256 hex value.`,
    `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant "${short}" is not a sha256 hex value.`,
    `The change pins the digest \`${DIGEST}\` for the deployed ELF. The constant \`0x${short}\` is not a sha256 hex value.`,
  ]) {
    expect(refutedSha256Token(summary)).toBeNull();
    expect(downgradeLiteralMisread(finding(summary))).toBeNull();
  }
});
