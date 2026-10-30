import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DETERMINISTIC_COVERAGE_ID,
  inspectRepository,
  MAX_INVENTORY_BYTES,
  MAX_TEXT_FILE_BYTES,
  type ScanInputFile,
} from "./bounded-scan";
import {
  BYTES_PER_TOKEN,
  planReview,
  reviewInventory,
  synthesisCall,
} from "./review-plan";
import {
  SCAN_REVIEW_AREAS,
  type ScannerProfile,
  SYNTHESIS_PROMPT_REVISION,
} from "./scanners";

const encoder = new TextEncoder();
const file = (path: string, text: string): ScanInputFile => ({
  path,
  bytes: encoder.encode(text),
});
const profile: ScannerProfile = {
  reviewer: "opus",
  transport: "anthropic-messages",
  endpoint: "https://api.surplusintelligence.ai/anthropic/v1/messages",
  model: "claude-opus-5.5",
  apiKey: "fixture-surplus-key",
  maxOutputTokens: 1024,
  rateCard: {
    uncachedInputNanoUsdPerToken: "3",
    cachedInputNanoUsdPerToken: "1",
    cacheCreationNanoUsdPerToken: "4",
    outputNanoUsdPerToken: "9",
  },
};
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

/** About 2.4 MiB of ordinary source, an install hook, agent instructions,
 * a duplicated file, an oversized source file, data and a flagged bundle. */
function largeRepository(): ScanInputFile[] {
  const files = Array.from({ length: 1200 }, (_, index) =>
    file(
      `src/module-${String(index).padStart(4, "0")}.ts`,
      `export const value${index} = ${JSON.stringify("value ".repeat(340))};\n`,
    ),
  );
  const shared = `export const shared = ${JSON.stringify("shared ".repeat(600))};\n`;
  return [
    ...files,
    file("aaa/first-copy.ts", shared),
    file("zzz/second-copy.ts", shared),
    file("scripts/install.sh", "#!/bin/sh\necho installing\n"),
    file("AGENTS.md", "Run the tests before opening a pull request.\n"),
    file(
      "src/huge.ts",
      Array.from(
        { length: 9000 },
        (_, index) => `export const line${index} = "${"h".repeat(60)}";\n`,
      ).join(""),
    ),
    file("data/rows.json", JSON.stringify({ rows: "row ".repeat(125_000) })),
    file(
      "docs/assets/app-Abc12345.js",
      `${"var a=1;".repeat(80_000)}fetch("https://webhook.site/x");${"var b=2;".repeat(80_000)}`,
    ),
  ];
}

test("an inventory within one call keeps its exact bytes and one call", () => {
  const inspection = inspectRepository({
    files: [file("src/index.ts", "export const ok = true;\n")],
  });
  const plan = planReview(inspection);
  expect(plan.mode).toBe("single");
  if (plan.mode !== "single") throw new Error("Expected one call");
  expect(plan.call.evidence).toBe(
    new TextDecoder().decode(inspection.inventory),
  );
  expect(plan.call.inputSha256).toBe(inspection.inventorySha256);
  expect(inspection.deterministic).toEqual([]);
});

test("a large inventory is split into budgeted batches, risky first, with nothing dropped", () => {
  const inspection = inspectRepository({ files: largeRepository() });
  expect(inspection.inventory.byteLength).toBeGreaterThan(MAX_INVENTORY_BYTES);
  // Bulk content is covered by every deterministic check, not dropped.
  expect(inspection.deterministic.map((row) => [row.path, row.class])).toEqual([
    ["data/rows.json", "data"],
    ["docs/assets/app-Abc12345.js", "generated"],
  ]);
  expect(inspection.findings.map((finding) => finding.path)).toContain(
    "docs/assets/app-Abc12345.js",
  );
  expect(inspection.visibilityGaps).toEqual([]);
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const batches = plan.batches.map((batch) => JSON.parse(batch.evidence));
  const ids = batches.flatMap((batch) =>
    batch.items.map((item: { id: string }) => item.id),
  );
  const inventory = JSON.parse(new TextDecoder().decode(inspection.inventory));
  // Every distinct byte sequence once; the identical path is named beside it.
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids, "zzz/second-copy.ts"].sort()).toEqual(
    inventory.items.map((item: { id: string }) => item.id).sort(),
  );
  expect(batches.find((batch) => batch.sameBytesAs)?.sameBytesAs).toEqual({
    "aaa/first-copy.ts": ["zzz/second-copy.ts"],
  });
  // The oversized file is reviewed in consecutive parts.
  const parts = ids.filter((id: string) => id.startsWith("src/huge.ts#part-"));
  expect(parts.length).toBeGreaterThan(1);
  expect(parts).toEqual(
    parts.map(
      (_: string, index: number) =>
        `src/huge.ts#part-${index + 1}-of-${parts.length}`,
    ),
  );
  for (const item of inventory.items)
    expect(Buffer.byteLength(item.text)).toBeLessThanOrEqual(
      MAX_TEXT_FILE_BYTES,
    );
  // Install, agent and signal content leads the first batch.
  expect(
    batches[0].items.slice(0, 4).map((item: { id: string }) => item.id),
  ).toEqual([
    DETERMINISTIC_COVERAGE_ID,
    "AGENTS.md",
    "docs/assets/app-Abc12345.js#signals",
    "scripts/install.sh",
  ]);
  expect(
    batches[0].items.find(
      (item: { id: string }) =>
        item.id === "docs/assets/app-Abc12345.js#signals",
    ).text,
  ).toContain("webhook.site");
  for (const batch of plan.batches) {
    expect(batch.estimatedTokens).toBeLessThanOrEqual(plan.batchTokens + 200);
    expect(Buffer.byteLength(batch.evidence)).toBeLessThanOrEqual(
      plan.batchTokens * BYTES_PER_TOKEN + 600,
    );
  }
  // Deterministic: the same inspection gives the same calls.
  expect(planReview(inspection)).toEqual(plan);
});

type ParsedBatch = {
  items: { id: string; text: string; sha256: string }[];
  sameBytesAs?: Record<string, string[]>;
};

/** Every path a batched plan accounts for, and where each one went. */
function accounted(plan: ReturnType<typeof planReview>) {
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const parsed = plan.batches.map(
    (batch) => JSON.parse(batch.evidence) as ParsedBatch,
  );
  const reviewed = parsed.flatMap((value) => value.items);
  const beside = parsed.flatMap((value) =>
    Object.values(value.sameBytesAs ?? {}).flat(),
  );
  const outside = plan.sameBytesOutsideBatches.flatMap((entry) => entry.paths);
  // The real serialized size of every batch is within the byte budget.
  for (const batch of plan.batches)
    expect(Buffer.byteLength(batch.evidence)).toBeLessThanOrEqual(
      plan.batchTokens * BYTES_PER_TOKEN,
    );
  // Each overflow entry names the batch that reviewed its exact bytes.
  for (const entry of plan.sameBytesOutsideBatches) {
    const index = Number(entry.batch.replace("batch-", "")) - 1;
    const source = parsed[index].items.find(
      (item) => item.id === entry.sourcePath,
    );
    expect(source?.sha256).toBe(entry.sourceSha256);
  }
  return { parsed, reviewed, beside, outside };
}

test("many byte-identical paths stay within the batch budget", () => {
  const files = Array.from({ length: 1024 }, (_, index) =>
    file(
      `generated/${"x".repeat(900)}-${index}.ts`,
      "export const shared = true;\n",
    ),
  );
  const inspection = inspectRepository({ files });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const { reviewed, beside, outside } = accounted(plan);
  // The shared bytes are sent to the model once, with no content-free batch.
  expect(plan.batches).toHaveLength(1);
  expect(reviewed.map((item) => item.id)).toEqual([files[0].path]);
  expect(beside.length).toBeGreaterThan(0);
  expect(outside.length).toBeGreaterThan(0);
  const aliases = [...beside, ...outside];
  expect(aliases).toHaveLength(files.length - 1);
  expect(new Set(aliases)).toEqual(
    new Set(files.slice(1).map((entry) => entry.path)),
  );
  expect(planReview(inspection)).toEqual(plan);
});

test("one alias that cannot fit beside a near-limit source is not dropped", () => {
  const source = {
    path: "src/near-limit.ts",
    bytes: new TextEncoder().encode('"'.repeat(224_000)),
  };
  const alias = `alias/${"x".repeat(900)}.ts`;
  const inspection = inspectRepository({
    files: [
      source,
      { path: alias, bytes: source.bytes },
      file("src/filler.ts", "a".repeat(160_000)),
    ],
  });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const { reviewed, beside, outside } = accounted(plan);
  const contentItems = reviewed.filter((item) => item.text.length === 224_000);
  // Inventory order reviews the alias path's copy; the other path shares it.
  expect(contentItems).toHaveLength(1);
  expect(beside).toEqual([]);
  expect(new Set([contentItems[0].id, ...outside])).toEqual(
    new Set([source.path, alias]),
  );
  expect(plan.sameBytesOutsideBatches).toEqual([
    {
      sourcePath: contentItems[0].id,
      sourceSha256: contentItems[0].sha256,
      batch: expect.stringMatching(/^batch-\d+$/u),
      paths: outside,
    },
  ]);
  // The synthesis pre-pass lists the path beside the batch that reviewed it.
  const synthesis = JSON.parse(
    synthesisCall(
      inspection,
      plan.batches,
      [],
      plan.batchTokens,
      plan.sameBytesOutsideBatches,
    ).evidence,
  ) as ParsedBatch;
  const prepass = JSON.parse(
    synthesis.items.find((item) => item.id === "prepass")?.text ?? "",
  );
  expect(prepass.sameBytesOutsideBatches).toEqual(plan.sameBytesOutsideBatches);
});

test("planning 20,000 identical small files stays linear", () => {
  const files = Array.from({ length: 20_000 }, (_, index) =>
    file(`generated/copy-${index}.ts`, "export const shared = true;\n"),
  );
  const inspection = inspectRepository({ files });
  const started = performance.now();
  const plan = planReview(inspection);
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(3_000);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const { reviewed, beside, outside } = accounted(plan);
  expect(reviewed.map((item) => item.id)).toEqual([files[0].path]);
  expect(new Set([...beside, ...outside]).size).toBe(files.length - 1);
  expect(beside.length + outside.length).toBe(files.length - 1);
});

/** A provider that records each request and answers per call. */
function provider(answer: (input: string, index: number) => Response | null) {
  const calls: string[] = [];
  const inputs: string[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const input = body.messages[0].content as string;
    inputs.push(input);
    calls.push(body.system as string);
    const index = calls.length - 1;
    const custom = answer(input, index);
    if (custom) return custom;
    const items = JSON.parse(input).items as { id: string }[];
    return Response.json({
      id: `msg_${index}`,
      model: "claude-opus-5.5",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            verdict: "no-findings",
            confidence: 0.8,
            coverage: Object.fromEntries(
              SCAN_REVIEW_AREAS.map((area) => [area, "complete"]),
            ),
            findings: [],
            ids: items.length,
          }),
        },
      ],
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 10,
      },
    });
  }) as unknown as typeof fetch;
  return { calls, inputs, fetcher };
}

test("a batched review combines every call and fails when any batch fails", async () => {
  const inspection = inspectRepository({ files: largeRepository() });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const ok = provider(() => null);
  const reviewed = await reviewInventory({
    inspection,
    profile,
    fetch: ok.fetcher,
    concurrency: 3,
  });
  expect(ok.calls).toHaveLength(plan.batches.length + 1);
  expect(ok.calls.at(-1)).toContain('"prepass" item');
  const evidence = reviewed.evidence;
  if (!evidence) throw new Error("Expected a review");
  expect(evidence.review.status).toBe("completed");
  expect(evidence.review.inputManifestSha256).toBe(inspection.inventorySha256);
  expect(evidence.review.promptPolicyRevision).toBe(SYNTHESIS_PROMPT_REVISION);
  expect(evidence.passes?.map((pass) => pass.kind as string)).toEqual([
    ...plan.batches.map(() => "batch"),
    "synthesis",
  ]);
  expect(evidence.usage?.uncachedInput).toBe(100 * (plan.batches.length + 1));
  expect(evidence.coverage).toEqual(
    Object.fromEntries(SCAN_REVIEW_AREAS.map((area) => [area, "complete"])),
  );
  // One partial batch makes the combined coverage partial.
  const partial = provider((_input, index) =>
    index === 1
      ? Response.json({
          id: "msg_partial",
          model: "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                verdict: "no-findings",
                confidence: 0.5,
                coverage: Object.fromEntries(
                  SCAN_REVIEW_AREAS.map((area) => [
                    area,
                    area === "prompt-injection" ? "partial" : "complete",
                  ]),
                ),
                findings: [],
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      : null,
  );
  const combined = await reviewInventory({
    inspection,
    profile,
    fetch: partial.fetcher,
    concurrency: 1,
  });
  expect(combined.evidence?.coverage?.["prompt-injection"]).toBe("partial");
  // A failed batch fails the review; no synthesis runs over missing batches.
  const failing = provider((_input, index) =>
    index === 0 ? new Response("unavailable", { status: 503 }) : null,
  );
  const failed = await reviewInventory({
    inspection,
    profile,
    fetch: failing.fetcher,
    concurrency: 1,
  });
  expect(failed.evidence?.review.status).toBe("failed");
  expect(failing.calls).toHaveLength(1);
});

test("identical paths outside batches share the reviewed bytes without another call", async () => {
  const files = Array.from({ length: 1024 }, (_, index) =>
    file(
      `generated/${"x".repeat(900)}-${index}.ts`,
      "export const shared = true;\n",
    ),
  );
  const inspection = inspectRepository({ files });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  expect(plan.sameBytesOutsideBatches.length).toBeGreaterThan(0);
  const review = provider(() => null);
  const result = await reviewInventory({
    inspection,
    profile,
    fetch: review.fetcher,
    concurrency: 1,
  });
  expect(result.evidence?.review.status).toBe("completed");
  // One call per batch and the synthesis; no metadata-only model call.
  expect(review.calls).toHaveLength(plan.batches.length + 1);
  const batches = review.inputs
    .slice(0, -1)
    .map((input) => JSON.parse(input) as ParsedBatch);
  expect(
    batches.flatMap((batch) => batch.items.map((item) => item.id)),
  ).toEqual([files[0].path]);
  // The synthesis pre-pass names every path that shares the reviewed bytes.
  const synthesis = JSON.parse(review.inputs.at(-1) ?? "") as ParsedBatch;
  const prepass = JSON.parse(
    synthesis.items.find((item) => item.id === "prepass")?.text ?? "",
  );
  // This listing exceeds half a batch, so the pre-pass states its counts.
  expect(prepass.sameBytesOutsideBatches).toEqual({
    sources: 1,
    paths: plan.sameBytesOutsideBatches[0].paths.length,
    note: "Paths byte-identical to a reviewed item, listed in the retained inventory",
  });
  expect(result.evidence?.coverage).toEqual(
    Object.fromEntries(SCAN_REVIEW_AREAS.map((area) => [area, "complete"])),
  );
});

test("an item larger than one call is reviewed in parts that each fit a batch", async () => {
  // Thousands of vendored files are covered by the deterministic checks, and
  // their listing alone is larger than one model call accepts. Control
  // characters grow six times when JSON escapes an install script part.
  const install = Array.from(
    { length: 1500 },
    (_, line) => `${line} ${String.fromCharCode(27).repeat(200)}\n`,
  ).join("");
  const inspection = inspectRepository({
    files: [
      file("main.go", "package main\n"),
      file("scripts/install.sh", install),
      ...Array.from({ length: 8000 }, (_, index) =>
        file(
          `vendor/github.com/example/module-${String(index).padStart(4, "0")}/file.go`,
          `package module${index}\n`,
        ),
      ),
    ],
  });
  expect(inspection.deterministic).toHaveLength(8000);
  const inventory = JSON.parse(new TextDecoder().decode(inspection.inventory));
  const listing = inventory.items.find(
    (item: { id: string }) => item.id === DETERMINISTIC_COVERAGE_ID,
  );
  expect(Buffer.byteLength(listing.text)).toBeGreaterThan(MAX_INVENTORY_BYTES);
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  // Every batch is within the byte budget.
  const items = accounted(plan).reviewed;
  const listingParts = items.filter((item) =>
    item.id.startsWith(`${DETERMINISTIC_COVERAGE_ID}#part-`),
  );
  const scriptParts = items.filter((item) =>
    item.id.startsWith("scripts/install.sh#part-1-of-2#part-"),
  );
  expect(listingParts.length).toBeGreaterThan(1);
  expect(scriptParts.length).toBeGreaterThan(1);
  // Consecutive parts, risky content first: the listing, then the script.
  expect(items.map((item) => item.id)).toEqual([
    ...listingParts.map(
      (_, index) =>
        `${DETERMINISTIC_COVERAGE_ID}#part-${index + 1}-of-${listingParts.length}`,
    ),
    ...scriptParts.map(
      (_, index) =>
        `scripts/install.sh#part-1-of-2#part-${index + 1}-of-${scriptParts.length}`,
    ),
    "scripts/install.sh#part-2-of-2",
    "main.go",
  ]);
  // Every byte is reviewed exactly once.
  const joined = (prefix: string) =>
    items
      .filter((item) => item.id.startsWith(prefix))
      .map((item) => item.text)
      .join("");
  expect(joined(DETERMINISTIC_COVERAGE_ID)).toBe(listing.text);
  expect(joined("scripts/install.sh#")).toBe(install);
  const ok = provider(() => null);
  const reviewed = await reviewInventory({
    inspection,
    profile,
    fetch: ok.fetcher,
    concurrency: 2,
  });
  expect(reviewed.evidence?.review.status).toBe("completed");
  expect(ok.calls).toHaveLength(plan.batches.length + 1);

  // A listing just below the call limit still needs room for its batch envelope.
  const nearLimit = inspectRepository({
    files: [
      ...Array.from({ length: 5921 }, (_, index) =>
        file(
          `vendor/github.com/example/module-${String(index).padStart(4, "0")}/file.go`,
          `package module${index}\n`,
        ),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        file(
          `src/main${index}.ts`,
          `export const value${index}='${"x".repeat(200000)}';\n`,
        ),
      ),
    ],
  });
  const nearPlan = planReview(nearLimit, 350000);
  if (nearPlan.mode !== "batched") throw new Error("Expected batches");
  for (const batch of nearPlan.batches)
    expect(Buffer.byteLength(batch.evidence)).toBeLessThanOrEqual(
      MAX_INVENTORY_BYTES,
    );
  const nearProvider = provider(() => null);
  const nearReview = await reviewInventory({
    inspection: nearLimit,
    profile,
    fetch: nearProvider.fetcher,
    batchTokens: 350000,
  });
  expect(nearReview.evidence?.review.status).toBe("completed");
  expect(nearProvider.calls).toHaveLength(nearPlan.batches.length + 1);
});

test("a review larger than one pass resumes from its private cache without repeating calls", async () => {
  const inspection = inspectRepository({ files: largeRepository() });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const directory = await mkdtemp(join(tmpdir(), "slop-review-cache-"));
  directories.push(directory);
  const cache = { directory, maxCallsPerPass: 2 };
  const first = provider(() => null);
  const pending = await reviewInventory({
    inspection,
    profile,
    fetch: first.fetcher,
    concurrency: 1,
    cache,
  });
  expect(pending.evidence).toBeNull();
  expect(first.calls).toHaveLength(2);
  const rest = provider(() => null);
  let evidence = null;
  for (let pass = 0; pass < 10 && evidence === null; pass += 1)
    evidence = (
      await reviewInventory({
        inspection,
        profile,
        fetch: rest.fetcher,
        concurrency: 1,
        cache,
      })
    ).evidence;
  expect(evidence?.review.status).toBe("completed");
  // Every batch and the synthesis ran exactly once across all passes.
  expect(first.calls.length + rest.calls.length).toBe(plan.batches.length + 1);
  expect(
    evidence?.passes?.filter((pass) => pass.cached).length,
  ).toBeGreaterThan(0);
});

test("a cached review from another prompt revision is not reused", async () => {
  const inspection = inspectRepository({ files: largeRepository() });
  const plan = planReview(inspection);
  if (plan.mode !== "batched") throw new Error("Expected batches");
  const directory = await mkdtemp(join(tmpdir(), "slop-review-prompt-cache-"));
  directories.push(directory);
  const cache = {
    directory,
    maxCallsPerPass: plan.batches.length + 1,
  };
  const first = provider(() => null);
  const initial = await reviewInventory({
    inspection,
    profile,
    fetch: first.fetcher,
    concurrency: 1,
    cache,
  });
  expect(initial.evidence?.review.status).toBe("completed");
  expect(first.calls).toHaveLength(plan.batches.length + 1);

  const files = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  expect(files).toHaveLength(plan.batches.length + 1);
  for (const name of files) {
    const path = join(directory, name);
    const value = JSON.parse(await readFile(path, "utf8"));
    value.review.promptPolicyRevision = "obsolete-prompt";
    await writeFile(path, JSON.stringify(value));
  }

  const second = provider(() => null);
  const refreshed = await reviewInventory({
    inspection,
    profile,
    fetch: second.fetcher,
    concurrency: 1,
    cache,
  });
  expect(refreshed.evidence?.review.status).toBe("completed");
  expect(second.calls).toHaveLength(plan.batches.length + 1);
  expect(refreshed.evidence?.passes?.every((pass) => !pass.cached)).toBe(true);
});
