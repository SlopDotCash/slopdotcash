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
// Extra cases use the same real scanner and D1. The callback journal records
// invocation order only; it does not pretend to verify a contract receipt.
let scenario = null;
const scenarioPages = [];
let worker;
try {
  let refuse = false;
  worker = await startHandlerWorker({
    d1: "scanner-progress",
    async outbound(request) {
      assert.equal(new URL(request.url).origin, "https://rpc.invalid");
      const { method, params } = await request.json();
      let result;
      if (scenario) {
        if (method === "eth_getTransactionReceipt") {
          result = { status: scenario === "origin-failed" ? "0x0" : "0x1", blockNumber: "0x4" };
        } else if (method === "eth_getBlockByNumber") {
          result = scenario === "head-unavailable" ? null : { number: "0x6" };
        } else {
          assert.equal(method, "eth_getLogs");
          scenarioPages.push([scenario, params[0].fromBlock, params[0].toBlock]);
          const event = (digit, block, index = "0x0") => ({
            topics: [params[0].topics[0][0], `0x${"a".repeat(64)}`],
            transactionHash: `0x${digit.repeat(64)}`, blockNumber: block, logIndex: index,
          });
          const first = event("1", "0x1");
          const second = event("2", "0x2");
          result = scenario === "invalid-array" ? {} :
            scenario === "malformed-sort" ? [first, event("2", "not-a-block")] :
            scenario === "empty" || scenario === "origin" || scenario === "lost-write" ? [] :
            scenario === "duplicate" ? [first, first] :
            scenario === "unexpected" ? [first, { ...second, topics: ["0xwrong"] }] :
            [second, first];
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result });
      }
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
  const query = new URL(request.url).searchParams;
  if(new URL(request.url).pathname === '/scenario') {
    const projectId = query.get('project');
    const fail = query.get('fail');
    const db = query.has('lostWrite') ? {prepare(sql) {
      if(!sql.startsWith('INSERT INTO payment_chain_cursors')) return env.DB.prepare(sql);
      return {bind(...args) { const statement=env.DB.prepare(sql).bind(...args); return {async run() {
        await statement.run(); throw new Error('lost committed cursor reply');
      }}; }};
    }} : env.DB;
    try {
      await scanEvmPayments(db,{
        projectId,network:'base-mainnet',vault:'0x'+'3'.repeat(40),
        scanPageBlocks:query.get('page') ?? '2',
        ...(query.has('origin') ? {deploymentTransaction:'0x'+'4'.repeat(64)} : {})
      },'https://rpc.invalid',async(event)=>{
        const second = event.transactionId === '0x'+'2'.repeat(64);
        if(fail === 'before' && second) throw new Error('second callback refused');
        await env.DB.prepare('INSERT INTO scanner_callback_attempts(project_id,txid) VALUES(?,?)')
          .bind(projectId,event.transactionId).run();
        if(fail === 'after' && second) throw new Error('committed callback reply lost');
      });
      return new Response(null,{status:204});
    } catch { return new Response(null,{status:503}); }
  }
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
  await db.prepare("CREATE TABLE scanner_callback_attempts(sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, txid TEXT NOT NULL)").run();
  const seed = (project, position = "0") => db.prepare(
    "INSERT INTO payment_chain_cursors VALUES(?,'base-mainnet',?,'2026-10-29T00:00:00.000Z')",
  ).bind(project, position).run();
  const invoke = (project, options = "") => runtime.dispatchFetch(
    `https://slop.cash/scenario?project=${project}${options}`,
  );
  const cursor = async (project) => (await db.prepare(
    "SELECT position FROM payment_chain_cursors WHERE project_id=? AND network='base-mainnet'",
  ).bind(project).first())?.position ?? null;
  const attempts = async (project) => (await db.prepare(
    "SELECT txid FROM scanner_callback_attempts WHERE project_id=? ORDER BY sequence",
  ).bind(project).all()).results.map((row) => row.txid[2]);

  scenario = "empty";
  // Invalid configuration refuses before a cursor or RPC origin is used.
  const priorPages = scenarioPages.length;
  assert.equal((await invoke("bad-page", "&page=0")).status, 503);
  assert.equal(await cursor("bad-page"), null);
  assert.equal(scenarioPages.length, priorPages);
  assert.equal((await invoke("missing-origin")).status, 503);
  assert.equal(await cursor("missing-origin"), null);
  scenario = "origin-failed";
  assert.equal((await invoke("failed-origin", "&origin")).status, 503);
  assert.equal(await cursor("failed-origin"), null);
  scenario = "head-unavailable";
  await seed("missing-head");
  assert.equal((await invoke("missing-head")).status, 503);
  assert.equal(await cursor("missing-head"), "0");
  scenario = "origin";
  assert.equal((await invoke("new-origin", "&origin")).status, 204);
  assert.equal(await cursor("new-origin"), "5");
  assert.deepEqual(scenarioPages.at(-1), ["origin", "0x4", "0x5"]);
  scenario = "empty";
  await seed("caught-up", "6");
  const beforeCaughtUp = scenarioPages.length;
  assert.equal((await invoke("caught-up")).status, 204);
  assert.equal(scenarioPages.length, beforeCaughtUp);
  await seed("tail", "4");
  assert.equal((await invoke("tail", "&page=3")).status, 204);
  assert.equal(await cursor("tail"), "6");
  assert.deepEqual(scenarioPages.at(-1), ["empty", "0x5", "0x6"]);
  for (const invalid of ["invalid-array", "malformed-sort"]) {
    scenario = invalid;
    await seed(invalid);
    assert.equal((await invoke(invalid)).status, 503);
    assert.equal(await cursor(invalid), "0");
    assert.deepEqual(await attempts(invalid), []);
  }
  scenario = "ordered";
  await seed("ordered");
  assert.equal((await invoke("ordered")).status, 204);
  assert.deepEqual(await attempts("ordered"), ["1", "2"]);
  assert.equal(await cursor("ordered"), "2");
  scenario = "duplicate";
  await seed("duplicates");
  assert.equal((await invoke("duplicates")).status, 204);
  assert.deepEqual(await attempts("duplicates"), ["1", "1"]);
  scenario = "unexpected";
  await seed("unexpected");
  assert.equal((await invoke("unexpected")).status, 503);
  assert.deepEqual(await attempts("unexpected"), ["1"]);
  assert.equal(await cursor("unexpected"), "0");
  scenario = "partial";
  await seed("partial");
  assert.equal((await invoke("partial", "&fail=before")).status, 503);
  assert.deepEqual(await attempts("partial"), ["1"]);
  assert.equal(await cursor("partial"), "0");
  assert.equal((await invoke("partial")).status, 204);
  assert.deepEqual(await attempts("partial"), ["1", "1", "2"]);
  assert.equal(await cursor("partial"), "2");
  await seed("lost-callback");
  assert.equal((await invoke("lost-callback", "&fail=after")).status, 503);
  assert.deepEqual(await attempts("lost-callback"), ["1", "2"]);
  assert.equal(await cursor("lost-callback"), "0");
  scenario = "lost-write";
  await seed("lost-write");
  assert.equal((await invoke("lost-write", "&lostWrite")).status, 503);
  assert.equal(await cursor("lost-write"), "2");
  assert.equal((await invoke("lost-write")).status, 204);
  assert.equal(await cursor("lost-write"), "4");
  assert.deepEqual(scenarioPages.at(-1), ["lost-write", "0x3", "0x4"]);
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
      callbackAndCursorCases: 15,
    }),
  );
} finally {
  release();
  await worker?.dispose();
}
