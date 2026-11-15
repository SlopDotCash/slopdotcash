import { expect, test } from "bun:test";
import { collect, fixture } from "../../tests/value-binary-fixture";
import { binarySourceLimitations } from "./value-binary";

function preexistingBinary(
  fault:
    | "none"
    | "changed"
    | "private"
    | "identity"
    | "tree"
    | "parent-bytes"
    | "mode" = "none",
) {
  const f = fixture({ direct: true, binaryOnly: true });
  const root = "/repos/example/binary-proof";
  const head = f.pull.head.sha;
  const merge = f.pull.merge_commit_sha;
  const parent = "d".repeat(40);
  const contents = f.contents.get(`capture.webm?ref=${head}`);
  if (!contents) throw Error("Missing fixture contents");
  const bytes = Buffer.from(contents.content, "base64");
  f.bind(
    parent,
    new Map([
      [
        "capture.webm",
        fault === "parent-bytes" ? new Uint8Array([0, 8, 9]) : bytes,
      ],
    ]),
    [f.pull.base.sha],
    fault === "mode" ? "100755" : "100644",
  );
  const original = f.client.get.bind(f.client);
  let repositoryReads = 0;
  f.client.get = async <T>(path: string): Promise<T | null> => {
    if (path === root) {
      repositoryReads++;
      return {
        id: 42,
        node_id:
          fault === "identity" && repositoryReads > 1 ? "R_other" : "R_binary",
        private: fault === "private",
      } as T;
    }
    const value = await original<T>(path);
    if (path.startsWith(`${root}/commits/${merge}`)) {
      const result = value as Record<string, unknown>;
      return {
        ...result,
        parents: [{ sha: parent }, { sha: head }],
        files: [],
        stats: { additions: 0, deletions: 0, total: 0 },
      } as T;
    }
    if (fault === "tree" && path.includes("/git/trees/"))
      return { ...(value as object), truncated: true } as T;
    return value;
  };
  f.bind(
    merge,
    new Map([
      ["capture.webm", fault === "changed" ? new Uint8Array([0, 2, 3]) : bytes],
    ]),
    [parent, head],
  );
  return f;
}

for (const fault of [
  "none",
  "changed",
  "private",
  "identity",
  "tree",
  "parent-bytes",
  "mode",
] as const) {
  test(`binary already present in a native merge ${fault}`, async () => {
    const evidence = await collect(preexistingBinary(fault));
    expect(evidence.mergeCommitEvidence?.files).toEqual([]);
    if (fault === "none") {
      expect(evidence.limitations).toEqual([]);
      expect(evidence.files[0].addedBinary?.retainedAtMerge?.parentSha).toBe(
        "d".repeat(40),
      );
      expect(await binarySourceLimitations(evidence)).toEqual([]);
      const retained = evidence.files[0].addedBinary?.retainedAtMerge;
      if (!retained) throw Error("Missing retained binary binding");
      retained.parentSha = "e".repeat(40);
      expect(await binarySourceLimitations(evidence)).toContain(
        "Added binary accepted identity is unavailable: capture.webm",
      );
    } else {
      expect(evidence.limitations.length).toBeGreaterThan(0);
      expect(evidence.files[0].addedBinary?.retainedAtMerge).toBeUndefined();
    }
  });
}

test("malformed retained binary metadata in an implementation scope stays held", async () => {
  const evidence = await collect(preexistingBinary());
  const file = evidence.commitAttribution[0].files?.[0];
  if (!file?.addedBinary) throw Error("Missing implementation proof");
  file.addedBinary.retainedAtMerge = { mergeSha: "invalid" } as never;
  expect(await binarySourceLimitations(evidence)).toContain(
    "Invalid added binary proof: capture.webm",
  );
});

test("malformed retained binary metadata on a submitted file stays held", async () => {
  const evidence = await collect(preexistingBinary());
  const proof = evidence.files[0].addedBinary;
  if (!proof) throw Error("Missing submitted proof");
  proof.retainedAtMerge = null as never;
  expect(await binarySourceLimitations(evidence)).toContain(
    "Invalid added binary proof: capture.webm",
  );
});
