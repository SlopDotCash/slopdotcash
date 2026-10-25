/** Actual Anvil + SQLite + public HTTP workflow. No live keys, RPCs or funds. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeFunctionData, type Hex, parseAbi } from "viem";
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
let signatures = 0;
let broadcasts = 0;
const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    if (new URL(request.url).pathname === "/fixture/sign") {
      signatures++;
      return new Response("observed");
    }
    const text = await request.text();
    if (JSON.parse(text).method === "eth_sendRawTransaction") broadcasts++;
    if (lose && JSON.parse(text).method === "eth_sendRawTransaction")
      return new Response("lost before acceptance", { status: 502 });
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
const api = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
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
  const blocked = await tick();
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
              "concurrent triggers coalesce in one gas-wallet object",
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
      ],
      payments: 3,
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
