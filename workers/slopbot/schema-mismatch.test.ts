import { expect, test } from "bun:test";
import { explainVerdict, VERDICT_SCHEMA } from "./contracts";
import {
  rejectionDetail,
  schemaMismatch,
  unreadableDetail,
} from "./schema-mismatch";

const verdict = {
  category: CATEGORY(),
  confidence: 0.4,
  rule_refs: [{ source: "CONTRIBUTING.md", quote: "Tests required" }],
  evidence: ["no test file changed"],
  summary: "Adds a parser without tests.",
  limitations: [],
  objective_defect: null,
};

function CATEGORY(): string {
  return (VERDICT_SCHEMA.properties.category.enum as readonly string[])[0];
}

test("a verdict that matches the schema has no schema problem", () => {
  expect(schemaMismatch(verdict, VERDICT_SCHEMA)).toBeNull();
});

test("each verdict schema break names its field without reply text", () => {
  const { summary: _summary, ...noSummary } = verdict;
  expect(schemaMismatch(noSummary, VERDICT_SCHEMA)).toBe(
    "missing required field summary",
  );
  expect(
    schemaMismatch({ ...verdict, category: "secret words" }, VERDICT_SCHEMA),
  ).toBe("field category is not one of the allowed values");
  expect(
    schemaMismatch(
      { ...verdict, rule_refs: [{ source: "a", quote: 3 }] },
      VERDICT_SCHEMA,
    ),
  ).toBe("field rule_refs[0].quote is integer, expected string");
  expect(
    schemaMismatch(
      { ...verdict, "drop table; --": 1, notes: "x" },
      VERDICT_SCHEMA,
    ),
  ).toBe("unexpected field <unnamed>");
  expect(schemaMismatch([verdict], VERDICT_SCHEMA)).toBe(
    "the reply is array, expected object",
  );
});

test("checks the schema cannot express are named by the verdict explainer", () => {
  expect(
    rejectionDetail(
      { ...verdict, confidence: 7 },
      VERDICT_SCHEMA,
      explainVerdict,
    ),
  ).toBe("field confidence is outside 0 to 1");
  expect(
    rejectionDetail(
      { ...verdict, summary: "" },
      VERDICT_SCHEMA,
      explainVerdict,
    ),
  ).toBe("field summary is empty");
  expect(
    rejectionDetail(
      { ...verdict, objective_defect: "not hex" },
      VERDICT_SCHEMA,
      explainVerdict,
    ),
  ).toBe("field objective_defect is not a 64-character hex digest");
  expect(rejectionDetail(verdict, VERDICT_SCHEMA)).toBe(
    "matches the schema but fails a stricter check",
  );
});

test("unreadable replies are told apart", () => {
  expect(unreadableDetail(undefined)).toBe("reply had no text block");
  expect(unreadableDetail("  ")).toBe("reply text was empty");
  expect(unreadableDetail('```json\n{"a":1}\n```')).toBe(
    "reply was wrapped in a Markdown fence",
  );
  expect(unreadableDetail('Here it is: {"a":1}')).toBe(
    "reply had prose before the JSON",
  );
  expect(unreadableDetail('{"a":1} done')).toBe(
    "reply JSON was cut off or followed by prose",
  );
  expect(unreadableDetail('{"a":1,}')).toBe("reply text was not valid JSON");
});
