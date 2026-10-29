import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { base58 } from "@scure/base";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

// Local HTTP transport fixture; no chain, signature, or payment is fabricated as verified.
// This deliberately waits real wall time: the documented Cron limit is 900 seconds.
const budget = Number(process.env.SCAN_BUDGET_MS ?? 900000);
const latency = Number(process.env.SCAN_LATENCY_MS ?? 9400);
const source = resolve(
  process.env.SCAN_SOURCE ?? "workers/payments/scanner.ts",
);
const expectProgress = process.env.SCAN_EXPECT_PROGRESS !== "0";
const folder = await mkdtemp(join(tmpdir(), "slop-scan-budget-"));
const signatures = Array.from({ length: 100 }, (_, i) =>
  base58.encode(new Uint8Array(64).fill(i + 1)),
);
const calls = [];
let completed = 0;
let fastFailure = false;
const rpc = createServer(async (request, response) => {
  const body = [];
  for await (const chunk of request) body.push(chunk);
  const input = JSON.parse(Buffer.concat(body).toString());
  assert.equal(input.method, "getTransaction");
  calls.push(input.params[0]);
  if (fastFailure) {
    response.writeHead(503).end("fixture stop");
    return;
  }
  await sleep(latency);
  completed++;
  if (completed % 10 === 0)
    console.log(
      JSON.stringify({
        completed,
        requests: calls.length,
        at: new Date().toISOString(),
      }),
    );
  response.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        meta: { err: null, innerInstructions: [] },
        transaction: { message: { instructions: [] } },
      },
    }),
  );
});
await new Promise((resolve) => rpc.listen(0, "127.0.0.1", resolve));
const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
let runtime;
let deadline;
try {
  const entry = join(folder, "worker.ts");
  const bundle = join(folder, "worker.mjs");
  await writeFile(
    entry,
    `import {scanSolanaPayments} from ${JSON.stringify(source)};
export default {async fetch(request,env){return new Response(new ReadableStream({async start(controller){
const encoder=new TextEncoder();const heartbeat=setInterval(()=>controller.enqueue(encoder.encode('heartbeat\\n')),30000);
try{await scanSolanaPayments(env.DB,{projectId:'budget-fixture',network:'solana-devnet',vault:'fixture-vault',projectPda:'11111111111111111111111111111111',programId:'11111111111111111111111111111111'},${JSON.stringify(rpcUrl)},async()=>{throw new Error('Unexpected escrow instruction')});controller.enqueue(encoder.encode('complete\\n'));}
catch(error){controller.enqueue(encoder.encode(String(error)+'\\n'));}finally{clearInterval(heartbeat);controller.close();}
}}));}};`,
  );
  const build = spawnSync(
    "bun",
    ["--no-env-file", "build", entry, "--target=browser", "--outfile", bundle],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const script = await readFile(bundle, "utf8");
  const options = () =>
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      modules: true,
      compatibilityDate: "2026-09-14",
      script,
      d1Databases: { DB: "scan-budget" },
      resourcePersistencePath: join(folder, "d1"),
    });
  runtime = new Miniflare(options());
  let db = await runtime.getD1Database("DB");
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlQuery(
      await readFile(join("migrations", name), "utf8"),
    ))
      await db.prepare(sql).run();
  await db
    .prepare("INSERT INTO payment_chain_cursors VALUES(?,?,?,?)")
    .bind(
      "budget-fixture",
      "solana-devnet",
      "preceding-cursor",
      "2026-10-29T00:00:00.000Z",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO payment_solana_scans(project_id,network,generation,until_signature,ready) VALUES(?,?,?,?,1)",
    )
    .bind(
      "budget-fixture",
      "solana-devnet",
      "fixture-generation",
      "preceding-cursor",
    )
    .run();
  await db
    .prepare("INSERT INTO payment_solana_scan_pages VALUES(?,?,?,?,?)")
    .bind(
      "budget-fixture",
      "solana-devnet",
      "fixture-generation",
      0,
      JSON.stringify(signatures.map((signature) => ({ signature, err: null }))),
    )
    .run();
  const start = performance.now();
  console.log(
    JSON.stringify({ started: new Date().toISOString(), budget, latency }),
  );
  const pending = runtime
    .dispatchFetch("http://local/run")
    .then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }))
    .catch((error) => ({ error: String(error) }));
  const outcome = await Promise.race([
    pending,
    new Promise((resolve) => {
      deadline = setTimeout(() => resolve({ deadline: true }), budget);
    }),
  ]);
  clearTimeout(deadline);
  const checkpoint = await db
    .prepare("SELECT position FROM payment_chain_cursors")
    .first();
  const retained = await db
    .prepare(
      "SELECT json_array_length(signatures_json) remaining,signatures_json FROM payment_solana_scan_pages",
    )
    .first();
  console.log(
    JSON.stringify(
      {
        elapsedMs: Math.round(performance.now() - start),
        budget,
        latency,
        requests: calls.length,
        completed,
        outcome,
        checkpoint,
        retained,
        first: calls[0],
      },
      null,
      2,
    ),
  );
  if (outcome.deadline) {
    const expectedFirst = JSON.parse(retained.signatures_json)[0].signature;
    await runtime.dispose();
    runtime = new Miniflare(options());
    db = await runtime.getD1Database("DB");
    fastFailure = true;
    const prior = calls.length;
    await (await runtime.dispatchFetch("http://local/restart")).text();
    assert.equal(calls[prior], expectedFirst);
    console.log(
      JSON.stringify({
        restartFirst: calls[prior],
        replaysOldest: calls[prior] === signatures[0],
      }),
    );
  }
  if (expectProgress) assert.notEqual(checkpoint.position, "preceding-cursor");
  else assert.equal(checkpoint.position, "preceding-cursor");
  console.log(JSON.stringify({ evidenceFolder: folder }));
} finally {
  clearTimeout(deadline);
  await runtime?.dispose();
  rpc.closeAllConnections();
  await new Promise((resolve) => rpc.close(resolve));
}
