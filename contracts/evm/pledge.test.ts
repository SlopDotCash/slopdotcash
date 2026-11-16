import { afterEach, describe, expect, test } from "bun:test";
import { EvmRpcError, readEvmMonthPledges } from "./adapter";

const VAULT = "0x4f891b8c3d3fab9150fcdc94176b96863cd02899";
const RPC = "https://rpc.invalid";
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const realFetch = globalThis.fetch;

type Call = { method: string; params: unknown[] };
/** Answers each JSON-RPC call from `answer`, recording every call made. */
function serve(answer: (call: Call) => object) {
  const calls: Call[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const call = JSON.parse(String(init?.body)) as Call;
    calls.push(call);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, ...answer(call) }),
    );
  }) as typeof fetch;
  return calls;
}
const block = { result: { number: "0x1234", timestamp: "0x1" } };
const code = { result: "0x6080" };

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("readEvmMonthPledges", () => {
  test("a revert with no data field, as mainnet.base.org answers, means no pledge support", async () => {
    serve(({ method }) =>
      method === "eth_getBlockByNumber"
        ? block
        : method === "eth_getCode"
          ? code
          : { error: { code: 3, message: "execution reverted" } },
    );
    expect(
      await readEvmMonthPledges({
        rpcUrl: RPC,
        vault: VAULT,
        periods: [202611],
      }),
    ).toBeNull();
  });

  test("a revert with empty data also means no pledge support", async () => {
    serve(({ method }) =>
      method === "eth_getBlockByNumber"
        ? block
        : method === "eth_getCode"
          ? code
          : { error: { code: 3, message: "execution reverted", data: "0x" } },
    );
    expect(
      await readEvmMonthPledges({ rpcUrl: RPC, vault: VAULT, periods: [] }),
    ).toBeNull();
  });

  test("a revert that carries data is an error, not missing support", async () => {
    serve(({ method }) =>
      method === "eth_getBlockByNumber"
        ? block
        : method === "eth_getCode"
          ? code
          : {
              error: {
                code: 3,
                message: "execution reverted",
                data: "0x498acb6b",
              },
            },
    );
    const read = readEvmMonthPledges({
      rpcUrl: RPC,
      vault: VAULT,
      periods: [],
    });
    await expect(read).rejects.toBeInstanceOf(EvmRpcError);
    await expect(read).rejects.toMatchObject({ emptyRevert: false });
  });

  test("an address with no code reads as no pledge support", async () => {
    const calls = serve(({ method }) =>
      method === "eth_getBlockByNumber" ? block : { result: "0x" },
    );
    expect(
      await readEvmMonthPledges({
        rpcUrl: RPC,
        vault: VAULT,
        periods: [202611],
      }),
    ).toBeNull();
    expect(calls.map((call) => call.method)).toEqual([
      "eth_getBlockByNumber",
      "eth_getCode",
    ]);
  });

  test("a provider failure is never read as missing support", async () => {
    globalThis.fetch = (async () =>
      new Response("busy", { status: 503 })) as unknown as typeof fetch;
    await expect(
      readEvmMonthPledges({ rpcUrl: RPC, vault: VAULT, periods: [] }),
    ).rejects.toMatchObject({ emptyRevert: false });
  });

  test("reads every value at the one pinned finalized block", async () => {
    const calls = serve(({ method, params }) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getCode") return code;
      const data = (params[0] as { data: string }).data;
      if (data.endsWith(word(202612n)))
        return { result: `0x${word(5n)}${word(1n)}` };
      if (data.endsWith(word(202611n)))
        return { result: `0x${word(7n)}${word(0n)}` };
      return { result: `0x${word(5n)}` };
    });
    expect(
      await readEvmMonthPledges({
        rpcUrl: RPC,
        vault: VAULT,
        periods: [202611, 202612],
      }),
    ).toEqual({
      openPledgedGross: 5n,
      pledges: [
        { period: 202611, amount: 7n, open: false },
        { period: 202612, amount: 5n, open: true },
      ],
    });
    expect(calls[0].params).toEqual(["finalized", false]);
    for (const call of calls.slice(1))
      expect(call.params.at(-1)).toBe("0x1234");
  });
});
