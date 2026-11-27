// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"
import { describe, expect, it } from "vitest";
import { modifiedDiffSection } from "../src/value/proofs/negotiatedDiff.ts";

const filename = "src/example.json";
const headers = [
  `diff --git a/${filename} b/${filename}`,
  "index baf06feae780..5cb22998251d 100644",
  `--- a/${filename}`,
  `+++ b/${filename}`,
];
const first = ["@@ -1 +1 @@", "-before", "+after"];
const second = ["@@ -3 +3 @@ context", "-previous", "\\ No newline at end of file", "+next"];

function diff(body: ReadonlyArray<string>, preamble: ReadonlyArray<string> = headers) {
  return [...preamble, ...body, ""].join("\n");
}

describe("an exact GitHub diff section", () => {
  it("preserves ordered hunks with changes and a no-newline annotation", () => {
    expect(modifiedDiffSection(diff([...first, ...second]), filename)).toEqual({
      patch: [...first, ...second].join("\n"),
      beforePrefix: "baf06feae780",
      afterPrefix: "5cb22998251d",
      mode: "100644",
    });
  });

  it("finds only the complete requested path among multiple sections", () => {
    const raw = diff(first).replaceAll(filename, "src/different.json") + diff(second);
    expect(modifiedDiffSection(raw, filename)?.patch).toBe(second.join("\n"));
    expect(modifiedDiffSection(raw, "src/missing.json")).toBeUndefined();
    expect(modifiedDiffSection(raw + diff(first), filename)).toBeUndefined();
  });

  it("refuses invalid identity and hunks with missing, overlapping or excess lines", () => {
    expect(modifiedDiffSection(diff(first, headers.map((line) => line.replace(" 100644", " 120000"))), filename)).toBeUndefined();
    expect(modifiedDiffSection(diff(first, headers.map((line) => line.replace("+++ b/", "+++ a/"))), filename)).toBeUndefined();
    expect(modifiedDiffSection(diff(first.slice(0, -1)), filename)).toBeUndefined();
    expect(modifiedDiffSection(diff([...first, ...first]), filename)).toBeUndefined();
    expect(modifiedDiffSection(diff([...first, "+extra"]), filename)).toBeUndefined();
    expect(modifiedDiffSection(diff(first).slice(0, -1), filename)).toBeUndefined();
  });

  it("refuses a possible quoted duplicate of an otherwise complete target section", () => {
    const quoted = [`diff --git "a/${filename}" "b/${filename}"`, ...headers.slice(1)];
    expect(modifiedDiffSection(diff(first) + diff(second, quoted), filename)).toBeUndefined();
  });

  it("refuses a no-newline marker followed by more lines on that side", () => {
    const body = ["@@ -1,2 +1,2 @@", "-before", "\\ No newline at end of file", "-later", "+after", "+last"];
    expect(modifiedDiffSection(diff(body), filename)).toBeUndefined();
    const later = ["@@ -5 +5 @@", "-later", "+last"];
    expect(modifiedDiffSection(diff([...second, ...later]), filename)).toBeUndefined();
  });
});
