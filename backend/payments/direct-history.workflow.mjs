import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../../scripts/child-environment.mjs";

// Real Pages payment handler, native D1, migrations and an actual session cookie.
// All identities and disclosed payments are synthetic; no chain or provider call.
const directory = await mkdtemp(join(tmpdir(), "slop-direct-history-"));
const when = "2026-10-29T00:00:00.000Z";
const token = "a".repeat(43);
const hash = createHash("sha256").update(token).digest("hex");
let runtime;
let outbound = 0;
try {
  const entry = join(directory, "worker.ts");
  const output = join(directory, "worker.mjs");
  await writeFile(
    entry,
    `import {handlePaymentsApi} from ${JSON.stringify(resolve("backend/payments/handler.ts"))};
export default {fetch(request,env){return handlePaymentsApi(request,{db:env.DB,now:()=>new Date(${JSON.stringify(when)})})}};`,
  );
  const build = spawnSync(
    "bun",
    ["--no-env-file", "build", entry, "--target=browser", "--outfile", output],
    {
      encoding: "utf8",
      env: childEnvironment(),
      timeout: 30_000,
    },
  );
  assert.equal(build.status, 0, build.stderr);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      modules: true,
      compatibilityDate: "2026-09-14",
      script: await readFile(output, "utf8"),
      d1Databases: { DB: "direct-history" },
      outboundService() {
        outbound++;
        return new Response(null, { status: 503 });
      },
    }),
  );
  const db = await runtime.getD1Database("DB");
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.batch(
      splitSqlQuery(await readFile(`migrations/${name}`, "utf8")).map((sql) =>
        db.prepare(sql),
      ),
    );
  await db.batch([
    db
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('MDQ6VXNlcjEyMw==','123','fixture-user',?,1)",
      )
      .bind(when),
    db
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,'MDQ6VXNlcjEyMw==','2027-01-01T00:00:00.000Z')",
      )
      .bind(hash),
  ]);
  const insert = (n, actor = "123", project = "history", amount = "1000000") =>
    db
      .prepare(
        "INSERT INTO payment_direct_transfers VALUES('base-mainnet',?,?, '2026-10',?,'synthetic-node','fixture-user','base',?,?,?,'finalized-fixture','disclosures/synthetic.json',?)",
      )
      .bind(
        `0x${n.toString(16).padStart(64, "0")}`,
        project,
        actor,
        `0x${"2".repeat(40)}`,
        amount,
        when,
        when,
      );
  for (let start = 1; start <= 5000; start += 100)
    await db.batch(
      Array.from({ length: 100 }, (_, index) => insert(start + index)),
    );
  await db.batch([
    insert(5001, "456"),
    insert(5002, "123", "other-history", "2000000"),
  ]);
  const read = (path, paged = true, signedIn = false) =>
    runtime.dispatchFetch(`https://slop.cash/api/v1/payments/${path}`, {
      headers: {
        ...(paged ? { "x-slop-direct-history": "paged" } : {}),
        ...(signedIn ? { cookie: `__Host-slop_points=${token}` } : {}),
      },
    });
  const firstResponse = await read("actors/123/direct-transfers");
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.transfers.length, 100);
  assert.equal(first.total, 5001);
  assert.equal(first.through, 5002);
  // New imported rows cannot change a reader's pinned history or totals.
  await insert(5003, "123", "history", "3000000").run();
  const rows = [...first.transfers];
  let next = first.next;
  let largest = 0;
  while (next !== null) {
    const response = await read(
      `actors/123/direct-transfers?after=${next}&through=${first.through}`,
    );
    assert.equal(response.status, 200);
    const bytes = await response.text();
    largest = Math.max(largest, Buffer.byteLength(bytes));
    const page = JSON.parse(bytes);
    assert.equal(page.total, first.total);
    assert.equal(page.through, first.through);
    assert.ok(page.transfers.length <= 100);
    assert.equal(
      page.totalMicro,
      page.transfers
        .reduce((sum, row) => sum + BigInt(row.amountMicro), 0n)
        .toString(),
    );
    rows.push(...page.transfers);
    next = page.next;
  }
  assert.equal(rows.length, 5001);
  assert.ok(rows.every((row) => row.githubUserId === "123"));
  assert.equal(new Set(rows.map((row) => row.transactionId)).size, rows.length);
  assert.equal(
    rows.reduce((sum, row) => sum + BigInt(row.amountMicro), 0n),
    5002000000n,
  );
  assert.ok(largest < 1_048_576);
  const project = await (
    await read("projects/history/direct-transfers")
  ).json();
  assert.equal(project.total, 5002);
  assert.ok(project.transfers.every((row) => row.projectId === "history"));
  const legacyResponse = await read("actors/123/direct-transfers", false);
  const legacyBytes = await legacyResponse.text();
  assert.ok(Buffer.byteLength(legacyBytes) > 1_048_576);
  const legacy = JSON.parse(legacyBytes);
  assert.equal(legacy.transfers.length, 5002);
  assert.equal(legacy.totalMicro, "5005000000");
  assert.equal(Object.hasOwn(legacy, "next"), false);
  const legacyAccount = await (await read("me", false, true)).json();
  assert.equal(legacyAccount.directTransfers.length, 5002);
  const accountResponse = await read("me", true, true);
  assert.equal(accountResponse.status, 200);
  const account = await accountResponse.json();
  assert.deepEqual(account, {
    ...legacyAccount,
    directTransfers: [],
    directTransfersPaged: true,
  });
  assert.equal((await read("me")).status, 401);
  assert.equal((await read("actors/123/direct-transfers?after=1")).status, 400);
  assert.equal(
    (await read("actors/123/direct-transfers?after=0&through=999999")).status,
    400,
  );
  assert.equal(outbound, 0);
  console.log(
    JSON.stringify({
      nativeD1: true,
      completePinnedRows: rows.length,
      pageMaximum: 100,
      legacyBodyBytes: Buffer.byteLength(legacyBytes),
      largestPageBytes: largest,
      sameAccountFacts: true,
      outboundRequests: outbound,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
