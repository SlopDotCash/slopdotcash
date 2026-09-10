import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSquadsExecutionIndex } from "../src/lib/squads-execution";
import {
  batchExecutionContext,
  executionContext,
} from "../tests/squads-execution-context";
import {
  compileSquadsExecutionRegistry,
  syncSquadsExecutionRegistry,
} from "./sync-squads-execution-registry";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const directory = await mkdtemp(join(tmpdir(), "slop-execution-registry-"));
  roots.push(directory);
  await mkdir(join(directory, "funding/executions"), { recursive: true });
  return directory;
}
async function fixture(batch = false) {
  const directory = await root();
  const context = await (batch ? batchExecutionContext() : executionContext());
  await mkdir(join(directory, "cycles/eliza/2026-07"), { recursive: true });
  await writeFile(
    join(directory, "funding/executions/ledger.json"),
    `${JSON.stringify(context.ledger)}\n`,
  );
  await writeFile(
    join(directory, "cycles/eliza/2026-07/allocation.json"),
    context.allocationBytes,
  );
  await writeFile(
    join(directory, "cycles/eliza/2026-07/execution-plan.json"),
    context.planBytes,
  );
  return { directory, ...context };
}
describe("compiled reviewed execution registry", () => {
  it("preserves one full 55-contributor-plus-fee plan and its 12-child Batch binding", async () => {
    const value = await fixture(true);
    const registry = await compileSquadsExecutionRegistry(value.directory);
    expect(registry.contexts).toHaveLength(1);
    expect(registry.ledger).toEqual(value.ledger);
    const binding = registry.ledger[0];
    if (binding.kind !== "squads-batch-execution-binding")
      throw new Error("Expected batch");
    expect(binding.schemaVersion).toBe("2");
    expect(binding.children).toHaveLength(12);
    expect(binding.children.flatMap((child) => child.transferIndexes)).toEqual(
      Array.from({ length: 56 }, (_, index) => index),
    );
    expect(Buffer.from(registry.contexts[0].planBase64, "base64")).toEqual(
      Buffer.from(value.planBytes),
    );
    await syncSquadsExecutionRegistry(value.directory);
    const index = assertSquadsExecutionIndex(
      JSON.parse(
        await readFile(
          join(value.directory, "public/data/squads-executions.json"),
          "utf8",
        ),
      ),
    );
    expect(index.schemaVersion).toBe(1);
    expect(index.executions[0].binding).toEqual(binding);
  });
  it.each(["hash", "missing-fee"])(
    "refuses a Batch with incorrect child %s",
    async (defect) => {
      const value = await fixture(true);
      const binding = value.ledger[0];
      if (binding.kind !== "squads-batch-execution-binding")
        throw new Error("Expected batch");
      if (defect === "hash") binding.children[0].messageSha256 = "0".repeat(64);
      else binding.children.pop();
      await writeFile(
        join(value.directory, "funding/executions/ledger.json"),
        `${JSON.stringify(value.ledger)}\n`,
      );
      await expect(
        compileSquadsExecutionRegistry(value.directory),
      ).rejects.toThrow();
    },
  );
  it("requires the canonical ledger rather than silently treating a missing file as empty", async () => {
    await expect(
      compileSquadsExecutionRegistry(await root()),
    ).rejects.toThrow();
  });
  it("rejects unrecognized execution authority files", async () => {
    const value = await fixture();
    await writeFile(
      join(value.directory, "funding/executions/alternate.json"),
      "[]\n",
    );
    await expect(
      compileSquadsExecutionRegistry(value.directory),
    ).rejects.toThrow(/canonical ledger/);
  });
  it("generates an empty Worker registry", async () => {
    const directory = await root();
    await writeFile(join(directory, "funding/executions/ledger.json"), "[]\n");
    await syncSquadsExecutionRegistry(directory);
    expect(
      await readFile(
        join(directory, "src/lib/squads-execution-registry.generated.ts"),
        "utf8",
      ),
    ).toContain(JSON.stringify({ schemaVersion: 1, ledger: [], contexts: [] }));
  });
  it("retains exact approved bytes and digests", async () => {
    const value = await fixture();
    const registry = await compileSquadsExecutionRegistry(value.directory);
    expect(
      Buffer.from(registry.contexts[0].allocationBase64, "base64"),
    ).toEqual(Buffer.from(value.allocationBytes));
    expect(registry.contexts[0].allocationSha256).toBe(value.allocationSha256);
    expect(Buffer.from(registry.contexts[0].planBase64, "base64")).toEqual(
      Buffer.from(value.planBytes),
    );
    await syncSquadsExecutionRegistry(value.directory);
    const index = assertSquadsExecutionIndex(
      JSON.parse(
        await readFile(
          join(value.directory, "public/data/squads-executions.json"),
          "utf8",
        ),
      ),
    );
    expect(index.executions[0]).toMatchObject({
      binding: value.ledger[0],
      allocationSha256: value.allocationSha256,
      paymentVerified: false,
      retirementVerified: false,
    });
    expect(
      await readFile(
        join(value.directory, "src/lib/squads-execution-registry.generated.ts"),
        "utf8",
      ),
    ).toContain(JSON.stringify(registry));
  });
  it.each(["allocation.json", "execution-plan.json"])(
    "rejects changed exact bytes in %s",
    async (file) => {
      const value = await fixture();
      const path = join(value.directory, "cycles/eliza/2026-07", file);
      await writeFile(path, `${await readFile(path, "utf8")} `);
      await expect(
        compileSquadsExecutionRegistry(value.directory),
      ).rejects.toThrow();
    },
  );
  it("rejects symlink sources", async () => {
    const value = await fixture();
    const path = join(
      value.directory,
      "cycles/eliza/2026-07/execution-plan.json",
    );
    await rm(path);
    await symlink(
      join(value.directory, "cycles/eliza/2026-07/allocation.json"),
      path,
    );
    await expect(
      compileSquadsExecutionRegistry(value.directory),
    ).rejects.toThrow(/symlink/);
  });
});
