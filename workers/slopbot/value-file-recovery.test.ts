import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { collectValueEvidence } from "./value-evidence";
import {
  type ValueFileRecovery,
  type ValueFileRequest,
  valueFileRecoveryCapture,
  verifiedValueFileClient,
} from "./value-file-recovery";

const sha = (type: string, bytes: Uint8Array) =>
  createHash("sha1")
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
function recovery(
  requests: ValueFileRequest[],
  bytes: Uint8Array,
): ValueFileRecovery {
  const blob = sha("blob", bytes);
  return {
    inputSha256: createHash("sha256")
      .update(JSON.stringify(requests))
      .digest("hex"),
    entries: requests.map((request) => ({
      ...request,
      treeSha: "d".repeat(40),
      mode: "100644",
      blobSha: blob,
    })),
    blobs: [
      {
        sha: blob,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        gzipBase64: gzipSync(bytes).toString("base64"),
      },
    ],
  };
}

test("normal collection recovers a complete oversized added text from verified private bundle bytes", async () => {
  const source = fixture({ direct: true, textOnly: true });
  const text = "export const retained = true;\n".repeat(100000);
  const bytes = new TextEncoder().encode(text);
  const head = source.pull.head.sha;
  const merged = source.pull.merge_commit_sha;
  if (!merged) throw new Error("Missing merge");
  source.bind(head, new Map([["fix.ts", bytes]]), [source.pull.base.sha]);
  source.bind(merged, new Map([["fix.ts", bytes]]), [
    source.pull.base.sha,
    head,
  ]);
  source.files[0].additions = 100000;
  delete source.files[0].patch;
  const client = {
    ...source.client,
    async get<T>(path: string): Promise<T | null> {
      const result = await source.client.get<T>(path);
      if (result && path.includes("/commits/") && !path.includes("/git/"))
        (result as unknown as { stats: unknown }).stats = {
          additions: 100000,
          deletions: 0,
          total: 100000,
        };
      return result;
    },
  };
  const before = await collectValueEvidence(
    client,
    repository.id,
    1,
    repository,
  );
  expect(before.limitations).toContain("Full diff required: fix.ts");
  const requests = [head, merged].map((ref) => ({
    repository: repository.id,
    repositoryNodeId: repository.expectedNodeId ?? "",
    ref,
    path: "fix.ts",
  }));
  const verified = await verifiedValueFileClient(
    client,
    requests,
    recovery(requests, bytes),
  );
  const after = await collectValueEvidence(
    verified,
    repository.id,
    1,
    repository,
  );
  expect(after.limitations).toEqual([]);
  expect(after.files[0].additions).toBe(100000);
  expect(after.files[0].patch?.split("\n").length).toBe(100001);
  expect(after.commitAttribution[0].changedPaths).toEqual(["fix.ts"]);
});

for (const invalid of ["request", "blob", "size", "duplicate"] as const) {
  test(`private recovery rejects ${invalid} corruption`, async () => {
    const requests = [
      {
        repository: "example/repo",
        repositoryNodeId: "R_example",
        ref: "a".repeat(40),
        path: "a.txt",
      },
    ];
    const bytes = new TextEncoder().encode("kept\n");
    const proof = recovery(requests, bytes);
    if (invalid === "request") proof.entries[0].path = "other.txt";
    if (invalid === "blob") proof.blobs[0].sha256 = "0".repeat(64);
    if (invalid === "size") proof.blobs[0].size = 1;
    if (invalid === "duplicate") proof.blobs.push(proof.blobs[0]);
    await expect(
      verifiedValueFileClient({ get: async () => null }, requests, proof),
    ).rejects.toThrow();
  });
}

for (const text of ["", "kept\n"]) {
  test(`verified file recovery preserves ${text ? "nonempty" : "empty"} exact text`, async () => {
    const requests = [
      {
        repository: "example/repo",
        repositoryNodeId: "R_example",
        ref: "a".repeat(40),
        path: "a.txt",
      },
    ];
    const bytes = new TextEncoder().encode(text);
    const client = await verifiedValueFileClient<
      import("./value-evidence-types").EvidenceClient
    >({ get: async () => null }, requests, recovery(requests, bytes));
    expect(
      new TextDecoder().decode(
        (await client.verifiedFile?.("example/repo", "a".repeat(40), "a.txt"))
          ?.bytes,
      ),
    ).toBe(text);
  });
}

for (const path of [
  "/repos/example/repo/pulls/1/files?per_page=100&page=1",
  "/repos/example/repo/pulls/1/commits?per_page=100&page=1",
  `/repos/example/repo/commits/${"a".repeat(40)}`,
]) {
  test(`recovery binds repo and milestone keys outside the direct PR response at ${path}`, async () => {
    let value = { repo: { id: 1 }, milestone: { id: 2 } };
    const capture = valueFileRecoveryCapture({
      get: async <T>(_path: string) => structuredClone(value) as T,
    });
    await capture.client.get(path);
    value = { repo: { id: 3 }, milestone: { id: 2 } };
    await expect(capture.client.get(path)).rejects.toThrow(
      "Source metadata changed",
    );
  });
}
test("recovery binds nested PR data outside embedded head and base repositories", async () => {
  let value = {
    head: { sha: "a" },
    base: { sha: "b" },
    custom: { repo: { id: 1 } },
  };
  const capture = valueFileRecoveryCapture({
    get: async <T>(_path: string) => structuredClone(value) as T,
  });
  await capture.client.get("/repos/example/repo/pulls/1");
  value = { ...value, custom: { repo: { id: 2 } } };
  await expect(
    capture.client.get("/repos/example/repo/pulls/1"),
  ).rejects.toThrow("Source metadata changed");
});

for (const changed of [false, true]) {
  test(`ordinary commit added patches use immutable contents recovery, changed=${changed}`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    const bytes = new TextEncoder().encode("export const retained = true;\n");
    const head = source.pull.head.sha;
    const merged = source.pull.merge_commit_sha;
    if (!merged) throw Error("fixture merge");
    source.bind(head, new Map([["fix.ts", bytes]]), [source.pull.base.sha]);
    source.bind(merged, new Map([["fix.ts", bytes]]), [
      source.pull.base.sha,
      head,
    ]);
    source.files[0].additions = 1;
    source.files[0].deletions = 0;
    source.files[0].patch = "@@ -0,0 +1 @@\n+export const retained = true;";
    const client = {
      ...source.client,
      async get<T>(path: string): Promise<T | null> {
        const result = await source.client.get<T>(path);
        if (result && path.includes("/commits/") && !path.includes("/git/")) {
          const commit = result as unknown as {
            stats: unknown;
            files: { patch?: string }[];
          };
          commit.stats = { additions: 1, deletions: 0, total: 1 };
          commit.files = commit.files.map((file) => {
            const copy = { ...file };
            delete copy.patch;
            return copy;
          });
        }
        if (
          changed &&
          result &&
          path.includes("/contents/") &&
          path.includes(head)
        ) {
          const contents = result as unknown as { content: string };
          contents.content = Buffer.from("changed bytes\n").toString("base64");
        }
        return result;
      },
    };
    const evidence = await collectValueEvidence(
      client,
      repository.id,
      1,
      repository,
    );
    const file = evidence.commitAttribution[0].files?.[0];
    if (changed) expect(file?.patch).toBeUndefined();
    else expect(file?.patch).toBe(source.files[0].patch);
  });
}

test("recovery accepts reordered GitHub object keys while binding array and nested values", async () => {
  const initial = {
    number: 3214,
    head: { sha: "a".repeat(40), ref: "fix", repo: { updated_at: "before" } },
    base: { sha: "b".repeat(40), ref: "main", repo: { updated_at: "before" } },
    labels: [{ id: 1, name: "accepted", color: "ffffff" }],
    _links: { self: { href: "/pulls/3214" }, comments: { href: "/comments" } },
    milestone: { title: "before" },
  };
  let value: unknown = initial;
  const capture = valueFileRecoveryCapture({
    get: async <T>(_path: string) => structuredClone(value) as T,
  });
  const path = "/repos/example/repo/pulls/3214";
  await capture.client.get(path);
  value = {
    _links: { comments: { href: "/comments" }, self: { href: "/pulls/3214" } },
    labels: [{ color: "ffffff", name: "accepted", id: 1 }],
    base: { repo: { updated_at: "after" }, ref: "main", sha: "b".repeat(40) },
    head: { repo: { updated_at: "after" }, ref: "fix", sha: "a".repeat(40) },
    milestone: { title: "after" },
    number: 3214,
  };
  await expect(capture.client.get(path)).resolves.toEqual(value);
  value = { ...initial, labels: [{ ...initial.labels[0], name: "changed" }] };
  await expect(capture.client.get(path)).rejects.toThrow(
    "Source metadata changed",
  );
});

test("recovery keeps GitHub array order significant", async () => {
  let value = { labels: [{ id: 1 }, { id: 2 }] };
  const capture = valueFileRecoveryCapture({
    get: async <T>(_path: string) => structuredClone(value) as T,
  });
  const path = "/repos/example/repo/pulls/3214";
  await capture.client.get(path);
  value = { labels: [...value.labels].reverse() };
  await expect(capture.client.get(path)).rejects.toThrow(
    "Source metadata changed",
  );
});

test("verified recovery preserves binary bytes and leaves text validation to consumers", async () => {
  const requests = [
    {
      repository: "example/repo",
      repositoryNodeId: "R_example",
      ref: "a".repeat(40),
      path: "capture.gz",
    },
  ];
  const bytes = new Uint8Array([0x1f, 0x8b, 0, 0xff, 0x80]);
  const client = await verifiedValueFileClient(
    { get: async () => null },
    requests,
    recovery(requests, bytes),
  );
  const file = await client.verifiedFile?.(
    "example/repo",
    "a".repeat(40),
    "capture.gz",
  );
  expect(file?.bytes).toEqual(bytes);
  if (!file) throw Error("Missing verified binary");
  file.bytes[0] = 0;
  expect(
    (await client.verifiedFile?.("example/repo", "a".repeat(40), "capture.gz"))
      ?.bytes,
  ).toEqual(bytes);
});

test("normal collection accepts exact binary evidence from private recovery", async () => {
  const source = fixture({ direct: true, binaryOnly: true });
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0xff, 9]);
  const client = {
    ...source.client,
    async get<T>(path: string): Promise<T | null> {
      if (path.includes("/contents/")) return null;
      return source.client.get<T>(path);
    },
  };
  const before = await collectValueEvidence(
    client,
    repository.id,
    1,
    repository,
  );
  expect(before.files[0].addedBinary).toBeUndefined();
  const requests = [source.pull.head.sha, source.pull.merge_commit_sha].map(
    (ref) => ({
      repository: repository.id,
      repositoryNodeId: repository.expectedNodeId ?? "",
      ref,
      path: "capture.webm",
    }),
  );
  const verified = await verifiedValueFileClient(
    client,
    requests,
    recovery(requests, bytes),
  );
  const after = await collectValueEvidence(
    verified,
    repository.id,
    1,
    repository,
  );
  expect(after.limitations).toEqual([]);
  expect(after.files[0].addedBinary?.contentBase64).toBe(
    Buffer.from(bytes).toString("base64"),
  );
  expect(after.files[0].addedBinary?.contentReview).toBe("unviewed");
});
