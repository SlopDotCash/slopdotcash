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
import { BYTES_PER_TOKEN, planReview, reviewInventory } from "./review-plan";
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
  // Every reviewed item exactly once, except identical bytes named beside it.
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

/** A provider that records each request and answers per call. */
function provider(answer: (input: string, index: number) => Response | null) {
  const calls: string[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const input = body.messages[0].content as string;
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
  return { calls, fetcher };
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
