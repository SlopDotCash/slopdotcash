// PRD sections 7 and 11: complete historical evidence within the existing
// recovery budget. These controlled GitHub responses stop before inference.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { EvidenceClient, FileChange } from "./value-evidence";
import { addedValuePatchRecovery, hasCompleteValuePatch } from "./value-patch";

const repository = "Example/project";
const submitted = "a".repeat(40);
const accepted = "b".repeat(40);
const path = "evidence/results.jsonl";
const textOfSize = (size: number) => `${"x".repeat(size - 1)}\n`;
function blob(text: string | Uint8Array) {
  const bytes = Buffer.from(text);
  return {
    type: "file",
    encoding: "base64",
    size: bytes.length,
    sha: createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex"),
    content: bytes.toString("base64"),
  };
}
function added(filename = path, additions = 1): FileChange {
  return { filename, status: "added", additions, deletions: 0, blob_url: null };
}
function fixture(responses: Map<string, ReturnType<typeof blob>>) {
  const reads: string[] = [];
  const client: EvidenceClient = {
    async get<T>(request: string) {
      reads.push(request);
      const result = responses.get(request);
      if (!result) throw new Error(`Unexpected evidence request: ${request}`);
      return result as T;
    },
  };
  return { reads, recover: addedValuePatchRecovery(client, repository) };
}
const request = (ref: string, filename = path) =>
  `/repos/${repository}/contents/${filename}?ref=${ref}`;

test("a complete added file above 512 KiB recovers in both immutable ranges", async () => {
  // Same byte and line counts as the retained #59 source that exposed the cap.
  const text = "x\n".repeat(575) + textOfSize(651_489 - 575 * 2);
  const source = blob(text);
  const { recover, reads } = fixture(
    new Map([
      [request(submitted), source],
      [request(accepted), source],
    ]),
  );
  const head = added(path, 576);
  const merge = added(path, 576);
  await recover([head], submitted);
  await recover([merge], accepted);
  expect(hasCompleteValuePatch(head)).toBe(true);
  expect(merge.patch).toBe(head.patch);
  expect(head.patch).toBe(
    "@@ -0,0 +1,576 @@\n" +
      text
        .trimEnd()
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n"),
  );
  const repeated = added(path, 576);
  await recover([repeated], accepted);
  expect(repeated.patch).toBe(merge.patch);
  expect(reads).toEqual([request(submitted), request(accepted)]);
});

test("submitted and accepted reads share one 2 MiB budget", async () => {
  const first = blob(textOfSize(700_000));
  const rest = blob(textOfSize(2 * 1024 * 1024 - 1_400_000));
  const { recover, reads } = fixture(
    new Map([
      [request(submitted), first],
      [request(accepted), first],
      [request(accepted, "too-large.txt"), first],
      [request(accepted, "remaining.txt"), rest],
    ]),
  );
  const head = added();
  const merge = added();
  await recover([head], submitted);
  await recover([merge], accepted);
  const tooLarge = added("too-large.txt");
  const remaining = added("remaining.txt");
  const exhausted = added("exhausted.txt");
  await recover([tooLarge, remaining, exhausted], accepted);
  expect(hasCompleteValuePatch(head)).toBe(true);
  expect(hasCompleteValuePatch(merge)).toBe(true);
  expect(tooLarge.patch).toBeUndefined();
  expect(hasCompleteValuePatch(remaining)).toBe(true);
  expect(exhausted.patch).toBeUndefined();
  expect(reads).toEqual([
    request(submitted),
    request(accepted),
    request(accepted, "too-large.txt"),
    request(accepted, "remaining.txt"),
  ]);
});

test("larger added files still require exact Git bytes, UTF-8 and line counts", async () => {
  const text = textOfSize(651_489);
  const valid = blob(text);
  const invalidUtf8 = Buffer.from(text);
  invalidUtf8[17] = 0xff;
  for (const [source, additions] of [
    [{ ...valid, sha: "c".repeat(40) }, 1],
    [blob(invalidUtf8), 1],
    [{ ...valid, size: valid.size - 1 }, 1],
    [valid, 2],
  ] as const) {
    const { recover } = fixture(new Map([[request(submitted), source]]));
    const file = added(path, additions);
    await recover([file], submitted);
    expect(file.patch).toBeUndefined();
    expect(hasCompleteValuePatch(file)).toBe(false);
  }
});

test("invalid hash and UTF-8 consume decoded budget; all reads remain bounded", async () => {
  const bytes = Buffer.from(textOfSize(700_000));
  const valid = blob(bytes);
  bytes[17] = 0xff;
  for (const invalid of [{ ...valid, sha: "c".repeat(40) }, blob(bytes)]) {
    const { recover } = fixture(
      new Map([
        [request(submitted), invalid],
        [request(accepted), valid],
        [request(accepted, "over-budget.txt"), valid],
      ]),
    );
    const rejected = added();
    const acceptedFile = added();
    const overBudget = added("over-budget.txt");
    await recover([rejected], submitted);
    await recover([acceptedFile, overBudget], accepted);
    expect(rejected.patch).toBeUndefined();
    expect(hasCompleteValuePatch(acceptedFile)).toBe(true);
    expect(overBudget.patch).toBeUndefined();
  }

  const files = Array.from({ length: 17 }, (_, i) => added(`file-${i}.txt`));
  const bounded = fixture(
    new Map(
      files.map((file) => [request(submitted, file.filename), blob("small\n")]),
    ),
  );
  await bounded.recover(files, submitted);
  expect(files.slice(0, 16).every(hasCompleteValuePatch)).toBe(true);
  expect(files[16].patch).toBeUndefined();
  const later = added("later.txt");
  await bounded.recover([later], accepted);
  expect(later.patch).toBeUndefined();
  expect(bounded.reads).toEqual(
    files.slice(0, 16).map((file) => request(submitted, file.filename)),
  );
});
