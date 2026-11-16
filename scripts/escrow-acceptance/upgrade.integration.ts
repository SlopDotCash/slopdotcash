/** Real local upgrade workflow. Faults affect only loopback RPC and generated Anvil state. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseTransaction,
  toHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  buildBindCalldata,
  buildCommitAwardCalldata,
  buildCreateVaultCalldata,
  buildPayCalldata,
  evmAllocationRoot,
  evmAwardId,
  evmBindingDigest,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import { CREATE2_DEPLOYER } from "../../contracts/evm/integration/upgrade";
import {
  buildReserveMonthlyCalldata,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
} from "../../contracts/evm/monthly-reserve";

const root = resolve(import.meta.dir, "../..");
const out = process.env.SLOP_UPGRADE_TEST_OUTPUT;
assert(out, "SLOP_UPGRADE_TEST_OUTPUT must name a fresh evidence directory");
await mkdir(out, { recursive: true });
const before = process.env.SLOP_UPGRADE_EXPECT_BEFORE === "1";
const port = Number(process.env.SLOP_UPGRADE_TEST_PORT ?? "29540");
const url = `http://127.0.0.1:${port}`;
const accounts = [0, 1, 2].map((addressIndex) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex },
  ),
);
const [owner, identity, fee] = accounts;
const ownerKey = owner.getHdKey().privateKey;
assert(ownerKey);
const abi = parseAbi([
  "function initialize(address,address,address,uint64,address,address)",
  "function vaults(bytes32) view returns(address)",
  "function mint(address,uint256)",
  "function approve(address,uint256) returns(bool)",
  "function deposit(uint128)",
]);
const anvil = spawn(
  "anvil",
  ["--port", String(port), "--chain-id", "84532", "--silent"],
  { stdio: "ignore" },
);
const raw = async (method: string, params: unknown[]) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()) as { result?: any; error?: unknown };
};
const rpc = async (method: string, params: unknown[]) => {
  const body = await raw(method, params);
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
};
let refusalUnavailable = false;
let historyUnavailable = false;
let omitKnownVaults = false;
let holdStraggler = false;
let straggler = "";
let receiptFault: "missing" | "canonical" | null = null;
let finalityLimit: string | null = null;
let gateway: ReturnType<typeof Bun.serve> | undefined;
const results: Record<string, unknown> = {
  mode: before ? "before" : "after",
  chain: "local Anvil 84532",
  faults: "loopback RPC method errors and local storage mutations only",
};
const send = async (data: string, to?: string, from = owner.address) => {
  const hash = await rpc("eth_sendTransaction", [
    { from, ...(to ? { to } : {}), data, gas: "0x1c9c380" },
  ]);
  await rpc("anvil_mine", ["0x40"]);
  const receipt = await rpc("eth_getTransactionReceipt", [hash]);
  assert.equal(receipt.status, "0x1");
  return receipt;
};
const deploy = async (file: string, name: string, suffix = "") => {
  const artifact = JSON.parse(
    await readFile(
      join(root, "contracts/evm/out", file, `${name}.json`),
      "utf8",
    ),
  );
  return await send(`${artifact.bytecode.object}${suffix}`);
};
const call = async (to: string, functionName: string, args: unknown[]) =>
  send(encodeFunctionData({ abi, functionName, args } as never), to);
let factory = "";
let deploymentBlock = "";
const run = async (
  command: string,
  directory: string,
  start = deploymentBlock,
  label = "normal",
) => {
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/escrow-acceptance/evm-upgrade.ts",
      command,
      "base-sepolia",
      join(out, directory),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ESCROW_ACCEPTANCE_RPC_URL: `http://127.0.0.1:${port + 1}`,
        ESCROW_ACCEPTANCE_FACTORY: factory,
        ESCROW_ACCEPTANCE_FACTORY_DEPLOYMENT_BLOCK: start,
        ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY: toHex(ownerKey),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await Bun.write(
    join(out, `${directory}-${command}-${label}.log`),
    `${stdout}\n${stderr}`,
  );
  return { exit, stdout, stderr };
};
try {
  for (let i = 0; ; i++) {
    try {
      await rpc("eth_chainId", []);
      break;
    } catch {
      assert(i < 100);
      await Bun.sleep(50);
    }
  }
  gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: port + 1,
    async fetch(request) {
      const query = (await request.json()) as {
        method: string;
        params: any[];
        id: unknown;
      };
      if (historyUnavailable && query.method === "eth_getLogs")
        return Response.json({
          jsonrpc: "2.0",
          id: query.id,
          error: { code: -32000, message: "historical data unavailable" },
        });
      if (
        omitKnownVaults &&
        query.method === "eth_getLogs" &&
        String(query.params[0]?.address).toLowerCase() === factory.toLowerCase()
      )
        return Response.json({ jsonrpc: "2.0", id: query.id, result: [] });
      if (
        holdStraggler &&
        query.method === "eth_sendRawTransaction" &&
        parseTransaction(query.params[0]).to?.toLowerCase() === straggler
      )
        return Response.json({
          jsonrpc: "2.0",
          id: query.id,
          error: { code: -32000, message: "injected send unavailable" },
        });
      if (
        refusalUnavailable &&
        query.method === "eth_call" &&
        String(query.params[0]?.from).toLowerCase().endsWith("dead")
      )
        return Response.json({
          jsonrpc: "2.0",
          id: query.id,
          error: { code: -32601, message: "method not available" },
        });
      const body = await raw(query.method, query.params);
      if (query.method === "eth_getTransactionReceipt" && receiptFault) {
        return Response.json({
          jsonrpc: "2.0",
          id: query.id,
          result:
            receiptFault === "missing"
              ? null
              : { ...body.result, blockHash: `0x${"00".repeat(32)}` },
        });
      }
      if (
        query.method === "eth_getBlockByNumber" &&
        query.params[0] === "finalized" &&
        finalityLimit
      )
        return Response.json({
          jsonrpc: "2.0",
          id: query.id,
          ...(await raw(query.method, [finalityLimit, false])),
        });
      if (query.method === "eth_sendRawTransaction" && body.result)
        await rpc("anvil_mine", ["0x40"]);
      return Response.json({ jsonrpc: "2.0", id: query.id, ...body });
    },
  });
  await rpc("anvil_setCode", [
    CREATE2_DEPLOYER,
    "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3",
  ]);
  const token = (await deploy("TestDollar.sol", "TestDollar")).contractAddress;
  const vaultLogic = (await deploy("ProjectEscrow.sol", "ProjectEscrow"))
    .contractAddress;
  const factoryLogic = (await deploy("ProjectEscrow.sol", "EscrowFactory"))
    .contractAddress;
  const initialize = encodeFunctionData({
    abi,
    functionName: "initialize",
    args: [
      owner.address,
      fee.address,
      identity.address,
      0n,
      owner.address,
      vaultLogic,
    ],
  });
  const proxy = await deploy(
    "ERC1967Proxy.sol",
    "ERC1967Proxy",
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }],
      [factoryLogic, initialize],
    ).slice(2),
  );
  factory = proxy.contractAddress;
  deploymentBlock = BigInt(proxy.blockNumber).toString();
  const projectId = `0x${"91".repeat(32)}`;
  const sourceDigest = `0x${"92".repeat(32)}`;
  const creation = await send(
    buildCreateVaultCalldata({ projectId, asset: token, monthlyCap: "1000" }),
    factory,
  );
  const key = evmVaultKey({ owner: owner.address, projectId, asset: token });
  const vaultWord = await rpc("eth_call", [
    {
      to: factory,
      data: encodeFunctionData({
        abi,
        functionName: "vaults",
        args: [key as `0x${string}`],
      }),
    },
    "latest",
  ]);
  const vault = `0x${vaultWord.slice(-40)}`;
  await call(token, "mint", [owner.address, 1000n]);
  await call(token, "approve", [vault, 1000n]);
  await call(vault, "deposit", [1000n]);
  const awardId = evmAwardId(84532n, vault, sourceDigest);
  await send(
    buildCommitAwardCalldata({
      obligationId: awardId,
      githubUserId: "101",
      grossMicro: "100",
      sourceDigest,
    }),
    vault,
  );
  const binding = {
    githubUserId: "101",
    destination: owner.address,
    expectedVersion: "0",
    claimDigest: `0x${"94".repeat(32)}`,
    expiresAt: "1900000000",
  };
  await send(
    buildBindCalldata({
      ...binding,
      walletSignature: await owner.sign({
        hash: evmBindingDigest(84532n, vault, binding) as `0x${string}`,
      }),
    }),
    vault,
    identity.address,
  );
  // Local calendar control exercises an admitted V2 month; it is not public-network timing evidence.
  await rpc("evm_setNextBlockTimestamp", [
    Date.parse("2026-12-04T01:00:00Z") / 1000,
  ]);
  const entries = [
    {
      githubUserId: "102",
      grossMicro: "200",
      sourceDigest: `0x${"93".repeat(32)}`,
    },
  ];
  const tree = evmMonthlySumTree(entries);
  const reservation = {
    version: 2 as const,
    allocationDigest: evmAllocationRoot(entries),
    allocationRoot: tree.hash,
    wholeGross: "200",
    remainingGross: "200",
    count: 1,
    sourceSequence: "1",
  };
  await send(
    buildReserveMonthlyCalldata(
      "2026-11",
      reservation,
      await identity.sign({
        hash: evmMonthlyReserveDigest(
          84532n,
          vault,
          "2026-11",
          reservation,
        ) as `0x${string}`,
      }),
    ),
    vault,
  );
  const finalBlock = BigInt(await rpc("eth_blockNumber", []));
  for (const [name, start] of [
    ["future-start", finalBlock + 1n],
    ["late-start", BigInt(creation.blockNumber) + 1n],
  ] as const) {
    const outcome = await run("plan", name, start.toString());
    assert.equal(outcome.exit, before ? 0 : 1, `${name} ${outcome.stderr}`);
    if (!before)
      assert.match(
        outcome.stderr,
        name === "future-start"
          ? /outside finalized history/
          : /existed before the supplied deployment block/,
      );
    results[name] = { exit: outcome.exit };
  }
  historyUnavailable = true;
  const missingHistory = await run("plan", "unavailable-history");
  assert.equal(missingHistory.exit, 1);
  assert.match(missingHistory.stderr, /historical data unavailable/);
  historyUnavailable = false;
  results.historyUnavailable = { exit: missingHistory.exit };
  assert.equal((await run("plan", "upgrade")).exit, 0);
  const laterProject = `0x${"95".repeat(32)}`;
  await send(
    buildCreateVaultCalldata({
      projectId: laterProject,
      asset: token,
      monthlyCap: "1000",
    }),
    factory,
  );
  const laterKey = evmVaultKey({
    owner: owner.address,
    projectId: laterProject,
    asset: token,
  });
  const laterWord = await rpc("eth_call", [
    {
      to: factory,
      data: encodeFunctionData({
        abi,
        functionName: "vaults",
        args: [laterKey as `0x${string}`],
      }),
    },
    "latest",
  ]);
  straggler = `0x${laterWord.slice(-40)}`;
  await call(token, "mint", [owner.address, 100n]);
  await call(token, "approve", [straggler, 100n]);
  await call(straggler, "deposit", [100n]);
  holdStraggler = true;
  const interrupted = await run(
    "execute",
    "upgrade",
    deploymentBlock,
    "straggler-interrupted",
  );
  assert.equal(interrupted.exit, 1);
  assert.match(interrupted.stdout, /injected send unavailable/);
  const saved = await Bun.file(join(out, "upgrade/upgrade.json")).json();
  const signature = saved.steps[`upgrade-vault:${straggler}`].transactionId;
  holdStraggler = false;
  const resumed = await run(
    "execute",
    "upgrade",
    deploymentBlock,
    "straggler-resumed",
  );
  assert.equal(resumed.exit, 0, resumed.stdout);
  const finished = await Bun.file(join(out, "upgrade/upgrade.json")).json();
  assert.equal(
    finished.steps[`upgrade-vault:${straggler}`].transactionId,
    signature,
  );
  results.stragglerResume = { exit: resumed.exit, sameTransaction: true };
  refusalUnavailable = true;
  const unavailable = await run(
    "verify",
    "upgrade",
    deploymentBlock,
    "rpc-fault",
  );
  assert.equal(unavailable.exit, before ? 0 : 1, unavailable.stderr);
  if (!before) assert.match(unavailable.stdout, /method not available/);
  results.rpcFailure = { exit: unavailable.exit };
  refusalUnavailable = false;
  omitKnownVaults = true;
  const omitted = await run(
    "verify",
    "upgrade",
    deploymentBlock,
    "missing-known-vault",
  );
  assert.equal(omitted.exit, before ? 0 : 1);
  if (!before)
    assert.match(omitted.stdout, /missing from finalized creation history/);
  omitKnownVaults = false;
  results.omittedVault = { exit: omitted.exit };
  const healthy = await run("verify", "upgrade");
  assert.equal(healthy.exit, 0, healthy.stderr);
  results.validUpgrade = { exit: healthy.exit };
  const preservationBlock = Math.max(
    ...Object.values(finished.steps).map((step: any) => Number(step.block)),
  ).toString();
  const frozen = JSON.stringify({
    before: finished.before,
    steps: finished.steps,
  });
  const payment = await send(buildPayCalldata(awardId, "1"), vault);
  assert(BigInt(payment.blockNumber) > BigInt(preservationBlock));
  const laterPayment = await run(
    "verify",
    "upgrade",
    deploymentBlock,
    "later-payment",
  );
  const expectPaymentFailure =
    process.env.SLOP_UPGRADE_EXPECT_LATER_PAYMENT_FAILURE === "1";
  assert.equal(
    laterPayment.exit,
    expectPaymentFailure ? 1 : 0,
    laterPayment.stdout,
  );
  if (expectPaymentFailure) {
    assert.match(laterPayment.stdout, /Upgrade verification failed: vault/);
    results.laterPayment = {
      reproduced: true,
      exit: laterPayment.exit,
      preservationBlock,
    };
    await Bun.write(
      join(out, "result.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    console.log(JSON.stringify(results));
    process.exitCode = 0;
  } else {
    const qualified = await Bun.file(join(out, "upgrade/upgrade.json")).json();
    assert.equal(
      JSON.stringify({ before: qualified.before, steps: qualified.steps }),
      frozen,
    );
    assert.equal(qualified.verification.preservationBlock, preservationBlock);
    assert.equal(qualified.verification.laterPayments.length, 1);
    assert.equal(
      qualified.verification.laterPayments[0].transactionId,
      payment.transactionHash,
    );
    await rpc("anvil_mine", ["0x40"]);
    const repeated = await run(
      "verify",
      "upgrade",
      deploymentBlock,
      "later-payment-replay",
    );
    assert.equal(repeated.exit, 0, repeated.stdout);
    const replay = await Bun.file(join(out, "upgrade/upgrade.json")).json();
    assert.equal(replay.verification.preservationBlock, preservationBlock);
    assert.equal(replay.verification.laterPayments.length, 1);
    const journalFile = join(out, "upgrade/upgrade.json");
    const original = await readFile(journalFile);
    const originalHash = createHash("sha256").update(original).digest("hex");
    const sidecar = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "scripts/escrow-acceptance/upgrade-verify.ts",
        "base-sepolia",
        journalFile,
        replay.sourceCommit,
        originalHash,
        join(out, "read-only-verification.json"),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          ESCROW_ACCEPTANCE_RPC_URL: `http://127.0.0.1:${port + 1}`,
          ESCROW_ACCEPTANCE_FACTORY: factory,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [sidecarOut, sidecarError, sidecarExit] = await Promise.all([
      new Response(sidecar.stdout).text(),
      new Response(sidecar.stderr).text(),
      sidecar.exited,
    ]);
    assert.equal(sidecarExit, 0, sidecarError);
    assert.deepEqual(await readFile(journalFile), original);
    assert.equal(JSON.parse(sidecarOut).originalPlanUnchanged, true);
    results.readOnlySidecar = {
      exit: sidecarExit,
      originalPlanUnchanged: true,
      noSigningKey: true,
    };
    for (const fault of ["missing", "canonical"] as const) {
      receiptFault = fault;
      const refused = await run(
        "verify",
        "upgrade",
        deploymentBlock,
        `receipt-${fault}`,
      );
      assert.equal(refused.exit, fault === "missing" ? 75 : 1, refused.stdout);
      results[`receipt-${fault}`] = { exit: refused.exit };
    }
    receiptFault = null;
    finalityLimit = toHex(BigInt(preservationBlock) - 1n);
    const notFinal = await run(
      "verify",
      "upgrade",
      deploymentBlock,
      "completion-not-final",
    );
    assert.equal(notFinal.exit, 75, notFinal.stdout);
    finalityLimit = null;
    results.completionNotFinal = { exit: notFinal.exit };
    results.laterPayment = {
      exit: laterPayment.exit,
      preservationBlock,
      exactFrozenPlan: true,
      replay: true,
    };
  }
  if (!expectPaymentFailure) {
    const mapping = (key: string | bigint, slot: bigint, offset = 0n) =>
      toHex(
        BigInt(
          keccak256(
            encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint256" }],
              [BigInt(key), slot],
            ),
          ),
        ) + offset,
        { size: 32 },
      );
    for (const [name, slot] of [
      ["funded-award", mapping(awardId, 11n)],
      ["consumed-source", mapping(sourceDigest, 12n)],
      ["binding", mapping(101n, 13n)],
      ["monthly-root", mapping(202611n, 17n)],
      ["monthly-reserve", mapping(202611n, 20n, 1n)],
      ["source-sequence", toHex(19n, { size: 32 })],
    ] as const) {
      const old = await rpc("eth_getStorageAt", [vault, slot, "latest"]);
      await rpc("anvil_setStorageAt", [vault, slot, toHex(999n, { size: 32 })]);
      await rpc("anvil_mine", ["0x40"]);
      const changed = await run("verify", "upgrade", deploymentBlock, name);
      assert.equal(changed.exit, before ? 0 : 1, `${name} ${changed.stderr}`);
      if (!before)
        assert.match(
          changed.stdout,
          /Upgrade verification failed: vault .* (mapping|slot 19)/,
        );
      results[name] = { exit: changed.exit };
      await rpc("anvil_setStorageAt", [vault, slot, old]);
      await rpc("anvil_mine", ["0x40"]);
    }
    const restored = await run(
      "verify",
      "upgrade",
      deploymentBlock,
      "restored",
    );
    assert.equal(restored.exit, 0, restored.stdout);
    results.restored = { exit: restored.exit };
    await call(token, "mint", [owner.address, 1n]);
    await call(token, "approve", [vault, 1n]);
    await call(vault, "deposit", [1n]);
    const otherActivity = await run(
      "verify",
      "upgrade",
      deploymentBlock,
      "other-activity",
    );
    assert.equal(otherActivity.exit, 1, otherActivity.stdout);
    assert.match(
      otherActivity.stdout,
      /Later non-payment activity is unqualified/,
    );
    results.unrelatedActivity = { exit: otherActivity.exit };
  }
  await Bun.write(
    join(out, "result.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results));
} finally {
  gateway?.stop(true);
  anvil.kill("SIGTERM");
}
