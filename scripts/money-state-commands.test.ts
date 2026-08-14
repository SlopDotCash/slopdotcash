/**
 * Verifies that disabled project payments stop every money-state command
 * before reading an artifact, writing a successor, or reaching Solana.
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
  it("refuses allocation approval while project payments are disabled", async () => {
    const validate = vi.fn(async () => ({ state: "payment-ready" }));
    const write = vi.fn(async () => undefined);
    const arguments_ = parseFinalizeArguments(
      ["--project", "eliza", "--cycle", "2026-07"],
      NOW,
    );

    await expect(
      finalizeRewardCycle(arguments_, { validate, write }),
    ).rejects.toThrow("Payments are disabled for project eliza");
    expect(validate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses settlement planning while project payments are disabled", async () => {
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
    ).rejects.toThrow("Payments are disabled for project eliza");
    expect(validate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses chain verification while project payments are disabled", async () => {
    const validate = vi.fn(async () => ({ state: "payment-ready" }));
    const write = vi.fn(async () => undefined);
    const getTransaction = vi.fn(async () => ({}));
    const arguments_ = parseVerifySettlementArguments(
      ["--project", "eliza", "--cycle", "2026-07"],
      { now: NOW },
    );

    await expect(
      verifySettlement(arguments_, { getTransaction, validate, write }),
    ).rejects.toThrow("Payments are disabled for project eliza");
    expect(validate).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
