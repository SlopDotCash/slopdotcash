// Writes formal/spec-catalog.json from the spec tree, with vibestack's own parser, so the catalog is never edited by hand.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { readSpecs } from "../vibestack/parse.ts"

const root = path.resolve(import.meta.dirname, "..")
const file = path.join(root, "formal/spec-catalog.json")
const previous = JSON.parse(readFileSync(file, "utf8")) as { meaning: string }
const specs = readSpecs(root)
  .map((spec) => ({
    path: spec.file,
    sha256: createHash("sha256").update(readFileSync(path.join(root, spec.file))).digest("hex"),
    module: spec.name,
    stories: spec.stories.map((story) => ({ heading: story.title, line: story.line })),
    rules: spec.rules.map((rule) => ({ heading: rule.key, line: rule.line, definitions: rule.defs })),
    imports: spec.imports,
    references: spec.references.map((reference) => ({ target: reference.target, line: reference.line })),
  }))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
const text = `${JSON.stringify({ meaning: previous.meaning, specs }, null, 2)}\n`
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== text) { process.stderr.write("formal/spec-catalog.json is not what formal/catalog.ts writes; run node formal/catalog.ts\n"); process.exit(1) }
} else writeFileSync(file, text)
