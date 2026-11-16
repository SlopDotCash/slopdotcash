/** Real RPC transport exercises the release readiness proof boundary. */
import { expect, test } from "bun:test";
import { probeRpc } from "./check-payout-readiness";

test("release readiness requires an actual finalized EVM block and exact Solana slot", async () => {
  let evmHead: unknown = {};
  let slot = 1.5;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { method, params } = await request.json();
      if (method === "eth_getBlockByNumber")
        expect(params).toEqual(["finalized", false]);
      if (method === "getSlot")
        expect(params).toEqual([{ commitment: "finalized" }]);
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result:
          method === "eth_chainId"
            ? "0x2105"
            : method === "eth_getBlockByNumber"
              ? evmHead
              : method === "getGenesisHash"
                ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
                : slot,
      });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  try {
    expect(await probeRpc("base-mainnet", url)).toBe("no-finalized-head");
    evmHead = { number: "0x1", hash: null };
    expect(await probeRpc("base-mainnet", url)).toBe("no-finalized-head");
    evmHead = { number: "0x1", hash: `0x${"1".repeat(64)}` };
    expect(await probeRpc("base-mainnet", url)).toBe("finalized");
    expect(await probeRpc("solana-mainnet", url)).toBe("no-finalized-head");
    slot = Number.MAX_SAFE_INTEGER + 1;
    expect(await probeRpc("solana-mainnet", url)).toBe("no-finalized-head");
    slot = 42;
    expect(await probeRpc("solana-mainnet", url)).toBe("finalized");
  } finally {
    server.stop(true);
  }
});
