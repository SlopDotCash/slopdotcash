import { expect, test } from "bun:test";
import { collect, fixture } from "../../tests/value-binary-fixture";
import { hasCompleteValuePatch, valuePatch } from "./value-patch";

const text = "export const fixed = true;\n";

function omittedAddition() {
  const source = fixture({ textOnly: true });
  source.files[0].additions = 0;
  delete source.files[0].patch;
  return source;
}

test("omitted added-text counts retain reported fields and admit verified source scopes", async () => {
  const source = omittedAddition();
  const evidence = await collect(source);
  expect(evidence.limitations).toEqual([]);
  const merged = evidence.mergeCommitEvidence?.files[0];
  const attributed = evidence.commitAttribution[0].files?.[0];
  if (!merged || !attributed) throw new Error("Accepted source scopes missing");
  for (const file of [evidence.files[0], merged, attributed]) {
    expect(file.additions).toBe(0);
    expect(file.patch).toBeUndefined();
    expect(file.addedComparison?.after.text).toBe(text);
    expect(hasCompleteValuePatch(file)).toBe(true);
    expect(valuePatch(file)).toBe("@@ -0,0 +1 @@\n+export const fixed = true;");
  }
  expect(evidence.commitAttribution[0].changedPaths).toEqual(["fix.ts"]);
});

test("verified added lines do not waive inconsistent commit totals", async () => {
  const source = omittedAddition();
  const files = new Map([
    ["fix.ts", new TextEncoder().encode(`${text}another line\n`)],
  ]);
  source.bind(source.pull.head.sha, files, [source.pull.base.sha]);
  source.bind(source.pull.merge_commit_sha, files, [source.pull.base.sha]);
  const evidence = await collect(source);
  expect(evidence.files[0].addedComparison?.after.text).toBe(
    `${text}another line\n`,
  );
  expect(evidence.limitations).toContain(
    "Incomplete reported merge commit additions",
  );
  expect(evidence.commitAttribution[0].changedPaths).toBeNull();
});

test("an existing parent path cannot be admitted as an omitted addition", async () => {
  const source = omittedAddition();
  source.bind(
    source.pull.base.sha,
    new Map([["fix.ts", new TextEncoder().encode("old contents\n")]]),
    [],
  );
  const evidence = await collect(source);
  expect(evidence.limitations).toContain("Full diff required: fix.ts");
  expect(evidence.files[0].addedComparison).toBeUndefined();
  expect(evidence.commitAttribution[0].changedPaths).toBeNull();
});

test("incomplete trees and corrupt added blobs preserve the source hold", async () => {
  for (const failure of ["tree", "blob"] as const) {
    const source = omittedAddition();
    if (failure === "tree") {
      for (const tree of source.trees.values())
        (tree as { truncated: boolean }).truncated = true;
    } else {
      for (const contents of source.contents.values())
        contents.content = Buffer.from("different bytes\n").toString("base64");
    }
    const evidence = await collect(source);
    expect(evidence.limitations).toContain("Full diff required: fix.ts");
    expect(evidence.files[0].addedComparison).toBeUndefined();
    expect(evidence.commitAttribution[0].changedPaths).toBeNull();
  }
});

test("complete reported text keeps its original evidence representation", async () => {
  const evidence = await collect(fixture({ textOnly: true }));
  expect(evidence.limitations).toEqual([]);
  expect(evidence.files[0].addedComparison).toBeUndefined();
  expect(evidence.files[0].additions).toBe(1);
  expect(evidence.files[0].patch).toBe(
    "@@ -0,0 +1 @@\n+export const fixed = true;",
  );
});
