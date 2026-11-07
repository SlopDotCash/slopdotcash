import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { budgetEvmSigner } from "./budget";
import { openKeeperStore } from "./store";

const account = privateKeyToAccount(`0x${"7".repeat(64)}`);
const today = "2026-11-05";
const yesterday = "2026-11-04";
const huge = (2n ** 80n).toString();
const cases = [
  {
    name: "old ordinary receipts",
    day: yesterday,
    maximum: "1000000",
    actual: "900000",
    expiry: null,
    error: null,
  },
  {
    name: "today's receipts",
    day: today,
    maximum: "30000",
    actual: "30000",
    expiry: null,
    error: "Operator gas budget reached",
  },
  {
    name: "unknown sends from an earlier day",
    day: yesterday,
    maximum: "30000",
    actual: null,
    expiry: null,
    error: "Operator gas budget reached",
  },
  {
    name: "expiry observed today",
    day: today,
    maximum: "30000",
    actual: null,
    expiry: "{}",
    error: "Operator gas budget reached",
  },
  {
    name: "expiry observed yesterday",
    day: yesterday,
    maximum: "30000",
    actual: null,
    expiry: "{}",
    error: null,
  },
  {
    name: "old native overruns",
    day: yesterday,
    maximum: "10000",
    actual: "60000",
    expiry: null,
    error: "A native charge exceeded its reserve",
  },
  {
    name: "overruns without a receipt day",
    day: null,
    maximum: "10000",
    actual: "60000",
    expiry: null,
    error: "A native charge exceeded its reserve",
  },
  {
    name: "old overruns covered by the current limit",
    day: yesterday,
    maximum: "10000",
    actual: "40000",
    expiry: null,
    error: null,
  },
  {
    name: "overruns above SQLite int64",
    day: yesterday,
    maximum: huge,
    actual: (BigInt(huge) + 1n).toString(),
    expiry: null,
    error: "A native charge exceeded its reserve",
  },
];

for (const scenario of cases) {
  test(`keeper history preserves accounting for ${scenario.name}`, async () => {
    const folder = mkdtempSync(join(tmpdir(), "slop-gas-history-"));
    if (!folder.startsWith(join(tmpdir(), "slop-gas-history-")))
      throw new Error("Unexpected fixture directory");
    const file = join(folder, "keeper.sqlite");
    const store = openKeeperStore(file);
    let calls = 0;
    try {
      store.db
        .query(
          "INSERT INTO gas(id,day,maximum,transaction_id,actual,settled_day,expiry_evidence) VALUES('history',?,?,?,?,?,?)",
        )
        .run(
          yesterday,
          scenario.maximum,
          "fixture",
          scenario.actual,
          scenario.day,
          scenario.expiry,
        );
      const signer = budgetEvmSigner(
        store,
        {
          perTransaction: "50000",
          perDay: "50000",
          additionalFeeReserve: "0",
        },
        {
          address: account.address,
          signTransaction: async (input) => {
            calls++;
            return account.signTransaction(input);
          },
        },
        { now: () => new Date(`${today}T00:00:00Z`) },
      );
      const send = store.journal.transaction(() =>
        signer.signTransaction({
          type: "eip1559",
          chainId: 84532,
          nonce: 0,
          gas: 21000n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          to: account.address,
          data: "0x",
          value: 0n,
        }),
      );
      if (scenario.error) await expect(send).rejects.toThrow(scenario.error);
      else expect(await send).toMatch(/^0x[0-9a-f]+$/);
      expect(calls).toBe(scenario.error ? 0 : 1);
      expect(
        store.db.query("SELECT count(*) n FROM gas WHERE id='history'").get(),
      ).toEqual({ n: 1 });
      expect(
        store.db.query("SELECT count(*) n FROM gas WHERE id!='history'").get(),
      ).toEqual({ n: scenario.error ? 0 : 1 });
    } finally {
      store.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}

test("fee replacements share one reserve without grouping adjacent nonce prefixes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "slop-gas-history-"));
  if (!folder.startsWith(join(tmpdir(), "slop-gas-history-")))
    throw new Error("Unexpected fixture directory");
  const store = openKeeperStore(join(folder, "keeper.sqlite"));
  try {
    const group = `84532:${account.address.toLowerCase()}`;
    store.db
      .query("INSERT INTO gas(id,day,maximum,transaction_id) VALUES(?,?,?,?)")
      .run(`${group}:10`, yesterday, "10000", "another-nonce");
    const signer = budgetEvmSigner(
      store,
      {
        perTransaction: "50000",
        perDay: "60000",
        additionalFeeReserve: "0",
      },
      account,
      { now: () => new Date(`${today}T00:00:00Z`) },
    );
    const input = {
      type: "eip1559" as const,
      chainId: 84532,
      nonce: 1,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      to: account.address,
      data: "0x" as const,
      value: 0n,
    };
    const original = await store.journal.transaction(() =>
      signer.signTransaction(input),
    );
    const replace = signer.signReplacement;
    if (!replace) throw new Error("Replacement signer missing");
    await store.journal.transaction(() =>
      replace({ ...input, maxFeePerGas: 2n }, keccak256(original)),
    );
    expect(store.db.query("SELECT id FROM gas ORDER BY id").all()).toEqual([
      { id: `${group}:1` },
      { id: `${group}:10` },
      { id: `${group}:1:r1` },
    ]);
    await expect(
      store.journal.transaction(() => signer.signTransaction(input)),
    ).rejects.toThrow("Gas reservation conflict");
    await expect(
      store.journal.transaction(() =>
        signer.signTransaction({ ...input, nonce: 2 }),
      ),
    ).rejects.toThrow("Operator gas budget reached");
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
