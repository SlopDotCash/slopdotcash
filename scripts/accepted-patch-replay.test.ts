import { expect, test } from "bun:test";
import { fixture, repository } from "../tests/value-binary-fixture";
import type { FileChange } from "../workers/slopbot/value-evidence-types";
import { collectAcceptedPatchReplay } from "../workers/slopbot/value-patch-replay";

function shiftedFiles(
  corruptLast = false,
  repeated?: "complete" | "partial" | "unequal" | "extra",
) {
  const f = fixture({ textOnly: true });
  const head = "b".repeat(40);
  const parent = "d".repeat(40);
  const merge = "c".repeat(40);
  const submitted = new Map<string, Uint8Array>();
  const before = new Map<string, Uint8Array>();
  const after = new Map<string, Uint8Array>();
  const files: FileChange[] = [];
  for (let i = 0; i < 17; i++) {
    const path = `file-${String(i).padStart(2, "0")}.ts`;
    const text = (value: string) => new TextEncoder().encode(value);
    submitted.set(path, text(`header ${i}\nnew ${i}\nfooter ${i}\n`));
    before.set(path, text(`prefix ${i}\nheader ${i}\nold ${i}\nfooter ${i}\n`));
    after.set(
      path,
      text(
        `prefix ${i}\nheader ${i}\n${corruptLast && i === 16 ? "wrong" : "new"} ${i}\nfooter ${i}\n`,
      ),
    );
    files.push({
      filename: path,
      status: "modified",
      additions: 1,
      deletions: 1,
      blob_url: `https://github.com/${repository.id}/blob/${head}/${path}`,
      patch: `@@ -1,3 +1,3 @@\n header ${i}\n-old ${i}\n+new ${i}\n footer ${i}`,
    });
    if (i === 0 && repeated) {
      const block = (word: string) => `header 0\n${word} 0\nfooter 0\n`;
      const second =
        repeated === "partial"
          ? "old"
          : repeated === "unequal"
            ? "different"
            : "new";
      const extra = repeated === "extra" ? `divider 0\n${block("old")}` : "";
      submitted.set(
        path,
        text(`${block("new")}divider 0\n${block(second)}${extra}`),
      );
      before.set(
        path,
        text(`prefix 0\n${block("old")}divider 0\n${block("old")}${extra}`),
      );
      after.set(
        path,
        text(`prefix 0\n${block("new")}divider 0\n${block(second)}${extra}`),
      );
      if (repeated !== "partial") {
        files[0].patch += `\n@@ -5,3 +5,3 @@\n header 0\n-old 0\n+${second} 0\n footer 0`;
        files[0].additions = 2;
        files[0].deletions = 2;
      }
    }
  }
  f.bind(head, submitted, ["a".repeat(40)]);
  f.bind(parent, before, ["a".repeat(40)]);
  f.bind(merge, after, [parent]);
  const accepted = files.map((file) => ({
    ...file,
    patch: file.patch?.replace(
      /@@ -(\d+),3 \+(\d+),3 @@/gu,
      (_match, old, added) =>
        `@@ -${Number(old) + 1},3 +${Number(added) + 1},3 @@`,
    ),
  }));
  const run = () =>
    collectAcceptedPatchReplay(f.client, repository.id, head, files, {
      sha: merge,
      parents: [{ sha: parent }],
      files: accepted,
    });
  return { run, calls: f.calls, merge };
}

test("a seventeen-file shifted squash proves every immutable file across batches", async () => {
  const f = shiftedFiles();
  const proof = await f.run();
  expect(proof?.files).toHaveLength(17);
  expect(proof?.files.map((file) => file.path)).toEqual(
    Array.from(
      { length: 17 },
      (_, i) => `file-${String(i).padStart(2, "0")}.ts`,
    ),
  );
  expect(f.calls.length).toBeGreaterThan(48);
  // Repeated ancestor reads are shared by the deterministic path batches.
  expect(new Set(f.calls).size).toBe(f.calls.length);
});

test("corruption in the last batch discards the entire squash proof", async () => {
  const f = shiftedFiles(true);
  expect(await f.run()).toBeNull();
  expect(f.calls).toContain(
    `/repos/${repository.id}/contents/file-16.ts?ref=${f.merge}`,
  );
});

test("all repeated contexts explicitly edited identically are bound at their accepted offsets", async () => {
  const proof = await shiftedFiles(false, "complete").run();
  expect(proof?.files).toHaveLength(17);
});

for (const repeated of ["partial", "unequal", "extra"] as const)
  test(`${repeated} repeated context remains ambiguous and refuses the complete proof`, async () => {
    expect(await shiftedFiles(false, repeated).run()).toBeNull();
  });
