// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"; spec/security/admission.md, "Synthesis decides the repository result and confirmed malice needs trusted evidence"
import { sha256Of } from "@repo/platform/git/bytes";
import { DETERMINISTIC_COVERAGE_ID, INVENTORY_SCHEMA, MAX_INVENTORY_BYTES, MAX_INVENTORY_ITEMS, textParts } from "../inspect/inspection.ts";
import type { InventoryItem, RepositoryInspection } from "../inspect/model.ts";
import { surfacesOf } from "../inspect/surfaces.ts";
import { type ReviewPass, SCAN_REVIEW_AREAS, type ScannerEvidence } from "../providers/review.ts";
import { batchEnds, fittedAliasCount } from "./plan.ts";

export const DEFAULT_BATCH_TOKENS = 150_000;
export const BYTES_PER_TOKEN = 3;
export const MAX_CALL_ATTEMPTS = 3;
const ITEM_OVERHEAD_BYTES = 160;
const BATCH_OVERHEAD_BYTES = 2_048;
const MAX_BUNDLE_GAPS = 100;
const partSuffix = /(?:#(?:part-\d+-of-\d+|signals))+$/u;

export interface PlannedCall {
  readonly evidence: string;
  readonly inputSha256: string;
  readonly items: number;
  readonly estimatedTokens: number;
}

export type SameBytesOutsideBatches = ReadonlyArray<{ readonly sourcePath: string; readonly sourceSha256: string; readonly batch: string; readonly paths: ReadonlyArray<string> }>;

export type ReviewPlan =
  | { readonly mode: "single"; readonly call: PlannedCall }
  | { readonly mode: "batched"; readonly batches: ReadonlyArray<PlannedCall>; readonly batchTokens: number; readonly sameBytesOutsideBatches: SameBytesOutsideBatches };

interface Inventory {
  readonly items: ReadonlyArray<InventoryItem>;
  readonly visibilityGaps: ReadonlyArray<string>;
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).byteLength;
const itemBytes = (item: InventoryItem) => byteLength(JSON.stringify(item)) + ITEM_OVERHEAD_BYTES;
const tokens = (bytes: number) => Math.ceil(bytes / BYTES_PER_TOKEN);

/** @throws {never} */
export function callTimeoutMs(estimatedTokens: number): number {
  return Math.min(600_000, 120_000 + estimatedTokens);
}

function planned(evidence: string, items: number): PlannedCall {
  return { evidence, inputSha256: sha256Of(evidence), items, estimatedTokens: tokens(byteLength(evidence)) };
}

function inventoryOf(inspection: RepositoryInspection): Inventory {
  return JSON.parse(new TextDecoder().decode(inspection.inventory)) as Inventory;
}

function batchParts(item: InventoryItem, limit: number): InventoryItem[] {
  const framing = BATCH_OVERHEAD_BYTES + itemBytes({ id: `${item.id}#part-999999-of-999999`, text: "", sha256: item.sha256 });
  return textParts(item.text, Math.floor((limit - framing) / 6)).map((text, index, parts) => ({ id: `${item.id}#part-${index + 1}-of-${parts.length}`, text, sha256: sha256Of(text) }));
}

function tier(id: string, risky: ReadonlySet<string>): number {
  const path = id.replace(partSuffix, "");
  if (path === DETERMINISTIC_COVERAGE_ID || id.startsWith("/slop-scan/symlink/") || id.startsWith("execution:") || id.startsWith("slop-skill-template/")) return 0;
  const lower = path.toLowerCase();
  const surfaces = surfacesOf(path);
  if (risky.has(path) || surfaces.includes("installScripts") || surfaces.includes("agentInstructions") || surfaces.includes("manifests") || lower.startsWith(".github/") || /(?:^|\/)(?:dockerfile|containerfile|docker-compose[^/]*\.ya?ml)$/u.test(lower)) return 0;
  if (/(?:^|\/)(?:tests?|__tests__|spec|fixtures?|examples?|docs?)\//u.test(lower) || /\.(?:test|spec)\.[^/]+$/u.test(lower) || surfaces.includes("dependencies")) return 2;
  return 1;
}

/** @throws {Error} */
export function planReview(inspection: RepositoryInspection, batchTokens = DEFAULT_BATCH_TOKENS): ReviewPlan {
  if (!Number.isSafeInteger(batchTokens) || batchTokens < 100_000) throw new Error("A batch needs at least 100,000 tokens");
  const evidence = new TextDecoder().decode(inspection.inventory);
  const inventory = inventoryOf(inspection);
  const fits = inspection.inventory.byteLength <= MAX_INVENTORY_BYTES && inventory.items.length <= MAX_INVENTORY_ITEMS && inventory.visibilityGaps.length <= MAX_BUNDLE_GAPS && inventory.visibilityGaps.every((gap) => gap.length <= 1000);
  if (fits) return { mode: "single", call: planned(evidence, inventory.items.length) };
  const batchEvidence = (index: number, count: number, items: ReadonlyArray<InventoryItem>, aliases: Readonly<Record<string, ReadonlyArray<string>>>) =>
    JSON.stringify({
      schemaVersion: INVENTORY_SCHEMA,
      batch: { index, count, inventorySha256: inspection.inventorySha256, note: "One batch of a repository review; coverage refers to the supplied items. A repository-level synthesis follows." },
      items,
      ...(Object.keys(aliases).length > 0 ? { sameBytesAs: aliases } : {}),
      artifacts: [],
      visibilityGaps: [],
    });
  const risky = new Set(inspection.riskSignals);
  const limit = Math.min(batchTokens * BYTES_PER_TOKEN, MAX_INVENTORY_BYTES);
  const widest = Number.MAX_SAFE_INTEGER;
  const items = inventory.items.flatMap((item) => (byteLength(batchEvidence(widest, widest, [item], {})) > limit ? batchParts(item, limit) : [item]));
  const first = new Map<string, InventoryItem>();
  const sameBytes = new Map<string, string[]>();
  for (const item of items) {
    const original = first.get(item.sha256);
    if (original === undefined) first.set(item.sha256, item);
    else sameBytes.set(original.id, [...(sameBytes.get(original.id) ?? []), item.id]);
  }
  const ordered = items
    .filter((item) => first.get(item.sha256) === item)
    .map((item, position) => ({ item, position, tier: (sameBytes.get(item.id) ?? []).reduce((lowest, id) => Math.min(lowest, tier(id, risky)), tier(item.id, risky)) }))
    .sort((a, b) => a.tier - b.tier || a.position - b.position)
    .map((entry) => entry.item);
  const prepared = ordered.map((item) => {
    const aliases = sameBytes.get(item.id) ?? [];
    const base = byteLength(batchEvidence(widest, widest, [item], { [item.id]: [] }));
    const fitted = aliases.slice(0, aliases.length === 0 ? 0 : fittedAliasCount(base, aliases.map((alias) => byteLength(JSON.stringify(alias))), limit));
    const aliasBytes = fitted.length === 0 ? 0 : byteLength(JSON.stringify({ [item.id]: fitted }));
    return { item, aliases: fitted, rest: aliases.slice(fitted.length), bytes: itemBytes(item) + aliasBytes };
  });
  const ends = batchEnds(prepared.map((entry) => entry.bytes), prepared.map((entry) => entry.rest.length > 0), BATCH_OVERHEAD_BYTES, limit, MAX_INVENTORY_ITEMS);
  const groups = ends.map((end, index) => prepared.slice(index === 0 ? 0 : ends[index - 1], end));
  const batches = groups.map((group, index) =>
    planned(batchEvidence(index + 1, groups.length, group.map((entry) => entry.item), Object.fromEntries(group.filter((entry) => entry.aliases.length > 0).map((entry) => [entry.item.id, entry.aliases]))), group.length),
  );
  const groupOf = (position: number) => ends.findIndex((end) => position < end);
  const sameBytesOutsideBatches = prepared.flatMap((entry, position) => (entry.rest.length > 0 ? [{ sourcePath: entry.item.id, sourceSha256: entry.item.sha256, batch: `batch-${groupOf(position) + 1}`, paths: entry.rest }] : []));
  return { mode: "batched", batches, batchTokens, sameBytesOutsideBatches };
}

/** @throws {Error} */
export function synthesisCall(inspection: RepositoryInspection, batches: ReadonlyArray<PlannedCall>, results: ReadonlyArray<ScannerEvidence>, batchTokens: number, sameBytesOutsideBatches: SameBytesOutsideBatches): PlannedCall {
  const inventory = inventoryOf(inspection);
  const batchInputs = batches.map((batch) => JSON.parse(batch.evidence) as Inventory & { readonly sameBytesAs?: Readonly<Record<string, ReadonlyArray<string>>> });
  const sameBytesInBatches = batchInputs.flatMap((batch, index) =>
    batch.items.flatMap((item) => {
      const paths = batch.sameBytesAs?.[item.id] ?? [];
      return paths.length === 0 ? [] : [{ sourcePath: item.id, sourceSha256: item.sha256, batch: `batch-${index + 1}`, paths }];
    }),
  );
  const risky = new Set(inspection.riskSignals);
  const summarizedAliases = (entries: SameBytesOutsideBatches) => {
    const flaggedAliases = entries.flatMap((entry) => {
      const paths = entry.paths.filter((path) => risky.has(path.replace(partSuffix, "")));
      return paths.length === 0 ? [] : [{ ...entry, paths }];
    });
    return { sources: entries.length, paths: entries.reduce((sum, entry) => sum + entry.paths.length, 0), ...(flaggedAliases.length > 0 ? { flaggedAliases } : {}) };
  };
  const listing = (full: boolean) => ({
    inventorySha256: inspection.inventorySha256,
    coverage: inspection.coverage,
    checks: inspection.checks,
    findings: inspection.findings,
    artifacts: inspection.artifacts.map((artifact) => ({ path: artifact.path, type: artifact.type, sha256: artifact.sha256 })),
    downloads: inspection.downloads,
    riskSignals: inspection.riskSignals,
    visibilityGaps: inspection.visibilityGaps,
    batches: batches.map((batch, index) => ({ id: `batch-${index + 1}`, items: full ? (batchInputs[index]?.items ?? []).map((item) => item.id) : batch.items })),
    ...(sameBytesInBatches.length > 0 ? { sameBytesAs: full ? sameBytesInBatches : { ...summarizedAliases(sameBytesInBatches), note: "Paths byte-identical to a reviewed item, supplied beside that item in the retained batch inventories" } } : {}),
    ...(sameBytesOutsideBatches.length > 0 ? { sameBytesOutsideBatches: full ? sameBytesOutsideBatches : { ...summarizedAliases(sameBytesOutsideBatches), note: "Paths byte-identical to a reviewed item, listed in the retained inventory" } } : {}),
    deterministicOnly: {
      count: inspection.deterministic.length,
      bytes: inspection.deterministic.reduce((sum, row) => sum + row.bytes, 0),
      files: full ? inspection.deterministic : `${inspection.deterministic.length} files listed in the retained inventory`,
    },
  });
  const whole = JSON.stringify(listing(true));
  const prepass = byteLength(whole) > (batchTokens * BYTES_PER_TOKEN) / 2 ? JSON.stringify(listing(false)) : whole;
  const gaps = inventory.visibilityGaps.map((gap) => gap.slice(0, 1000));
  const bundleGaps = gaps.length > MAX_BUNDLE_GAPS ? [...gaps.slice(0, MAX_BUNDLE_GAPS - 1), `${gaps.length - MAX_BUNDLE_GAPS + 1} further visibility gaps are listed in the prepass item`] : gaps;
  const items = [
    { id: "prepass", text: prepass },
    ...results.map((result, index) => ({ id: `batch-${index + 1}`, text: JSON.stringify({ verdict: result.review.verdict, confidence: result.confidence, coverage: result.coverage, findings: result.findings }) })),
  ].map((item) => ({ ...item, sha256: sha256Of(item.text) }));
  return planned(JSON.stringify({ schemaVersion: INVENTORY_SCHEMA, synthesis: { inventorySha256: inspection.inventorySha256 }, items, artifacts: [], visibilityGaps: bundleGaps }), items.length);
}

/** @throws {never} */
export function withEarlierAttempts(last: ScannerEvidence, earlier: ReadonlyArray<ScannerEvidence>): ScannerEvidence {
  if (earlier.length === 0) return last;
  const attempts = [...earlier, last];
  const failed = last.review.status === "failed";
  const counted = attempts.filter((attempt) => attempt.usage !== null);
  const priced = attempts.filter((attempt) => attempt.cost !== null);
  const usage = counted.reduce(
    (sum, attempt) => ({
      uncachedInput: sum.uncachedInput + (attempt.usage?.uncachedInput ?? 0),
      cachedInput: sum.cachedInput + (attempt.usage?.cachedInput ?? 0),
      cacheCreation: sum.cacheCreation + (attempt.usage?.cacheCreation ?? 0),
      output: sum.output + (attempt.usage?.output ?? 0),
    }),
    { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 },
  );
  const basis = priced.at(-1)?.cost ?? null;
  const nanoUsd = priced.reduce((sum, attempt) => sum + BigInt(attempt.cost?.nanoUsd ?? "0"), 0n);
  return {
    ...last,
    usage: counted.length > 0 && (failed || counted.length === attempts.length) ? usage : null,
    cost: basis !== null && (failed || priced.length === attempts.length) ? { ...basis, nanoUsd: nanoUsd.toString() } : null,
  };
}

/** @throws {never} */
export function labelFailure(evidence: ScannerEvidence, label: string): ScannerEvidence {
  return evidence.failure === undefined ? evidence : { ...evidence, failure: `${label}:${evidence.failure}` };
}

/** @throws {never} */
export function passOf(kind: ReviewPass["kind"], index: number, call: PlannedCall, evidence: ScannerEvidence, attempts: number): ReviewPass {
  return {
    kind,
    index,
    inputSha256: call.inputSha256,
    items: call.items,
    estimatedTokens: call.estimatedTokens,
    runId: evidence.review.runId,
    status: evidence.review.status,
    verdict: evidence.review.verdict,
    providerRequestId: evidence.providerRequestId,
    responseSha256: evidence.responseSha256,
    usage: evidence.usage,
    cached: false,
    attempts,
  };
}

/** @throws {never} */
export function failedReview(evidence: ScannerEvidence, inventorySha256: string, passes: ReadonlyArray<ReviewPass>): ScannerEvidence {
  return { ...evidence, review: { ...evidence.review, inputManifestSha256: inventorySha256 }, passes };
}

const RANK = { "no-findings": 0, findings: 1, "malicious-suspected": 2 } as const;
const COVERAGE_RANK = { complete: 0, partial: 1, missing: 2 } as const;

/** @throws {never} */
export function combine(inventorySha256: string, batchResults: ReadonlyArray<ScannerEvidence>, last: ScannerEvidence, passes: ReadonlyArray<ReviewPass>): ScannerEvidence {
  const results = [...batchResults, last];
  const completed = results.every((result) => result.review.status === "completed");
  const coverage = completed
    ? (Object.fromEntries(SCAN_REVIEW_AREAS.map((area) => [area, results.map((result) => result.coverage?.[area] ?? "missing").reduce((worst, state) => (COVERAGE_RANK[state] > COVERAGE_RANK[worst] ? state : worst))])) as ScannerEvidence["coverage"])
    : null;
  const verdict = completed ? results.map((result) => result.review.verdict ?? "no-findings").reduce((worst, value) => (RANK[value] > RANK[worst] ? value : worst)) : null;
  const findings = completed ? results.flatMap((result) => result.findings) : [];
  const usage = results.every((result) => result.usage !== null)
    ? results.reduce(
        (sum, result) => ({
          uncachedInput: sum.uncachedInput + (result.usage?.uncachedInput ?? 0),
          cachedInput: sum.cachedInput + (result.usage?.cachedInput ?? 0),
          cacheCreation: sum.cacheCreation + (result.usage?.cacheCreation ?? 0),
          output: sum.output + (result.usage?.output ?? 0),
        }),
        { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 },
      )
    : null;
  const cost = results.every((result) => result.cost !== null)
    ? { basis: "operator-rate-estimate" as const, nanoUsd: results.reduce((sum, result) => sum + BigInt(result.cost?.nanoUsd ?? "0"), 0n).toString(), rateCardSha256: last.cost?.rateCardSha256 ?? "" }
    : null;
  return {
    review: { ...last.review, inputManifestSha256: inventorySha256, status: completed ? "completed" : "failed", verdict, findingCount: findings.length },
    promptSha256: sha256Of(results.map((result) => result.promptSha256).join("\n")),
    responseSha256: completed ? sha256Of(results.map((result) => result.responseSha256).join("\n")) : null,
    providerRequestId: last.providerRequestId,
    returnedModel: last.returnedModel,
    coverage,
    confidence: completed ? Math.min(...results.map((result) => result.confidence ?? 0)) : null,
    findings,
    usage,
    cost,
    visibilityGaps: [...new Set(results.flatMap((result) => result.visibilityGaps))],
    passes,
  };
}
