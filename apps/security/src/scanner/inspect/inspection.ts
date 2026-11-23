// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import { sha256Of } from "@repo/platform/git/bytes";
import { templatePrefix } from "../../admission/result.ts";
import { expandGzipInputs } from "./gzip.ts";
import { localInstallHelpers } from "./helpers.ts";
import { wellFormedImage } from "./images.ts";
import { cmakeIncludedPaths, decodeText, gypIncludedPaths } from "./includes.ts";
import { declaresInterpreter } from "./magic.ts";
import {
  type Checks,
  type Classification,
  type Coverage,
  type DeterministicRecord,
  type InventoryItem,
  type MediaRecord,
  type RepositoryInspection,
  SCAN_SURFACES,
  SCAN_THREATS,
  type ScanFinding,
  type ScanInputFile,
  type ScanSurface,
  type VettingArtifact,
} from "./model.ts";
import { DOWNLOAD, OBFUSCATION, RULE_POLICY_SHA256, checkText, installHookCommands, signalExcerpt, xmlAttributeRuleText } from "./rules.ts";
import { ANT_BUILD_XML, ARCHIVES, MSBUILD_RECIPE, bulkClass, knownScanPath, opaqueArtifact, surfacesOf } from "./surfaces.ts";
import { textPartEnds } from "./textParts.ts";

export const INVENTORY_SCHEMA = "slop-scan-inventory-v2";
export const MAX_INVENTORY_BYTES = 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 1024;
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const DETERMINISTIC_COVERAGE_ID = "/slop-scan/deterministic-coverage";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** @throws {never} */
function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** @throws {never} */
function byPath<T extends { readonly path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** @throws {never} */
export function textParts(text: string, size = MAX_TEXT_FILE_BYTES): string[] {
  const bytes = encoder.encode(text);
  if (bytes.length <= size) return [text];
  const parts: string[] = [];
  let start = 0;
  for (const end of textPartEnds(bytes, size)) {
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts;
}

/** @throws {never} */
function inventoryBytes(classifications: ReadonlyArray<Classification>, items: ReadonlyArray<InventoryItem>, artifacts: ReadonlyArray<VettingArtifact>, media: ReadonlyArray<MediaRecord>, visibilityGaps: ReadonlyArray<string>): Uint8Array {
  return encoder.encode(JSON.stringify({ schemaVersion: INVENTORY_SCHEMA, rulePolicySha256: RULE_POLICY_SHA256, classifications, items, artifacts, ...(media.length > 0 ? { media } : {}), visibilityGaps }));
}

/** @throws {never} */
function quarantined(file: ScanInputFile, digest: string, type: VettingArtifact["type"]): VettingArtifact {
  return {
    sha256: digest,
    parentSha256: file.parentArtifactSha256 ?? null,
    origin: file.parentArtifactSha256 ? "archive" : "repository",
    path: file.path.slice(0, 500),
    type,
    state: "quarantined",
    analysis: "pending",
    requestedExecution: false,
  };
}

/** @throws {never} */
function artifactType(path: string): VettingArtifact["type"] {
  const lower = path.toLowerCase();
  return ARCHIVES.test(path) ? "archive" : lower.endsWith(".wasm") ? "wasm" : lower.endsWith(".node") ? "native-module" : "binary";
}

/** @throws {never} */
function withSurface(surfaces: ScanSurface[], ...added: ReadonlyArray<ScanSurface>) {
  for (const surface of added) if (!surfaces.includes(surface)) surfaces.push(surface);
}

interface Candidate {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly text: string;
  readonly surfaces: ReadonlyArray<ScanSurface>;
  readonly flagged: boolean;
  readonly fullTextRequired: boolean;
  readonly nonMatches?: ReadonlySet<RegExp>;
}

/** @throws {never} */
function itemsOf(candidate: Candidate): InventoryItem[] {
  return textParts(candidate.text).map((text, index, parts) => ({
    id: parts.length === 1 ? candidate.path : `${candidate.path}#part-${index + 1}-of-${parts.length}`,
    text,
    sha256: sha256Of(text),
  }));
}

/** @throws {never} */
function linkItems(files: ReadonlyArray<ScanInputFile>): InventoryItem[] {
  return files.flatMap((file) => {
    if (!file.symlink) return [];
    return textParts(JSON.stringify({ path: file.path, ...file.symlink })).map((text, index, parts) => ({
      id: `/slop-scan/symlink/${file.path}${parts.length === 1 ? "" : `#part-${index + 1}-of-${parts.length}`}`,
      text,
      sha256: sha256Of(text),
    }));
  });
}

/** @throws {never} */
function beyondOneReview(items: ReadonlyArray<InventoryItem>): boolean {
  return items.length > MAX_INVENTORY_ITEMS || items.reduce((total, item) => total + byteLength(item.text) + item.id.length + 160, 0) > MAX_INVENTORY_BYTES;
}

/** @throws {never} */
export function inspectRepository(input: { readonly files: ReadonlyArray<ScanInputFile>; readonly acquisitionGaps?: ReadonlyArray<string> }): RepositoryInspection {
  const expanded = expandGzipInputs(input.files, knownScanPath);
  const files = [...expanded.files].sort(byPath);
  const counts = Object.fromEntries(SCAN_SURFACES.map((surface) => [surface, 0])) as Record<ScanSurface, number>;
  counts.downloads = expanded.archives.length;
  const partial = new Set<ScanSurface>();
  const gaps: string[] = [...(input.acquisitionGaps ?? []), ...expanded.gaps];
  if (gaps.length > 0) partial.add("source");
  const findings: ScanFinding[] = [];
  const artifacts: VettingArtifact[] = [...expanded.archives];
  const dependencyLocks: { path: string; sha256: string }[] = [];
  const candidates: Candidate[] = [];
  const classifications: Classification[] = [];
  const downloads = new Set<string>();
  const media: MediaRecord[] = [];
  const templatePaths = new Set(files.filter((file) => file.templateInput).map((file) => file.path));
  const gyp = gypIncludedPaths(files);
  if (gyp.unacquired.length > 0) {
    partial.add("installScripts");
    gaps.push(...gyp.unacquired);
  }
  const cmakeIncludes = cmakeIncludedPaths(files);
  const texts = new Map(files.map((file) => [file.path, decodeText(file.bytes)]));
  const helpers = localInstallHelpers(
    files.map((file) => ({ path: file.path, text: texts.get(file.path) ?? null })),
    files.flatMap((file) => {
      const text = texts.get(file.path);
      if (text === null || text === undefined) return [];
      const surfaces = surfacesOf(file.logicalPath ?? file.path);
      const directory = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      const hooks = installHookCommands(file.path, text).map((command) => ({ path: file.path, text: command, directory }));
      if (
        (surfaces.includes("installScripts") || (surfaces.length === 0 && declaresInterpreter(file.bytes)) || gyp.included.has(file.path) || cmakeIncludes.has(file.path)) &&
        (/\.(?:sh|bash|zsh)$/iu.test(file.logicalPath ?? file.path) || /^#![^\n]*\b(?:ba|da|k|z)?sh(?:\s|$)/u.test(text))
      )
        return [...hooks, { path: file.path, text, directory, file: true }];
      return hooks;
    }),
  );
  if (helpers.unacquired.length > 0) {
    partial.add("installScripts");
    gaps.push(...helpers.unacquired);
  }
  for (const file of files) {
    const surfaces = surfacesOf(file.logicalPath ?? file.path);
    if (surfaces.length === 0 && declaresInterpreter(file.bytes)) surfaces.push("installScripts", "source");
    if (gyp.included.has(file.path) || cmakeIncludes.has(file.path) || helpers.included.has(file.path)) withSurface(surfaces, "installScripts", "source");
    const unclassified = surfaces.length === 0;
    if (!file.templateInput && file.path.toLowerCase().startsWith(`${templatePrefix}/`)) {
      partial.add("source");
      gaps.push(`Repository path in the reserved template namespace: ${file.path}`);
    }
    const image = unclassified && !file.parentArtifactSha256 && !file.templateInput ? wellFormedImage(file.logicalPath ?? file.path, file.bytes) : null;
    if (image !== null) {
      media.push({ path: file.path.slice(0, 500), sha256: sha256Of(file.bytes), bytes: file.bytes.byteLength, format: image });
      continue;
    }
    if (surfaces.length > 0) classifications.push({ path: file.path, surfaces: [...surfaces].sort() });
    const digest = sha256Of(file.bytes);
    if (opaqueArtifact(file.path, file.bytes)) {
      artifacts.push(quarantined(file, digest, artifactType(file.path)));
      counts.downloads += 1;
      continue;
    }
    const text = texts.get(file.path) ?? null;
    if (text !== null && /<project(?=[\t\n\r />])/u.test(text)) withSurface(surfaces, "installScripts", "source");
    if (unclassified) {
      withSurface(surfaces, "source");
      classifications.push({ path: file.path, surfaces: [...surfaces].sort() });
    }
    for (const surface of surfaces) counts[surface] += 1;
    if (surfaces.includes("dependencies")) dependencyLocks.push({ path: file.path.slice(0, 500), sha256: digest });
    if (text === null) {
      for (const surface of surfaces) partial.add(surface);
      gaps.push(`Undecodable executable content at ${file.path}`);
      if (unclassified) {
        artifacts.push(quarantined(file, digest, "binary"));
        counts.downloads += 1;
      }
      continue;
    }
    const msbuild = MSBUILD_RECIPE.test(file.path);
    const attributes = msbuild || ANT_BUILD_XML.test(file.path) ? xmlAttributeRuleText(text, msbuild) : undefined;
    const ruleText = attributes?.text ?? text;
    const provenNonMatches = new Set<RegExp>();
    const found = checkText(file.path, ruleText, surfaces, text, attributes?.origin, provenNonMatches);
    findings.push(...found);
    const hooks = installHookCommands(file.path, text);
    if (hooks.length > 0) {
      counts.installScripts += 1;
      for (const command of hooks) findings.push(...checkText(`${file.path}#scripts`, command, ["installScripts"]));
    }
    if (surfaces.includes("installScripts") || hooks.length > 0)
      for (const match of [ruleText, ...hooks].join("\n").matchAll(DOWNLOAD)) downloads.add((match[1] ?? match[2] ?? "").slice(0, 500));
    candidates.push({
      path: file.path,
      sha256: digest,
      bytes: file.bytes.byteLength,
      text,
      surfaces,
      flagged: found.length > 0 || hooks.length > 0,
      fullTextRequired: unclassified,
      ...(ruleText === text ? { nonMatches: provenNonMatches } : {}),
    });
  }
  const links = linkItems(input.files);
  const deterministic: DeterministicRecord[] = candidates
    .filter((candidate) => templatePaths.has(candidate.path))
    .map((candidate) => ({ path: candidate.path, sha256: candidate.sha256, bytes: candidate.bytes, class: "template" as const }));
  const reviewable = candidates.filter((candidate) => !templatePaths.has(candidate.path));
  let items: InventoryItem[] = [...reviewable.flatMap(itemsOf), ...links];
  const excerpted = new Set<string>();
  if (beyondOneReview(items)) {
    items = [...links];
    for (const candidate of reviewable) {
      const kind = candidate.fullTextRequired ? null : bulkClass(candidate.path, candidate.surfaces);
      const excerpt = kind === null ? null : signalExcerpt(candidate.path, candidate.text, candidate.nonMatches);
      if (kind === null || (excerpt !== null && byteLength(excerpt) > MAX_TEXT_FILE_BYTES)) {
        items.push(...itemsOf(candidate));
        continue;
      }
      deterministic.push({ path: candidate.path, sha256: candidate.sha256, bytes: candidate.bytes, class: kind, ...(excerpt === null ? {} : { signals: true as const }) });
      if (excerpt !== null) {
        excerpted.add(candidate.path);
        items.push({ id: `${candidate.path}#signals`, text: excerpt, sha256: sha256Of(excerpt) });
      }
    }
  }
  if (deterministic.length > 0) {
    const text = JSON.stringify({
      note: "Files covered by every deterministic check and not sent to the model. A file with signals has a <path>#signals item with every rule match and obfuscation signal in context.",
      files: deterministic,
    });
    items.unshift({ id: DETERMINISTIC_COVERAGE_ID, text, sha256: sha256Of(text) });
  }
  const bulk = new Set(deterministic.map((record) => record.path));
  const riskSignals = candidates
    .filter((candidate) => excerpted.has(candidate.path) || ((candidate.flagged || OBFUSCATION.test(candidate.text)) && !bulk.has(candidate.path)))
    .map((candidate) => candidate.path);
  const urls = [...downloads].sort();
  for (const url of urls) {
    counts.downloads += 1;
    partial.add("downloads");
    gaps.push(`Install-time download not retrieved: ${url}`);
  }
  const inventory = inventoryBytes(classifications, items, artifacts, media, gaps);
  return {
    inventory,
    inventorySha256: sha256Of(inventory),
    classifications,
    items,
    coverage: Object.fromEntries(SCAN_SURFACES.map((surface) => [surface, { state: partial.has(surface) ? "partial" : "complete", items: counts[surface] }])) as Coverage,
    checks: Object.fromEntries(SCAN_THREATS.map((threat) => [threat, findings.some((finding) => finding.category === threat) ? "flagged" : "passed"])) as Checks,
    findings,
    artifacts,
    derivedFiles: expanded.derivedFiles,
    dependencyLocks,
    visibilityGaps: gaps,
    downloads: urls,
    deterministic,
    media,
    riskSignals,
  };
}

/** @throws {never} */
export function withExecutionEvidence(inspection: RepositoryInspection, added: ReadonlyArray<{ readonly id: string; readonly text: string }>, gaps: ReadonlyArray<string>): RepositoryInspection {
  const items = [...inspection.items, ...added.map(({ id, text }) => ({ id, text, sha256: sha256Of(text) }))];
  const visibilityGaps = [...inspection.visibilityGaps, ...gaps];
  const inventory = inventoryBytes(inspection.classifications, items, inspection.artifacts, inspection.media, visibilityGaps);
  return { ...inspection, items, visibilityGaps, inventory, inventorySha256: sha256Of(inventory) };
}

/** @throws {never} */
export function refusalInventory(reason: string): { readonly inventory: Uint8Array; readonly inventorySha256: string; readonly visibilityGaps: ReadonlyArray<string> } {
  const visibilityGaps = [`Acquisition refused before inspection: ${reason}`];
  const inventory = inventoryBytes([], [], [], [], visibilityGaps);
  return { inventory, inventorySha256: sha256Of(inventory), visibilityGaps };
}
