import { describe, expect, it } from "vitest";
import {
  assertSquadsBindingTransition,
  assertSquadsExecutionBinding,
  canonicalSquadsBinding,
  parseSquadsBindingLedger,
} from "./squads-execution";

const binding = {
  schemaVersion: "1",
  kind: "squads-execution-binding",
  projectId: "eliza",
  cycleId: "2026-09",
  planSha256: "a".repeat(64),
  multisig: "11111111111111111111111111111111",
  vault: "Vote111111111111111111111111111111111111111",
  vaultIndex: 0,
  transactionIndex: "1",
  proposalAccount: "Stake11111111111111111111111111111111111111",
  vaultTransactionAccount: "SysvarRent111111111111111111111111111111111",
};

describe("immutable Squads execution binding", () => {
  it("accepts an append and idempotent readback without changing accepted history", () => {
    const rows = assertSquadsBindingTransition([], [binding]);
    expect(assertSquadsBindingTransition(rows, rows)).toEqual(rows);
    expect(
      parseSquadsBindingLedger(
        new TextEncoder().encode(`${JSON.stringify(rows)}\n`),
      ),
    ).toEqual(rows);
  });
  it.each(["planSha256", "multisig", "vault", "transactionIndex", "projectId"])(
    "rejects rewriting %s",
    (key) => {
      expect(() =>
        assertSquadsBindingTransition(
          [binding],
          [{ ...binding, [key]: key === "transactionIndex" ? "2" : "changed" }],
        ),
      ).toThrow();
    },
  );
  it("rejects deleting history, duplicate plan, and replay under another project", () => {
    expect(() => assertSquadsBindingTransition([binding], [])).toThrow(
      /append-only/,
    );
    expect(() => assertSquadsBindingTransition([], [binding, binding])).toThrow(
      /replay/,
    );
    expect(() =>
      assertSquadsBindingTransition(
        [],
        [binding, { ...binding, projectId: "asi", planSha256: "b".repeat(64) }],
      ),
    ).toThrow(/replay/);
  });
  it.each(["0", "01", "-1", "18446744073709551616", 1])(
    "rejects noncanonical transaction index %s",
    (transactionIndex) => {
      expect(() =>
        assertSquadsExecutionBinding({ ...binding, transactionIndex }),
      ).toThrow();
    },
  );
  it("rejects URL/status assertions and duplicate JSON keys", () => {
    expect(() =>
      assertSquadsExecutionBinding({ ...binding, status: "executed" }),
    ).toThrow();
    const text = `[${canonicalSquadsBinding(binding).replace('"schemaVersion":"1"', '"schemaVersion":"1","schemaVersion":"1"')}]\n`;
    expect(() =>
      parseSquadsBindingLedger(new TextEncoder().encode(text)),
    ).toThrow(/canonical/);
  });
});
