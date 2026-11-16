import { expect, test } from "bun:test";
import { collect, fixture } from "../../tests/value-binary-fixture";
import { binarySourceLimitations } from "./value-binary";

async function largeBinaryFixture(count = 3, bytesPerFile = 400 * 1024) {
  const source = fixture({ binaryOnly: true, direct: true });
  const head = source.pull.head.sha;
  const files = new Map<string, Uint8Array>();
  source.files.splice(0);
  for (let index = 0; index < count; index++) {
    const name = `capture-${index}.gz`;
    const bytes = new Uint8Array(bytesPerFile);
    bytes.fill(index + 1);
    bytes[0] = 0;
    files.set(name, bytes);
    source.files.push({
      filename: name,
      status: "added",
      additions: 0,
      deletions: 0,
      blob_url: `https://github.com/example/binary-proof/blob/${head}/${name}`,
    });
  }
  const client = Object.assign(source.client, {
    async verifiedFile(_repository: string, ref: string, path: string) {
      const content = source.contents.get(`${path}?ref=${ref}`);
      return content
        ? { sha: content.sha, bytes: Buffer.from(content.content, "base64") }
        : null;
    },
  });
  source.pull.changed_files = count;
  source.bind(head, files, [source.pull.base.sha]);
  source.bind(source.pull.merge_commit_sha, files, [
    source.pull.base.sha,
    head,
  ]);
  return collect({ ...source, client });
}

test("repeated binary representations count their immutable bytes once", async () => {
  const evidence = await largeBinaryFixture();
  expect(evidence.limitations).toEqual([]);
  expect(evidence.files).toHaveLength(3);
  expect(
    evidence.files.every((file) => file.addedBinary?.size === 400 * 1024),
  ).toBe(true);
  expect(await binarySourceLimitations(evidence)).toEqual([]);
});

test("distinct binary bytes retain the total recovery budget", async () => {
  const evidence = await largeBinaryFixture(5, 450 * 1024);
  expect(evidence.limitations).toContain(
    "Added binary evidence exceeds the recovery budget",
  );
});

test("a repeated hash cannot hide changed bytes in one source scope", async () => {
  const evidence = await largeBinaryFixture();
  const file = evidence.mergeCommitEvidence?.files[0];
  if (!file?.addedBinary) throw Error("Binary fixture missing");
  file.addedBinary.contentBase64 = Buffer.alloc(400 * 1024, 9).toString(
    "base64",
  );
  expect(await binarySourceLimitations(evidence)).toContain(
    `Invalid added binary proof: ${file.filename}`,
  );
});

test("one oversized binary retains its per-object recovery bound", async () => {
  const evidence = await largeBinaryFixture(1, 513 * 1024);
  expect(evidence.limitations.some((reason) => reason.includes("binary"))).toBe(
    true,
  );
});
