import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import type { SignerInput } from "../../workers/payment-executor/binding-shared";
import { budgetEvmSigner } from "./budget";
import { openKeeperStore } from "./store";

const address = `0x${"a".repeat(40)}`;
const today = new Date("2026-11-09T12:00:00.000Z");

function input(nonce: number, maximum: bigint): SignerInput {
  return {
    type: "eip1559",
    chainId: 1,
    nonce,
    gas: maximum,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    to: `0x${"b".repeat(40)}`,
    data: "0x",
    value: 0n,
  };
}

test("the keeper's daily liability charges each unresolved nonce once and only today's settlements", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keeper-budget-"));
  const store = openKeeperStore(join(directory, "keeper.sqlite"));
  const { db } = store;
  const row = db.query(
    "INSERT INTO gas(id,day,maximum,transaction_id,actual,settled_day,expiry_evidence) VALUES(?,?,?,?,?,?,?)",
  );
  const group = (nonce: number) => `1:${address}:${nonce}`;
  // Two unresolved same-nonce attempts: only the larger maximum, 8, counts.
  row.run(group(0), "2026-11-08", "5", "0x01", null, null, null);
  row.run(`${group(0)}:r1`, "2026-11-08", "8", "0x02", null, null, null);
  // Expiry observed today keeps its full maximum, 4; yesterday's is released.
  row.run(group(1), "2026-11-08", "4", "0x03", null, "2026-11-09", "expired");
  row.run(group(2), "2026-11-07", "9", "0x04", null, "2026-11-08", "expired");
  // Finalized actuals count only on their settlement day: 2 today, 3 before.
  row.run(group(3), "2026-11-09", "6", "0x05", "2", "2026-11-09", null);
  row.run(group(4), "2026-11-08", "6", "0x06", "3", "2026-11-08", null);
  let signatures = 0;
  const signer = budgetEvmSigner(
    store,
    { perTransaction: "10", perDay: "20", additionalFeeReserve: "0" },
    {
      address,
      async signTransaction() {
        signatures += 1;
        return `0x${signatures.toString(16).padStart(2, "0")}` as Hex;
      },
    },
    { now: () => today },
  );
  // Committed before the new nonce: 8 + 4 + 2 = 14 of the 20 per day.
  await expect(signer.signTransaction(input(5, 7n))).rejects.toThrow(
    "Operator gas budget reached",
  );
  expect(signatures).toBe(0);
  await signer.signTransaction(input(5, 6n));
  expect(signatures).toBe(1);
  // The day is now exactly full; any further positive maximum is refused.
  await expect(signer.signTransaction(input(6, 1n))).rejects.toThrow(
    "Operator gas budget reached",
  );
  expect(
    db.query("SELECT count(*) n FROM gas WHERE id=?").get(group(5)),
  ).toEqual({ n: 1 });
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
