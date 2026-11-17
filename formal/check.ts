import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

interface CatalogSpec { path: string; sha256: string; module: string; stories: { heading: string }[]; rules: { heading: string }[]; imports: string[]; references: { target: string }[] }
interface Owner { spec: string; rules: string[] }
interface Section { section: number | string; heading: string; owners: (string | Owner)[] }
interface Model { sourcePath: string; retainedPath: string; sha256: string; actions: string[]; targetAreas: string[]; candidateSuccessorSpecs?: string[]; noSuccessor?: string }

const root = path.resolve(import.meta.dirname, "..")
const read = (file: string) => readFileSync(path.join(root, file))
const json = <T>(file: string) => JSON.parse(read(file).toString("utf8")) as T
const sha256 = (file: string) => createHash("sha256").update(read(file)).digest("hex")
const exists = (file: string) => existsSync(path.join(root, file))
const specFiles = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const at = `${dir}/${entry.name}`
  if (entry.isDirectory()) return entry.name === "gen" || entry.name.startsWith(".") ? [] : specFiles(at)
  return entry.name.endsWith(".md") ? [at] : []
})

const catalog = json<{ specs: CatalogSpec[] }>("formal/spec-catalog.json").specs
const requirements = json<{ source: { path: string; sha256: string }; sections: Section[] }>("formal/requirements.json")
const models = json<{ models: Model[] }>("formal/model-map.json").models
const gaps: string[] = []
const gap = (file: string, message: string) => gaps.push(`${file}: ${message}`)

const byPath = new Map(catalog.map((spec) => [spec.path, spec]))
const modules = new Set(catalog.map((spec) => spec.module))
const owned = new Set(requirements.sections.flatMap((section) => section.owners.map((owner) => (typeof owner === "string" ? owner : owner.spec))))

for (const spec of specFiles("spec").sort()) {
  if (!byPath.has(spec)) gap("formal/spec-catalog.json", `${spec} has no entry`)
  if (!owned.has(spec)) gap("formal/requirements.json", `${spec} owns no PRD subsection`)
}

for (const spec of catalog) {
  if (!exists(spec.path)) { gap("formal/spec-catalog.json", `${spec.path} does not exist`); continue }
  if (sha256(spec.path) !== spec.sha256) gap("formal/spec-catalog.json", `${spec.path} sha256 ${spec.sha256} does not match the file`)
  for (const imported of spec.imports) if (!modules.has(imported)) gap("formal/spec-catalog.json", `${spec.path} imports ${imported}, which no entry defines`)
  for (const { target } of spec.references) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(spec.path), target.split("#")[0]))
    if (!exists(resolved)) gap("formal/spec-catalog.json", `${spec.path} references ${target}, which does not exist`)
  }
}

if (!exists(requirements.source.path)) gap("formal/requirements.json", `source ${requirements.source.path} does not exist`)
else if (sha256(requirements.source.path) !== requirements.source.sha256) gap("formal/requirements.json", `source ${requirements.source.path} sha256 does not match the file`)
for (const section of requirements.sections) {
  const name = `section ${section.section} "${section.heading}"`
  if (section.owners.length === 0) gap("formal/requirements.json", `${name} has no owner`)
  for (const owner of section.owners) {
    const spec = typeof owner === "string" ? owner : owner.spec
    if (!exists(spec)) { gap("formal/requirements.json", `${name} owner ${spec} does not exist`); continue }
    if (typeof owner === "string" || owner.rules.length === 0) { gap("formal/requirements.json", `${name} owner ${spec} has no rule anchor`); continue }
    const headings = new Set([...(byPath.get(spec)?.stories ?? []), ...(byPath.get(spec)?.rules ?? [])].map((entry) => entry.heading))
    for (const anchor of owner.rules) if (!headings.has(anchor)) gap("formal/requirements.json", `${name} owner ${spec} anchor "${anchor}" is no story or rule of its catalog entry`)
  }
}

const generic = new Set(["init", "step"])
const words = new Map<string, Set<string>>()
const wordsOf = (spec: string) => words.get(spec) ?? words.set(spec, new Set(read(spec).toString("utf8").match(/\w+/g))).get(spec)!
for (const model of models) {
  const name = model.sourcePath
  if (!exists(model.retainedPath)) gap("formal/model-map.json", `${name} retained copy ${model.retainedPath} does not exist`)
  else if (sha256(model.retainedPath) !== model.sha256) gap("formal/model-map.json", `${name} retained copy sha256 does not match the recorded digest`)
  for (const area of model.targetAreas) if (!exists(area)) gap("formal/model-map.json", `${name} target area ${area} does not exist`)
  const candidates = model.candidateSuccessorSpecs ?? []
  for (const spec of candidates) if (!exists(spec)) gap("formal/model-map.json", `${name} candidate successor ${spec} does not exist`)
  const actions = model.actions.filter((action) => !generic.has(action))
  const mentions = candidates.filter(exists).some((spec) => actions.some((action) => wordsOf(spec).has(action)))
  const reason = typeof model.noSuccessor === "string" && /\S/.test(model.noSuccessor)
  if (mentions && model.noSuccessor !== undefined) gap("formal/model-map.json", `${name} has a successor and also records noSuccessor`)
  if (!mentions && !reason) gap("formal/model-map.json", `${name} has no candidate successor that mentions one of its actions and no noSuccessor reason`)
}

if (gaps.length) {
  process.stderr.write(`${gaps.join("\n")}\n${gaps.length} formal inventory gaps\n`)
  process.exit(1)
}
process.stdout.write(`formal inventories: ${catalog.length} specs, ${requirements.sections.length} PRD subsections, ${models.length} models\n`)
