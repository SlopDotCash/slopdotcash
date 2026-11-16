import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { valueJsonDigest } from "./value-json-digest";

for (const value of [
  null,
  true,
  42,
  -0,
  Infinity,
  '\\"\n\t\u0000',
  { z: 1, a: [undefined, null, "😀"] },
  { 0: "first", 10: "third", 2: "second", omitted: undefined },
  `${"a".repeat(16383)}😀${"b".repeat(16383)}\ud800`,
  "large\n".repeat(1500000),
]) {
  test("streamed JSON has exact native serialization digest", () => {
    expect(valueJsonDigest(value)).toBe(
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    );
  });
}
test("streamed JSON refuses unsupported or cyclic evidence", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => valueJsonDigest(cycle)).toThrow();
  expect(() => valueJsonDigest(new Date())).toThrow();
  expect(() => valueJsonDigest({ n: 1n })).toThrow();
});

test("added patch recovery retains exact empty, final-newline and multiple-line bytes", async () => {
  const { addedValuePatchRecovery } = await import("./value-patch");
  for (const text of ["", "one", "one\n", "one\n\n", "\n", "a\r\nb\n"]) {
    const bytes = new TextEncoder().encode(text);
    const lines = text === "" ? [] : text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    const expected =
      lines.length === 0
        ? ""
        : `@@ -0,0 +1${lines.length === 1 ? "" : `,${lines.length}`} @@\n` +
          lines.map((line) => `+${line}`).join("\n") +
          (text.endsWith("\n") ? "" : "\n\\ No newline at end of file");
    const sha = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    const file = {
      filename: "a.txt",
      status: "added",
      additions: lines.length,
      deletions: 0,
      blob_url: null,
    };
    await addedValuePatchRecovery(
      { get: async () => null, verifiedFile: async () => ({ sha, bytes }) },
      "example/repo",
    )([file], "a".repeat(40));
    expect((file as import("./value-evidence-types").FileChange).patch).toBe(
      expected,
    );
  }
});
