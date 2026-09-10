import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CycleActionRequest,
  parseCycleActionRequest,
  prepareCycleAction,
} from "./prepare-cycle-action";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(
  action: CycleActionRequest["action"] = "finalize-allocation",
) {
  const root = await mkdtemp(join(tmpdir(), "cycle-action-"));
  roots.push(root);
  const directory = join(root, "cycles/eliza/2026-07");
  await mkdir(directory, { recursive: true });
  // Adapter fixtures are never represented as approved allocations or payments.
  const source = '{"adapterFixture":true}\n';
  const name =
    action === "finalize-allocation"
      ? "proposal.json"
      : action === "reserve-settlement"
        ? "allocation.json"
        : "execution-plan.json";
  await writeFile(join(directory, name), source);
  const request: CycleActionRequest = {
    action,
    project: "eliza",
    cycle: "2026-07",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    transactionsJson:
      action === "verify-settlement"
        ? '{"adapterFixture":"transaction inputs"}'
        : "",
  };
  return { root, directory, source, request, name };
}
describe("trusted cycle action adapter", () => {
  it("rejects unsupported actions, unbound sources and cross-project/path inputs", () => {
    const env = {
      CYCLE_ACTION: "finalize-allocation",
      CYCLE_PROJECT: "eliza",
      CYCLE_MONTH: "2026-07",
      CYCLE_SOURCE_SHA256: "a".repeat(64),
    };
    expect(parseCycleActionRequest(env).action).toBe("finalize-allocation");
    for (const patch of [
      { CYCLE_ACTION: "broadcast-payment" },
      { CYCLE_PROJECT: "../../other" },
      { CYCLE_PROJECT: "delta-star" },
      { CYCLE_SOURCE_SHA256: "develop" },
      { CYCLE_MONTH: "2026-07; echo unsafe" },
      { CYCLE_TRANSACTIONS_JSON: "{}" },
    ])
      expect(() => parseCycleActionRequest({ ...env, ...patch })).toThrow();
    expect(() =>
      parseCycleActionRequest({ ...env, CYCLE_ACTION: "verify-settlement" }),
    ).toThrow();
  });
  it("binds exact source bytes before invoking any lifecycle CLI", async () => {
    const f = await fixture();
    const run = vi.fn(async () => {});
    await expect(
      prepareCycleAction(
        { ...f.request, sourceSha256: "b".repeat(64) },
        { root: f.root, run },
      ),
    ).rejects.toThrow("hash");
    expect(run).not.toHaveBeenCalled();
    expect(await readFile(join(f.directory, f.name), "utf8")).toBe(f.source);
  });
  it("delegates finalization without a review-time override and retains exact source evidence", async () => {
    const f = await fixture();
    const run = vi.fn(async (script: string) => {
      if (script === "finalize-reward-cycle.ts")
        await writeFile(
          join(f.directory, "allocation.json"),
          '{"adapterOutput":true}\n',
        );
    });
    const result = await prepareCycleAction(f.request, { root: f.root, run });
    expect(run.mock.calls.map((call) => call[0])).toEqual([
      "finalize-reward-cycle.ts",
      "sync-cycle-index.ts",
    ]);
    expect(run).toHaveBeenNthCalledWith(1, "finalize-reward-cycle.ts", [
      "--project",
      "eliza",
      "--cycle",
      "2026-07",
    ]);
    expect(result.newFiles).toEqual(["cycles/eliza/2026-07/allocation.json"]);
    expect(
      await readFile(
        join(f.root, "evidence/cycle-action/proposal.json"),
        "utf8",
      ),
    ).toBe(f.source);
    expect(
      await readFile(join(f.root, "evidence/cycle-action/SHA256SUMS"), "utf8"),
    ).toContain(`${f.request.sourceSha256}  proposal.json`);
    await expect(
      prepareCycleAction(f.request, { root: f.root, run }),
    ).rejects.toThrow("replace");
  });
  it("propagates the existing CLI review/activation refusal without generating an allocation", async () => {
    const f = await fixture();
    const run = vi.fn(async () => {
      throw new Error("Existing lifecycle gate refused finalization");
    });
    await expect(
      prepareCycleAction(f.request, { root: f.root, run }),
    ).rejects.toThrow("lifecycle gate");
    await expect(
      readFile(join(f.directory, "allocation.json")),
    ).rejects.toThrow();
    expect(await readFile(join(f.directory, "proposal.json"), "utf8")).toBe(
      f.source,
    );
  });
  it("passes supplied evidence to the canonical verifier and removes unverified new evidence on failure", async () => {
    const f = await fixture("verify-settlement");
    const run = vi.fn(async (script: string, args: string[]) => {
      expect(script).toBe("verify-settlement.ts");
      expect(args).toEqual(["--project", "eliza", "--cycle", "2026-07"]);
      expect(
        JSON.parse(
          await readFile(join(f.directory, "transactions.json"), "utf8"),
        ),
      ).toEqual(JSON.parse(f.request.transactionsJson));
      throw new Error("Finalized deltas do not reconcile");
    });
    await expect(
      prepareCycleAction(f.request, { root: f.root, run }),
    ).rejects.toThrow("do not reconcile");
    await expect(
      readFile(join(f.directory, "transactions.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(f.directory, "settlement.json")),
    ).rejects.toThrow();
    expect(
      await readFile(join(f.directory, "execution-plan.json"), "utf8"),
    ).toBe(f.source);
  });
  it("refuses to replace previously published transaction evidence", async () => {
    const f = await fixture("verify-settlement");
    const previous = '{"differentPublishedEvidence":true}\n';
    await writeFile(join(f.directory, "transactions.json"), previous);
    const run = vi.fn(async () => {});
    await expect(
      prepareCycleAction(f.request, { root: f.root, run }),
    ).rejects.toThrow("different published");
    expect(run).not.toHaveBeenCalled();
    expect(await readFile(join(f.directory, "transactions.json"), "utf8")).toBe(
      previous,
    );
  });
});

it("refuses an unfunded selected August proposal before running any CLI or freezing zero awards", async () => {
  const f = await fixture();
  const run = vi.fn(async () => {});
  await expect(
    prepareCycleAction(
      { ...f.request, action: "propose", cycle: "2026-08" },
      { root: f.root, run },
    ),
  ).rejects.toThrow(/Payments are disabled|positive canonical cycle funding/);
  expect(run).not.toHaveBeenCalled();
  await expect(
    readFile(join(f.root, "cycles/eliza/2026-08/proposal.json")),
  ).rejects.toThrow();
});

it("does not allow a local snapshot override for finalization or verification", async () => {
  const f = await fixture();
  const run = vi.fn(async () => {});
  await expect(
    prepareCycleAction(f.request, {
      root: f.root,
      snapshotPath: join(f.root, "unrelated-snapshot.json"),
      run,
    }),
  ).rejects.toThrow("only for propose");
  expect(run).not.toHaveBeenCalled();
});

function reservationFixture(sourceSha256: string) {
  return {
    schemaVersion: "1",
    kind: "payment-reservation",
    projectId: "eliza",
    cycleId: "2026-07",
    instrumentId:
      "squads-v4-vault:solana:xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg:0:FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv",
    allocationSha256: sourceSha256,
    policySha256: "a".repeat(64),
    planSha256: "b".repeat(64),
    reservedAt: "2026-08-20T00:00:00.000Z",
    principalMinor: "1000000",
    feeMinor: "10000",
    intentIds: ["pay_adapter_fixture"],
  };
}

it("reservation action appends only the selected allocation to the global ledger and never releases a plan", async () => {
  const f = await fixture("reserve-settlement");
  f.request.transactionsJson = "";
  await mkdir(join(f.root, "funding"));
  const ledger = join(f.root, "funding/payment-reservations.json");
  await writeFile(ledger, "[]\n");
  const run = vi.fn(async (script: string, args: string[]) => {
    expect(script).toBe("prepare-payment-reservation.ts");
    expect(args).toEqual([
      "--project",
      "eliza",
      "--cycle",
      "2026-07",
      "--output",
      join(f.root, "evidence/cycle-action/reservation-candidate.json"),
    ]);
    await writeFile(
      args[5],
      `${JSON.stringify([reservationFixture(f.request.sourceSha256)], null, 2)}\n`,
    );
  });
  const result = await prepareCycleAction(f.request, { root: f.root, run });
  expect(result.newFiles).toEqual([]);
  expect(result).toMatchObject({
    modifiedFiles: ["funding/payment-reservations.json"],
  });
  expect(run).toHaveBeenCalledTimes(1);
  await expect(
    readFile(join(f.directory, "execution-plan.json")),
  ).rejects.toThrow();
  expect(
    await readFile(
      join(f.root, "evidence/cycle-action/payment-reservations-before.json"),
      "utf8",
    ),
  ).toBe("[]\n");
  expect(await readFile(join(f.directory, "allocation.json"), "utf8")).toBe(
    f.source,
  );
});

it.each(["wrong-project", "released-plan"])(
  "reservation action refuses %s output",
  async (kind) => {
    const f = await fixture("reserve-settlement");
    f.request.transactionsJson = "";
    await mkdir(join(f.root, "funding"));
    const ledger = join(f.root, "funding/payment-reservations.json");
    await writeFile(ledger, "[]\n");
    const run = vi.fn(async (_script: string, args: string[]) => {
      const row = reservationFixture(f.request.sourceSha256);
      if (kind === "wrong-project") row.projectId = "asi";
      await writeFile(args[5], `${JSON.stringify([row], null, 2)}\n`);
      if (kind === "released-plan")
        await writeFile(
          join(f.directory, "execution-plan.json"),
          "forbidden adapter output",
        );
    });
    await expect(
      prepareCycleAction(f.request, { root: f.root, run }),
    ).rejects.toThrow(
      kind === "wrong-project" ? "selected allocation" : "must not release",
    );
  },
);
