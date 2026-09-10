import { afterEach, describe, expect, it, vi } from "vitest";
import { readExecutionVerification } from "../../../backend/trace/execution-verification";
import {
  assertSquadsExecutionObservation,
  SQUADS_EXECUTION_RPC_AUTHORITIES,
} from "../../../src/lib/squads-execution";
import { verifySquadsExecution } from "../../../src/lib/squads-execution-verifier";
import {
  batchExecutionContext,
  executionContext,
} from "../../../tests/squads-execution-context";

const compiled = vi.hoisted(() => ({
  value: '{"schemaVersion":1,"ledger":[],"contexts":[]}',
}));
vi.mock("../../../src/lib/squads-execution-registry.generated", () => ({
  get SQUADS_EXECUTION_REGISTRY_JSON() {
    return compiled.value;
  },
}));
vi.mock("../../../src/lib/squads-execution-verifier", async (original) => {
  const actual =
    await original<
      typeof import("../../../src/lib/squads-execution-verifier")
    >();
  return {
    ...actual,
    verifySquadsExecution: vi.fn(actual.verifySquadsExecution),
  };
});
async function registry(batch = false) {
  const context = await (batch ? batchExecutionContext() : executionContext());
  compiled.value = JSON.stringify({
    schemaVersion: 1,
    ledger: context.ledger,
    contexts: [
      {
        projectId: "eliza",
        cycleId: "2026-07",
        allocationSha256: context.allocationSha256,
        planSha256: context.ledger[0].planSha256,
        allocationBase64: Buffer.from(context.allocationBytes).toString(
          "base64",
        ),
        planBase64: Buffer.from(context.planBytes).toString("base64"),
      },
    ],
  });
  return context;
}
function request(project = "eliza", cycle = "2026-07", query = "") {
  return readExecutionVerification(
    new Request(
      `https://api.slop.cash/api/v1/projects/${project}/executions/${cycle}${query}`,
    ),
    project,
    cycle,
    async () => null,
  );
}
afterEach(() => {
  vi.mocked(verifySquadsExecution).mockClear();
  vi.unstubAllGlobals();
  compiled.value = '{"schemaVersion":1,"ledger":[],"contexts":[]}';
});
describe("reviewed Squads execution observation API", () => {
  it.each([0, 5, 12])(
    "passes through verified Batch progress %s/12 without payment promotion",
    async (executedChildren) => {
      const context = await registry(true);
      const binding = context.ledger[0];
      const observation = {
        verifier: "squads-execution-v1" as const,
        binding,
        observedAt: "2026-09-10T00:00:00.000Z",
        status: "plan-matched" as const,
        instructionVerification: "verified" as const,
        paymentVerified: false as const,
        retirementVerified: false as const,
        proposalStatus:
          executedChildren === 12
            ? ("executed" as const)
            : ("approved" as const),
        accountEvidence: {
          authorities: [...SQUADS_EXECUTION_RPC_AUTHORITIES.slice(0, 2)],
          slots: [1, 1],
          proposalSha256: "a".repeat(64),
          vaultTransactionSha256: "b".repeat(64),
          tokenAccountsSha256: "c".repeat(64),
          lookupTablesSha256: "d".repeat(64),
        },
        reason: "Exact Batch decoder fixture",
        batchProgress: { totalChildren: 12, executedChildren },
      };
      vi.mocked(verifySquadsExecution).mockResolvedValueOnce(observation);
      const response = await request();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(observation);
      expect(
        assertSquadsExecutionObservation(body, binding).paymentVerified,
      ).toBe(false);
      expect(
        Buffer.from(
          vi.mocked(verifySquadsExecution).mock.calls[0][0].planBytes,
        ),
      ).toEqual(Buffer.from(context.planBytes));
    },
  );
  it("returns unresolved Batch progress as null when the real verifier cannot reach quorum", async () => {
    const context = await registry(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Unavailable");
      }),
    );
    const response = await request();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      instructionVerification: "unverified",
      batchProgress: null,
      paymentVerified: false,
      retirementVerified: false,
      accountEvidence: null,
    });
    expect(
      assertSquadsExecutionObservation(body, context.ledger[0])
        .instructionVerification,
    ).toBe("unverified");
  });
  it("applies admission once to the entire Batch and rejects before child RPC", async () => {
    await registry(true);
    const admit = vi.fn(async () => new Response(null, { status: 429 }));
    const response = await readExecutionVerification(
      new Request(
        "https://api.slop.cash/api/v1/projects/eliza/executions/2026-07",
      ),
      "eliza",
      "2026-07",
      admit,
    );
    expect(response.status).toBe(429);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("never invokes the exact RPC verifier without successful admission", async () => {
    await registry();
    const raw = new Request(
      "https://api.slop.cash/api/v1/projects/eliza/executions/2026-07",
    );
    expect(
      (await readExecutionVerification(raw, "eliza", "2026-07")).status,
    ).toBe(503);
    expect(
      (
        await readExecutionVerification(
          raw,
          "eliza",
          "2026-07",
          async () => new Response(null, { status: 429 }),
        )
      ).status,
    ).toBe(429);
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("returns 404 for an empty reviewed ledger without RPC", async () => {
    expect((await request()).status).toBe(404);
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it.each([
    ["other", "2026-07"],
    ["eliza", "2026-08"],
    ["eliza", "2026-13"],
  ])("rejects foreign project/cycle %s %s", async (project, cycle) => {
    await registry();
    expect((await request(project, cycle)).status).toBe(404);
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("rejects caller URLs and keys", async () => {
    await registry();
    expect(
      (
        await request(
          "eliza",
          "2026-07",
          "?ledger=https://evil.example&proposal=anything",
        )
      ).status,
    ).toBe(400);
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("fails malformed registry or altered bytes closed before RPC", async () => {
    await registry();
    const changed = JSON.parse(compiled.value);
    changed.contexts[0].allocationBase64 = btoa("{}");
    for (const value of ["{}", JSON.stringify(changed)]) {
      compiled.value = value;
      const response = await request();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        instructionVerification: "unverified",
        paymentVerified: false,
        retirementVerified: false,
      });
    }
    expect(verifySquadsExecution).not.toHaveBeenCalled();
  });
  it("runs the real exact verifier and returns unresolved 503 on unavailable quorum", async () => {
    await registry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unavailable");
      }),
    );
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      instructionVerification: "unverified",
      paymentVerified: false,
      retirementVerified: false,
      accountEvidence: null,
    });
  });
  it("passes exact canonical bytes and wraps only the decoder result", async () => {
    const context = await registry();
    vi.mocked(verifySquadsExecution).mockResolvedValueOnce({
      verifier: "squads-execution-v1",
      binding: context.ledger[0],
      observedAt: "2026-09-10T00:00:00.000Z",
      status: "plan-matched",
      instructionVerification: "verified",
      paymentVerified: false,
      retirementVerified: false,
      proposalStatus: "executed",
      accountEvidence: {
        authorities: [...SQUADS_EXECUTION_RPC_AUTHORITIES.slice(0, 2)],
        slots: [1, 1],
        proposalSha256: "a".repeat(64),
        vaultTransactionSha256: "b".repeat(64),
        tokenAccountsSha256: "c".repeat(64),
        lookupTablesSha256: "d".repeat(64),
      },
      reason: "Fixture decoder result",
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const input = vi.mocked(verifySquadsExecution).mock.calls[0][0];
    expect(input.projectId).toBe("eliza");
    expect(input.ledger).toEqual(context.ledger);
    expect(input.baseLedger).toEqual(context.ledger);
    expect(Buffer.from(input.allocationBytes)).toEqual(
      Buffer.from(context.allocationBytes),
    );
    expect(Buffer.from(input.planBytes)).toEqual(
      Buffer.from(context.planBytes),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      binding: context.ledger[0],
      instructionVerification: "verified",
      proposalStatus: "executed",
      paymentVerified: false,
      retirementVerified: false,
    });
    expect(
      assertSquadsExecutionObservation(body, context.ledger[0]).proposalStatus,
    ).toBe("executed");
  });
});
