/** Deterministic accounting; a discovered function is not a proved function. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isExcludedSourceDirectory } from "./lemmascript-source-directories.mjs";

const { ts } = createRequire(import.meta.resolve("lemmascript/package.json"))(
  "ts-morph",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs/lemmascript-inventory.json");
const arguments_ = process.argv.slice(2);
if (
  arguments_.some((argument) => !["--write", "--check"].includes(argument)) ||
  arguments_.length > 1
) {
  throw new Error(
    "Usage: node scripts/lemmascript-inventory.mjs [--write|--check]",
  );
}
const write = arguments_[0] === "--write";
const roots = [
  "src",
  "backend",
  "workers",
  "functions",
  "scripts",
  "skills",
  "contracts",
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const targets = new Set(
  readFileSync(join(root, "LemmaScript-files.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);
const files = [];

function walk(path) {
  if (!existsSync(join(root, path))) return;
  for (const entry of readdirSync(join(root, path), {
    withFileTypes: true,
  }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const child = `${path}/${entry.name}`;
    if (
      isExcludedSourceDirectory(child) &&
      (entry.isDirectory() || entry.isSymbolicLink())
    )
      continue;
    if (entry.isSymbolicLink())
      throw new Error(`Inventory refuses source symbolic links: ${child}`);
    if (entry.isDirectory()) {
      walk(child);
    } else if (
      /\.(?:ts|tsx|mts|mjs|js|py|sh|rs|sol)$/.test(child) &&
      !/(?:\.test|\.spec|\.generated|\.d|\.integration|\.workflow|\.e2e)\.(?:ts|tsx|mts|mjs|js)$/.test(
        child,
      )
    ) {
      files.push(child);
    }
  }
}
for (const sourceRoot of roots) walk(sourceRoot);

function features(node) {
  const found = new Set();
  const visit = (child) => {
    if (ts.isAwaitExpression(child)) found.add("await");
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    )
      found.add("jsx");
    if (ts.isNewExpression(child) && child.expression.getText() === "Promise")
      found.add("promise-construction");
    if (ts.isThrowStatement(child)) found.add("throw-unreachable-model");
    if (ts.isCallExpression(child)) {
      const name = child.expression.getText();
      if (
        /^(?:fetch|setTimeout|setInterval|Date\.now|crypto\.|console\.|process\.)/.test(
          name,
        )
      )
        found.add("runtime-effect");
      if (/\.(?:sort|localeCompare|toLowerCase|toUpperCase|split)$/.test(name))
        found.add("library-semantics-review");
      if (/^Math\.(?:sqrt|pow|random)/.test(name))
        found.add("unsupported-math");
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...found].sort();
}

function nameOf(node, source) {
  if (node.name) return node.name.getText(source);
  if (ts.isVariableDeclaration(node.parent))
    return node.parent.name.getText(source);
  if (ts.isPropertyAssignment(node.parent))
    return node.parent.name.getText(source);
  return `<${ts.SyntaxKind[node.kind]}@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}>`;
}

const inventory = files.sort().map((path) => {
  const text = readFileSync(join(root, path), "utf8");
  if (/\.(?:py|sh|rs|sol)$/.test(path))
    return {
      path,
      sha256: digest(text),
      language: path.endsWith(".py")
        ? "python"
        : path.endsWith(".rs")
          ? "rust"
          : path.endsWith(".sol")
            ? "solidity"
            : "shell",
      disposition: "outside-typescript-toolchain",
      functions: [],
    };
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : /\.(?:mjs|js)$/.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const functions = [];
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node)) &&
      node.body
    ) {
      const start = node.getStart(source);
      const prefix = text.slice(node.getFullStart(), start);
      const leadingBody = text.slice(
        node.body.getStart(source) + 1,
        node.body.statements?.[0]?.getStart(source) ?? node.body.end - 1,
      );
      const selected =
        targets.has(path) &&
        /\/\/@\s+verify\b/.test(`${prefix}\n${leadingBody}`);
      const syntaxFeatures = features(node.body);
      const unsupported = syntaxFeatures.some((feature) =>
        [
          "await",
          "jsx",
          "promise-construction",
          "runtime-effect",
          "unsupported-math",
        ].includes(feature),
      );
      functions.push({
        name: nameOf(node, source),
        kind: ts.SyntaxKind[node.kind],
        line: source.getLineAndCharacterOfPosition(start).line + 1,
        sha256: digest(node.getText(source)),
        status: selected ? "contract-target-unconfirmed" : "unproved",
        candidate: selected
          ? "selected-runtime-contract"
          : unsupported
            ? "requires-effect-or-language-boundary"
            : "requires-contract-and-semantics-review",
        syntaxFeatures,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return {
    path,
    sha256: digest(text),
    language: path.endsWith(".tsx")
      ? "tsx"
      : /\.(?:mjs|js)$/.test(path)
        ? "javascript"
        : "typescript",
    disposition: functions.length
      ? "callables-inventoried"
      : "no-function-body",
    functions,
  };
});
const functions = inventory.flatMap((file) => file.functions);
const result = {
  schemaVersion: 1,
  scope: roots,
  exclusions: [
    "tests, fixtures, integration, dependency and native build directories",
    "*.test.*, *.spec.*, *.integration.*, *.workflow.*, *.e2e.*, *.generated.*, *.d.*",
    "dependencies",
    "build outputs",
  ],
  counts: {
    files: inventory.length,
    functions: functions.length,
    selectedContractTargets: functions.filter(
      (entry) => entry.status === "contract-target-unconfirmed",
    ).length,
    unprovedFunctions: functions.filter((entry) => entry.status === "unproved")
      .length,
    nonTypeScriptFiles: inventory.filter(
      (entry) => entry.disposition === "outside-typescript-toolchain",
    ).length,
  },
  limits: [
    "Inventory is accounting, not verification. Contract targets are not counted as proved without successful current evidence.",
    "Syntax scanning can miss indirect effects and does not establish purity or LemmaScript support.",
    "Module initialization, native dependencies, Rust, Solidity, Python and shell require separate semantic review.",
  ],
  files: inventory,
};
// One callable per line keeps the complete generated index reviewable without
// repeating ten lines of JSON punctuation for each of thousands of callbacks.
const { files: indexedFiles, ...summary } = result;
const fileRows = indexedFiles.map(({ functions: callables, ...file }) => {
  const header = JSON.stringify(file).slice(0, -1);
  return `${header},"functions":[\n${callables.map((entry) => JSON.stringify(entry)).join(",\n")}\n]}`;
});
const bytes = `${JSON.stringify(summary, null, 2).slice(0, -2)},\n  "files": [\n${fileRows.join(",\n")}\n  ]\n}\n`;
if (write) writeFileSync(outputPath, bytes);
else if (
  !existsSync(outputPath) ||
  readFileSync(outputPath, "utf8") !== bytes
) {
  throw new Error(
    "LemmaScript inventory is missing or stale. Review changes, then run lemmascript:inventory:update.",
  );
}
console.log(
  `${write ? "Wrote" : "Checked"} ${inventory.length} files, ${functions.length} functions, ${result.counts.selectedContractTargets} selected contracts; unlisted contracts remain unproved.`,
);
