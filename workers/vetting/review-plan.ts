/**
 * Model review of an inventory of any size (owner decision, 28 October 2026:
 * admission scans have no repository size limit). An inventory within one
 * call's envelope is read by exactly one call, as before. A larger one is
 * split into token-budgeted batches, risky content first and grouped by
 * directory, followed by one repository-level synthesis call over the
 * deterministic pre-pass and every batch result. Nothing is sampled or
 * shortened: every distinct byte sequence is in exactly one batch, every
 * byte-identical path is named beside it or recorded with the plan as sharing
 * its reviewed bytes, and the review is complete only when every call completed.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex as sha256 } from "../../src/lib/sha256";
import {
  DETERMINISTIC_COVERAGE_ID,
  INVENTORY_SCHEMA,
  MAX_INVENTORY_BYTES,
  MAX_INVENTORY_ITEMS,
  type RepositoryInspection,
  surfacesOf,
} from "./bounded-scan";
import {
  type ReviewPass,
  reviewScan,
  SCAN_PROMPT_REVISION,
  SCAN_REVIEW_AREAS,
  type ScannerEvidence,
  type ScannerProfile,
  SYNTHESIS_PROMPT_REVISION,
} from "./scanners";

/** Default input budget of one batch call, in estimated tokens. */
export const DEFAULT_BATCH_TOKENS = 150_000;
/** Conservative estimate for source text; real tokenizers yield fewer tokens. */
export const BYTES_PER_TOKEN = 3;
/** Fixed per-item JSON framing, counted like the single-call envelope. */
const ITEM_OVERHEAD_BYTES = 160;
/** Batch metadata, `sameBytesAs` framing and JSON punctuation. */
const BATCH_OVERHEAD_BYTES = 2_048;
const MAX_BUNDLE_GAPS = 100;

type Item = { id: string; text: string; sha256: string };
type PlannedItem = { item: Item; aliases: string[] };
type Inventory = {
  items: Item[];
  artifacts: unknown[];
  visibilityGaps: string[];
};

export type PlannedCall = {
  evidence: string;
  inputSha256: string;
  items: number;
  estimatedTokens: number;
};
/**
 * Paths byte-identical to a reviewed item that did not fit beside it in its
 * batch. They share that item's reviewed bytes (the same SHA-256), so they are
 * covered by its review without another model call.
 */
export type SameBytesOutsideBatches = {
  sourcePath: string;
  sourceSha256: string;
  batch: string;
  paths: string[];
}[];
export type ReviewPlan =
  | { mode: "single"; call: PlannedCall }
  | {
      mode: "batched";
      batches: PlannedCall[];
      batchTokens: number;
      sameBytesOutsideBatches: SameBytesOutsideBatches;
    };

/** Serialized size, so escaping counts against the budget. */
const itemBytes = (item: Item) =>
  Buffer.byteLength(JSON.stringify(item)) + ITEM_OVERHEAD_BYTES;
const aliasBytes = (id: string, aliases: string[]) =>
  aliases.length === 0
    ? 0
    : Buffer.byteLength(JSON.stringify({ [id]: aliases }));
const plannedItemBytes = ({ item, aliases }: PlannedItem) =>
  itemBytes(item) + aliasBytes(item.id, aliases);
const tokens = (bytes: number) => Math.ceil(bytes / BYTES_PER_TOKEN);
/** A larger input gets more time; an outage still fails as a retry. */
export const callTimeoutMs = (estimatedTokens: number) =>
  Math.min(600_000, 120_000 + estimatedTokens);

function planned(evidence: string, items: number): PlannedCall {
  return {
    evidence,
    inputSha256: sha256(evidence),
    items,
    estimatedTokens: tokens(Buffer.byteLength(evidence)),
  };
}

/** Review order: 0 runs at install, build or agent time, or carries a risk signal. */
function tier(id: string, risky: Set<string>): number {
  if (
    id === DETERMINISTIC_COVERAGE_ID ||
    id.startsWith("execution:") ||
    id.startsWith("slop-skill-template/")
  )
    return 0;
  const path = id.replace(/#(?:part-\d+-of-\d+|signals)$/u, "");
  const lower = path.toLowerCase();
  const surfaces = surfacesOf(path);
  if (
    risky.has(path) ||
    surfaces.includes("installScripts") ||
    surfaces.includes("agentInstructions") ||
    surfaces.includes("manifests") ||
    lower.startsWith(".github/") ||
    /(?:^|\/)(?:dockerfile|containerfile|docker-compose[^/]*\.ya?ml)$/u.test(
      lower,
    )
  )
    return 0;
  if (
    /(?:^|\/)(?:tests?|__tests__|spec|fixtures?|examples?|docs?)\//u.test(
      lower,
    ) ||
    /\.(?:test|spec)\.[^/]+$/u.test(lower) ||
    surfaces.includes("dependencies")
  )
    return 2;
  return 1;
}

/**
 * Splits the inspection's inventory. Deterministic: the same inventory gives
 * the same calls. A single-call inventory keeps its exact bytes.
 */
export function planReview(
  inspection: RepositoryInspection,
  batchTokens = DEFAULT_BATCH_TOKENS,
): ReviewPlan {
  if (!Number.isSafeInteger(batchTokens) || batchTokens < 100_000)
    throw new Error("A batch needs at least 100,000 tokens");
  const evidence = new TextDecoder().decode(inspection.inventory);
  const inventory = JSON.parse(evidence) as Inventory;
  const fits =
    inspection.inventory.byteLength <= MAX_INVENTORY_BYTES &&
    inventory.items.length <= MAX_INVENTORY_ITEMS &&
    inventory.visibilityGaps.length <= MAX_BUNDLE_GAPS &&
    inventory.visibilityGaps.every((gap) => gap.length <= 1000);
  if (fits)
    return { mode: "single", call: planned(evidence, inventory.items.length) };
  const risky = new Set(inspection.riskSignals);
  // Identical bytes are reviewed once. Every other path is named beside the
  // reviewed copy while it fits that copy's batch; the rest are recorded with
  // the plan and the synthesis pre-pass, never sent as content-free batches.
  const first = new Map<string, Item>();
  const sameBytes = new Map<string, string[]>();
  for (const item of inventory.items) {
    const original = first.get(item.sha256);
    if (original === undefined) first.set(item.sha256, item);
    else {
      const aliases = sameBytes.get(original.id);
      if (aliases) aliases.push(item.id);
      else sameBytes.set(original.id, [item.id]);
    }
  }
  const unique = inventory.items.filter(
    (item) => first.get(item.sha256) === item,
  );
  const ordered = unique
    .map((item, position) => ({
      item,
      position,
      // A shared copy is reviewed at the riskiest tier of any of its paths.
      tier: (sameBytes.get(item.id) ?? []).reduce(
        (lowest, id) => Math.min(lowest, tier(id, risky)),
        tier(item.id, risky),
      ),
    }))
    // Stable: within a tier, sorted inventory order groups each directory
    // and keeps every part of a file consecutive.
    .sort((a, b) => a.tier - b.tier || a.position - b.position)
    .map((entry) => entry.item);
  const limit = Math.min(batchTokens * BYTES_PER_TOKEN, MAX_INVENTORY_BYTES);
  const batchEvidence = (
    index: number,
    count: number,
    items: Item[],
    aliases: Record<string, string[]>,
  ) =>
    JSON.stringify({
      schemaVersion: INVENTORY_SCHEMA,
      batch: {
        index,
        count,
        inventorySha256: inspection.inventorySha256,
        note: "One batch of a repository review; coverage refers to the supplied items. A repository-level synthesis follows.",
      },
      items,
      ...(Object.keys(aliases).length > 0 ? { sameBytesAs: aliases } : {}),
      artifacts: [],
      visibilityGaps: [],
    });
  /**
   * The aliases that fit beside `item` in its own batch, measured exactly and
   * in linear time: the serialized batch with an empty alias list (at the
   * widest index and count), plus each alias's JSON bytes and its comma.
   */
  const fittedAliases = (item: Item, aliases: string[]): string[] => {
    let size = Buffer.byteLength(
      batchEvidence(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, [item], {
        [item.id]: [],
      }),
    );
    let fitted = 0;
    for (const alias of aliases) {
      size += Buffer.byteLength(JSON.stringify(alias)) + (fitted > 0 ? 1 : 0);
      if (size > limit) break;
      fitted += 1;
    }
    return aliases.slice(0, fitted);
  };
  const groups: PlannedItem[][] = [];
  const outside: { item: Item; group: number; paths: string[] }[] = [];
  let current: PlannedItem[] = [];
  let bytes = BATCH_OVERHEAD_BYTES;
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    bytes = BATCH_OVERHEAD_BYTES;
  };
  for (const item of ordered) {
    const aliases = sameBytes.get(item.id) ?? [];
    const fitted = aliases.length > 0 ? fittedAliases(item, aliases) : aliases;
    if (fitted.length < aliases.length) {
      // The reviewed copy fills its own batch; the remaining identical paths
      // share its reviewed bytes and are recorded outside the model batches.
      flush();
      groups.push([{ item, aliases: fitted }]);
      outside.push({
        item,
        group: groups.length,
        paths: aliases.slice(fitted.length),
      });
      continue;
    }
    const plannedItem: PlannedItem = { item, aliases };
    const size = plannedItemBytes(plannedItem);
    if (
      current.length > 0 &&
      (bytes + size > limit || current.length >= MAX_INVENTORY_ITEMS)
    )
      flush();
    current.push(plannedItem);
    bytes += size;
  }
  flush();
  const batches = groups.map((plannedItems, index) => {
    const items = plannedItems.map(({ item }) => item);
    const aliases = Object.fromEntries(
      plannedItems
        .filter(({ aliases }) => aliases.length > 0)
        .map(({ item, aliases }) => [item.id, aliases]),
    );
    return planned(
      batchEvidence(index + 1, groups.length, items, aliases),
      items.length,
    );
  });
  const sameBytesOutsideBatches = outside.map(({ item, group, paths }) => ({
    sourcePath: item.id,
    sourceSha256: item.sha256,
    batch: `batch-${group}`,
    paths,
  }));
  return { mode: "batched", batches, batchTokens, sameBytesOutsideBatches };
}

const RANK = { "no-findings": 0, findings: 1, "malicious-suspected": 2 };
const COVERAGE_RANK = { complete: 0, partial: 1, missing: 2 } as const;

/** The synthesis input: the pre-pass report and every batch result. */
export function synthesisCall(
  inspection: RepositoryInspection,
  batches: PlannedCall[],
  results: ScannerEvidence[],
  batchTokens: number,
  sameBytesOutsideBatches: SameBytesOutsideBatches = [],
): PlannedCall {
  const inventory = JSON.parse(
    new TextDecoder().decode(inspection.inventory),
  ) as Inventory;
  const listing = (full: boolean) => ({
    inventorySha256: inspection.inventorySha256,
    coverage: inspection.coverage,
    checks: inspection.checks,
    findings: inspection.findings,
    artifacts: inspection.artifacts.map((artifact) => ({
      path: artifact.path,
      type: artifact.type,
      sha256: artifact.sha256,
    })),
    downloads: inspection.downloads,
    riskSignals: inspection.riskSignals,
    visibilityGaps: inspection.visibilityGaps,
    batches: batches.map((batch, index) => ({
      id: `batch-${index + 1}`,
      items: full
        ? (JSON.parse(batch.evidence) as Inventory).items.map((item) => item.id)
        : batch.items,
    })),
    // Identical paths that did not fit beside their reviewed copy; each one
    // shares the bytes reviewed in the named batch.
    ...(sameBytesOutsideBatches.length > 0
      ? {
          sameBytesOutsideBatches: full
            ? sameBytesOutsideBatches
            : {
                sources: sameBytesOutsideBatches.length,
                paths: sameBytesOutsideBatches.reduce(
                  (sum, entry) => sum + entry.paths.length,
                  0,
                ),
                note: "Paths byte-identical to a reviewed item, listed in the retained inventory",
              },
        }
      : {}),
    deterministicOnly: {
      count: inspection.deterministic.length,
      bytes: inspection.deterministic.reduce((sum, row) => sum + row.bytes, 0),
      files: full
        ? inspection.deterministic
        : `${inspection.deterministic.length} files listed in the retained inventory`,
    },
  });
  // The full listing when it fits half a batch; otherwise counts, stated as such.
  let prepass = JSON.stringify(listing(true));
  if (Buffer.byteLength(prepass) > (batchTokens * BYTES_PER_TOKEN) / 2)
    prepass = JSON.stringify(listing(false));
  const gaps = inventory.visibilityGaps.map((gap) => gap.slice(0, 1000));
  const bundleGaps =
    gaps.length > MAX_BUNDLE_GAPS
      ? [
          ...gaps.slice(0, MAX_BUNDLE_GAPS - 1),
          `${gaps.length - MAX_BUNDLE_GAPS + 1} further visibility gaps are listed in the prepass item`,
        ]
      : gaps;
  const items = [
    { id: "prepass", text: prepass },
    ...results.map((result, index) => ({
      id: `batch-${index + 1}`,
      text: JSON.stringify({
        verdict: result.review.verdict,
        confidence: result.confidence,
        coverage: result.coverage,
        findings: result.findings,
      }),
    })),
  ].map((item) => ({ ...item, sha256: sha256(item.text) }));
  return planned(
    JSON.stringify({
      schemaVersion: INVENTORY_SCHEMA,
      synthesis: { inventorySha256: inspection.inventorySha256 },
      items,
      artifacts: [],
      visibilityGaps: bundleGaps,
    }),
    items.length,
  );
}

/** Optional operator-private store that lets a long review resume next pass. */
export type ReviewCache = { directory: string; maxCallsPerPass: number };

const promptRevision = (kind: ReviewPass["kind"]) =>
  kind === "synthesis" ? SYNTHESIS_PROMPT_REVISION : SCAN_PROMPT_REVISION;

async function cached(
  cache: ReviewCache | undefined,
  key: string,
  call: PlannedCall,
  profile: ScannerProfile,
  kind: ReviewPass["kind"],
): Promise<ScannerEvidence | null> {
  if (!cache) return null;
  try {
    const value = JSON.parse(
      await readFile(join(cache.directory, `${key}.json`), "utf8"),
    ) as ScannerEvidence;
    return value.review.status === "completed" &&
      value.review.inputManifestSha256 === call.inputSha256 &&
      value.review.model === profile.model &&
      value.review.reviewer === profile.reviewer &&
      value.review.promptPolicyRevision === promptRevision(kind)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function store(
  cache: ReviewCache | undefined,
  key: string,
  evidence: ScannerEvidence,
) {
  if (!cache || evidence.review.status !== "completed") return;
  await mkdir(cache.directory, { recursive: true, mode: 0o700 });
  const target = join(cache.directory, `${key}.json`);
  await writeFile(`${target}.tmp`, JSON.stringify(evidence), { mode: 0o600 });
  await rename(`${target}.tmp`, target);
}

function combine(
  inventorySha256: string,
  results: ScannerEvidence[],
  passes: ReviewPass[],
): ScannerEvidence {
  const last = results[results.length - 1];
  const completed = results.every((r) => r.review.status === "completed");
  const coverage = completed
    ? (Object.fromEntries(
        SCAN_REVIEW_AREAS.map((area) => [
          area,
          results
            .map((r) => r.coverage?.[area] ?? "missing")
            .reduce((worst, state) =>
              COVERAGE_RANK[state] > COVERAGE_RANK[worst] ? state : worst,
            ),
        ]),
      ) as ScannerEvidence["coverage"])
    : null;
  const verdict = completed
    ? results
        .map((r) => r.review.verdict ?? "no-findings")
        .reduce((worst, value) => (RANK[value] > RANK[worst] ? value : worst))
    : null;
  const findings = completed ? results.flatMap((r) => r.findings) : [];
  const usage = results.every((r) => r.usage)
    ? results.reduce(
        (sum, r) => ({
          uncachedInput: sum.uncachedInput + (r.usage?.uncachedInput ?? 0),
          cachedInput: sum.cachedInput + (r.usage?.cachedInput ?? 0),
          cacheCreation: sum.cacheCreation + (r.usage?.cacheCreation ?? 0),
          output: sum.output + (r.usage?.output ?? 0),
        }),
        { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 },
      )
    : null;
  const cost = results.every((r) => r.cost)
    ? {
        basis: "operator-rate-estimate" as const,
        nanoUsd: results
          .reduce((sum, r) => sum + BigInt(r.cost?.nanoUsd ?? "0"), 0n)
          .toString(),
        rateCardSha256: last.cost?.rateCardSha256 ?? "",
      }
    : null;
  return {
    review: {
      ...last.review,
      inputManifestSha256: inventorySha256,
      status: completed ? "completed" : "failed",
      verdict,
      findingCount: findings.length,
    },
    promptSha256: sha256(results.map((r) => r.promptSha256).join("\n")),
    responseSha256: completed
      ? sha256(results.map((r) => r.responseSha256).join("\n"))
      : null,
    providerRequestId: last.providerRequestId,
    returnedModel: last.returnedModel,
    coverage,
    confidence: completed
      ? Math.min(...results.map((r) => r.confidence ?? 0))
      : null,
    findings,
    usage,
    cost,
    visibilityGaps: [...new Set(results.flatMap((r) => r.visibilityGaps))],
    passes,
  };
}

/**
 * Reviews the whole inventory with one profile. `pending` means the optional
 * cache's per-pass call budget ran out before every call completed; the
 * completed calls are kept and the next pass continues. A failed call fails
 * the review, never shortens it.
 */
export async function reviewInventory(input: {
  inspection: RepositoryInspection;
  profile: ScannerProfile;
  fetch?: typeof fetch;
  batchTokens?: number;
  concurrency?: number;
  cache?: ReviewCache;
}): Promise<{ evidence: ScannerEvidence | null; plan: ReviewPlan }> {
  const { inspection, profile } = input;
  const plan = planReview(inspection, input.batchTokens);
  if (plan.mode === "single")
    return {
      plan,
      evidence: await reviewScan({
        evidence: plan.call.evidence,
        inputSha256: plan.call.inputSha256,
        profile,
        fetch: input.fetch,
        timeoutMs: callTimeoutMs(plan.call.estimatedTokens),
      }),
    };
  const key = (call: PlannedCall, kind: ReviewPass["kind"]) =>
    sha256(
      JSON.stringify([
        profile.endpoint,
        profile.model,
        profile.reviewer,
        kind,
        promptRevision(kind),
        call.inputSha256,
      ]),
    );
  let budget = input.cache?.maxCallsPerPass ?? Number.POSITIVE_INFINITY;
  let exhausted = false;
  const run = async (
    call: PlannedCall,
    kind: ReviewPass["kind"],
  ): Promise<{ evidence: ScannerEvidence; cached: boolean } | null> => {
    const id = key(call, kind);
    const hit = await cached(input.cache, id, call, profile, kind);
    if (hit) return { evidence: hit, cached: true };
    if (budget <= 0) {
      exhausted = true;
      return null;
    }
    budget -= 1;
    const evidence = await reviewScan({
      evidence: call.evidence,
      inputSha256: call.inputSha256,
      profile,
      fetch: input.fetch,
      synthesis: kind === "synthesis",
      timeoutMs: callTimeoutMs(call.estimatedTokens),
    });
    await store(input.cache, id, evidence);
    return { evidence, cached: false };
  };
  const outcomes: ({ evidence: ScannerEvidence; cached: boolean } | null)[] =
    new Array(plan.batches.length).fill(null);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < plan.batches.length) {
      const index = next++;
      const outcome = await run(plan.batches[index], "batch");
      outcomes[index] = outcome;
      if (outcome && outcome.evidence.review.status !== "completed")
        failed = true;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(input.concurrency ?? 4, 16)) },
      worker,
    ),
  );
  const pass = (
    kind: ReviewPass["kind"],
    index: number,
    call: PlannedCall,
    outcome: { evidence: ScannerEvidence; cached: boolean },
  ): ReviewPass => ({
    kind,
    index,
    inputSha256: call.inputSha256,
    items: call.items,
    estimatedTokens: call.estimatedTokens,
    runId: outcome.evidence.review.runId,
    status: outcome.evidence.review.status,
    verdict: outcome.evidence.review.verdict,
    providerRequestId: outcome.evidence.providerRequestId,
    responseSha256: outcome.evidence.responseSha256,
    usage: outcome.evidence.usage,
    cached: outcome.cached,
  });
  const done = outcomes.filter((outcome) => outcome !== null);
  if (failed) {
    const first = done.find((o) => o.evidence.review.status !== "completed");
    return { plan, evidence: first?.evidence ?? null };
  }
  if (exhausted || done.length !== plan.batches.length)
    return { plan, evidence: null };
  const results = done.map((outcome) => outcome.evidence);
  const synthesis = synthesisCall(
    inspection,
    plan.batches,
    results,
    plan.batchTokens,
    plan.sameBytesOutsideBatches,
  );
  const final = await run(synthesis, "synthesis");
  if (!final) return { plan, evidence: null };
  if (final.evidence.review.status !== "completed")
    return { plan, evidence: final.evidence };
  return {
    plan,
    evidence: combine(
      inspection.inventorySha256,
      [...results, final.evidence],
      [
        ...done.map((outcome, index) =>
          pass("batch", index + 1, plan.batches[index], outcome),
        ),
        pass("synthesis", plan.batches.length + 1, synthesis, final),
      ],
    ),
  };
}
