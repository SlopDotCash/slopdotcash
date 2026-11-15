import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { FileChange } from "./value-evidence-types";
import { valueAdditionCount, valueDeletionCount } from "./value-patch";

function file(before: string, after: string): FileChange {
  const blob = (text: string) =>
    createHash("sha1")
      .update(`blob ${Buffer.byteLength(text)}\0`)
      .update(text)
      .digest("hex");
  return {
    filename: "test.ts",
    status: "modified",
    additions: 0,
    deletions: 0,
    blob_url: null,
    fullComparison: {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      before: { blobSha: blob(before), text: before },
      after: { blobSha: blob(after), text: after },
    },
  };
}

test("recovers only omitted counts from verified complete text", () => {
  const source = file("keep\nold\n", "keep\nnew\nmore\n");
  expect(valueAdditionCount(source)).toBe(2);
  expect(valueDeletionCount(source)).toBe(1);
  expect(source.additions).toBe(0);
  expect(source.deletions).toBe(0);
  expect(valueAdditionCount(file("same\n", "same\n"))).toBe(0);
  expect(valueDeletionCount(file("same\n", "same\n"))).toBe(0);
});

test("retains reported nonzero counts and refuses a forged comparison", () => {
  const source = file("old\n", "new\n");
  source.additions = 5;
  expect(valueAdditionCount(source)).toBe(5);
  expect(valueDeletionCount(source)).toBe(0);
  const forged = file("old\n", "new\n");
  if (!forged.fullComparison) throw new Error("Missing test comparison");
  forged.fullComparison.after.text = "forged\n";
  expect(valueAdditionCount(forged)).toBe(0);
  expect(valueDeletionCount(forged)).toBe(0);
});

test("counts final-newline and repeated-line changes", () => {
  expect(valueAdditionCount(file("a", "a\n"))).toBe(1);
  expect(valueDeletionCount(file("a", "a\n"))).toBe(1);
  expect(valueAdditionCount(file("a\na\nb\n", "a\nb\na\n"))).toBe(1);
  expect(valueDeletionCount(file("a\na\nb\n", "a\nb\na\n"))).toBe(1);
});

test("matches an independent LCS count across short text pairs", () => {
  const texts = ["", "a\n", "b\n", "a\nb\n", "b\na\n", "a\na\n"];
  for (const before of texts)
    for (const after of texts) {
      const a = before.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
      const b = after.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
      const rows = Array.from({ length: a.length + 1 }, () =>
        Array<number>(b.length + 1).fill(0),
      );
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
          rows[i][j] =
            a[i - 1] === b[j - 1]
              ? rows[i - 1][j - 1] + 1
              : Math.max(rows[i - 1][j], rows[i][j - 1]);
      const source = file(before, after),
        same = rows[a.length][b.length];
      expect(valueAdditionCount(source)).toBe(b.length - same);
      expect(valueDeletionCount(source)).toBe(a.length - same);
    }
});

test("invalidates cached counts after a comparison mutation", () => {
  const source = file("old\n", "new\n");
  expect(valueAdditionCount(source)).toBe(1);
  if (!source.fullComparison) throw new Error("Missing test comparison");
  source.fullComparison.after.text = "forged\n";
  expect(valueAdditionCount(source)).toBe(0);
});

test("leaves an excessive comparison unresolved", () => {
  const source = file("a\n".repeat(1500), "b\n".repeat(1500));
  expect(valueAdditionCount(source)).toBe(0);
  expect(valueDeletionCount(source)).toBe(0);
});
