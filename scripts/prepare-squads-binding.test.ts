import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SQUADS_EXECUTION_RPC_AUTHORITIES,
  type SquadsExecutionBinding,
  type SquadsExecutionObservation,
} from "../src/lib/squads-execution";
import { verifySquadsExecution } from "../src/lib/squads-execution-verifier";
import {
  batchExecutionContext,
  executionContext,
} from "../tests/squads-execution-context";
import {
  assertSquadsBindingRequest,
  prepareSquadsBinding,
  readTrustedBindingBlob,
} from "./prepare-squads-binding";

vi.mock("../src/lib/squads-execution-verifier", async (original) => ({
  ...(await original<object>()),
  verifySquadsExecution: vi.fn(),
}));
const encode = (v: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(v)}\n`);
const request = {
  project: "eliza",
  cycle: "2026-07",
  transaction_index: "1",
  mode: "single",
} as const;
function observation(
  binding: SquadsExecutionBinding,
): SquadsExecutionObservation {
  return {
    verifier: "squads-execution-v1",
    binding,
    observedAt: "2026-09-10T00:00:00.000Z",
    status: "plan-matched",
    instructionVerification: "verified",
    paymentVerified: false,
    retirementVerified: false,
    proposalStatus: "active",
    reason: "Synthetic quorum fixture",
    accountEvidence: {
      authorities: [...SQUADS_EXECUTION_RPC_AUTHORITIES].slice(0, 2),
      slots: [100, 101],
      proposalSha256: "a".repeat(64),
      vaultTransactionSha256: "b".repeat(64),
      tokenAccountsSha256: "c".repeat(64),
      lookupTablesSha256: "d".repeat(64),
    },
    ...(binding.kind === "squads-batch-execution-binding"
      ? {
          batchProgress: {
            totalChildren: binding.children.length,
            executedChildren: 0,
          },
        }
      : {}),
  };
}
beforeEach(() => {
  vi.mocked(verifySquadsExecution).mockReset();
  vi.mocked(verifySquadsExecution).mockImplementation(async (input) =>
    observation(
      (input.ledger as SquadsExecutionBinding[])[
        (input.ledger as SquadsExecutionBinding[]).length - 1
      ],
    ),
  );
});
describe("trusted Squads binding bridge", () => {
  it.each(["0", "01", "-1", "1.0", "18446744073709551616", "$(touch bad)"])(
    "rejects unsafe index %s",
    (transaction_index) => {
      expect(() =>
        assertSquadsBindingRequest({ ...request, transaction_index }),
      ).toThrow();
    },
  );
  it.each([
    { project: "../eliza" },
    { cycle: "2026-13" },
    { mode: "auto" },
    { rpcUrl: "https://attacker.invalid" },
  ])("rejects input outside the bounded contract %j", (patch) => {
    expect(() =>
      assertSquadsBindingRequest({ ...request, ...patch }),
    ).toThrow();
  });
  it("derives single binding exactly and leaves all source bytes unchanged", async () => {
    const c = await executionContext();
    const source = { ...c, ledgerBytes: encode([]) };
    const before = Buffer.from(source.planBytes);
    const result = await prepareSquadsBinding(
      { ...request, transaction_index: c.ledger[0].transactionIndex },
      source,
    );
    expect(result.binding).toEqual(c.ledger[0]);
    expect(JSON.parse(result.candidate)).toEqual([result.binding]);
    expect(Buffer.from(source.planBytes)).toEqual(before);
    expect(result.observation.paymentVerified).toBe(false);
  });
  it("covers all 55 recipients and fee with canonical batch messages", async () => {
    const c = await batchExecutionContext(55);
    const result = await prepareSquadsBinding(
      {
        ...request,
        mode: "batch",
        transaction_index: c.ledger[0].transactionIndex,
      },
      { ...c, ledgerBytes: encode([]) },
    );
    expect(result.binding).toEqual(c.ledger[0]);
  });
  it("rejects replay before calling RPC", async () => {
    const c = await executionContext();
    await expect(
      prepareSquadsBinding(request, { ...c, ledgerBytes: encode(c.ledger) }),
    ).rejects.toThrow();
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("rejects exact allocation-byte hash drift before RPC", async () => {
    const c = await executionContext();
    await expect(
      prepareSquadsBinding(request, {
        ...c,
        allocationBytes: new Uint8Array([...c.allocationBytes, 32]),
        ledgerBytes: encode([]),
      }),
    ).rejects.toThrow();
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("rejects a different project/cycle before RPC", async () => {
    const c = await executionContext();
    await expect(
      prepareSquadsBinding(
        { ...request, cycle: "2026-08" },
        { ...c, ledgerBytes: encode([]) },
      ),
    ).rejects.toThrow();
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("rejects noncanonical source ledger", async () => {
    const c = await executionContext();
    await expect(
      prepareSquadsBinding(request, {
        ...c,
        ledgerBytes: new TextEncoder().encode("[ ]\n"),
      }),
    ).rejects.toThrow();
  });
  it("fails closed on unavailable finalized quorum", async () => {
    const c = await executionContext();
    vi.mocked(verifySquadsExecution).mockImplementation(async (input) => ({
      ...observation((input.ledger as SquadsExecutionBinding[])[0]),
      status: "unverified",
      instructionVerification: "unverified",
      proposalStatus: "unknown",
      accountEvidence: null,
    }));
    await expect(
      prepareSquadsBinding(request, { ...c, ledgerBytes: encode([]) }),
    ).rejects.toThrow(/quorum/);
  });
  it("rejects a verifier result for another binding", async () => {
    const c = await executionContext();
    vi.mocked(verifySquadsExecution).mockImplementation(async (input) => ({
      ...observation((input.ledger as SquadsExecutionBinding[])[0]),
      binding: {
        ...(input.ledger as SquadsExecutionBinding[])[0],
        transactionIndex: "99",
      },
    }));
    await expect(
      prepareSquadsBinding(request, { ...c, ledgerBytes: encode([]) }),
    ).rejects.toThrow();
  });
});

it("preserves an existing binding prefix byte-for-byte", async () => {
  const c = await executionContext();
  const previous = {
    ...c.ledger[0],
    projectId: "other-project",
    cycleId: "2026-06",
    planSha256: "f".repeat(64),
    transactionIndex: "999",
    proposalAccount: "SysvarRent111111111111111111111111111111111",
    vaultTransactionAccount: "SysvarC1ock11111111111111111111111111111111",
  };
  const result = await prepareSquadsBinding(request, {
    ...c,
    ledgerBytes: encode([previous]),
  });
  expect(JSON.parse(result.candidate)[0]).toEqual(previous);
  expect(JSON.parse(result.candidate)).toHaveLength(2);
});
it("rejects proposal allocation before any RPC", async () => {
  const c = await executionContext();
  const allocation = JSON.parse(new TextDecoder().decode(c.allocationBytes));
  allocation.status = "proposal";
  allocation.approvedAt = null;
  await expect(
    prepareSquadsBinding(request, {
      ...c,
      allocationBytes: encode(allocation),
      ledgerBytes: encode([]),
    }),
  ).rejects.toThrow();
  expect(verifySquadsExecution).not.toHaveBeenCalled();
});
it("does not accept a false payment-authority claim from a verifier result", async () => {
  const c = await executionContext();
  vi.mocked(verifySquadsExecution).mockImplementation(
    async (input) =>
      ({
        ...observation((input.ledger as SquadsExecutionBinding[])[0]),
        paymentVerified: true,
      }) as unknown as SquadsExecutionObservation,
  );
  await expect(
    prepareSquadsBinding(request, { ...c, ledgerBytes: encode([]) }),
  ).rejects.toThrow();
});
it("reads exact committed bytes, rejects missing/symlink/executable Git objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "squads-binding-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    await writeFile(join(root, "data.json"), '{"original":true}\n');
    await writeFile(join(root, "executable.json"), "{}\n", { mode: 0o755 });
    await symlink("data.json", join(root, "link.json"));
    git("add", ".");
    git(
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const revision = git("rev-parse", "HEAD");
    await writeFile(join(root, "data.json"), "working changes");
    expect(
      new TextDecoder().decode(
        readTrustedBindingBlob(root, revision, "data.json"),
      ),
    ).toBe('{"original":true}\n');
    for (const path of ["missing.json", "link.json", "executable.json"])
      expect(() => readTrustedBindingBlob(root, revision, path)).toThrow();
    expect(() => readTrustedBindingBlob(root, "HEAD", "data.json")).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
