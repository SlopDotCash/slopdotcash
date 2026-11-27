import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as Schema from "effect/Schema";
import { act } from "../action.ts";
import { entry, installedProgram, recall, steady, store, type Memory } from "../cache.ts";
import { sourceProofUnits } from "../pipeline.ts";
import { proofInputs, type Unit } from "../prove.ts";
import { contracts } from "../review.ts";
import { digest, readSrc, tsApi, type SrcFile } from "../util.ts";

const ownerName = "points";
const sourceDirectory = "apps/points/src/";
const maxTypedOutputBytes = 8 * 1024 * 1024;
const extractionTimeoutMs = 60_000;
const cacheVersion = "knip-points-proof-reads-v1";
const adapterDigest = digest(readFileSync(import.meta.filename, "utf8"));
const reviewDigest = digest(readFileSync(path.join(path.dirname(import.meta.dirname), "review.ts"), "utf8"));
const decodePackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }));

const decodeTypedProof = Schema.decodeUnknownSync(Schema.Struct({
  schema: Schema.Literal(1),
  file: Schema.String,
  lemmascript: Schema.String,
  backendDirective: Schema.NullOr(Schema.Literal("dafny")),
  functions: Schema.Array(Schema.Struct({
    name: Schema.String,
    exported: Schema.Boolean,
    requires: Schema.Array(Schema.Unknown),
    ensures: Schema.Array(Schema.Unknown),
  })),
  dafny: Schema.Struct({
    emittedNames: Schema.Record(Schema.String, Schema.String),
    error: Schema.optionalKey(Schema.Never),
  }),
}));

const decodeProjection = Schema.decodeUnknownSync(Schema.Struct({
  source: Schema.String,
  bundle: Schema.String,
  names: Schema.Array(Schema.String),
}));

type Projection = ReturnType<typeof decodeProjection>;
type TypedProof = ReturnType<typeof decodeTypedProof>;

interface SourceUnit {
  source: SrcFile;
  unit: Unit;
}

function proofSources(root: string): Promise<ReadonlyMap<string, SourceUnit>> {
  const sources = readSrc(root).filter((source) => source.ts && source.file.startsWith(sourceDirectory));
  return sourceProofUnits(root, ownerName, sources).then((units) => {
    const files = new Map(sources.map((source) => [source.file.replaceAll("/", "-"), source]));
    const registered = new Map<string, SourceUnit>();
    for (const unit of units) {
      const source = files.get(unit.unit);
      if (!source) throw new Error("Proof unit has no original source: " + unit.unit);
      registered.set(source.file, { source, unit });
    }
    return registered;
  });
}

function clauseCalls(value: unknown, calls: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) clauseCalls(item, calls);
  } else if (value !== null && typeof value === "object") {
    if ("kind" in value && value.kind === "call" && "callKind" in value && value.callKind === "spec-pure" && "fn" in value) {
      const fn = value.fn;
      if (fn !== null && typeof fn === "object" && "kind" in fn && fn.kind === "var" && "name" in fn && typeof fn.name === "string") calls.add(fn.name);
    }
    for (const property of Object.values(value)) clauseCalls(property, calls);
  }
}

function localFunctions(source: SrcFile) {
  const ts = tsApi();
  const file = ts.createSourceFile(source.file, source.code, ts.ScriptTarget.Latest, true);
  const local = new Map<string, boolean>();
  for (const node of file.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    if (local.has(name)) throw new Error("Ambiguous source declaration: " + name);
    local.set(name, node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  }
  return local;
}

function projectionNames(root: string, source: SrcFile, info: TypedProof, local: ReadonlyMap<string, boolean>): string[] {
  const owned = info.functions.filter((fn) => local.has(fn.name));
  const named = new Map(owned.map((fn) => [fn.name, fn]));
  if (named.size !== owned.length || [...named].some(([name, fn]) => fn.exported !== local.get(name))) {
    throw new Error("Ambiguous typed proof declaration ownership");
  }

  const names = new Set<string>();
  const add = (name: string) => {
    const fn = named.get(name);
    if (!fn?.exported || !Object.hasOwn(info.dafny.emittedNames, name) || !info.dafny.emittedNames[name]) {
      throw new Error("Proof has no emitted export " + name);
    }
    names.add(name);
  };

  for (const row of contracts(root, [source]).get(source.file) ?? []) {
    const clause = /^(\S+): \/\/@\s+(requires|ensures)\b/.exec(row);
    if (!clause) continue;
    const [, name, kind] = clause;
    if (!local.get(name)) continue;
    const fn = named.get(name);
    if (!fn || (kind === "requires" ? fn.requires : fn.ensures).length === 0) {
      throw new Error("Proof has no typed " + kind + " clause for " + name);
    }
    add(name);
  }

  for (const fn of named.values()) {
    const calls = new Set<string>();
    clauseCalls([fn.requires, fn.ensures], calls);
    for (const name of calls) {
      if (name !== fn.name && local.get(name)) add(name);
    }
  }
  return [...names].sort();
}

function checkProjection(projection: Projection, expected: Pick<Projection, "source" | "bundle">, local: ReadonlyMap<string, boolean>) {
  if (projection.source !== expected.source || projection.bundle !== expected.bundle ||
    new Set(projection.names).size !== projection.names.length || projection.names.some((name) => !local.get(name))) {
    throw new Error("Proof projection does not match its source");
  }
}

async function projectProof(root: string, { source, unit }: SourceUnit): Promise<Projection> {
  return steady(async () => {
    const program = installedProgram(root, "lsc");
    if (!program?.id) throw new Error("LemmaScript installation could not be identified");
    const memory: Memory = { root, fresh: false, used: new Set(), actionSignal: AbortSignal.timeout(extractionTimeoutMs) };
    const inputs = proofInputs(unit.unit, unit.text);
    const key = { source: digest(source.code), bundle: digest(unit.text) };
    const receipt = await entry(root, "action", [
      cacheVersion, adapterDigest, reviewDigest, tsApi().version, program.id, source.file, key.source, key.bundle,
      inputs["lemmascript.json"].key, inputs["tsconfig.json"].key,
    ], false);
    const local = localFunctions(source);
    const cached = recall<unknown>(memory, receipt);
    if (cached !== undefined) {
      const projection = decodeProjection(cached);
      checkProjection(projection, key, local);
      return projection;
    }
    const began = performance.now();
    const result = await act(memory, "lsc", ["info", "--typed", "--backend=dafny", unit.unit], { temp: "vibestack-proof-reads-" }, inputs);
    const warnings = result.stderr.trim().split(/\r?\n/).filter(Boolean);
    if (!result.ok || warnings.some((line) => !line.startsWith("WARNING: "))) {
      throw new Error("LemmaScript extraction failed: " + (result.stopped ?? (result.stderr.slice(0, 1_000) || "exit " + result.status)));
    }
    const typed = result.out.slice(0, result.out.length - result.stderr.length);
    if (!typed.trim() || Buffer.byteLength(typed) > maxTypedOutputBytes) {
      throw new Error("LemmaScript typed output is empty or exceeds 8 MiB");
    }
    const info = decodeTypedProof(JSON.parse(typed));
    const launcherPackage = createRequire(import.meta.url).resolve("lemmascript/package.json");
    const { version } = decodePackage(JSON.parse(readFileSync(launcherPackage, "utf8")));
    const backend = /\/\/@ backend (\w+)/.exec(unit.text)?.[1] ?? null;
    if (path.basename(info.file) !== unit.unit || info.lemmascript !== version || info.backendDirective !== backend) {
      throw new Error("LemmaScript extraction does not match its proof unit");
    }
    if (warnings.length) process.stderr.write(result.stderr);
    const projection = { ...key, names: projectionNames(root, source, info, local) };
    store(memory, receipt, projection, { program, began });
    return projection;
  });
}

export function compilePointsProof(root: string): (source: string, file: string) => string | Promise<string> {
  let registered: ReturnType<typeof proofSources> | undefined;
  const projections = new Map<string, Promise<Projection>>();
  return (source, file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (!relative.startsWith(sourceDirectory) || !source.includes("//@")) return source;
    registered ??= proofSources(root);
    return registered.then(async (files) => {
      const proof = files.get(relative);
      if (!proof) return source;
      if (proof.source.code !== source) throw new Error(relative + ": source changed during proof projection");
      let projection = projections.get(relative);
      if (!projection) {
        projection = projectProof(root, proof);
        projections.set(relative, projection);
      }
      const { names } = await projection;
      return names.length ? source + "\n" + names.map((name) => "void " + name + ";").join("\n") + "\n" : source;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(relative + ": Points proof projection failed: " + message.slice(0, 1_000), { cause: error });
    });
  };
}
