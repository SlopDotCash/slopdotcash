// Actual metadata-reader regression definitions with local RPC responses.
// They do not execute a provider/chain call or establish chain authenticity.
// Authored without running tests or native/crypto checks in this audit.
import { expect, test } from "bun:test";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../../contracts/solana/token-extensions";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { REWARD_ASSET_NETWORKS, type RewardAssetNetwork } from "../../src/lib/reward-asset.mjs";
import { rpcTokenMetadataReader, TokenMetadataError } from "./token-metadata";

const TOKEN = "0x1111111111111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const URL = "https://rpc.fixture.invalid";
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const dynamicSymbol = (value: string) => {
  const bytes = Buffer.from(value);
  return `0x${word(32n)}${word(BigInt(bytes.length))}${bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0")}`;
};
type RpcInput = { jsonrpc: string; id: number; method: string; params: unknown[] };
function evmFixture(options: {
  chain?: unknown; code?: unknown; decimals?: unknown; symbol?: unknown;
  respond?: (request: RpcInput) => Response | Promise<Response>;
} = {}) {
  const calls: RpcInput[] = [];
  const read = rpcTokenMetadataReader((async (input, init) => {
    expect(String(input)).toBe(URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.signal).toBeDefined();
    const request = JSON.parse(String(init?.body)) as RpcInput;
    expect(request.jsonrpc).toBe("2.0"); expect(request.id).toBe(1);
    calls.push(request);
    if (options.respond) return options.respond(request);
    const result = request.method === "eth_chainId" ? options.chain ?? "0x1"
      : request.method === "eth_getCode" ? options.code ?? "0x6000"
      : (request.params[0] as { data: string }).data === "0x313ce567"
        ? options.decimals ?? `0x${word(18n)}` : options.symbol ?? dynamicSymbol("UNIT");
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch, { ethereum: URL });
  return { read: () => read("ethereum", TOKEN), calls };
}

test.each(["base", "ethereum", "robinhood", "solana"] as RewardAssetNetwork[])(
  "native metadata for %s never calls RPC", async (network) => {
    const read = rpcTokenMetadataReader((async () => { throw new Error("Native asset must not call RPC"); }) as typeof fetch);
    expect(await read(network, REWARD_ASSET_NETWORKS[network].native.address)).toEqual({
      decimals: REWARD_ASSET_NETWORKS[network].native.decimals,
      symbol: REWARD_ASSET_NETWORKS[network].native.symbol,
    });
  },
);

test("EVM metadata follows chain, code, decimals and optional-symbol reads in order", async () => {
  const f = evmFixture();
  expect(await f.read()).toEqual({ decimals: 18, symbol: "UNIT" });
  expect(f.calls.map((request) => request.method)).toEqual(["eth_chainId", "eth_getCode", "eth_call", "eth_call"]);
  expect(f.calls[1].params).toEqual([TOKEN, "latest"]);
  expect(f.calls[2].params).toEqual([{ to: TOKEN, data: "0x313ce567" }, "latest"]);
  expect(f.calls[3].params).toEqual([{ to: TOKEN, data: "0x95d89b41" }, "latest"]);
});

test("a different chain refuses before querying the supplied address", async () => {
  const f = evmFixture({ chain: "0x2" });
  await expect(f.read()).rejects.toBeInstanceOf(TokenMetadataError);
  expect(f.calls).toHaveLength(1);
});

test.each(["0x", "not-bytecode", "0x0", "0xzz", "0X6000", 123])(
  "non-bytecode response %j cannot establish contract existence", async (code) => {
    const f = evmFixture({ code });
    await expect(f.read()).rejects.toBeInstanceOf(TokenMetadataError);
    expect(f.calls).toHaveLength(2);
  },
);

test("nonempty even-length bytecode permits metadata reads regardless of byte value", async () => {
  const f = evmFixture({ code: "0x00FF" });
  expect(await f.read()).toEqual({ decimals: 18, symbol: "UNIT" });
});

test.each([0n, 255n])("uint8 decimals boundary %s is returned by the reader", async (value) => {
  const f = evmFixture({ decimals: `0x${word(value)}` });
  expect((await f.read()).decimals).toBe(Number(value));
});

test.each([`0x${word(256n)}`, "0x12", `0x${"g".repeat(64)}`, 18])(
  "invalid decimals word %j refuses before the optional symbol", async (decimals) => {
    const f = evmFixture({ decimals });
    await expect(f.read()).rejects.toBeInstanceOf(TokenMetadataError);
    expect(f.calls).toHaveLength(3);
  },
);

test("legacy bytes32 symbol removes trailing padding while preserving inner bytes", async () => {
  expect((await evmFixture({ symbol: `0x${Buffer.from("LEGACY").toString("hex").padEnd(64, "0")}` }).read()).symbol).toBe("LEGACY");
  expect((await evmFixture({ symbol: `0x${Buffer.from([76, 0, 71]).toString("hex").padEnd(64, "0")}` }).read()).symbol).toBeNull();
});

test.each([
  "0x123", `0x${"gg".repeat(32)}`, `0x${word(33n)}${word(1n)}41`,
  `0x${word(999999999999999999999n)}${word(1n)}41`,
  `0x${word(32n)}${word(65n)}${"41".repeat(65)}`,
  `0x${word(32n)}${word(4n)}41`, dynamicSymbol("not a symbol"), dynamicSymbol("X".repeat(17)),
])("unreadable optional symbol %j preserves successful decimals", async (symbol) => {
  expect(await evmFixture({ symbol }).read()).toEqual({ decimals: 18, symbol: null });
});

test.each([429, 502])("HTTP %s body is cancelled and remains a retryable failure", async (status) => {
  let cancelled = 0;
  const f = evmFixture({ respond: () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status }) });
  let caught: unknown;
  try { await f.read(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(TokenMetadataError);
  expect((caught as Error).message).toContain(`HTTP ${status}`);
  expect(cancelled).toBe(1);
  expect(f.calls).toHaveLength(1);
});

test("RPC refusal remains the primary error when body cancellation fails", async () => {
  const f = evmFixture({ respond: () => new Response(new ReadableStream({
    cancel() { throw new Error("secondary cancellation failure"); },
  }), { status: 503 }) });
  await expect(f.read()).rejects.toThrow("network RPC returned HTTP 503");
});

test.each([-32603, -32005])("temporary RPC error %s is retryable", async (code) => {
  const f = evmFixture({ respond: () => Response.json({ error: { code } }) });
  let caught: unknown;
  try { await f.read(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(TokenMetadataError);
});

test("other RPC errors and absent results refuse the metadata request", async () => {
  for (const body of [{ error: { code: -32601 } }, {}]) {
    await expect(evmFixture({ respond: () => Response.json(body) }).read()).rejects.toBeInstanceOf(TokenMetadataError);
  }
});

test.each([null, "0x", "not-an-integer"])(
  "malformed JSON/null or chain quantity %j keeps the actual retry classification", async (value) => {
    const f = evmFixture({ respond: () => Response.json(value === null ? null : { result: value }) });
    let caught: unknown;
    try { await f.read(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TokenMetadataError);
    expect(f.calls).toHaveLength(1);
  },
);

test.each([[], true, 1, "primitive"])("top-level RPC value %j refuses without metadata", async (value) => {
  await expect(evmFixture({ respond: () => Response.json(value) }).read()).rejects.toBeInstanceOf(TokenMetadataError);
});

test("oversized required RPC response cancels and refuses without returning metadata", async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
    cancel() { cancelled += 1; },
  }, { highWaterMark: 0 }));
  await expect(evmFixture({ respond: () => response }).read()).rejects.toBeInstanceOf(TokenMetadataError);
  expect(cancelled).toBe(1);
  expect(response.body?.locked).toBe(false);
});

test("an unavailable optional symbol is cancelled but does not reject decimals", async () => {
  let cancelled = 0;
  const f = evmFixture({ respond: (request) => {
    if (request.method === "eth_chainId") return Response.json({ result: "0x1" });
    if (request.method === "eth_getCode") return Response.json({ result: "0x6000" });
    if ((request.params[0] as { data: string }).data === "0x313ce567") return Response.json({ result: `0x${word(18n)}` });
    return new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status: 503 });
  } });
  expect(await f.read()).toEqual({ decimals: 18, symbol: null });
  expect(cancelled).toBe(1);
});

function solanaFixture(options: { genesis?: unknown; owner?: string; data?: Uint8Array; account?: unknown } = {}) {
  const calls: RpcInput[] = [];
  const data = options.data ?? new Uint8Array(82);
  if (!options.data) { data[44] = 9; data[45] = 1; }
  const read = rpcTokenMetadataReader((async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as RpcInput; calls.push(request);
    return Response.json({ result: request.method === "getGenesisHash"
      ? options.genesis ?? ESCROW_NETWORKS["solana-mainnet"].genesisHash
      : { value: options.account === undefined ? { owner: options.owner ?? TOKEN_PROGRAM, data: [Buffer.from(data).toString("base64"), "base64"] } : options.account } });
  }) as typeof fetch, { solana: URL });
  return { read: () => read("solana", MINT), calls };
}

test("Solana pins mainnet genesis then reads finalized mint data", async () => {
  const f = solanaFixture();
  expect(await f.read()).toEqual({ decimals: 9, symbol: null });
  expect(f.calls.map((request) => request.method)).toEqual(["getGenesisHash", "getAccountInfo"]);
  expect(f.calls[1].params).toEqual([MINT, { encoding: "base64", commitment: "finalized" }]);
});

test("wrong Solana genesis refuses before the account read", async () => {
  const f = solanaFixture({ genesis: "another-chain" });
  await expect(f.read()).rejects.toBeInstanceOf(TokenMetadataError);
  expect(f.calls).toHaveLength(1);
});

test.each([null, { owner: "another-program", data: [] }, { owner: TOKEN_PROGRAM, data: ["", "base64"] }])(
  "absent or unsupported mint %j cannot return metadata", async (account) => {
    await expect(solanaFixture({ account }).read()).rejects.toBeInstanceOf(TokenMetadataError);
  },
);

test("the existing Token-2022 authority policy is preserved by the shared reader", async () => {
  const data = new Uint8Array(82); data[44] = 6; data[45] = 1;
  expect(await solanaFixture({ owner: TOKEN_2022_PROGRAM, data }).read()).toEqual({ decimals: 6, symbol: null });
  data[0] = 1;
  await expect(solanaFixture({ owner: TOKEN_2022_PROGRAM, data }).read()).rejects.toBeInstanceOf(TokenMetadataError);
});
