import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { scanEvmPayments } from "./scanner";

test("a wrong-chain empty page cannot consume payment history", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let chain = "0x1";
  globalThis.fetch = (async (_url, init) => {
    const { method } = JSON.parse(String(init?.body));
    methods.push(method);
    const result =
      method === "eth_chainId"
        ? chain
        : method === "eth_getBlockByNumber"
          ? { number: "0xc8" }
          : [];
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  try {
    await db
      .prepare("INSERT INTO payment_chain_cursors VALUES(?,?,?,?)")
      .bind("history", "base-mainnet", "100", "2026-11-04T00:00:00.000Z")
      .run();
    const deployment = {
      projectId: "history",
      network: "base-mainnet",
      vault: `0x${"2".repeat(40)}`,
      chainId: "8453",
      scanPageBlocks: "100",
    };
    const scan = () =>
      scanEvmPayments(db, deployment, "https://rpc.invalid", async () => {});
    await expect(scan()).rejects.toThrow("chain mismatch");
    expect(methods).toEqual(["eth_chainId"]);
    expect(
      await db
        .prepare("SELECT position FROM payment_chain_cursors")
        .first<{ position: string }>(),
    ).toEqual({ position: "100" });
    chain = "0x2105";
    await scan();
    expect(
      await db
        .prepare("SELECT position FROM payment_chain_cursors")
        .first<{ position: string }>(),
    ).toEqual({ position: "200" });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
