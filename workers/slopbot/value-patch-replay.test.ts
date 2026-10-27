import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { EvidenceClient, FileChange } from "./value-evidence";
import { collectAcceptedPatchReplay } from "./value-patch-replay";
import { readValueTree } from "./value-tree";

const head = "a".repeat(40),
  parent = "b".repeat(40),
  merge = "c".repeat(40);
const repository = "example/toolkit";
type Entry = { text: string; mode?: string };
const hash = (kind: string, bytes: Buffer) =>
  createHash("sha1")
    .update(`${kind} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
const blob = (text: string) => hash("blob", Buffer.from(text));

function fixture(trees: Record<string, Record<string, Entry>>) {
  const responses = new Map<string, unknown>();
  for (const [ref, files] of Object.entries(trees)) {
    const build = (prefix: string): string => {
      const names = [
        ...new Set(
          Object.keys(files)
            .filter((path) => path.startsWith(prefix))
            .map((path) => path.slice(prefix.length).split("/")[0]),
        ),
      ];
      const entries = names
        .map((name) => {
          const file = files[prefix + name];
          return file
            ? {
                path: name,
                type: "blob",
                mode: file.mode ?? "100644",
                sha: blob(file.text),
              }
            : {
                path: name,
                type: "tree",
                mode: "040000",
                sha: build(prefix + name + "/"),
              };
        })
        .sort((a, b) =>
          Buffer.compare(
            Buffer.from(a.path + (a.type === "tree" ? "/" : "\0")),
            Buffer.from(b.path + (b.type === "tree" ? "/" : "\0")),
          ),
        );
      const raw = Buffer.concat(
        entries.map((entry) =>
          Buffer.concat([
            Buffer.from(`${entry.mode.replace(/^0/u, "")} ${entry.path}\0`),
            Buffer.from(entry.sha, "hex"),
          ]),
        ),
      );
      const sha = hash("tree", raw);
      responses.set(`/repos/${repository}/git/trees/${sha}`, {
        sha,
        truncated: false,
        tree: entries,
      });
      return sha;
    };
    const tree = build("");
    responses.set(`/repos/${repository}/git/commits/${ref}`, {
      sha: ref,
      tree: { sha: tree },
    });
    for (const [path, file] of Object.entries(files))
      responses.set(`/repos/${repository}/contents/${path}?ref=${ref}`, {
        type: "file",
        encoding: "base64",
        content: Buffer.from(file.text).toString("base64"),
        size: Buffer.byteLength(file.text),
        sha: blob(file.text),
      });
  }
  const client: EvidenceClient = {
    async get<T>(path: string) {
      if (!responses.has(path)) throw new Error(`Unexpected read: ${path}`);
      return responses.get(path) as T;
    },
  };
  return { client, responses };
}

function change(
  filename: string,
  patch: string,
  status = "modified",
): FileChange {
  return {
    filename,
    status,
    patch,
    additions: patch.split("\n").filter((s) => s.startsWith("+")).length,
    deletions: patch.split("\n").filter((s) => s.startsWith("-")).length,
    blob_url: null,
  };
}

function example() {
  const original = "before\nold\nafter\n";
  const final = "import one\nimport two\nbefore\nnew\nafter\n";
  const files = [
    change("file.ts", "@@ -1,3 +1,3 @@\n before\n-old\n+new\n after"),
    change("test.ts", "@@ -0,0 +1 @@\n+regression", "added"),
  ];
  const accepted = structuredClone(files);
  accepted[0].patch = accepted[0].patch!.replace("-1,3 +1,3", "-3,3 +3,3");
  const trees: Record<string, Record<string, Entry>> = {
    [head]: {
      "file.ts": { text: original.replace("old", "new") },
      "test.ts": { text: "regression\n" },
    },
    [parent]: { "file.ts": { text: "import one\nimport two\n" + original } },
    [merge]: {
      "file.ts": { text: final },
      "test.ts": { text: "regression\n" },
    },
  };
  return { files, accepted, trees };
}

async function prove(input: ReturnType<typeof example>) {
  return collectAcceptedPatchReplay(
    fixture(input.trees).client,
    repository,
    head,
    input.files,
    { sha: merge, parents: [{ sha: parent }], files: input.accepted },
  );
}

test("a prior import shift replays to the complete accepted files and retains separate identities", async () => {
  const input = example();
  const original = JSON.stringify(input.files);
  expect(await prove(input)).toEqual({
    schemaVersion: 1,
    headSha: head,
    mergeSha: merge,
    parentSha: parent,
    files: [
      {
        path: "file.ts",
        mode: "100644",
        submittedBlobSha: blob(input.trees[head]["file.ts"].text),
        parentBlobSha: blob(input.trees[parent]["file.ts"].text),
        acceptedBlobSha: blob(input.trees[merge]["file.ts"].text),
      },
      {
        path: "test.ts",
        mode: "100644",
        submittedBlobSha: blob("regression\n"),
        parentBlobSha: null,
        acceptedBlobSha: blob("regression\n"),
      },
    ],
  });
  expect(JSON.stringify(input.files)).toBe(original);
});

for (const fault of [
  "ambiguous",
  "suffix",
  "source-body",
  "context",
  "addition",
  "extent",
  "mode",
  "extra-file",
  "missing-file",
  "fake-added",
  "oversized",
] as const) {
  test(`shifted squash refuses ${fault} instead of inferring acceptance`, async () => {
    const input = example();
    if (fault === "ambiguous") {
      input.trees[parent]["file.ts"].text += "before\nold\nafter\n";
      input.trees[merge]["file.ts"].text += "before\nold\nafter\n";
    } else if (fault === "suffix")
      input.trees[merge]["file.ts"].text += "unreported change\n";
    else if (fault === "source-body")
      input.trees[head]["file.ts"].text = "unrelated source content\n";
    else if (fault === "context")
      input.accepted[0].patch = input.accepted[0].patch!.replace(
        " before",
        " elsewhere",
      );
    else if (fault === "addition")
      input.accepted[0].patch = input.accepted[0].patch!.replace(
        "+new",
        "+different",
      );
    else if (fault === "extent")
      input.accepted[0].patch = input.accepted[0].patch!.replace(
        "+3,3",
        "+3,4",
      );
    else if (fault === "mode")
      Object.assign(input.trees[merge]["file.ts"], { mode: "100755" });
    else if (fault === "extra-file")
      input.accepted.push(change("extra.ts", "@@ -0,0 +1 @@\n+extra", "added"));
    else if (fault === "missing-file") input.accepted.pop();
    else if (fault === "fake-added")
      Object.assign(input.trees[parent], { "test.ts": { text: "old test\n" } });
    else input.trees[parent]["file.ts"].text += "x".repeat(512 * 1024);
    expect(await prove(input)).toBeNull();
  });
}

test("multiple hunks preserve unrelated gaps and use only original-parent anchors", async () => {
  const input = example();
  input.files = [
    change(
      "file.ts",
      "@@ -1,2 +1,2 @@\n one\n-old\n+new\n@@ -4,2 +4,2 @@\n two\n-last\n+final",
    ),
  ];
  input.accepted = [
    change(
      "file.ts",
      "@@ -2,2 +2,2 @@\n one\n-old\n+new\n@@ -7,2 +7,2 @@\n two\n-last\n+final",
    ),
  ];
  input.trees[head] = {
    "file.ts": { text: "one\nnew\ngap\ntwo\nfinal\n" },
    "test.ts": { text: "" },
  };
  input.trees[parent] = {
    "file.ts": { text: "prefix\none\nold\ngap\nextra\nlines\ntwo\nlast\n" },
  };
  input.trees[merge] = {
    "file.ts": { text: "prefix\none\nnew\ngap\nextra\nlines\ntwo\nfinal\n" },
    "test.ts": { text: "" },
  };
  expect(await prove(input)).not.toBeNull();
  input.trees[parent]["file.ts"].text = input.trees[parent][
    "file.ts"
  ].text.replace("two", "missing");
  expect(await prove(input)).toBeNull();
});

for (const ending of ["\r\n", ""]) {
  test(`replay preserves ${ending ? "CRLF" : "missing final newline"} exactly`, async () => {
    const input = example();
    const eof = ending === "" ? "\n\\ No newline at end of file" : "";
    const token = ending === "\r\n" ? "\r" : "";
    input.files = [
      change("file.ts", `@@ -1 +1 @@\n-old${token}${eof}\n+new${token}${eof}`),
    ];
    input.accepted = [
      change("file.ts", `@@ -2 +2 @@\n-old${token}${eof}\n+new${token}${eof}`),
    ];
    input.trees[head] = {
      "file.ts": { text: "new" + ending },
      "test.ts": { text: "" },
    };
    input.trees[parent] = { "file.ts": { text: "prefix\nold" + ending } };
    input.trees[merge] = {
      "file.ts": { text: "prefix\nnew" + ending },
      "test.ts": { text: "" },
    };
    expect(await prove(input)).not.toBeNull();
  });
}

test("authenticated tree and blob failures never become a replay proof", async () => {
  const input = example();
  const { client, responses } = fixture(input.trees);
  responses.set(`/repos/${repository}/contents/file.ts?ref=${merge}`, {
    type: "file",
    encoding: "base64",
    content: Buffer.from("forged").toString("base64"),
    size: 6,
    sha: blob(input.trees[merge]["file.ts"].text),
  });
  expect(
    await collectAcceptedPatchReplay(client, repository, head, input.files, {
      sha: merge,
      parents: [{ sha: parent }],
      files: input.accepted,
    }),
  ).toBeNull();
  const failure = new Error("GitHub unavailable");
  await expect(
    collectAcceptedPatchReplay(
      {
        async get() {
          throw failure;
        },
      },
      repository,
      head,
      input.files,
      { sha: merge, parents: [{ sha: parent }], files: input.accepted },
    ),
  ).rejects.toBe(failure);
});

test("nested paths prove tree membership and absence without a recursive inventory", async () => {
  const input = example();
  for (const files of Object.values(input.trees))
    for (const key of Object.keys(files)) {
      files[`src/nested/${key}`] = files[key];
      delete files[key];
    }
  for (const file of [...input.files, ...input.accepted])
    file.filename = `src/nested/${file.filename}`;
  const { client, responses } = fixture(input.trees);
  expect(await prove(input)).not.toBeNull();
  for (const [path, value] of responses) {
    if (path.includes("/git/trees/"))
      Object.assign(value as object, { truncated: true });
  }
  expect(
    await collectAcceptedPatchReplay(client, repository, head, input.files, {
      sha: merge,
      parents: [{ sha: parent }],
      files: input.accepted,
    }),
  ).toBeNull();
});

for (const patch of [
  "@@ -1,3 +1,3\n before\n-old\n+new\n after",
  "@@ -1,4 +1,4 @@\n before\n-old\n+new\n after",
  "@@ -0,0 +1 @@\n+new",
  "@@ -1,3 +9007199254740991,3 @@\n before\n-old\n+new\n after",
  "@@ -1,3 +1,3 @@\n before\n-old\n+new\n after\ntrailing junk",
]) {
  test(`malformed or unanchored hunks refuse: ${patch.split("\n")[0]}`, async () => {
    const input = example();
    input.files[0] = change("file.ts", patch);
    input.accepted[0] = structuredClone(input.files[0]);
    expect(await prove(input)).toBeNull();
  });
}

test("one shared read ceiling covers all tree paths and blobs", async () => {
  const input = example();
  const prefix = "deep/".repeat(20);
  for (const files of Object.values(input.trees))
    for (const key of Object.keys(files)) {
      files[prefix + key] = files[key];
      delete files[key];
    }
  for (const file of [...input.files, ...input.accepted])
    file.filename = prefix + file.filename;
  const { client } = fixture(input.trees);
  let calls = 0;
  const counted: EvidenceClient = {
    get<T>(path: string) {
      calls++;
      return client.get<T>(path);
    },
  };
  expect(
    await collectAcceptedPatchReplay(counted, repository, head, input.files, {
      sha: merge,
      parents: [{ sha: parent }],
      files: input.accepted,
    }),
  ).toBeNull();
  expect(calls).toBeLessThanOrEqual(48);
});

test("aggregate verified bytes stay bounded across files", async () => {
  const input = example();
  const modified = input.files[0],
    accepted = input.accepted[0];
  input.files = [];
  input.accepted = [];
  for (const ref of Object.keys(input.trees)) input.trees[ref] = {};
  for (let i = 0; i < 5; i++) {
    const path = `file${i}.ts`,
      suffix = "x".repeat(225 * 1024);
    input.files.push({ ...modified, filename: path });
    input.accepted.push({ ...accepted, filename: path });
    input.trees[head][path] = { text: `before\nnew\nafter\n${suffix}` };
    input.trees[parent][path] = {
      text: `import one\nimport two\nbefore\nold\nafter\n${suffix}`,
    };
    input.trees[merge][path] = {
      text: `import one\nimport two\nbefore\nnew\nafter\n${suffix}`,
    };
  }
  expect(await prove(input)).toBeNull();
});

test("the existing complete-tree reader still verifies and rejects changed tree bytes", async () => {
  const input = example();
  const { client, responses } = fixture(input.trees);
  const commit = responses.get(`/repos/${repository}/git/commits/${head}`) as {
    tree: { sha: string };
  };
  const path = `/repos/${repository}/git/trees/${commit.tree.sha}`;
  const tree = structuredClone(responses.get(path)) as {
    tree: { sha: string }[];
  };
  responses.set(`${path}?recursive=1`, tree);
  expect(
    (await readValueTree(client, repository, head))?.get("file.ts")?.sha,
  ).toBe(blob(input.trees[head]["file.ts"].text));
  tree.tree[0].sha = "0".repeat(40);
  expect(await readValueTree(client, repository, head)).toBeNull();
});
