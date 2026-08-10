/**
 * Verifies that each money-shaped command checks the canonical cycle state
 * before reading an input artifact, writing a successor, or reaching Solana.
 */

import { describe, expect, it, vi } from "vitest";
import {
  finalizeRewardCycle,
  parseFinalizeArguments,
} from "./finalize-reward-cycle";
import {
  parseSettlementPlanArguments,
  prepareSettlementPlan,
} from "./prepare-settlement-plan";
import {
  parseVerifySettlementArguments,
  verifySettlement,
} from "./verify-settlement";

const NOW = "2026-08-20T00:00:00.000Z";

describe("money-state command guards", () => {
  it("approves only a fully verified review cycle", async () => {
    const validate = vi.fn(async () => ({ state: "payment-ready" }));
    const write = vi.fn(async () => undefined);
    const arguments_ = parseFinalizeArguments(
      ["--project", "eliza", "--cycle", "2026-07"],
      NOW,
    );

    await expect(
      finalizeRewardCycle(arguments_, { validate, write }),
    ).rejects.toThrow("Only a fully verified review cycle");
    expect(validate).toHaveBeenCalledWith("eliza", "2026-07");
    expect(write).not.toHaveBeenCalled();
  });

  it("plans transfers only from payment-ready state", async () => {
    const validate = vi.fn(async () => ({ state: "review" }));
    const write = vi.fn(async () => undefined);
    const arguments_ = parseSettlementPlanArguments(
      [
        "--project",
        "eliza",
        "--cycle",
        "2026-07",
        "--source-wallet",
        "11111111111111111111111111111111",
        "--fee-wallet",
        "Vote111111111111111111111111111111111111111",
      ],
      NOW,
    );

    await expect(
      prepareSettlementPlan(arguments_, { validate, write }),
    ).rejects.toThrow("Only a verified approved allocation");
    expect(validate).toHaveBeenCalledWith("eliza", "2026-07");
    expect(write).not.toHaveBeenCalled();
  });

  it("allows pending transaction evidence only at the verifier boundary", async () => {
    const validate = vi.fn(async () => ({ state: "payment-ready" }));
    const write = vi.fn(async () => undefined);
    const getTransaction = vi.fn(async () => ({}));
    const arguments_ = parseVerifySettlementArguments(
      ["--project", "eliza", "--cycle", "2026-07"],
      { now: NOW },
    );

    await expect(
      verifySettlement(arguments_, { getTransaction, validate, write }),
    ).rejects.toThrow("Only a verified execution plan");
    expect(validate).toHaveBeenCalledWith("eliza", "2026-07", {
      allowPendingTransactionEvidence: true,
    });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
