import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

interface CatalogSpec { path: string; sha256: string; module: string; stories: { heading: string }[]; rules: { heading: string }[]; imports: string[]; references: { target: string }[] }
interface Owner { spec: string; rules: string[] }
interface Section { section: number | string; heading: string; sourceText: string; owners: (string | Owner)[] }
interface Model { sourcePath: string; retainedPath: string; sha256: string; actions: string[]; scenarios: string[]; targetAreas: string[]; candidateSuccessorSpecs?: string[]; noSuccessor?: string }
type Reconciled = { status: "rule"; spec: string; defs: string[]; note: string } | { status: "abstraction"; note: string } | { status: "gap"; spec: string; note: string }

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

// A spec with no story and no rule only links to others, so it owns no requirement of its own.
const navigation = (spec: string) => { const entry = byPath.get(spec); return !!entry && entry.stories.length === 0 && entry.rules.length === 0 }
for (const spec of specFiles("spec").sort()) {
  if (!byPath.has(spec)) gap("formal/spec-catalog.json", `${spec} has no entry`)
  if (!owned.has(spec) && !navigation(spec)) gap("formal/requirements.json", `${spec} owns no PRD subsection`)
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
    // A section whose text is only its heading states nothing to anchor; its owner is the area's navigation spec.
    const headingOnly = section.sourceText.split("\n").slice(1).every((line) => !/\S/.test(line))
    if (typeof owner === "string" || owner.rules.length === 0) { if (!(headingOnly && navigation(spec))) gap("formal/requirements.json", `${name} owner ${spec} has no rule anchor`); continue }
    const headings = new Set([...(byPath.get(spec)?.stories ?? []), ...(byPath.get(spec)?.rules ?? [])].map((entry) => entry.heading))
    for (const anchor of owner.rules) if (!headings.has(anchor)) gap("formal/requirements.json", `${name} owner ${spec} anchor "${anchor}" is no story or rule of its catalog entry`)
  }
}

const definitions = new Map<string, Set<string>>()
/** The names a spec's Quint defines: definitions, and each sum type with its constructors (also on continued `|` lines). */
const definedIn = (spec: string) => {
  const known = definitions.get(spec)
  if (known) return known
  const names = new Set<string>()
  let sum = false
  for (const line of read(spec).toString("utf8").split("\n")) {
    const type = /^\s*type\s+(\w+)\s*=(.*)$/.exec(line)
    const def = /^\s*(?:pure\s+def|pure\s+val|def|val|action|var|const|temporal|run|nondet)\s+(\w+)/.exec(line)
    if (type) {
      names.add(type[1])
      sum = !type[2].trim().startsWith("{")
      if (sum) for (const word of type[2].match(/\b[A-Z]\w*/g) ?? []) names.add(word)
    } else if (sum && /^\s*\|/.test(line)) for (const word of line.match(/\b[A-Z]\w*/g) ?? []) names.add(word)
    else sum = false
    if (def) names.add(def[1])
  }
  definitions.set(spec, names)
  return names
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
  // Prose can share a word with an action name by coincidence; only a successor whose Quint defines an action contradicts noSuccessor.
  const defines = candidates.filter(exists).some((spec) => actions.some((action) => definedIn(spec).has(action)))
  const reason = typeof model.noSuccessor === "string" && /\S/.test(model.noSuccessor)
  if (defines && model.noSuccessor !== undefined) gap("formal/model-map.json", `${name} has a successor and also records noSuccessor`)
  if (!mentions && !reason) gap("formal/model-map.json", `${name} has no candidate successor that mentions one of its actions and no noSuccessor reason`)
}

// Each retained model's action (but init and step) and scenario names the successor rule that carries it, the reason the
// successor abstracts it away, or the gap still open in the spec that should own it.
const reconciliation = json<{ models: Record<string, { actions: Record<string, Reconciled>; scenarios: Record<string, Reconciled> }> }>("formal/legacy-reconciliation.json").models
const openGaps: string[] = []
for (const name of Object.keys(reconciliation)) if (!models.some((model) => model.sourcePath === name)) gap("formal/legacy-reconciliation.json", `${name} is no model of formal/model-map.json`)
for (const model of models) {
  const name = model.sourcePath
  const entry = reconciliation[name]
  if (!entry) { gap("formal/legacy-reconciliation.json", `${name} has no reconciliation`); continue }
  for (const [kind, expected, given] of [["action", model.actions.filter((action) => !generic.has(action)), entry.actions ?? {}], ["scenario", model.scenarios, entry.scenarios ?? {}]] as const) {
    for (const item of expected) if (!(item in given)) gap("formal/legacy-reconciliation.json", `${name} ${kind} ${item} is not reconciled`)
    for (const [item, r] of Object.entries(given)) {
      const at = `${name} ${kind} ${item}`
      if (!expected.includes(item)) { gap("formal/legacy-reconciliation.json", `${at} is not in the model`); continue }
      if (!/\S/.test(r.note ?? "")) gap("formal/legacy-reconciliation.json", `${at} gives no note`)
      if (r.status === "rule") {
        if (!exists(r.spec)) { gap("formal/legacy-reconciliation.json", `${at} names ${r.spec}, which does not exist`); continue }
        if (!r.defs.length) gap("formal/legacy-reconciliation.json", `${at} names no definition of ${r.spec}`)
        for (const def of r.defs) if (!definedIn(r.spec).has(def)) gap("formal/legacy-reconciliation.json", `${at} names ${def}, which ${r.spec} does not define`)
      } else if (r.status === "gap") {
        // A gap may name the spec that should own it before that spec exists.
        if (!/^spec\/[\w/]+\.md$/.test(r.spec ?? "")) gap("formal/legacy-reconciliation.json", `${at} assigns its gap to ${r.spec}, which is no spec path`)
        openGaps.push(at)
      } else if (r.status !== "abstraction") gap("formal/legacy-reconciliation.json", `${at} has status ${(r as { status: string }).status}`)
    }
  }
}

if (gaps.length) {
  process.stderr.write(`${gaps.join("\n")}\n${gaps.length} formal inventory gaps\n`)
  process.exit(1)
}
process.stdout.write(`formal inventories: ${catalog.length} specs, ${requirements.sections.length} PRD subsections, ${models.length} models, ${openGaps.length} open legacy gaps\n`)
