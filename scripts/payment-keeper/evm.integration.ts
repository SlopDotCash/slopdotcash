/** Actual Anvil + SQLite + public HTTP workflow. No live keys, RPCs or funds. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildBindCalldata,
  buildCommitAwardCalldata,
  buildCreateVaultCalldata,
  buildDepositCalldata,
  buildSetMonthlyCommitmentCalldata,
  evmAllocationRoot,
  evmAwardId,
  evmBindingTypedData,
  evmMonthlyDigest,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { cloudflareKeeperRuntime } from "../../tests/cloudflare-keeper-runtime.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import { rpc } from "./budget";
import { type KeeperConfiguration, runKeeper } from "./keeper";
import { openKeeperStore } from "./store";

const root = resolve(import.meta.dir, "../..");
const port = process.env.SLOP_KEEPER_TEST_PORT ?? "28550";
const url = `http://127.0.0.1:${port}`;
const useCloudflare = process.env.SLOP_KEEPER_RUNTIME === "cloudflare";
const directory = mkdtempSync(join(tmpdir(), "slop-keeper-e2e-"));
const anvil = spawn(
  "anvil",
  ["--host", "127.0.0.1", "--port", port, "--chain-id", "11155111", "--silent"],
  { stdio: "ignore" },
);
const keeperKey = generatePrivateKey();
const keeper = privateKeyToAccount(keeperKey);
const attester = privateKeyToAccount(generatePrivateKey());
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
let lose = false;
// Latest-block reads to pass before one transient failure; -1 disables it.
let latestBlockFailsAfter = -1;
let signatures = 0;
let broadcasts = 0;
let forwardedBroadcasts = 0;
let holdBroadcast:
  | { reached(raw: Hex): void; response: Promise<Response> }
  | undefined;
const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    if (new URL(request.url).pathname === "/fixture/sign") {
      signatures++;
      return new Response("observed");
    }
    const text = await request.text();
    const call = JSON.parse(text) as { method: string; params?: unknown[] };
    if (call.method === "eth_sendRawTransaction") {
      broadcasts++;
      if (holdBroadcast) {
        holdBroadcast.reached(call.params?.[0] as Hex);
        return holdBroadcast.response;
      }
    }
    if (
      latestBlockFailsAfter >= 0 &&
      call.method === "eth_getBlockByNumber" &&
      call.params?.[0] === "latest" &&
      latestBlockFailsAfter-- === 0
    )
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "temporary outage" },
      });
    if (lose && JSON.parse(text).method === "eth_sendRawTransaction")
      return new Response("lost before acceptance", { status: 502 });
    if (call.method === "eth_sendRawTransaction") forwardedBroadcasts++;
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
  },
});
const { db, sqlite } = sqliteD1(
  readdirSync(join(root, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort(),
);
let redirectRegistry = false;
let redirectDestinationReads = 0;
const api = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request): Response | Promise<Response> {
    if (new URL(request.url).pathname === "/redirect-target") {
      redirectDestinationReads++;
      return new Response("Redirect must not be followed");
    }
    if (redirectRegistry)
      return new Response(null, {
        status: 302,
        headers: { location: `${api.url.origin}/redirect-target` },
      });
    // A loopback transport for the unchanged public Pages routers and real migrated SQLite.
    return onRequest({
      request: new Request(`https://slop.cash${new URL(request.url).pathname}`),
      env: { SLOP_DB: db, PAYMENT_NETWORKS: '["ethereum-sepolia"]' },
    } as never);
  },
});
let store = openKeeperStore(join(directory, "keeper.sqlite"));
let cloudflare: Awaited<ReturnType<typeof cloudflareKeeperRuntime>> | undefined;
async function queryOne<T>(sql: string): Promise<T | null> {
  return cloudflare
    ? ((await cloudflare.query<T>(sql))[0] ?? null)
    : store.db.query<T, []>(sql).get();
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const abi = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns(bool)",
  "function blockAddress(address)",
  "function vaults(bytes32) view returns(address)",
  "function balanceOf(address) view returns(uint256)",
]);
const chain = (method: string, params: unknown[] = []) =>
  rpc(url, method, params);
async function mine() {
  await chain("anvil_mine", ["0x40"]);
}
async function send(from: string, to: string, data: string) {
  const id = (await chain("eth_sendTransaction", [
    { from, to, data, gas: "0x7a1200" },
  ])) as string;
  for (let i = 0; i < 100; i++) {
    const receipt = (await chain("eth_getTransactionReceipt", [id])) as {
      status: string;
    } | null;
    if (receipt) {
      assert.equal(receipt.status, "0x1");
      return id;
    }
    await Bun.sleep(20);
  }
  throw new Error("Local receipt unavailable");
}
try {
  for (let i = 0; ; i++) {
    try {
      assert.equal(await chain("eth_chainId"), "0xaa36a7");
      break;
    } catch (error) {
      if (i === 99) throw error;
      await Bun.sleep(50);
    }
  }
  const accounts = (await chain("eth_accounts")) as Hex[];
  const [owner, registrar, fee] = accounts;
  for (const account of [keeper, attester]) {
    await chain("anvil_setBalance", [account.address, "0x8ac7230489e80000"]);
    await chain("anvil_impersonateAccount", [account.address]);
  }
  const deploy = (contract: string, args: string[] = []) =>
    JSON.parse(
      execFileSync(
        "forge",
        [
          "create",
          "--root",
          join(root, "contracts/evm"),
          contract,
          "--rpc-url",
          url,
          "--unlocked",
          "--from",
          owner,
          "--broadcast",
          "--json",
          ...(args.length ? ["--constructor-args", ...args] : []),
        ],
        { encoding: "utf8" },
      ),
    ).deployedTo as Hex;
  const token = deploy(
    "integration/TestDollar.sol:TestDollar",
  ).toLowerCase() as Hex;
  const factory = deployUpgradeableFactory(deploy, [
    registrar,
    fee,
    attester.address,
    "0",
  ]).toLowerCase() as Hex;
  const projectId = "keeper-proof";
  const projectDigest = `0x${hash(`slop-project:${projectId}`)}`;
  const creation = await send(
    owner,
    factory,
    buildCreateVaultCalldata({
      projectId: projectDigest,
      asset: token,
      monthlyCap: "2000000",
      automaticMonthly: true,
    }),
  );
  const vaultValue = (await chain("eth_call", [
    {
      to: factory,
      data: encodeFunctionData({
        abi,
        functionName: "vaults",
        args: [
          evmVaultKey({ owner, projectId: projectDigest, asset: token }) as Hex,
        ],
      }),
    },
    "latest",
  ])) as string;
  const vault = `0x${vaultValue.slice(-40)}` as Hex;
  await send(
    owner,
    token,
    encodeFunctionData({ abi, functionName: "mint", args: [owner, 10000000n] }),
  );
  await send(
    owner,
    token,
    encodeFunctionData({
      abi,
      functionName: "approve",
      args: [vault, 10000000n],
    }),
  );
  await send(owner, vault, buildDepositCalldata(10000000n));
  let now = new Date("2026-12-05T23:59:00Z");
  await chain("evm_setNextBlockTimestamp", [Math.floor(now.getTime() / 1000)]);
  await mine();
  const codeHash = async (address: string) =>
    createHash("sha256")
      .update(
        Buffer.from(
          ((await chain("eth_getCode", [address, "latest"])) as string).slice(
            2,
          ),
          "hex",
        ),
      )
      .digest("hex");
  const deployment = {
    network: "ethereum-sepolia" as const,
    vault,
    asset: token,
    owner,
    identityAuthority: attester.address.toLowerCase(),
    feeRecipient: fee,
    factory,
    registrar,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    rotationDelaySeconds: null,
    bindingDelaySeconds: "0",
    deploymentTransaction: creation,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    codeSha256: await codeHash(vault),
    factoryCodeSha256: await codeHash(factory),
    evmUpgrade: await captureUpgrade(chain, factory, vault),
  };
  const draft = applicationManifest(projectId, "example/keeper-proof");
  const manifest = assertProjectDefinition({
    ...draft,
    status: "active",
    reward: {
      ...(draft.reward as object),
      currency: "TEST",
      feeBasisPoints: 200,
      monthlyCapMinor: "2000000",
      monthlyCapDisplay: "2 TEST",
    },
    rewardAsset: {
      network: "ethereum",
      kind: "token",
      address: token,
      symbol: "TEST",
      decimals: 6,
      chainId: "1",
      cluster: null,
      verifiedAt: now.toISOString(),
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "ethereum",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  });
  const text = JSON.stringify(manifest);
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(projectId, text, hash(text), "Local keeper proof", now.toISOString());
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(projectId, text, hash(text), now.toISOString(), now.toISOString());
  const entries = ["1001", "1002"].map((actor) => ({
    githubUserId: actor,
    grossMicro: "1000000",
    sourceDigest: `0x${hash(`keeper-month:${actor}`)}`,
  }));
  const allocationRoot = evmAllocationRoot(entries);
  const digest = evmMonthlyDigest(11155111n, vault, "2026-11", allocationRoot);
  const authorization: MonthlyAuthorization = {
    plan: {
      family: "evm",
      request: {
        projectId,
        period: "2026-11",
        network: "ethereum-sepolia",
        snapshotSha256: hash("local frozen fixture"),
      },
      deployment,
      allocationRoot,
      messageHex: digest.slice(2),
      totalGrossBase: "2000000",
      entries,
    },
    signatureHex: (await attester.sign({ hash: digest as Hex })).slice(2),
  };
  sqlite
    .query("INSERT INTO monthly_reward_bases VALUES(?,?,?,?,?,?,?,?)")
    .run(
      projectId,
      "2026-11",
      text,
      hash(text),
      hash("local frozen fixture"),
      "2000000",
      2,
      now.toISOString(),
    );
  sqlite
    .query(
      "INSERT INTO monthly_payment_runs VALUES(?,?,'automatic',NULL,0,?,?,?,?,?,?,?)",
    )
    .run(
      projectId,
      "2026-11",
      JSON.stringify(entries),
      authorization.plan.request.snapshotSha256,
      "ethereum-sepolia",
      vault,
      "2000000",
      now.toISOString(),
      now.toISOString(),
    );
  sqlite
    .query("INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?,?,?)")
    .run(
      projectId,
      "2026-11",
      "ethereum-sepolia",
      authorization.plan.request.snapshotSha256,
      JSON.stringify(authorization),
      now.toISOString(),
    );
  const config: KeeperConfiguration = {
    apiOrigin: api.url.origin,
    network: "ethereum-sepolia",
    projectIds: ["unlisted-project", projectId],
    signer: keeper.address,
    rpcUrl: proxy.url.origin,
    perRun: 10,
    gas: {
      perTransaction: "10000000000000000",
      perDay: "100000000000000000",
      additionalFeeReserve: "0",
    },
  };
  const signer = {
    address: keeper.address,
    async signTransaction(input: Parameters<typeof keeper.signTransaction>[0]) {
      signatures++;
      return keeper.signTransaction(input);
    },
  };
  if (useCloudflare) {
    cloudflare = await cloudflareKeeperRuntime(
      directory,
      keeperKey,
      `${proxy.url.origin}/fixture/sign`,
    );
    await cloudflare.configure(config, undefined, now);
    assert.deepEqual(await cloudflare.request("/scheduled"), {});
    assert.equal(signatures, 0, "unspecified Worker mode cannot sign");
    assert.equal(broadcasts, 0, "unspecified Worker mode cannot broadcast");
    assert.equal((await cloudflare.request("/public")).status, 404);
  }
  const tick = (
    execute = true,
    policy = config,
  ): Promise<Awaited<ReturnType<typeof runKeeper>>> =>
    cloudflare
      ? cloudflare.tick(policy, execute, now)
      : runKeeper(
          policy,
          { store, evmSigner: signer, now, localChain: {} },
          execute,
        );
  if (cloudflare) {
    redirectRegistry = true;
    await assert.rejects(() => tick(false), /keeper_run_failed/);
    assert.equal(
      redirectDestinationReads,
      0,
      "the registry redirect destination was not requested",
    );
    assert.equal(signatures, 0);
    redirectRegistry = false;
  }
  const dry = await tick(false);
  assert(
    dry.some((item) => item.state === "published-not-executed"),
    JSON.stringify(dry),
  );
  assert.equal(signatures, 0);
  await send(owner, vault, buildSetMonthlyCommitmentCalldata("2000000", false));
  await mine();
  const off = await tick();
  assert(
    off.some((item) => item.state === "waiting"),
    JSON.stringify(off),
  );
  assert.equal(signatures, 0);
  await send(owner, vault, buildSetMonthlyCommitmentCalldata("2000000", true));
  await mine();
  if (cloudflare) {
    const failure = await cloudflare.tick(config, true, now, {
      failAfterSign: true,
    });
    assert(
      failure.some((item: { error?: string }) =>
        item.error?.includes("Fixture interruption"),
      ),
      JSON.stringify(failure),
    );
    assert.equal(
      signatures,
      1,
      "real local signing reached the injected interruption",
    );
    assert.equal(broadcasts, 0, "interrupted transaction cannot broadcast");
    assert.equal(
      (await queryOne<{ n: number }>("SELECT count(*) n FROM gas"))?.n,
      0,
    );
    assert.equal(
      (
        await queryOne<{ n: number }>(
          "SELECT count(*) n FROM journal WHERE key LIKE 'monthly:%' OR key LIKE 'nonce:%'",
        )
      )?.n,
      0,
      "gas, nonce and signed bytes roll back together",
    );
  }
  const signedBeforeAttempt = signatures;
  lose = true;
  const concurrent = cloudflare
    ? await cloudflare.tick(config, true, now, { concurrent: true })
    : undefined;
  if (concurrent)
    assert.deepEqual(
      concurrent[0],
      concurrent[1],
      "overlapping triggers share the same run",
    );
  const uncertain = concurrent ? concurrent[0] : await tick();
  assert(
    uncertain.some((item) => item.state === "waiting"),
    JSON.stringify(uncertain),
  );
  assert.equal(signatures, signedBeforeAttempt + 1);
  const saved = await queryOne<{ value: string }>(
    "SELECT value FROM journal WHERE key LIKE 'monthly:%'",
  );
  assert(saved);
  if (cloudflare) {
    const savedAttempt = JSON.parse(saved.value) as {
      rawTransaction: Hex;
      transactionId: string;
    };
    const reservedGas = await queryOne<{ transaction_id: string }>(
      "SELECT transaction_id FROM gas",
    );
    assert.equal(reservedGas?.transaction_id, savedAttempt.transactionId);
    assert.equal(
      keccak256(savedAttempt.rawTransaction),
      savedAttempt.transactionId,
    );
    assert.equal(
      (
        await queryOne<{ value: string }>(
          "SELECT value FROM journal WHERE key LIKE 'nonce:%'",
        )
      )?.value,
      "1",
      "same native commit advances the nonce once",
    );
    await tick(true, { ...config, signer: keeper.address.toLowerCase() });
    assert.equal(
      signatures,
      signedBeforeAttempt + 1,
      "address case does not create a fresh signer journal",
    );
    await assert.rejects(
      () => tick(true, { ...config, apiOrigin: "http://127.0.0.1:1" }),
      /keeper_run_failed/,
    );
    assert.equal(
      signatures,
      signedBeforeAttempt + 1,
      "registry change cannot reset the same wallet journal",
    );
    await cloudflare.configure(config, "execute", now);
  }
  assert.equal(
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM gas WHERE actual IS NULL",
      )
    )?.n,
    1,
  );
  if (cloudflare) await cloudflare.restart();
  else {
    store.close();
    store = openKeeperStore(join(directory, "keeper.sqlite"));
  }
  now = new Date("2026-12-06T00:01:00Z");
  await chain("evm_setNextBlockTimestamp", [Math.floor(now.getTime() / 1000)]);
  lose = false;
  await tick();
  await mine();
  assert.equal(signatures, signedBeforeAttempt + 1);
  assert.equal(
    (
      await queryOne<{ value: string }>(
        "SELECT value FROM journal WHERE key LIKE 'monthly:%'",
      )
    )?.value,
    saved.value,
  );
  const walletless = await tick();
  assert.equal(
    (
      await queryOne<{ day: string; settled_day: string }>(
        "SELECT day,settled_day FROM gas",
      )
    )?.day,
    "2026-12-05",
  );
  assert.equal(
    (
      await queryOne<{ day: string; settled_day: string }>(
        "SELECT day,settled_day FROM gas",
      )
    )?.settled_day,
    "2026-12-06",
  );
  assert(
    walletless.filter((item) => item.state === "awaiting-wallet").length === 2,
    JSON.stringify(walletless),
  );
  for (const [index, wallet] of [alice, bob].entries()) {
    const request = {
      githubUserId: entries[index].githubUserId,
      destination: wallet.address,
      expectedVersion: "0",
      claimDigest: `0x${hash(`claim:${index}`)}`,
      expiresAt: String(Math.floor(now.getTime() / 1000) + 86400),
    };
    const typed = evmBindingTypedData(11155111n, vault, request);
    const { EIP712Domain: _domain, ...types } = typed.types;
    const signature = await wallet.signTypedData({
      domain: { ...typed.domain, chainId: 11155111, verifyingContract: vault },
      types,
      primaryType: typed.primaryType,
      message: {
        actorId: BigInt(request.githubUserId),
        destination: wallet.address,
        expectedVersion: 0n,
        claimDigest: request.claimDigest as Hex,
        expiresAt: BigInt(request.expiresAt),
      },
    } as never);
    await send(
      attester.address,
      vault,
      buildBindCalldata({ ...request, walletSignature: signature }),
    );
  }
  await send(
    owner,
    token,
    encodeFunctionData({
      abi,
      functionName: "blockAddress",
      args: [alice.address],
    }),
  );
  await mine();
  const spent = (
    await queryOne<{ actual: string }>(
      "SELECT actual FROM gas WHERE actual IS NOT NULL",
    )
  )?.actual;
  assert(spent && BigInt(spent) > 0n);
  const preBudget = signatures;
  const midnightBudget = await tick(true, {
    ...config,
    gas: { ...config.gas, perTransaction: spent, perDay: spent },
  });
  assert(
    midnightBudget.some((item) => item.error?.includes("gas budget")),
    JSON.stringify(midnightBudget),
  );
  assert.equal(
    signatures,
    preBudget,
    "The expense mined today must reduce today's budget",
  );
  let resumedAfterCrash: Awaited<ReturnType<typeof tick>> | undefined;
  if (cloudflare) {
    // The RPC gate observes the committed attempt, but forwards no bytes to
    // Anvil. Kill the real Workerd process here, not after a graceful tick.
    let reached!: (raw: Hex) => void;
    let release!: (response: Response) => void;
    const captured = new Promise<Hex>((resolve) => {
      reached = resolve;
    });
    holdBroadcast = {
      reached,
      response: new Promise<Response>((resolve) => {
        release = resolve;
      }),
    };
    const beforeForwarded = forwardedBroadcasts;
    const beforeSignatures = signatures;
    const inFlight = tick().then(
      () => "completed",
      () => "interrupted",
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        captured,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () =>
              reject(new Error("Keeper never reached the pre-broadcast gate")),
            30_000,
          );
        }),
      ]);
      clearTimeout(deadline);
      const id = keccak256(raw);
      const savedPayment = await queryOne<{ key: string; value: string }>(
        `SELECT key,value FROM journal WHERE json_extract(value,'$.transactionId')='${id}'`,
      );
      assert(
        savedPayment,
        "the signed payment was durably committed before RPC",
      );
      const attempt = JSON.parse(savedPayment.value) as {
        rawTransaction: Hex;
        transactionId: Hex;
        obligationId: Hex;
      };
      assert.equal(attempt.rawTransaction, raw);
      assert.equal(attempt.transactionId, id);
      assert.equal(
        attempt.obligationId,
        evmAwardId(11155111n, vault, entries[1].sourceDigest),
      );
      const nonce = await queryOne<{ value: string }>(
        "SELECT value FROM journal WHERE key LIKE 'nonce:%'",
      );
      const gas = await queryOne<{
        id: string;
        transaction_id: string;
        maximum: string;
        actual: string | null;
      }>(
        `SELECT id,transaction_id,maximum,actual FROM gas WHERE transaction_id='${id}'`,
      );
      assert(nonce && gas);
      assert.equal(gas.actual, null);
      assert(BigInt(gas.maximum) > 0n);
      assert.equal(signatures, beforeSignatures + 1);
      assert.equal(forwardedBroadcasts, beforeForwarded);
      assert.equal(await chain("eth_getTransactionByHash", [id]), null);
      const processes = await cloudflare.crashAndRestart();
      assert.notEqual(processes.currentPid, processes.previousPid);
      assert.equal(await inFlight, "interrupted");
      assert.deepEqual(
        await queryOne(
          `SELECT key,value FROM journal WHERE key='${savedPayment.key}'`,
        ),
        savedPayment,
        "a new Workerd process retains the exact signed attempt",
      );
      assert.deepEqual(
        await queryOne("SELECT value FROM journal WHERE key LIKE 'nonce:%'"),
        nonce,
      );
      assert.deepEqual(
        await queryOne(
          `SELECT id,transaction_id,maximum,actual FROM gas WHERE transaction_id='${id}'`,
        ),
        gas,
        "the uncertain send keeps its full native liability across the crash",
      );
      assert.equal(await chain("eth_getTransactionByHash", [id]), null);
      holdBroadcast = undefined;
      release(new Response("fixture process was terminated", { status: 502 }));
      resumedAfterCrash = await tick();
      assert.equal(
        signatures,
        beforeSignatures + 1,
        "restart must not sign again",
      );
      assert.equal(forwardedBroadcasts, beforeForwarded + 1);
      await mine();
      await tick();
      const paid = await queryOne<{ payment: string }>(
        `SELECT payment FROM awards WHERE id='${attempt.obligationId}'`,
      );
      assert(paid);
      const receipt = JSON.parse(paid.payment);
      assert.equal(receipt.transactionId, id);
      assert.equal(receipt.obligationId, attempt.obligationId);
      assert.equal(receipt.githubUserId, "1002");
      assert.equal(receipt.destination, bob.address.toLowerCase());
      assert.equal(receipt.netMicro, "980000");
      assert.equal(receipt.feeMicro, "20000");
      assert(
        BigInt(
          (
            await queryOne<{ actual: string }>(
              `SELECT actual FROM gas WHERE transaction_id='${id}'`,
            )
          )?.actual ?? "0",
        ) > 0n,
        "the same reserved attempt reconciles its canonical gas charge",
      );
      assert.equal(
        (
          await queryOne<{ n: number }>(
            "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
          )
        )?.n,
        1,
      );
      await tick();
      assert.equal(signatures, beforeSignatures + 1);
      assert.equal(
        forwardedBroadcasts,
        beforeForwarded + 1,
        "completed payment is not rebroadcast",
      );
    } finally {
      clearTimeout(deadline);
      holdBroadcast = undefined;
      release(new Response("fixture gate closed", { status: 502 }));
    }
  }
  const blocked = resumedAfterCrash ?? (await tick());
  assert(
    blocked.some((item) => item.state === "submitted"),
    JSON.stringify(blocked),
  );
  assert(
    blocked.some((item) => item.state === "waiting"),
    JSON.stringify(blocked),
  );
  await mine();
  await tick();
  assert.equal(
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
    )?.n,
    1,
  );
  await send(
    owner,
    token,
    encodeFunctionData({
      abi,
      functionName: "blockAddress",
      args: ["0x0000000000000000000000000000000000000000"],
    }),
  );
  await mine();
  const count = signatures;
  const budget = await tick(true, {
    ...config,
    gas: { ...config.gas, perTransaction: "1", perDay: "1" },
  });
  assert(
    budget.some((item) => item.error?.includes("gas budget")),
    JSON.stringify(budget),
  );
  assert.equal(signatures, count);
  await tick();
  await mine();
  await tick();
  assert.equal(
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
    )?.n,
    2,
  );
  for (const wallet of [alice, bob])
    assert.equal(
      BigInt(
        (await chain("eth_call", [
          {
            to: token,
            data: encodeFunctionData({
              abi,
              functionName: "balanceOf",
              args: [wallet.address],
            }),
          },
          "finalized",
        ])) as string,
      ),
      980000n,
    );
  const beforeReplay = signatures;
  await tick();
  assert.equal(signatures, beforeReplay);
  assert.equal(
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM gas WHERE actual IS NULL",
      )
    )?.n,
    0,
  );
  // Existing funded obligations still settle when the project is paused and automatic admission is off.
  await send(owner, vault, buildSetMonthlyCommitmentCalldata("2000000", false));
  const extra = `0x${hash("funded-before-pause")}`;
  await send(
    owner,
    vault,
    buildCommitAwardCalldata({
      obligationId: evmAwardId(11155111n, vault, extra),
      githubUserId: "1001",
      grossMicro: "100",
      sourceDigest: extra,
    }),
  );
  await mine();
  const paused = JSON.stringify({ ...manifest, status: "paused" });
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,2,?,?,?,?)",
    )
    .run(
      projectId,
      paused,
      hash(paused),
      "Pause after funding",
      now.toISOString(),
    );
  sqlite
    .query(
      "UPDATE projects SET status='paused',revision=2,manifest=?,manifest_sha256=?,updated_at=? WHERE id=?",
    )
    .run(paused, hash(paused), now.toISOString(), projectId);
  await tick();
  await mine();
  await tick();
  assert.equal(
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
    )?.n,
    3,
  );

  // Bounded same-nonce fee replacement (owner decision, 25 October 2026).
  const paid = async () =>
    (
      await queryOne<{ n: number }>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
    )?.n;
  const fundAward = async (label: string) => {
    const source = `0x${hash(label)}`;
    const id = evmAwardId(11155111n, vault, source);
    await send(
      owner,
      vault,
      buildCommitAwardCalldata({
        obligationId: id,
        githubUserId: "1001",
        grossMicro: "100",
        sourceDigest: source,
      }),
    );
    await mine();
    return id.toLowerCase();
  };
  const outcome = (results: Awaited<ReturnType<typeof tick>>, id: string) => {
    const item = results.find(
      (entry) => entry.operation.toLowerCase() === `award:${id}`,
    );
    assert(item, JSON.stringify(results));
    return item;
  };
  const journalValue = async <T>(sql: string) => {
    const row = await queryOne<{ value: string }>(sql);
    assert(row, sql);
    return JSON.parse(row.value) as T;
  };
  const replacements = async (original: string) =>
    (
      await journalValue<{
        replacements: { rawTransaction: Hex; transactionId: string }[];
      }>(`SELECT value FROM journal WHERE key='fee-bump:${original}'`)
    ).replacements;
  const signedFees = async (transactionId: string) => {
    const tx = (await chain("eth_getTransactionByHash", [transactionId])) as {
      maxFeePerGas: Hex;
      maxPriorityFeePerGas: Hex;
      nonce: Hex;
    };
    return {
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      priority: BigInt(tx.maxPriorityFeePerGas),
    };
  };
  const nextBaseFee = (value: bigint) =>
    chain("anvil_setNextBlockBaseFeePerGas", [`0x${value.toString(16)}`]);
  const later = async () => {
    now = new Date(now.getTime() + 11 * 60_000);
  };
  const finalize = async () => {
    // Without automine, a mined send needs one more finalization window.
    await mine();
    await mine();
  };
  const gasRows = (ids: string[]) =>
    cloudflare
      ? cloudflare.query<{
          transaction_id: string;
          actual: string | null;
          expiry_evidence: string | null;
        }>(
          `SELECT transaction_id,actual,expiry_evidence FROM gas WHERE transaction_id IN (${ids.map((id) => `'${id}'`).join(",")})`,
        )
      : store.db
          .query<
            {
              transaction_id: string;
              actual: string | null;
              expiry_evidence: string | null;
            },
            []
          >(
            `SELECT transaction_id,actual,expiry_evidence FROM gas WHERE transaction_id IN (${ids.map((id) => `'${id}'`).join(",")})`,
          )
          .all();
  const assertOneWinner = async (winner: string, losers: string[]) => {
    const rows = await gasRows([winner, ...losers]);
    assert.equal(rows.length, losers.length + 1, JSON.stringify(rows));
    for (const row of rows) {
      if (row.transaction_id === winner) {
        assert(row.actual && BigInt(row.actual) > 0n, JSON.stringify(row));
      } else {
        assert.equal(row.actual, "0", "losing same-nonce reserve released");
        assert.equal(
          JSON.parse(row.expiry_evidence ?? "{}").transactionId,
          winner,
        );
      }
    }
    assert.equal(
      (
        await queryOne<{ n: number }>(
          "SELECT count(*) n FROM gas WHERE actual IS NULL",
        )
      )?.n,
      0,
    );
  };
  const restart = async () => {
    if (cloudflare) await cloudflare.restart();
    else {
      store.close();
      store = openKeeperStore(join(directory, "keeper.sqlite"));
    }
  };
  const nonceMark = () =>
    queryOne<{ value: string }>(
      "SELECT value FROM journal WHERE key LIKE 'nonce:%'",
    );

  // A clipped priority fee still allows mining: keep the existing signed fee cap.
  const clippedAward = await fundAward("fee-bump-clipped-tip");
  await chain("evm_setAutomine", [false]);
  const clippedOriginal = outcome(await tick(), clippedAward).transactionId;
  assert(clippedOriginal);
  const clippedFees = await signedFees(clippedOriginal);
  assert(clippedFees.priority > 1n);
  const clippedBase = clippedFees.maxFeePerGas - clippedFees.priority / 2n;
  await chain("anvil_dropTransaction", [clippedOriginal]);
  await nextBaseFee(clippedBase);
  await chain("anvil_mine", ["0x1"]);
  const clippedLatest = (await chain("eth_getBlockByNumber", [
    "latest",
    false,
  ])) as { baseFeePerGas: Hex };
  assert.equal(BigInt(clippedLatest.baseFeePerGas), clippedBase);
  const beforeClipped = signatures;
  await later();
  const clippedOutcome = outcome(await tick(), clippedAward);
  assert.equal(clippedOutcome.transactionId, clippedOriginal);
  assert.equal(
    signatures,
    beforeClipped,
    "a clipped tip needs no new signature",
  );
  assert.equal((await replacements(clippedOriginal)).length, 0);
  await nextBaseFee(clippedBase);
  await finalize();
  const clippedReceipt = (await chain("eth_getTransactionReceipt", [
    clippedOriginal,
  ])) as { status: string; effectiveGasPrice: Hex };
  assert.equal(clippedReceipt.status, "0x1");
  assert.equal(
    BigInt(clippedReceipt.effectiveGasPrice),
    clippedFees.maxFeePerGas,
  );
  const paidBeforeClipped = await paid();
  await tick();
  assert.equal(await paid(), (paidBeforeClipped ?? 0) + 1);
  await assertOneWinner(clippedOriginal, []);
  await chain("evm_setAutomine", [true]);

  // A tighter current per-operation envelope prevents a fee replacement,
  // without rewriting the already-signed original or its gas reservation.
  const nativeAward = await fundAward("native-cost-replacement-bound");
  await chain("evm_setAutomine", [false]);
  const nativeOriginal = outcome(await tick(), nativeAward).transactionId;
  assert(nativeOriginal);
  const nativeTx = (await chain("eth_getTransactionByHash", [
    nativeOriginal,
  ])) as {
    gas: Hex;
    maxFeePerGas: Hex;
  };
  const nativeFee = BigInt(nativeTx.maxFeePerGas);
  const nativeLimit = (BigInt(nativeTx.gas) * nativeFee * 110n) / 100n;
  const reviseNativeLimit = (limit: string | undefined) => {
    const row = sqlite
      .query<{ revision: number; manifest: string }, [string]>(
        "SELECT revision,manifest FROM projects WHERE id=?",
      )
      .get(projectId);
    assert(row);
    const changed = JSON.parse(row.manifest);
    for (const pin of changed.escrow.deployments) {
      if (limit === undefined) delete pin.maxNativeCostWei;
      else pin.maxNativeCostWei = limit;
    }
    const text = JSON.stringify(changed),
      revision = row.revision + 1;
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        projectId,
        revision,
        text,
        hash(text),
        "Local native envelope fixture",
        now.toISOString(),
      );
    sqlite
      .query(
        "UPDATE projects SET revision=?,manifest=?,manifest_sha256=? WHERE id=?",
      )
      .run(revision, text, hash(text), projectId);
  };
  reviseNativeLimit(nativeLimit.toString());
  await chain("anvil_dropTransaction", [nativeOriginal]);
  await nextBaseFee((nativeFee * 120n) / 100n);
  await chain("anvil_mine", ["0x1"]);
  await later();
  const beforeNativeReplacement = signatures;
  const nativeHeld = outcome(await tick(), nativeAward);
  assert(
    nativeHeld.error?.includes("native cost limit"),
    JSON.stringify(nativeHeld),
  );
  assert.equal(
    signatures,
    beforeNativeReplacement,
    "Native cap refused before replacement signing",
  );
  assert.equal((await replacements(nativeOriginal)).length, 0);
  await nextBaseFee(1n);
  await tick();
  await finalize();
  await tick();
  await assertOneWinner(nativeOriginal, []);
  reviseNativeLimit(undefined);
  await chain("evm_setAutomine", [true]);

  // 1. A send stalled by a high base fee is replaced once and the replacement lands.
  const stalledAward = await fundAward("fee-bump-lands");
  await chain("evm_setAutomine", [false]);
  let before = signatures;
  const stalledOriginal = outcome(await tick(), stalledAward).transactionId;
  assert(stalledOriginal);
  assert.equal(signatures, before + 1);
  const stalledFees = await signedFees(stalledOriginal);
  await nextBaseFee((stalledFees.maxFeePerGas * 120n) / 100n);
  await chain("anvil_mine", ["0x1"]);
  // Anvil drops the underpriced send; inside the wait nothing new is signed.
  const inside = outcome(await tick(), stalledAward);
  assert.equal(inside.state, "waiting", JSON.stringify(inside));
  assert.equal((await replacements(stalledOriginal)).length, 0);
  assert.equal(signatures, before + 1);
  await later();
  const bumped = outcome(await tick(), stalledAward).transactionId;
  assert(bumped && bumped !== stalledOriginal);
  assert.equal(signatures, before + 2);
  const bumpedFees = await signedFees(bumped);
  assert.equal(
    bumpedFees.maxFeePerGas,
    (stalledFees.maxFeePerGas * 125n + 99n) / 100n,
  );
  assert.equal(bumpedFees.priority, (stalledFees.priority * 125n + 99n) / 100n);
  await finalize();
  const paidBefore = await paid();
  await tick();
  assert.equal(await paid(), (paidBefore ?? 0) + 1);
  await assertOneWinner(bumped, [stalledOriginal]);

  // 2. The original lands after its replacement was broadcast: one record, reserves released.
  await chain("evm_setAutomine", [true]);
  const raceAward = await fundAward("fee-bump-original-wins");
  await chain("evm_setAutomine", [false]);
  before = signatures;
  const raceOriginal = outcome(await tick(), raceAward).transactionId;
  assert(raceOriginal);
  const raceFees = await signedFees(raceOriginal);
  await nextBaseFee((raceFees.maxFeePerGas * 120n) / 100n);
  await chain("anvil_mine", ["0x1"]);
  await later();
  const raceReplacement = outcome(await tick(), raceAward).transactionId;
  assert(raceReplacement && raceReplacement !== raceOriginal);
  assert.equal(signatures, before + 2);
  // Another node still held the original and a block producer included it.
  const raceRaw = (
    await journalValue<{ rawTransaction: Hex }>(
      `SELECT value FROM journal WHERE json_extract(value,'$.transactionId')='${raceOriginal}'`,
    )
  ).rawTransaction;
  await chain("anvil_dropTransaction", [raceReplacement]);
  await nextBaseFee(1n);
  assert.equal(await chain("eth_sendRawTransaction", [raceRaw]), raceOriginal);
  await finalize();
  const racePaidBefore = await paid();
  const raceResult = await tick();
  assert.equal(await paid(), (racePaidBefore ?? 0) + 1, "no double record");
  assert(
    !raceResult.some(
      (entry) => entry.operation.toLowerCase() === `award:${raceAward}`,
    ),
    "the indexed payment needs no further send",
  );
  assert.equal(signatures, before + 2);
  await assertOneWinner(raceOriginal, [raceReplacement]);

  // 3. Cap reached, restart mid-bump and budget refusal.
  await chain("evm_setAutomine", [true]);
  const cappedAward = await fundAward("fee-bump-cap");
  await chain("evm_setAutomine", [false]);
  before = signatures;
  const nonceBefore = (await nonceMark())?.value;
  const cappedOriginal = outcome(await tick(), cappedAward).transactionId;
  assert(cappedOriginal);
  const nonceAfterOriginal = (await nonceMark())?.value;
  assert.equal(
    BigInt(nonceAfterOriginal ?? "0"),
    BigInt(nonceBefore ?? "0") + 1n,
  );
  const cappedFees = await signedFees(cappedOriginal);
  await nextBaseFee(cappedFees.maxFeePerGas * 10n);
  await chain("anvil_mine", ["0x1"]);
  for (let step = 1; step <= 5; step++) {
    if (step === 2) {
      // Restart mid-bump: the journal continues; nothing new is signed inside the wait.
      await restart();
      await tick();
      assert.equal(signatures, before + 2, "restart signs nothing new");
    }
    await later();
    if (step === 4) {
      const latest = await queryOne<{ maximum: string }>(
        "SELECT maximum FROM gas WHERE actual IS NULL ORDER BY CAST(maximum AS INTEGER) DESC LIMIT 1",
      );
      assert(latest);
      const refused = await tick(true, {
        ...config,
        gas: { ...config.gas, perTransaction: latest.maximum },
      });
      assert(
        outcome(refused, cappedAward).error?.includes("gas budget"),
        JSON.stringify(refused),
      );
      assert.equal(signatures, before + 4, "no replacement without a reserve");
      assert.equal((await replacements(cappedOriginal)).length, 3);
    }
    await tick();
    assert.equal(signatures, before + 1 + step);
    assert.equal((await replacements(cappedOriginal)).length, step);
  }
  await later();
  const capped = await tick();
  assert.equal(outcome(capped, cappedAward).state, "waiting");
  assert(
    outcome(capped, cappedAward).error?.includes("cap reached"),
    JSON.stringify(capped),
  );
  assert.equal(signatures, before + 6, "the cap stops further signing");
  const ladder = await replacements(cappedOriginal);
  const finalFees = await Promise.all(
    ladder.map(async (item) => parseTransaction(item.rawTransaction)),
  );
  const originalTransaction = parseTransaction(
    (
      await journalValue<{ rawTransaction: Hex }>(
        `SELECT value FROM journal WHERE json_extract(value,'$.transactionId')='${cappedOriginal}'`,
      )
    ).rawTransaction,
  );
  for (const item of finalFees) {
    assert.equal(item.nonce, originalTransaction.nonce);
    assert.equal(item.data, originalTransaction.data);
    assert.equal(item.to, originalTransaction.to);
    assert.equal(item.gas, originalTransaction.gas);
  }
  assert.equal(
    finalFees.at(-1)?.maxFeePerGas,
    (originalTransaction.maxFeePerGas ?? 0n) * 3n,
  );
  assert.equal(
    finalFees.at(-1)?.maxPriorityFeePerGas,
    (originalTransaction.maxPriorityFeePerGas ?? 0n) * 3n,
  );
  assert.equal(
    (await nonceMark())?.value,
    nonceAfterOriginal,
    "replacements never advance the nonce",
  );
  // The fee falls, but the fee read fails: the latest verified bytes are still rebroadcast.
  await nextBaseFee(1n);
  // The award's binding-time check reads the latest block first; the fee read is next.
  latestBlockFailsAfter = 1;
  const unreadable = outcome(await tick(), cappedAward);
  assert.equal(latestBlockFailsAfter, -1, "exactly the fee read failed");
  assert.equal(unreadable.state, "waiting");
  assert(
    unreadable.error?.includes("Network fee unavailable"),
    JSON.stringify(unreadable),
  );
  assert.equal(signatures, before + 6);
  assert(
    await chain("eth_getTransactionByHash", [ladder[4].transactionId]),
    "the latest capped replacement reached the node",
  );
  await finalize();
  const capPaidBefore = await paid();
  await tick();
  assert.equal(await paid(), (capPaidBefore ?? 0) + 1);
  await assertOneWinner(ladder[4].transactionId, [
    cappedOriginal,
    ...ladder.slice(0, 4).map((item) => item.transactionId),
  ]);
  await chain("evm_setAutomine", [true]);
  console.log(
    JSON.stringify({
      result: "PASS",
      source: deployment.sourceCommit,
      chain: "actual local Anvil, Ethereum Sepolia identity",
      runtime: useCloudflare
        ? "native Workerd SQLite Durable Object"
        : "Bun SQLite",
      publicHttp:
        "unchanged Pages public registry/authorization routes over real migrated SQLite",
      cases: [
        ...(useCloudflare
          ? [
              "execution disabled by default; public execution route absent",
              "async signing interruption atomically rolls back gas, nonce and signed bytes",
              "concurrent native cron handlers coalesce in one gas-wallet object",
              "address case and registry changes cannot reset nonce or budget",
              "registry redirects refused without following the destination",
              "SIGKILL after durable signing before broadcast retains exact attempt, nonce and gas; fresh process pays once without re-signing",
            ]
          : []),
        "read-only dry run",
        "on-chain opt-out",
        "durable lost-send restart and identical raw transaction",
        "late wallet binding",
        "failed recipient isolation",
        "operator gas budget refusal before signing",
        "receipt-day budget across midnight and restart",
        "missing selected project isolation",
        "finalized exact receipt indexing",
        "completed replay",
        "funded award after pause and opt-out",
        "stalled send replaced at +25% after the wait and the replacement lands",
        "mineable clipped-tip send keeps its original fees and settles once",
        "original lands after its replacement: one payment, other reserve released",
        "fee cap of three times stops signing and reports waiting",
        "restart mid-bump continues from the journal without a new nonce",
        "replacement refused when its reserve does not fit the budget",
        "current native envelope refuses replacement before signing and preserves the original",
        "fee read outage still rebroadcasts the latest verified attempt",
      ],
      payments: 6,
      signatures,
      journal: "retained privately; no raw signed bytes in report",
    }),
  );
} finally {
  await cloudflare?.close();
  store.close();
  sqlite.close();
  api.stop(true);
  proxy.stop(true);
  anvil.kill("SIGTERM");
}
