/** Candidate discovery only: literal coverage is not semantic refinement. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { ts } = createRequire(import.meta.resolve("lemmascript/package.json"))(
  "ts-morph",
);

const root = resolve(import.meta.dirname, "..");
const write = process.argv.includes("--write");
const inventory = JSON.parse(
  readFileSync(resolve(root, "formal/inventory.json"), "utf8"),
);
const modelText = new Map(
  inventory.models.map((model) => [
    model.path,
    readFileSync(resolve(root, model.path), "utf8"),
  ]),
);
const candidates = [];
const lifecycleName =
  /state|status|phase|stage|outcome|decision|mode|reason|result|verdict|exemption|availability|progress/iu;
for (const source of inventory.sources) {
  const text = readFileSync(resolve(root, source.path), "utf8");
  if (/\.[cm]?[jt]sx?$/u.test(source.path)) {
    const file = ts.createSourceFile(
      source.path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (ts.isUnionTypeNode(node)) {
        const values = node.types.flatMap((type) =>
          ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
            ? [type.literal.text]
            : [],
        );
        let owner = node.parent;
        while (owner && !owner.name && !ts.isCallExpression(owner))
          owner = owner.parent;
        const expression =
          owner && ts.isCallExpression(owner) ? owner.expression : null;
        const name =
          owner?.name?.getText(file) ??
          (expression && ts.isPropertyAccessExpression(expression)
            ? expression.name.text
            : expression && ts.isIdentifier(expression)
              ? expression.text
              : "anonymous");
        if (values.length >= 2 && lifecycleName.test(name)) {
          const line =
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          candidates.push({
            path: source.path,
            line,
            name,
            kind: "string-union",
            values: [...new Set(values)].sort(),
            models: source.models,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  } else if (source.path.endsWith(".sql")) {
    for (const match of text.matchAll(
      /CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]*)\)/gimu,
    )) {
      if (!lifecycleName.test(match[1])) continue;
      const values = [...match[2].matchAll(/'([^']*)'/gu)].map(
        (value) => value[1],
      );
      if (values.length >= 2)
        candidates.push({
          path: source.path,
          line: text.slice(0, match.index).split("\n").length,
          name: match[1],
          kind: "sql-check",
          values: [...new Set(values)].sort(),
          models: source.models,
        });
    }
  }
}
const states = candidates.map((candidate) => ({
  ...candidate,
  // An absent literal is a useful review lead. Its presence may be accidental
  // or part of another machine and cannot establish actual coverage.
  lexicallyUnmentionedValues: candidate.values.filter(
    (value) =>
      !candidate.models.some((model) =>
        modelText.get(model).includes(JSON.stringify(value)),
      ),
  ),
  review: "candidate-only",
}));
const result = {
  schemaVersion: 1,
  meaning:
    "Declared lifecycle candidates. This intentionally incomplete syntactic census cannot find every implicit state, establish reachability, or prove source/model correspondence. Review all audit gaps as well.",
  inventorySha256: createHash("sha256")
    .update(JSON.stringify(inventory))
    .digest("hex"),
  states,
};
const path = resolve(root, "formal/state-catalog.json");
if (write) {
  const formatted = execFileSync(
    resolve(root, "node_modules/.bin/biome"),
    ["format", "--stdin-file-path", "formal/state-catalog.json"],
    { cwd: root, input: JSON.stringify(result), encoding: "utf8" },
  );
  writeFileSync(path, formatted);
} else if (
  JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !==
  JSON.stringify(result)
) {
  throw new Error(
    "State catalog is stale; review then run bun run formal:states:update.",
  );
}
console.log(
  `${states.length} declared lifecycle candidates; lexical model mentions are not semantic coverage.`,
);
