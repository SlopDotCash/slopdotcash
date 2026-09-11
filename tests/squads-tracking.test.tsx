import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CycleIndexEntry } from "../src/lib/cycle-index";
import {
  SQUADS_EXECUTION_RPC_AUTHORITIES,
  type SquadsExecutionObservation,
} from "../src/lib/squads-execution";
import { SquadsTracking } from "../src/SquadsTracking";
import {
  batchExecutionContext,
  executionContext,
} from "./squads-execution-context";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(batch = false) {
  const context = batch
    ? await batchExecutionContext()
    : await executionContext();
  const binding = context.ledger[0];
  const published = {
    projectId: binding.projectId,
    cycleId: binding.cycleId,
    allocationSha256: context.allocationSha256,
    planSha256: binding.planSha256,
    binding,
    observationUrl: `https://api.slop.cash/api/v1/projects/${binding.projectId}/executions/${binding.cycleId}`,
    paymentVerified: false,
    retirementVerified: false,
  };
  const observation: SquadsExecutionObservation = {
    verifier: "squads-execution-v1",
    binding,
    observedAt: new Date().toISOString(),
    status: "plan-matched",
    instructionVerification: "verified",
    paymentVerified: false,
    retirementVerified: false,
    proposalStatus: batch ? "approved" : "executed",
    ...(binding.kind === "squads-batch-execution-binding"
      ? {
          batchProgress: {
            totalChildren: binding.children.length,
            executedChildren: 3,
          },
        }
      : {}),
    accountEvidence: {
      authorities: [...SQUADS_EXECUTION_RPC_AUTHORITIES],
      slots: [123, 123, 123],
      proposalSha256: "a".repeat(64),
      vaultTransactionSha256: "b".repeat(64),
      tokenAccountsSha256: "c".repeat(64),
      lookupTablesSha256: "d".repeat(64),
    },
    reason: "Exact plan fixture; settlement unverified.",
  };
  const cycle: CycleIndexEntry = {
    projectId: binding.projectId,
    cycleId: binding.cycleId,
    kind: "monthly-pool",
    state: "settlement-planned",
    generatedAt: "2026-08-01T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    reviewEndsAt: "2026-08-15T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
    settledAt: null,
    reward: {
      currency: "USDC",
      capMinor: "10000000000",
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      paidMinor: "0",
      feeMinor: "10000",
      sharePartsPerMillion: null,
    },
    contributors: [],
    files: {
      sourceSnapshot: { sha256: "a".repeat(64), url: "/source.json" },
      proposal: { sha256: "b".repeat(64), url: "/proposal.json" },
      allocation: { sha256: context.allocationSha256, url: "/allocation.json" },
      executionPlan: {
        sha256: binding.planSha256,
        url: "/execution-plan.json",
      },
      settlement: null,
    },
  };
  return { published, observation, cycle };
}

describe("Squads tracker public contract", () => {
  it("uses the published execution reference and raw live observation without claiming paid, then expires on focus", async () => {
    const { published, observation, cycle } = await fixture();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.cache).toBe("no-store");
      return new Response(
        JSON.stringify(
          url.startsWith("/data/")
            ? { schemaVersion: 1, executions: [published] }
            : observation,
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const listeners = vi.spyOn(window, "addEventListener");
    render(<SquadsTracking cycle={cycle} />);
    expect(
      await screen.findByText("Proposal executed · settlement unverified"),
    ).toBeVisible();
    await waitFor(() =>
      expect(listeners).toHaveBeenCalledWith("focus", expect.any(Function)),
    );
    expect(fetcher.mock.calls[1][0]).toBe(published.observationUrl);
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(Date.parse(observation.observedAt) + 299999);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      screen.getByText("Proposal executed · settlement unverified"),
    ).toBeVisible();
    clock.mockReturnValue(Date.parse(observation.observedAt) + 300000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      screen.getByText("Execution observation stale · refresh required"),
    ).toBeVisible();
  });
  it("expires observations on the interval without a focus event or new fetch", async () => {
    const { published, observation, cycle } = await fixture();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const intervals = vi.spyOn(window, "setInterval");
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.startsWith("/data/")
              ? { schemaVersion: 1, executions: [published] }
              : observation,
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<SquadsTracking cycle={cycle} />);
    await screen.findByText("Proposal executed · settlement unverified");
    await waitFor(() =>
      expect(intervals).toHaveBeenCalledWith(expect.any(Function), 1000),
    );
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse(observation.observedAt) + 300000,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(
      screen.getByText("Execution observation stale · refresh required"),
    ).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("shows partial batch execution without reporting settlement", async () => {
    const { published, observation, cycle } = await fixture(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.startsWith("/data/")
                ? { schemaVersion: 1, executions: [published] }
                : observation,
            ),
          ),
      ),
    );
    render(<SquadsTracking cycle={cycle} />);
    expect(
      await screen.findByText(
        "Batch 3/12 children executed · settlement unverified",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/3 of 12 batch transactions observed as executed/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Batch instructions" }),
    ).toBeVisible();
  });
  it("rejects a foreign allocation digest before calling the live endpoint", async () => {
    const { published, cycle } = await fixture();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            executions: [{ ...published, allocationSha256: "f".repeat(64) }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<SquadsTracking cycle={cycle} />);
    expect(await screen.findByText(/does not match this cycle/)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps missing binding separate from verification failure", async () => {
    const { cycle } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ schemaVersion: 1, executions: [] })),
      ),
    );
    render(<SquadsTracking cycle={cycle} />);
    expect(
      await screen.findByText(
        "No reviewed Squads proposal has been linked to this cycle.",
      ),
    ).toBeVisible();
  });
});
