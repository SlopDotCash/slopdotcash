// Issue #1930: Slopbot findings called a 64-character SHA-256 digest "not a
// sha256 hex value" and Python hex literals "undefined names". The published
// comment must state the deterministic fact next to such a finding without
// removing or rewording any of it.
import { expect, test } from "bun:test";
import { LITERAL_FACT_LIMIT, literalFacts } from "./literal-facts";
import { commentBody } from "./review";

const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";

const DIGEST_ITEM = `Title: pin SPL Token ELF\n\nBody:\nb\n\nDiff:\n+    assert sha256(elf) == "${DIGEST}"\n`;
const LITERAL_ITEM =
  "Title: slots\n\nBody:\nb\n\nDiff:\n+SLOT_TOKEN_SIDE = 0x57738c8\n+head = data[:0xF4]\n";

function body(
  action: "label" | "close" | "hold" | "comment",
  verdict: { summary: string; evidence: string[]; limitations?: string[] },
  itemText: string | undefined,
): string {
  return commentBody({
    verdict: {
      category: action === "comment" ? "none" : "low_quality",
      summary: verdict.summary,
      rule_refs: [],
      evidence: verdict.evidence,
      limitations: verdict.limitations ?? [],
      objective_defect: null,
      confidence: 0.6,
    } as never,
    action,
    blockedClose: action === "hold" ? "uncertain result" : null,
    context: {
      limitations: [],
      quality: [],
      revision: "abc",
      policyDigest: "d",
      registration: { scope: "contributor" },
      itemText,
    } as never,
    triage: null,
    confirm: null,
    penalty: null,
  });
}

const digestFinding = {
  summary:
    "The pinned value is not a sha256 hex value, so the hash assertion should fail.",
  evidence: [`assert sha256(elf) == "${DIGEST}"`],
};
const literalFinding = {
  summary:
    "The module assigns to an undefined name and should raise NameError.",
  evidence: ["SLOT_TOKEN_SIDE = 0x57738c8"],
  limitations: [
    "The slice uses an undefined name, 0xF4, where 0xF4 appears intended.",
  ],
};

test("a finding that disputes a cited digest carries the deterministic fact", () => {
  const text = body("hold", digestFinding, DIGEST_ITEM);
  expect(text).toContain(
    `- \`${DIGEST}\` is a well-formed 64-character lowercase hex string, the form of a SHA-256 digest. Whether it is the digest of a particular file was not checked.`,
  );
});

test("a finding that calls hex literals undefined names carries the facts", () => {
  const text = body("hold", literalFinding, LITERAL_ITEM);
  expect(text).toContain(
    "- `0x57738c8` is written as a hex integer literal (`0x` followed by 7 hex digits), not as a name.",
  );
  expect(text).toContain(
    "- `0xF4` is written as a hex integer literal (`0x` followed by 2 hex digits), not as a name.",
  );
});

test("the fact lines only add: every line of the finding is still published", () => {
  for (const [finding, item] of [
    [digestFinding, DIGEST_ITEM],
    [literalFinding, LITERAL_ITEM],
  ] as const) {
    for (const action of ["label", "hold", "close"] as const) {
      const without = body(action, finding, undefined).split("\n");
      const withFacts = body(action, finding, item).split("\n");
      let cursor = 0;
      for (const line of without) {
        cursor = withFacts.indexOf(line, cursor);
        expect(cursor).toBeGreaterThanOrEqual(0);
        cursor += 1;
      }
      expect(withFacts.length).toBeGreaterThan(without.length);
      expect(withFacts[1]).toBe(without[1]);
    }
  }
});

test("a real finding about a malformed digest or a real name gets no fact line", () => {
  const short = DIGEST.slice(0, 63);
  expect(
    literalFacts(
      [`"${short}" is not a sha256 hex value`],
      `+ pinned = "${short}"\n`,
    ),
  ).toEqual([]);
  const upper = DIGEST.toUpperCase();
  expect(literalFacts([upper], `+ pinned = "${upper}"\n`)).toEqual([]);
  expect(literalFacts([`${DIGEST}ab`], `+ pinned = "${DIGEST}ab"\n`)).toEqual(
    [],
  );
  expect(
    literalFacts(["0xZZ is an undefined name"], "+ value = 0xZZ\n"),
  ).toEqual([]);
  expect(
    literalFacts(["x0F4 is an undefined name"], "+ value = x0F4\n"),
  ).toEqual([]);
  expect(literalFacts(["0x is not a literal"], "+ value = 0x\n")).toEqual([]);
});

test("a token the item does not contain as its own token gets no fact line", () => {
  expect(literalFacts([`${DIGEST} is wrong`], "+ nothing here\n")).toEqual([]);
  expect(literalFacts(["0xF4 is undefined"], "+ value = 0xF4F4\n")).toEqual([]);
  expect(literalFacts(["0xF4 is undefined"], "+ value = a0xF4\n")).toEqual([]);
  expect(literalFacts([DIGEST], `+ blob = "${DIGEST}${DIGEST}"\n`)).toEqual([]);
});

test("no-finding comments and items without cited hex are unchanged", () => {
  expect(body("comment", digestFinding, DIGEST_ITEM)).toBe(
    body("comment", digestFinding, undefined),
  );
  const plain = { summary: "The change has no tests.", evidence: ["no tests"] };
  expect(body("label", plain, DIGEST_ITEM)).toBe(
    body("label", plain, undefined),
  );
});

test("each token is reported once and the list is bounded", () => {
  expect(
    literalFacts(["0xF4 and 0xF4 again", "0xF4"], "+ a = 0xF4\n+ b = 0xF4\n"),
  ).toHaveLength(1);
  const many = Array.from(
    { length: 20 },
    (_, i) => `0x${(i + 16).toString(16)}`,
  );
  expect(
    literalFacts([many.join(" ")], many.map((t) => `+ v = ${t}`).join("\n")),
  ).toHaveLength(LITERAL_FACT_LIMIT);
});
