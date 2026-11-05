import { expect, test } from "bun:test";
import type { Verdict } from "./contracts";
import { suppressHexMisreads } from "./hex-misread";

const D = "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";
const OTHER = "a".repeat(64);

function verdict(
  overrides: Partial<Verdict> & Pick<Verdict, "summary">,
): Verdict {
  return {
    category: "low_quality",
    confidence: 0.62,
    rule_refs: [
      { source: "CONTRIBUTING.md", quote: "Score accepted outcomes." },
    ],
    evidence: [],
    limitations: [
      "Tests were not run, so the maintainer still has this check.",
    ],
    objective_defect: null,
    ...overrides,
  };
}

test("keeps an undefined name when a nearby 0x literal is not that name", () => {
  const input = verdict({
    summary:
      "The PR assigns 0x10 to timeout but leaves retries undefined, so the retry loop crashes.",
    evidence: ["retries = timeout"],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps a duplicate-test finding and drops only the digest encoding line", () => {
  const input = verdict({
    summary: "The PR copies an existing test file and adds no behaviour.",
    evidence: [
      "tests/a.test.ts duplicates tests/b.test.ts line for line",
      `The README says ${D} is not a valid sha256 hex value`,
    ],
    limitations: ["The duplicate check did not execute the tests."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(input.summary);
  expect(output.evidence).toEqual([
    "tests/a.test.ts duplicates tests/b.test.ts line for line",
  ]);
  expect(output.limitations).toEqual(input.limitations);
  expect(output.rule_refs).toEqual(input.rule_refs);
  expect(output.confidence).toBe(input.confidence);
});

test("keeps a checksum that is the wrong value for a version", () => {
  const input = verdict({
    summary: `Pinned checksum ${D} is not a valid sha256 for v1.2.0; the real digest differs.`,
    evidence: [`published ${D}`],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps an invalid sha256 for a tarball", () => {
  const input = verdict({
    summary: `invalid sha256 ${D} for the tarball, verification can never pass`,
    evidence: ["install.sh pins the tarball checksum"],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps an undefined global when 0xF4 is the assigned value", () => {
  const input = verdict({
    summary:
      "The code assigns 0xF4 to undefined global config without declaring it.",
    evidence: ["config = 0xF4"],
    limitations: ["Import-time failure was not executed."],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps an authentication bypass and drops only the encoding claim", () => {
  const bypass =
    "The authentication check can be bypassed with an empty token.";
  const input = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value. ${bypass}`,
    evidence: [
      `The digest ${D} is not a valid sha256 hex value.`,
      "if token == '': grant_admin()",
    ],
    limitations: ["Static review did not run the auth tests."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(bypass);
  expect(output.evidence).toEqual(["if token == '': grant_admin()"]);
  expect(output.limitations).toEqual(input.limitations);
  expect(output.rule_refs).toEqual(input.rule_refs);
});

test("drops an encoding clause joined by and and keeps the other defect", () => {
  const input = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value and the authentication check can be bypassed with an empty token.`,
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(
    "The authentication check can be bypassed with an empty token.",
  );
  expect(output.limitations).toEqual(input.limitations);
  expect(output.evidence).toEqual(input.evidence);
});

test("drops a digest encoding misread and keeps limitations", () => {
  const input = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value.`,
    evidence: [`The digest ${D} is not a valid sha256 hex value.`],
    limitations: [
      "The model wondered whether the digest was a placeholder or redaction.",
    ],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("none");
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
  expect(output.rule_refs).toEqual(input.rule_refs);
  expect(output.summary.toLowerCase()).not.toContain("not a valid sha256");
  expect(output.summary).not.toContain(D);
});

test("keeps an undeclared variable that shares a sentence with a 0x misread", () => {
  const kept =
    "Also reads the undeclared variable `retryBudget` before assignment, which raises NameError on the same path.";
  const input = verdict({
    summary: `The tool slices with an undefined name, \`0xF4\`, and also reads the undeclared variable \`retryBudget\` before assignment, which raises NameError on the same path.`,
    evidence: ["packet[0xF4]"],
    limitations: ["The NameError was inferred from the diff, not observed."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(kept);
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
  expect(output.summary).not.toContain("0xF4");
});

test("keeps the same defect when the model says undefined variable", () => {
  const input = verdict({
    summary:
      "The tool slices with an undefined name, `0xF4`, and also reads the undefined variable `retryBudget` before assignment, which raises NameError on the same path.",
    evidence: ["packet[0xF4]"],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(
    "Also reads the undefined variable `retryBudget` before assignment, which raises NameError on the same path.",
  );
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
});

test("keeps a placeholder-constant failure when the misread is only in evidence", () => {
  const summary =
    "The retry loop never runs because the placeholder constant is never replaced at build time, so every scheduled job is silently skipped.";
  const input = verdict({
    summary,
    evidence: ["The slice uses an undefined name, `0xF4`."],
    limitations: ["The scheduler was not executed."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(summary);
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
});

test("drops a 0x token only when that token is the undefined name", () => {
  const input = verdict({
    summary:
      "The slice uses an undefined name, `0xF4`, where 0xF4 appears intended, and should raise NameError.",
    evidence: ["packet[0xF4]"],
    limitations: ["NameError was inferred from the diff, not observed."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("none");
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
  expect(output.summary.toLowerCase()).not.toContain("0xf4");
  expect(output.summary).not.toContain("NameError");
});

test("drops the reported undefined-name literal misreads without a label", () => {
  const summaries = [
    "SLOT_TOKEN_SIDE = 0x57738c8 was called an undefined name that should raise NameError.",
    "This is a carefully scoped static-analysis packet with stated limits, but the submitted tool assigns SLOT_TOKEN_SIDE to an undefined name, 0x57738c8, instead of the slot address 0x57738c8 that evidence.json reports. As written, tools/wire_asset_codec.py should raise a NameError on import, so the reported test results and byte-identical regeneration cannot come from this diff. Please replace the placeholder with the real slot constant, confirm nothing secret was pasted, then rerun the tool, the unit tests and the manifest check and report the actual outcomes.",
    "The packet is scoped, structured and follows the evidence template. However, the specification function in tools/match_resting_order.py slices with an undefined name, `0xF4`, where 0xF4 appears intended. Any case that reaches that line should raise NameError, so the tool as submitted is unlikely to regenerate the packet. That contradicts the stated 0 mismatches and passing tests. Replace the name with the intended constant, rerun the generator and unit tests, and confirm the committed outputs and manifest still match.",
  ];
  for (const summary of summaries) {
    const input = verdict({
      summary,
      limitations: ["The NameError was not executed."],
    });
    const output = suppressHexMisreads(input);
    expect(output.category).toBe("none");
    expect(output.limitations).toEqual(input.limitations);
    expect(output.summary).not.toContain("NameError");
    expect(output.summary).not.toContain("0xF4");
    expect(output.summary).not.toContain("0x57738c8");
  }
});

test("keeps a real NameError when the undefined identifier is not a 0x literal", () => {
  const input = verdict({
    summary:
      "The submitted tool assigns an undefined identifier to `OFFSET_PASS`. That would raise a NameError when the module is imported.",
    evidence: ["OFFSET_PASS = 0x10"],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps a truncated checksum and a report that code treats a digest as invalid hex", () => {
  const truncated = "ab".repeat(24);
  const truncatedFinding = verdict({
    summary: `The pinned digest ${truncated} is not a valid sha256 hex value.`,
  });
  const codeReport = verdict({
    summary: `The validator treats ${D} as not a valid sha-256 hex value.`,
  });
  expect(suppressHexMisreads(truncatedFinding)).toEqual(truncatedFinding);
  expect(suppressHexMisreads(codeReport)).toEqual(codeReport);
});

test("keeps a hex mismatch that names the artifact and a second digest", () => {
  const input = verdict({
    summary: `The checksum ${D} is not a valid sha256 hex value for the tarball; the published digest is ${OTHER}.`,
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps a non-hex name beside a 0x misread without a fixed frame", () => {
  const cases = [
    "The tool slices with an undefined name, `0xF4`, and also reads `retryBudget`, an undeclared variable, which raises NameError on the same path.",
    "The tool slices with an undefined name, `0xF4`, and also reads `retryBudget`, an undefined variable, which raises NameError on the same path.",
    "The tool slices with an undefined name, `0xF4`, and also reads the undeclared `retryBudget` on the same path, which raises NameError.",
  ];
  for (const summary of cases) {
    const input = verdict({
      summary,
      evidence: ["packet[0xF4]"],
      limitations: ["The NameError was inferred from the diff, not observed."],
    });
    const output = suppressHexMisreads(input);
    expect(output.category).toBe("low_quality");
    expect(output.summary).toContain("retryBudget");
    expect(output.summary).not.toContain("0xF4");
    expect(output.evidence).toEqual([]);
    expect(output.limitations).toEqual(input.limitations);
  }
});

test("keeps a subject failure whose verb is not on a fixed list", () => {
  const summary =
    "The retry loop never runs because the placeholder constant is never substituted at build time, so every scheduled job is silently skipped.";
  const input = verdict({
    summary,
    evidence: ["The slice uses an undefined name, `0xF4`."],
    limitations: ["The scheduler was not executed."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(summary);
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
});

test("keeps a NameError about a non-hex identifier after a digest misread", () => {
  const input = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value. The tool reads retryBudget, which raises NameError.`,
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(
    "The tool reads retryBudget, which raises NameError.",
  );
  expect(output.evidence).toEqual([]);
  expect(output.limitations).toEqual(input.limitations);
});

test("keeps a never-validates claim joined to a digest misread by a comma", () => {
  const input = verdict({
    summary: `The digest ${D} is not a valid hex value, the pipeline never validates checksums.`,
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe("The pipeline never validates checksums.");
  expect(output.summary).not.toContain(D);
  expect(output.evidence).toEqual(input.evidence);
  expect(output.limitations).toEqual(input.limitations);
});

test("keeps an auth bypass joined to a digest misread by a comma", () => {
  const input = verdict({
    summary: `The digest ${D} is not a valid hex value, the auth check can be bypassed with an empty token.`,
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(
    "The auth check can be bypassed with an empty token.",
  );
  expect(output.limitations).toEqual(input.limitations);
});

test("keeps a comma-spliced defect whose verb is not on a fixed list", () => {
  const cases = [
    [
      `The digest ${D} is not a valid hex value, the handler omits the auth check.`,
      "The handler omits the auth check.",
    ],
    [
      `The digest ${D} is not a valid hex value, the endpoint leaks private report bodies to other reporters.`,
      "The endpoint leaks private report bodies to other reporters.",
    ],
    [
      `The digest ${D} is not a valid hex value, the empty token breaks authentication.`,
      "The empty token breaks authentication.",
    ],
    [
      `The digest ${D} is not a valid hex value, the refresh path drops the loaded notification list.`,
      "The refresh path drops the loaded notification list.",
    ],
    [
      `The digest ${D} is not a valid hex value, the importer discards every valid row.`,
      "The importer discards every valid row.",
    ],
    [
      `The digest ${D} is not a valid hex value, the exporter truncates every output file.`,
      "The exporter truncates every output file.",
    ],
  ] as const;
  for (const [summary, kept] of cases) {
    const input = verdict({ summary });
    const output = suppressHexMisreads(input);
    expect(output.category).toBe("low_quality");
    expect(output.summary).toBe(kept);
    expect(output.summary).not.toContain(D);
    expect(output.limitations).toEqual(input.limitations);
  }
});

test("does not treat an unrelated digest as the token a concrete name cites", () => {
  const input = verdict({
    summary:
      "The pinned token `zz-top` is not hexadecimal, so the parser rejects every request.",
    evidence: [D],
  });
  expect(suppressHexMisreads(input)).toEqual(input);
});

test("keeps evidence for a remaining claim that is not the contradicted token", () => {
  const config =
    "The code assigns 0xF4 to undefined global config without declaring it.";
  const input = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value. ${config}`,
    evidence: ["config = 0xF4"],
    limitations: ["Import-time failure was not executed."],
  });
  const output = suppressHexMisreads(input);
  expect(output.category).toBe("low_quality");
  expect(output.summary).toBe(config);
  expect(output.evidence).toEqual(["config = 0xF4"]);
  expect(output.limitations).toEqual(input.limitations);
});

test("leaves other categories and verified defects unchanged", () => {
  const scam = verdict({
    category: "scam",
    summary: `The digest ${D} is not a valid sha256 hex value.`,
  });
  const verified = verdict({
    summary: `The digest ${D} is not a valid sha256 hex value.`,
    objective_defect: "b".repeat(64),
  });
  expect(suppressHexMisreads(scam)).toBe(scam);
  expect(suppressHexMisreads(verified)).toBe(verified);
});
