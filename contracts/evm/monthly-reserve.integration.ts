/** Real local-chain qualification of whole-month admission and bounded award materialization.
 * Uses generated local chain state and public Anvil fixture accounts, never a live network. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { escrowAwardOrigin } from "../../src/lib/payments/escrow-cycle";
import {
  type ExecutorEnvironment,
  type JournalStore,
  submitEvmMonthly,
} from "../../workers/payment-executor/core";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import {
  buildBindCalldata,
  buildCommitAwardCalldata,
  buildCommitMonthlyCalldata,
  buildCommitMonthlyLeafCalldata,
  buildCreateVaultCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildReserveMonthlyCalldata,
  buildSetMonthlyCommitmentCalldata,
  buildWithdrawCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  type EvmEscrowConfig,
  EvmMonthlyAlreadyAdmitted,
  evmAllocationRoot,
  evmAwardId,
  evmBindingDigest,
  evmMonthlyDigest,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
  evmVaultKey,
  type MonthlyAllocationEntry,
  prepareEvmMonthlyReservation,
  readEvmMonthlyReserve,
  readVaultTotals,
  verifyEvmDeployment,
  verifyPayment,
} from "./adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "./integration/upgrade";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = process.env.SLOP_MONTHLY_TEST_PORT ?? "28647";
const rpcUrl = `http://127.0.0.1:${port}`;
const anvil = spawn(
  "anvil",
  ["--port", port, "--chain-id", "84532", "--silent"],
  { stdio: "ignore" },
);
const accounts = Array.from({ length: 6 }, (_, addressIndex) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex },
  ),
);
const [owner, authority, recipient, fee, gas] = accounts;
const chainId = 84532n;
const period = "2026-11";
const projectId = "eliza";
const digest = (bytes: string) =>
  createHash("sha256")
    .update(Buffer.from(bytes.replace(/^0x/, ""), "hex"))
    .digest("hex");
const projectDigest = `0x${createHash("sha256").update(`slop-project:${projectId}`).digest("hex")}`;
const allocationDigest = `0x${"a".repeat(64)}`;
const ABI = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256)",
  "function vaults(bytes32) view returns (address)",
  "function pendingMonthlyGross() view returns (uint128)",
  "function ordinarySourceSequence() view returns (uint256)",
  "function freeBalance() view returns (uint128)",
  "function awards(bytes32) view returns (uint64,uint128,uint128,bytes32,uint64,bool)",
  "function balanceOf(address) view returns (uint256)",
]);
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
async function finalized() {
  await rpc("anvil_mine", ["0x40"]);
}
type Receipt = {
  status: string;
  gasUsed: string;
  blockNumber: string;
  logs: { topics: string[]; logIndex: string }[];
};
async function send(
  to: string,
  data: string,
  from = owner.address,
  success = true,
) {
  const hash = String(
    await rpc("eth_sendTransaction", [{ from, to, data, gas: "0x1c9c380" }]),
  );
  let receipt: Receipt | null = null;
  for (let i = 0; i < 100 && !receipt; ++i) {
    receipt = (await rpc("eth_getTransactionReceipt", [
      hash,
    ])) as Receipt | null;
    if (!receipt) await Bun.sleep(10);
  }
  assert(receipt, "local transaction mined");
  assert.equal(
    receipt.status,
    success ? "0x1" : "0x0",
    `expected ${success ? "success" : "revert"}: ${hash}`,
  );
  return { hash, receipt };
}
function deploy(contract: string, args: string[] = []): string {
  if (contract === "src/ProjectEscrow.sol:EscrowFactory" && args.length)
    return deployUpgradeableFactory(deploy, args);
  const output = execFileSync(
    "forge",
    [
      "create",
      "--root",
      root,
      contract,
      "--rpc-url",
      rpcUrl,
      "--unlocked",
      "--from",
      owner.address,
      "--broadcast",
      "--json",
      ...(args.length ? ["--constructor-args", ...args] : []),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output).deployedTo;
}
async function value(to: string, signature: string, args: string[] = []) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  return String(await rpc("eth_call", [{ to, data }, "latest"]));
}
function journal() {
  const records = new Map<string, unknown>();
  const store: JournalStore = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put<T>(key: string, data: T) {
      records.set(key, structuredClone(data));
    },
    async transaction<T>(fn: (tx: JournalStore) => Promise<T>) {
      return fn(store);
    },
  };
  return { records, store };
}

try {
  for (let i = 0; ; ++i) {
    try {
      await rpc("eth_chainId", []);
      break;
    } catch {
      if (i >= 100 || anvil.exitCode !== null)
        throw new Error("Local Anvil unavailable");
      await Bun.sleep(25);
    }
  }
  await rpc("evm_setNextBlockTimestamp", [1796342400]);
  const token = deploy("integration/TestDollar.sol:TestDollar");
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner.address,
    fee.address,
    authority.address,
    "0",
  ]);
  const created = await send(
    factory,
    buildCreateVaultCalldata({
      projectId: projectDigest,
      asset: token,
      monthlyCap: "100000000",
      automaticMonthly: true,
    }),
  );
  const vaultKey = evmVaultKey({
    owner: owner.address,
    projectId: projectDigest,
    asset: token,
  });
  const vault = `0x${(await value(factory, "vaults(bytes32)", [vaultKey])).slice(-40)}`;
  await send(
    token,
    encodeFunctionData({
      abi: ABI,
      functionName: "mint",
      args: [owner.address, 150000001n],
    }),
  );
  await send(
    token,
    encodeFunctionData({
      abi: ABI,
      functionName: "approve",
      args: [vault as `0x${string}`, 150000001n],
    }),
  );
  await send(vault, buildDepositCalldata("150000000"));
  const config: EvmEscrowConfig = {
    rpcUrl,
    chainId,
    vault,
    asset: token,
    owner: owner.address,
    identityAuthority: authority.address,
    feeRecipient: fee.address,
    codeSha256: digest(String(await rpc("eth_getCode", [vault, "latest"]))),
    bindingDelaySeconds: "0",
    factory,
    factoryCodeSha256: digest(
      String(await rpc("eth_getCode", [factory, "latest"])),
    ),
    registrar: owner.address,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  await finalized();
  await verifyEvmDeployment(config);
  const entries: MonthlyAllocationEntry[] = Array.from(
    { length: 100 },
    (_, index) => ({
      githubUserId: String(1001 + index),
      grossMicro: "1000000",
      sourceDigest: `0x${escrowAwardOrigin(projectId, period, String(1001 + index))}`,
    }),
  );
  const commit = (entry: MonthlyAllocationEntry) =>
    buildCommitAwardCalldata({
      obligationId: evmAwardId(chainId, vault, entry.sourceDigest),
      githubUserId: entry.githubUserId,
      grossMicro: entry.grossMicro,
      sourceDigest: entry.sourceDigest,
    });
  await send(vault, commit(entries[0]));
  await finalized();
  const originalAward = await value(vault, "awards(bytes32)", [
    evmAwardId(chainId, vault, entries[0].sourceDigest),
  ]);
  await assert.rejects(
    prepareEvmMonthlyReservation(config, period, allocationDigest, [
      entries[0],
      entries[0],
    ]),
    /Repeated monthly source/,
  );
  const first = await prepareEvmMonthlyReservation(
    config,
    period,
    allocationDigest,
    entries,
  );
  assert(first);
  assert.equal(
    first.entries.length,
    99,
    "historical source needs no second reserve",
  );
  const firstDigest = evmMonthlyReserveDigest(
    chainId,
    vault,
    period,
    first.reservation,
  );
  const firstSignature = await authority.sign({ hash: firstDigest });
  const legacySignature = await authority.sign({
    hash: evmMonthlyDigest(
      chainId,
      vault,
      period,
      evmAllocationRoot(entries),
    ) as `0x${string}`,
  });
  const legacyGas = BigInt(
    String(
      await rpc("eth_estimateGas", [
        {
          from: gas.address,
          to: vault,
          data: buildCommitMonthlyCalldata(period, entries, legacySignature),
        },
      ]),
    ),
  );
  assert(
    (legacyGas * 12n) / 10n > 500000n,
    "the old whole-array operation exceeds the unchanged gas bound",
  );

  // A manual award lands after signing. Stale admission must change no reserve/root.
  await send(vault, commit(entries[1]));
  const beforeRace = await value(vault, "freeBalance()");
  await send(
    vault,
    buildReserveMonthlyCalldata(period, first.reservation, firstSignature),
    gas.address,
    false,
  );
  assert.equal(await value(vault, "freeBalance()"), beforeRace);
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 0n);
  await finalized();
  const next = await prepareEvmMonthlyReservation(
    config,
    period,
    allocationDigest,
    entries,
  );
  assert(next);
  assert.equal(next.entries.length, 98);
  assert.equal(
    next.reservation.allocationDigest,
    first.reservation.allocationDigest,
  );
  assert(
    BigInt(next.reservation.sourceSequence) >
      BigInt(first.reservation.sourceSequence),
  );
  const nextDigest = evmMonthlyReserveDigest(
    chainId,
    vault,
    period,
    next.reservation,
  );
  const signature = await authority.sign({ hash: nextDigest });
  // Legacy signatures cannot admit V2, even for the same period and economic allocation.
  await send(
    vault,
    buildReserveMonthlyCalldata(period, next.reservation, legacySignature),
    gas.address,
    false,
  );
  await send(vault, buildWithdrawCalldata("50000001"));
  await send(
    vault,
    buildReserveMonthlyCalldata(period, next.reservation, signature),
    gas.address,
    false,
  );
  assert.equal(
    BigInt(await value(vault, "pendingMonthlyGross()")),
    0n,
    "underfunded admission is atomic",
  );
  await send(vault, buildDepositCalldata("1"));
  await finalized();
  const execution = journal();
  const env: ExecutorEnvironment = {
    PAYMENTS_DB: {
      prepare() {
        throw new Error("Monthly executor must not access wallet consents");
      },
      async batch() {
        throw new Error("Unexpected database access");
      },
    },
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      {
        ...config,
        chainId: chainId.toString(),
        network: "base-sepolia",
        chain: "base",
        projectId,
        gasCeiling: "500000",
      },
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
    SIGNER: gas,
    JOURNAL: execution.store,
  };
  const authorization = {
    plan: {
      request: {
        projectId,
        period,
        network: "base-sepolia",
        snapshotSha256: allocationDigest.slice(2),
      },
      deployment: config,
      family: "evm",
      allocationRoot: next.reservation.allocationRoot,
      messageHex: nextDigest.slice(2),
      totalGrossBase: next.reservation.wholeGross,
      entries: next.entries,
      evmReservation: next.reservation,
    },
    signatureHex: signature.slice(2),
  } as unknown as MonthlyAuthorization;
  await submitEvmMonthly(env, authorization);
  await finalized();
  const totals = await readVaultTotals({ ...config, network: "base-sepolia" });
  assert.equal(totals.freeBalance, "0");
  assert.equal(
    totals.reserved,
    "100000000",
    "combined snapshot includes both awards and the pending month",
  );
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 98000000n);
  await assert.rejects(
    prepareEvmMonthlyReservation(config, period, allocationDigest, entries),
    EvmMonthlyAlreadyAdmitted,
  );
  await send(vault, buildWithdrawCalldata("1"), owner.address, false);
  await send(
    vault,
    buildReserveMonthlyCalldata(period, next.reservation, signature),
    gas.address,
    false,
  );
  const laterManual = {
    githubUserId: "9999",
    grossMicro: "1",
    sourceDigest: `0x${"b".repeat(64)}`,
  };
  await send(vault, commit(laterManual), owner.address, false);
  await send(vault, buildSetMonthlyCommitmentCalldata("0", false));
  await rpc("evm_setNextBlockTimestamp", [1799020801]);
  await finalized();

  // Existing funded awards retain their bytes and can pay while leaves remain, after Off/window end.
  assert.equal(
    await value(vault, "awards(bytes32)", [
      evmAwardId(chainId, vault, entries[0].sourceDigest),
    ]),
    originalAward,
  );
  const binding = {
    githubUserId: entries[0].githubUserId,
    destination: recipient.address,
    expectedVersion: "0",
    claimDigest: `0x${"c".repeat(64)}`,
    expiresAt: "1800000000",
  };
  const walletSignature = await recipient.sign({
    hash: evmBindingDigest(chainId, vault, binding) as `0x${string}`,
  });
  await send(
    vault,
    buildBindCalldata({ ...binding, walletSignature }),
    authority.address,
  );
  const paid = await send(
    vault,
    buildPayCalldata(evmAwardId(chainId, vault, entries[0].sourceDigest), "1"),
    gas.address,
  );
  await finalized();
  const paidLog = paid.receipt.logs.find(
    (log) => log.topics[0] === EVM_ESCROW_EVENT_TOPICS.Paid,
  );
  assert(paidLog);
  const payment = await verifyPayment(
    config,
    paid.hash,
    Number(BigInt(paidLog.logIndex)),
    evmAwardId(chainId, vault, entries[0].sourceDigest),
  );
  assert.equal(payment.netMicro, "980000");
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 98000000n);
  const tree = evmMonthlySumTree(next.entries);
  await send(
    vault,
    buildCommitMonthlyLeafCalldata(period, next.entries[0], 1, tree.proofs[0]),
    gas.address,
    false,
  );
  const firstLeaf = await submitEvmMonthly(env, authorization, false, 1);
  assert.equal(firstLeaf.complete, false);
  await finalized();
  await send(
    vault,
    buildCommitMonthlyLeafCalldata(period, next.entries[0], 0, tree.proofs[0]),
    gas.address,
    false,
  );
  await send(vault, commit(laterManual), owner.address, false);
  let complete = false;
  for (let runs = 0; runs < 10; ++runs) {
    const result = await submitEvmMonthly(env, authorization, false, 16);
    if (result.complete) {
      complete = true;
      break;
    }
    await finalized();
  }
  assert(
    complete,
    "bounded restarts finish all leaves after opt-out and admission window expiry",
  );
  assert.equal((await readEvmMonthlyReserve(config, period)).remaining, 0n);
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 0n);
  const completed = await readVaultTotals({
    ...config,
    network: "base-sepolia",
  });
  assert.equal(
    BigInt(completed.reservedPrincipal ?? "0") +
      BigInt(completed.reservedFees ?? "0"),
    99000000n,
  );
  await send(
    token,
    encodeFunctionData({
      abi: ABI,
      functionName: "mint",
      args: [owner.address, 1n],
    }),
  );
  await send(
    token,
    encodeFunctionData({
      abi: ABI,
      functionName: "approve",
      args: [vault as `0x${string}`, 1n],
    }),
  );
  await send(vault, buildDepositCalldata("1"));
  await send(vault, commit(laterManual));
  const gasUsed: bigint[] = [];
  for (const item of execution.records.values()) {
    const record = item as { transactionId?: string };
    if (record?.transactionId) {
      const receipt = (await rpc("eth_getTransactionReceipt", [
        record.transactionId,
      ])) as Receipt;
      assert.equal(receipt.status, "0x1");
      gasUsed.push(BigInt(receipt.gasUsed));
      const tx = (await rpc("eth_getTransactionByHash", [
        record.transactionId,
      ])) as { gas: string };
      assert(
        BigInt(tx.gas) <= 500000n,
        "every signed bounded transaction respects the unchanged limit",
      );
    }
  }
  console.log(
    JSON.stringify(
      {
        result: "pass",
        awards: entries.length,
        newlyMaterialized: next.entries.length,
        legacyGas: legacyGas.toString(),
        highestBoundedGas: gasUsed
          .reduce((a, b) => (a > b ? a : b), 0n)
          .toString(),
        signedTransactions: gasUsed.length,
        configuredGasCeiling: "500000",
        createdAtBlock: created.receipt.blockNumber,
        wholeMonthReserve: next.reservation.remainingGross,
        principalAndFeesAfterOneOldPayment: "99000000",
        manualRace: "rejected-before-reserve",
        optedOutAndWindowExpired: "leaves-completed",
        replay: "refused",
        withdrawalOfReservedFunds: "refused",
      },
      null,
      2,
    ),
  );
} finally {
  anvil.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (anvil.exitCode !== null) resolve();
    else anvil.once("exit", () => resolve());
  });
}
