import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";

// Actual scanner, native D1 and public totals handler. RPC facts are synthetic.
let release;
let started;
const held = new Promise((resolve) => {
  release = resolve;
});
const firstStarted = new Promise((resolve) => {
  started = resolve;
});
const pages = [];
let worker;
try {
  let refuse = false;
  worker = await startHandlerWorker({
    d1: "scanner-progress",
    async outbound(request) {
      assert.equal(new URL(request.url).origin, "https://rpc.invalid");
      const { method, params } = await request.json();
      let result;
      if (method === "eth_getBlockByNumber") result = { number: "0x12c" };
      else {
        assert.equal(method, "eth_getLogs");
        pages.push([
          BigInt(params[0].fromBlock).toString(),
          BigInt(params[0].toBlock).toString(),
        ]);
        if (pages.length === 1) {
          started();
          await held;
        }
        result = refuse
          ? [
              {
                topics: [params[0].topics[0][0], `0x${"a".repeat(64)}`],
                transactionHash: `0x${"b".repeat(64)}`,
                logIndex: "0x0",
                blockNumber: "0xc9",
              },
            ]
          : [];
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    },
    entrySource: `
import {scanEvmPayments} from ${JSON.stringify(resolve("workers/payments/scanner.ts"))};
import {handlePaymentsApi} from ${JSON.stringify(resolve("backend/payments/handler.ts"))};
export default {async fetch(request,env) {
  if(new URL(request.url).pathname.startsWith('/api/')) return handlePaymentsApi(request,{db:env.DB});
  try {
    await scanEvmPayments(env.DB,{projectId:'history',network:'base-mainnet',vault:'0x'+'2'.repeat(40),scanPageBlocks:'100'},'https://rpc.invalid',async()=>{throw new Error('fixture index refused')});
    return new Response(null,{status:204});
  } catch { return new Response(null,{status:503}); }
}};`,
  });
  const { runtime, db } = worker;
  await db
    .prepare(
      "INSERT INTO payment_chain_cursors VALUES('history','base-mainnet','0','2026-10-29T00:00:00.000Z')",
    )
    .run();
  const scan = () => runtime.dispatchFetch("https://slop.cash/scan");
  const coverage = async () => {
    const response = await runtime.dispatchFetch(
      "https://slop.cash/api/v1/payments/projects/history/totals",
    );
    assert.equal(response.status, 200);
    return (await response.json()).coverage.completeThrough;
  };
  const delayed = scan();
  await firstStarted;
  assert.equal((await scan()).status, 204);
  assert.equal((await scan()).status, 204);
  assert.equal(await coverage(), "200");
  release();
  assert.equal((await delayed).status, 204);
  // A late completion must not rewind the public finalized-coverage record.
  assert.equal(await coverage(), "200");
  refuse = true;
  assert.equal((await scan()).status, 503);
  assert.equal(await coverage(), "200");
  refuse = false;
  assert.equal((await scan()).status, 204);
  assert.equal(await coverage(), "300");
  assert.equal((await scan()).status, 204);
  assert.deepEqual(pages, [
    ["1", "100"],
    ["1", "100"],
    ["101", "200"],
    ["201", "300"],
    ["201", "300"],
  ]);
  console.log(
    JSON.stringify({
      nativeD1: true,
      publicCoverage: "300",
      overlappingRuns: 3,
      oldCompletionCannotRewind: true,
      failedPageCannotAdvance: true,
      failedPageRetried: true,
      nextPage: pages.at(-1),
      liveChain: false,
    }),
  );
} finally {
  release();
  await worker?.dispose();
}
