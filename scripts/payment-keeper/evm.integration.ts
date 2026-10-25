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
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import { rpc } from "./budget";
import { type KeeperConfiguration, runKeeper } from "./keeper";
import { openKeeperStore } from "./store";

const root = resolve(import.meta.dir, "../..");
const port = process.env.SLOP_KEEPER_TEST_PORT ?? "28550";
const url = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(join(tmpdir(), "slop-keeper-e2e-"));
const anvil = spawn(
  "anvil",
  ["--host", "127.0.0.1", "--port", port, "--chain-id", "11155111", "--silent"],
  { stdio: "ignore" },
);
const keeper = privateKeyToAccount(generatePrivateKey());
const attester = privateKeyToAccount(generatePrivateKey());
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
let lose = false;
const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const text = await request.text();
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
  let signatures = 0;
  const signer = {
    address: keeper.address,
    async signTransaction(input: Parameters<typeof keeper.signTransaction>[0]) {
      signatures++;
      return keeper.signTransaction(input);
    },
  };
  const tick = (execute = true, policy = config) =>
    runKeeper(
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
  lose = true;
  const uncertain = await tick();
  assert(
    uncertain.some((item) => item.state === "waiting"),
    JSON.stringify(uncertain),
  );
  assert.equal(signatures, 1);
  const saved = store.db
    .query<{ value: string }, []>(
      "SELECT value FROM journal WHERE key LIKE 'monthly:%'",
    )
    .get();
  assert(saved);
  assert.equal(
    store.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM gas WHERE actual IS NULL",
      )
      .get()?.n,
    1,
  );
  store.close();
  store = openKeeperStore(join(directory, "keeper.sqlite"));
  now = new Date("2026-12-06T00:01:00Z");
  await chain("evm_setNextBlockTimestamp", [Math.floor(now.getTime() / 1000)]);
  lose = false;
  await tick();
  await mine();
  assert.equal(signatures, 1);
  assert.equal(
    store.db
      .query<{ value: string }, []>(
        "SELECT value FROM journal WHERE key LIKE 'monthly:%'",
      )
      .get()?.value,
    saved.value,
  );
  const walletless = await tick();
  assert.equal(
    store.db
      .query<{ day: string; settled_day: string }, []>(
        "SELECT day,settled_day FROM gas",
      )
      .get()?.day,
    "2026-12-05",
  );
  assert.equal(
    store.db
      .query<{ day: string; settled_day: string }, []>(
        "SELECT day,settled_day FROM gas",
      )
      .get()?.settled_day,
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
  const spent = store.db
    .query<{ actual: string }, []>(
      "SELECT actual FROM gas WHERE actual IS NOT NULL",
    )
    .get()?.actual;
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
    store.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
      .get()?.n,
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
    store.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
      .get()?.n,
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
    store.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM gas WHERE actual IS NULL",
      )
      .get()?.n,
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
    store.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM awards WHERE payment IS NOT NULL",
      )
      .get()?.n,
    3,
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      source: deployment.sourceCommit,
      chain: "actual local Anvil, Ethereum Sepolia identity",
      publicHttp:
        "unchanged Pages public registry/authorization routes over real migrated SQLite",
      cases: [
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
  store.close();
  sqlite.close();
  api.stop(true);
  proxy.stop(true);
  anvil.kill("SIGTERM");
}
