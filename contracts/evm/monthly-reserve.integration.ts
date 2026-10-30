/** Real local-chain qualification of whole-month admission and bounded award materialization.
 * Uses generated local chain state and public Anvil fixture accounts, never a live network. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { handlePaymentsApi } from "../../backend/payments/handler";
import { coordinateMonthlyPayments } from "../../backend/payments/monthly";
import type { MonthlyAttestationPlan } from "../../backend/payments/monthly-attestation";
import { publishMonthlyAuthorizations } from "../../backend/payments/monthly-publication";
import { storeVaultSnapshot } from "../../backend/payments/vault-snapshots";
import { CloudflareProjectPersistence } from "../../backend/projects/cloudflare-persistence";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { runKeeper } from "../../scripts/payment-keeper/keeper";
import { openKeeperStore } from "../../scripts/payment-keeper/store";
import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import { escrowAwardOrigin } from "../../src/lib/payments/escrow-cycle";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { sha256Hex } from "../../src/lib/sha256";
import { createMonthlyAllocationFixture } from "../../tests/monthly-allocation-fixture";
import {
  type ExecutorEnvironment,
  type JournalStore,
  submitEvmMonthly,
} from "../../workers/payment-executor/core";
import {
  type MonthlyAuthorization,
  signMonthlyAllocation,
} from "../../workers/payment-executor/monthly";
import {
  checkMonthlyReserveRelease,
  prepareMonthlyReserveRelease,
} from "../../workers/payment-executor/monthly-release";
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
import {
  inspectEvmMonthlyWrongSum,
  prepareEvmMonthlyWrongSumRelease,
} from "./monthly-reserve";

const root = fileURLToPath(new URL(".", import.meta.url));
const legacyRoot = process.env.SLOP_MONTHLY_LEGACY_ROOT;
let deploymentRoot = legacyRoot ?? root;
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
const [owner, authority, recipient, fee, gas, registrar] = accounts;
const chainId = 84532n;
const period = "2026-11";
const projectId = "eliza";
const digest = (bytes: string) =>
  createHash("sha256")
    .update(Buffer.from(bytes.replace(/^0x/, ""), "hex"))
    .digest("hex");
const projectDigest = `0x${createHash("sha256").update(`slop-project:${projectId}`).digest("hex")}`;

const ABI = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256)",
  "function vaults(bytes32) view returns (address)",
  "function pendingMonthlyGross() view returns (uint128)",
  "function ordinarySourceSequence() view returns (uint256)",
  "function freeBalance() view returns (uint128)",
  "function awards(bytes32) view returns (uint64,uint128,uint128,bytes32,uint64,bool)",
  "function balanceOf(address) view returns (uint256)",
  "function monthlyReleaseDigest(uint32,uint128,uint128) view returns (bytes32)",
  "function proposeIdentityAuthority(address)",
  "function executeIdentityAuthorityRotation()",
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
      deploymentRoot,
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
  return String(JSON.parse(output).deployedTo).toLowerCase();
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

let keeperApi: ReturnType<typeof Bun.serve> | undefined;
let keeperStore: ReturnType<typeof openKeeperStore> | undefined;
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
    registrar.address,
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
    owner: owner.address.toLowerCase(),
    identityAuthority: authority.address.toLowerCase(),
    feeRecipient: fee.address.toLowerCase(),
    codeSha256: digest(String(await rpc("eth_getCode", [vault, "latest"]))),
    bindingDelaySeconds: "0",
    factory,
    factoryCodeSha256: digest(
      String(await rpc("eth_getCode", [factory, "latest"])),
    ),
    registrar: registrar.address.toLowerCase(),
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  await finalized();
  await verifyEvmDeployment(config);
  // A lost tree is not a fault proof. Exercise the read-only classifier against actual admitted
  // states, then restore this isolated fixture before the existing whole-month workflow.
  if (!legacyRoot) {
    const releaseEntries = [
      {
        githubUserId: "11",
        grossMicro: "1000",
        sourceDigest: `0x${"a".repeat(64)}`,
      },
      {
        githubUserId: "12",
        grossMicro: "2000",
        sourceDigest: `0x${"b".repeat(64)}`,
      },
    ];
    const tree = evmMonthlySumTree(releaseEntries);
    const capture = {
      allocationDigest: `0x${"c".repeat(64)}`,
      entries: releaseEntries,
    };
    const readOnly: EvmEscrowConfig = {
      ...config,
      rpcUrl: undefined,
      request: async (method, params) => {
        assert(
          [
            "eth_chainId",
            "eth_call",
            "eth_getCode",
            "eth_getStorageAt",
            "eth_getBlockByNumber",
          ].includes(method),
        );
        return rpc(method, params);
      },
    };
    for (const fault of ["healthy", "sum", "count"] as const) {
      const snapshot = await rpc("evm_snapshot", []);
      try {
        const reservation = {
          version: 2 as const,
          allocationDigest: capture.allocationDigest,
          allocationRoot: tree.hash,
          wholeGross: "10000",
          remainingGross: (
            tree.total + (fault === "healthy" ? 0n : 1n)
          ).toString(),
          count: releaseEntries.length + (fault === "count" ? 1 : 0),
          sourceSequence: "0",
        };
        const signature = await authority.sign({
          hash: evmMonthlyReserveDigest(chainId, vault, period, reservation),
        });
        await send(
          vault,
          buildReserveMonthlyCalldata(period, reservation, signature),
        );
        await finalized();
        const before = await readEvmMonthlyReserve(config, period);
        const releaseFixture = await createMonthlyAllocationFixture({
          deployment: {
            network: "base-sepolia",
            vault,
            asset: token,
            owner: config.owner,
            identityAuthority: config.identityAuthority,
            feeRecipient: config.feeRecipient,
            codeSha256: config.codeSha256,
            bindingDelaySeconds: "0",
            rotationDelaySeconds: null,
            factory,
            factoryCodeSha256: config.factoryCodeSha256,
            registrar: config.registrar,
            evmUpgrade: config.evmUpgrade,
            programId: null,
            upgradeAuthority: null,
            projectPda: null,
            networkDomain: null,
            deploymentTransaction: created.hash,
            sourceCommit: "8a72098a9e4fd5c5828da4d18d882e1a6cb89bcf",
          },
          period,
        });
        const releaseDeployment =
          releaseFixture.project.manifest.escrow?.deployments[0];
        if (!releaseDeployment)
          throw new Error("Missing release fixture deployment");
        const releaseRequest = {
          projectId,
          period,
          network: "base-sepolia" as const,
          manifestSha256: releaseFixture.project.manifestSha256,
        };
        let releaseSigns = 0;
        const releaseJournal = journal();
        const releaseDependencies = {
          db: releaseFixture.db,
          journal: releaseJournal.store,
          getProject: releaseFixture.getProject,
          pinned: [
            { ...paymentDeploymentRecord(projectId, releaseDeployment) },
          ],
          family: "evm" as const,
          evm: async () => readOnly,
          solana: async () => {
            throw new Error("Wrong family");
          },
          sign: async (messageHex: string) => {
            releaseSigns++;
            return (await authority.sign({ hash: `0x${messageHex}` })).slice(2);
          },
        };
        assert.equal(
          (
            await prepareMonthlyReserveRelease(
              releaseDependencies,
              releaseRequest,
            )
          ).status,
          "held",
        );
        assert.equal(releaseSigns, 0, "missing captures never reach the key");
        releaseFixture.sqlite
          .prepare(
            "INSERT INTO monthly_payment_runs(project_id,period,trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,vault,total_gross_base,frozen_at,obligations_created_at) VALUES(?,?,'automatic',NULL,0,'{}',?,'base-sepolia',?,?,'2026-12-04T00:00:00Z','2026-12-04T00:00:00Z')",
          )
          .run(
            projectId,
            period,
            capture.allocationDigest.slice(2),
            vault,
            reservation.wholeGross,
          );
        const retainedAuthorization = {
          plan: {
            request: {
              projectId,
              period,
              network: "base-sepolia",
              snapshotSha256: capture.allocationDigest.slice(2),
            },
            deployment: releaseDeployment,
            allocationRoot: tree.hash,
            messageHex: evmMonthlyReserveDigest(
              chainId,
              vault,
              period,
              reservation,
            ).slice(2),
            family: "evm",
            totalGrossBase: reservation.wholeGross,
            evmReservation: reservation,
            entries: releaseEntries,
          },
          signatureHex: signature.slice(2),
        };
        releaseFixture.sqlite
          .prepare(
            "INSERT INTO monthly_payment_authorizations(project_id,period,network,snapshot_sha256,authorization,published_at) VALUES(?,?,'base-sepolia',?,?,'2026-12-04T00:00:00Z')",
          )
          .run(
            projectId,
            period,
            capture.allocationDigest.slice(2),
            JSON.stringify(retainedAuthorization),
          );
        await assert.rejects(
          prepareMonthlyReserveRelease(releaseDependencies, {
            ...releaseRequest,
            manifestSha256: "0".repeat(64),
          }),
        );
        await assert.rejects(
          prepareMonthlyReserveRelease(
            { ...releaseDependencies, pinned: [] },
            releaseRequest,
          ),
        );
        const serviceRelease = await prepareMonthlyReserveRelease(
          releaseDependencies,
          releaseRequest,
        );
        assert.equal(serviceRelease.status, fault === "sum" ? "ready" : "held");
        assert.equal(releaseSigns, fault === "sum" ? 1 : 0);
        if (serviceRelease.status === "ready") {
          assert.equal(serviceRelease.family, "evm");
          assert.equal(
            (
              await prepareMonthlyReserveRelease(
                releaseDependencies,
                releaseRequest,
              )
            ).status,
            "ready",
          );
          assert.equal(
            releaseSigns,
            1,
            "retries reuse the same verified attestation",
          );
          assert.equal(
            (
              await checkMonthlyReserveRelease(
                { ...releaseDependencies, evm: async () => config },
                {
                  ...releaseRequest,
                  planId: serviceRelease.planId,
                  transactionId: `0x${"0".repeat(64)}`,
                },
              )
            ).status,
            "pending",
          );
        }

        const result = await inspectEvmMonthlyWrongSum(
          readOnly,
          period,
          capture,
        );
        if (fault === "sum") {
          assert.equal(result.status, "provably-unsettleable");
          assert.equal(result.computedTotal, "3000");
          assert.equal(result.storedTotal, "3001");
          assert.equal(result.releasedGross, "3001");
          assert.equal(
            result.identityAuthority,
            authority.address.toLowerCase(),
          );
          for (const [index, entry] of releaseEntries.entries())
            await assert.rejects(
              rpc("eth_call", [
                {
                  to: vault,
                  data: buildCommitMonthlyLeafCalldata(
                    period,
                    entry,
                    index,
                    tree.proofs[index],
                  ),
                },
                "finalized",
              ]),
            );
          assert.equal(
            (await inspectEvmMonthlyWrongSum(readOnly, period, null)).status,
            "held",
          );
          assert.equal(
            (
              await inspectEvmMonthlyWrongSum(readOnly, period, {
                ...capture,
                allocationDigest: `0x${"d".repeat(64)}`,
              })
            ).status,
            "held",
          );
          assert.equal(
            (
              await inspectEvmMonthlyWrongSum(readOnly, period, {
                ...capture,
                entries: [releaseEntries[0]],
              })
            ).status,
            "held",
          );
          await assert.rejects(
            inspectEvmMonthlyWrongSum(
              { ...readOnly, codeSha256: "0".repeat(64) },
              period,
              capture,
            ),
          );
          await assert.rejects(
            inspectEvmMonthlyWrongSum(
              {
                ...readOnly,
                request: async (method, params) => {
                  const value = await readOnly.request(method, params);
                  if (
                    method === "eth_getBlockByNumber" &&
                    params[0] !== "finalized"
                  )
                    return {
                      ...(value as object),
                      hash: `0x${"0".repeat(64)}`,
                    };
                  return value;
                },
              },
              period,
              capture,
            ),
          );
        } else {
          assert.equal(result.status, "held");
          assert.equal(
            result.reason,
            fault === "healthy" ? "no-wrong-sum-fault" : "allocation-mismatch",
          );
          if (fault === "healthy")
            for (const [index, entry] of releaseEntries.entries())
              await rpc("eth_call", [
                {
                  to: vault,
                  data: buildCommitMonthlyLeafCalldata(
                    period,
                    entry,
                    index,
                    tree.proofs[index],
                  ),
                },
                "finalized",
              ]);
        }
        assert.deepEqual(
          await readEvmMonthlyReserve(config, period),
          before,
          "inspection cannot move or release funds",
        );
        if (fault === "sum") {
          const releaseDigest = String(
            await rpc("eth_call", [
              {
                to: vault,
                data: encodeFunctionData({
                  abi: ABI,
                  functionName: "monthlyReleaseDigest",
                  args: [202611, 3001n, 3001n],
                }),
              },
              "finalized",
            ]),
          ) as `0x${string}`;
          const attestation = await authority.sign({ hash: releaseDigest });
          await assert.rejects(
            prepareEvmMonthlyWrongSumRelease(
              readOnly,
              period,
              capture,
              await owner.sign({ hash: releaseDigest }),
            ),
          );
          const plan = await prepareEvmMonthlyWrongSumRelease(
            readOnly,
            period,
            capture,
            attestation,
          );
          assert.equal(plan.transaction.from, owner.address.toLowerCase());
          assert.equal(plan.transaction.to, vault.toLowerCase());
          assert.equal(plan.transaction.value, "0x0");
          assert.equal(plan.evidence.releasedGross, "3001");
          assert.deepEqual(await readEvmMonthlyReserve(config, period), before);
          const rotationSnapshot = await rpc("evm_snapshot", []);
          try {
            await send(
              factory,
              encodeFunctionData({
                abi: ABI,
                functionName: "proposeIdentityAuthority",
                args: [recipient.address],
              }),
              registrar.address,
            );
            await send(
              factory,
              encodeFunctionData({
                abi: ABI,
                functionName: "executeIdentityAuthorityRotation",
              }),
            );
            await finalized();
            await assert.rejects(
              prepareEvmMonthlyWrongSumRelease(
                readOnly,
                period,
                capture,
                attestation,
              ),
            );
            await send(vault, plan.transaction.data, owner.address, false);
          } finally {
            assert.equal(await rpc("evm_revert", [rotationSnapshot]), true);
          }
          let actualReleaseHash = "";
          const freeBefore = BigInt(await value(vault, "freeBalance()"));
          let lateRelease = false;
          await assert.rejects(
            prepareEvmMonthlyWrongSumRelease(
              {
                ...readOnly,
                request: async (method, params) => {
                  const call = params[0] as { from?: string; data?: string };
                  if (
                    method === "eth_call" &&
                    params[1] === "latest" &&
                    call.from === plan.transaction.from &&
                    call.data === plan.transaction.data &&
                    !lateRelease
                  ) {
                    // The prior owner request actually lands after fresh inspection,
                    // immediately before the new request's latest-state simulation.
                    lateRelease = true;
                    actualReleaseHash = (
                      await send(vault, plan.transaction.data)
                    ).hash;
                  }
                  return readOnly.request(method, params);
                },
              },
              period,
              capture,
              attestation,
            ),
          );
          assert.equal(lateRelease, true);
          await finalized();
          assert.equal(serviceRelease.status, "ready");
          if (serviceRelease.status !== "ready")
            throw new Error("Expected qualified service release");
          assert.equal(
            (
              await checkMonthlyReserveRelease(
                { ...releaseDependencies, evm: async () => config },
                {
                  ...releaseRequest,
                  planId: serviceRelease.planId,
                  transactionId: actualReleaseHash,
                },
              )
            ).status,
            "finalized",
          );
          assert.equal(
            (
              await prepareMonthlyReserveRelease(
                releaseDependencies,
                releaseRequest,
              )
            ).status,
            "held",
          );
          assert.equal(releaseSigns, 1, "a released reserve never signs again");
          for (const fault of [
            "canonical-membership",
            "receipt-index",
            "transaction-block",
            "receipt-owner",
          ]) {
            await assert.rejects(
              checkMonthlyReserveRelease(
                {
                  ...releaseDependencies,
                  evm: async () => ({
                    ...config,
                    rpcUrl: undefined,
                    request: async (method, params) => {
                      const actual = await rpc(method, params);
                      if (
                        method === "eth_getBlockByNumber" &&
                        params[0] !== "finalized" &&
                        fault === "canonical-membership"
                      )
                        return { ...(actual as object), transactions: [] };
                      if (
                        method === "eth_getTransactionReceipt" &&
                        fault === "receipt-index"
                      )
                        return {
                          ...(actual as object),
                          transactionIndex: "0x1",
                        };
                      if (
                        method === "eth_getTransactionByHash" &&
                        fault === "transaction-block"
                      )
                        return {
                          ...(actual as object),
                          blockHash: `0x${"0".repeat(64)}`,
                        };
                      if (
                        method === "eth_getTransactionReceipt" &&
                        fault === "receipt-owner"
                      )
                        return {
                          ...(actual as object),
                          from: recipient.address,
                        };
                      return actual;
                    },
                  }),
                },
                {
                  ...releaseRequest,
                  planId: serviceRelease.planId,
                  transactionId: actualReleaseHash,
                },
              ),
            );
          }

          assert.equal(
            (
              await checkMonthlyReserveRelease(
                {
                  ...releaseDependencies,
                  evm: async () => config,
                  getProject: async () => ({
                    ...releaseFixture.project,
                    revision: 2,
                    manifestSha256: "e".repeat(64),
                  }),
                },
                {
                  ...releaseRequest,
                  manifestSha256: "e".repeat(64),
                  planId: serviceRelease.planId,
                  transactionId: actualReleaseHash,
                },
              )
            ).status,
            "finalized",
            "a nonfinancial project edit cannot strand transaction recovery",
          );

          assert.equal(
            (await readEvmMonthlyReserve(config, period)).remaining,
            0n,
          );
          assert.equal(
            BigInt(await value(vault, "freeBalance()")),
            freeBefore + 3001n,
          );
          await assert.rejects(
            prepareEvmMonthlyWrongSumRelease(
              readOnly,
              period,
              capture,
              attestation,
            ),
          );
        }
        releaseFixture.sqlite.close();
      } finally {
        assert.equal(await rpc("evm_revert", [snapshot]), true);
      }
    }
  }
  const entries: MonthlyAllocationEntry[] = Array.from(
    { length: 100 },
    (_, index) => ({
      githubUserId: String(1001 + index),
      grossMicro: index === 0 ? "1000001" : index === 1 ? "999999" : "1000000",
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
  const binding = {
    githubUserId: entries[0].githubUserId,
    destination: recipient.address,
    expectedVersion: "0",
    claimDigest: `0x${"c".repeat(64)}`,
    expiresAt: "1800000000",
  };
  // The wallet signs before the optional implementation upgrade.
  const walletSignature = await recipient.sign({
    hash: evmBindingDigest(chainId, vault, binding) as `0x${string}`,
  });
  const network = "base-sepolia" as const;
  const now = new Date("2026-12-04T01:00:00Z");
  const schedule = { firstPeriod: period, cutoffSecondsAfterPeriodEnd: 259200 };
  const fixture = await createMonthlyAllocationFixture({
    deployment: {
      network,
      vault,
      asset: token,
      owner: config.owner,
      identityAuthority: config.identityAuthority,
      feeRecipient: config.feeRecipient,
      codeSha256: config.codeSha256,
      bindingDelaySeconds: "0",
      rotationDelaySeconds: null,
      factory,
      factoryCodeSha256: config.factoryCodeSha256,
      registrar: config.registrar,
      evmUpgrade: config.evmUpgrade,
      programId: null,
      upgradeAuthority: null,
      projectPda: null,
      networkDomain: null,
      deploymentTransaction: created.hash,
      sourceCommit: "8a72098a9e4fd5c5828da4d18d882e1a6cb89bcf",
    },
    period,
    capBase: "100000000",
    rows: entries.map((entry) => ({
      githubUserId: entry.githubUserId,
      grossBase: String(entry.grossMicro),
    })),
  });
  await storeVaultSnapshot(
    fixture.db,
    { projectId, network, chain: "base", vault, asset: token },
    await readVaultTotals({ ...config, network }),
    now.toISOString(),
  );
  const coordinated = await coordinateMonthlyPayments({
    db: fixture.db,
    projects: fixture,
    networks: [network],
    schedule,
    now,
  });
  assert.deepEqual(coordinated.failures, []);
  assert.deepEqual(coordinated.created, [`${projectId}/${period}`]);
  const frozen = fixture.sqlite
    .prepare("SELECT snapshot_sha256,snapshot FROM monthly_payment_runs")
    .get() as { snapshot_sha256: string; snapshot: string };
  const allocationDigest = `0x${frozen.snapshot_sha256}`;
  const attestationJournal = journal();
  let useReserve = false;
  const publication = {
    db: fixture.db,
    networks: [network],
    schedule,
    now,
    authorize: (request: Parameters<typeof signMonthlyAllocation>[1]) =>
      signMonthlyAllocation(
        {
          ...fixture,
          networks: [network],
          schedule,
          now: () => now,
          journal: attestationJournal.store,
          verifyDeployment: async () => {
            await verifyEvmDeployment(config);
          },
          ...(useReserve
            ? {
                reserve: (plan: MonthlyAttestationPlan) =>
                  prepareEvmMonthlyReservation(
                    config,
                    period,
                    `0x${plan.request.snapshotSha256}`,
                    plan.entries,
                  ),
              }
            : {}),
          sign: async (plan) =>
            (await authority.sign({ hash: `0x${plan.messageHex}` })).slice(2),
        },
        request,
      ),
  };
  const readPublished = async () => {
    const response = await handlePaymentsApi(
      new Request(
        `https://slop.cash/api/v1/payments/projects/${projectId}/monthly/${period}/authorization/${network}`,
      ),
      { db: fixture.db },
    );
    assert.equal(response.status, 200);
    return ((await response.json()) as { authorization: MonthlyAuthorization })
      .authorization;
  };
  assert.deepEqual(
    (await publishMonthlyAuthorizations(publication)).failures,
    [],
  );
  const legacyAuthorization = await readPublished();
  assert.equal(legacyAuthorization.plan.evmReservation, undefined);
  const keeperPath = join(
    mkdtempSync(join(tmpdir(), "slop-monthly-keeper-")),
    "keeper.sqlite",
  );
  keeperStore = openKeeperStore(keeperPath);
  keeperApi = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return onRequest({
        request: new Request(
          `https://slop.cash${new URL(request.url).pathname}`,
        ),
        env: {
          SLOP_DB: fixture.db,
          PAYMENT_NETWORKS: JSON.stringify([network]),
        },
      } as never);
    },
  });
  const keeperTick = async (execute = false, at = now, perRun = 1) => {
    assert(keeperStore && keeperApi);
    return runKeeper(
      {
        apiOrigin: keeperApi.url.origin,
        network,
        projectIds: [projectId],
        signer: gas.address,
        rpcUrl,
        perRun,
        gas: {
          perTransaction: "10000000000000000",
          perDay: "100000000000000000",
          additionalFeeReserve: "0",
        },
      },
      { store: keeperStore, evmSigner: gas, now: at, localChain: {} },
      execute,
    );
  };
  const keeperKey = `authorization:${projectId}:${vault}:${period}`;
  const retainPublished = async (expected: MonthlyAuthorization) => {
    const result = await keeperTick();
    assert(!result.some((item) => item.error), JSON.stringify(result));
    assert.deepEqual(await keeperStore?.journal.get(keeperKey), expected);
    keeperStore?.close();
    keeperStore = openKeeperStore(keeperPath);
  };
  await retainPublished(legacyAuthorization);
  const permanentAuthorization = fixture.sqlite
    .prepare("SELECT authorization FROM monthly_payment_authorizations")
    .get();
  if (legacyRoot) {
    const storageBefore = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        rpc("eth_getStorageAt", [vault, `0x${index.toString(16)}`, "latest"]),
      ),
    );
    const totalsBefore = await readVaultTotals({ ...config, network });
    const domainBefore = await value(vault, "domainSeparator()");
    const oldReview = config.evmUpgrade;
    assert(oldReview);
    deploymentRoot = root;
    const implementation = deploy("src/ProjectEscrow.sol:ProjectEscrow");
    const upgrade = await send(
      vault,
      execFileSync(
        "cast",
        ["calldata", "upgradeToAndCall(address,bytes)", implementation, "0x"],
        { encoding: "utf8" },
      ).trim(),
      registrar.address,
    );
    await finalized();
    config.evmUpgrade = {
      ...(await captureUpgrade(rpc, factory, vault)),
      history: [
        {
          ...oldReview,
          supersededAtBlock: BigInt(upgrade.receipt.blockNumber).toString(),
        },
      ],
    };
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          rpc("eth_getStorageAt", [vault, `0x${index.toString(16)}`, "latest"]),
        ),
      ),
      storageBefore,
      "legacy storage slots retained",
    );
    const totalsAfter = await readVaultTotals({ ...config, network });
    // The observation block advances, but every financial counter must stay unchanged.
    for (const key of [
      "freeBalance",
      "reservedPrincipal",
      "reservedFees",
      "totalDeposited",
      "totalPaid",
      "totalPayoutFees",
      "totalGrossWithdrawn",
    ] as const)
      assert.equal(totalsAfter[key], totalsBefore[key], key);
    assert.equal(
      await value(vault, "domainSeparator()"),
      domainBefore,
      "old signature domain retained",
    );
    assert.equal(
      await value(vault, "awards(bytes32)", [
        evmAwardId(chainId, vault, entries[0].sourceDigest),
      ]),
      originalAward,
    );
    const current = await fixture.getProject(projectId);
    assert(current?.manifest.escrow);
    const manifest = assertProjectDefinition({
      ...current.manifest,
      escrow: {
        ...current.manifest.escrow,
        deployments: current.manifest.escrow.deployments.map((deployment) => ({
          ...deployment,
          evmUpgrade: config.evmUpgrade,
        })),
      },
    });
    const manifestText = JSON.stringify(manifest);
    const updated = await new CloudflareProjectPersistence(
      fixture.db,
    ).appendProjectRevision(
      {
        projectId,
        expectedRevision: current.revision,
        manifest,
        manifestText,
        manifestSha256: sha256Hex(manifestText),
        reason: "Reviewed local upgrade",
        actor: { githubId: "900000071", githubLogin: "owner" },
        at: now.toISOString(),
      },
      0,
    );
    assert.equal(updated, "updated");
  }
  useReserve = true;
  assert.deepEqual(
    (await publishMonthlyAuthorizations(publication)).failures,
    [],
  );
  const firstAuthorization = await readPublished();
  assert.deepEqual(firstAuthorization.legacyAuthorization, legacyAuthorization);
  await retainPublished(firstAuthorization);
  await assert.rejects(
    prepareEvmMonthlyReservation(config, period, allocationDigest, [
      entries[0],
      entries[0],
    ]),
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
  assert.equal(firstAuthorization.plan.messageHex, firstDigest.slice(2));
  const firstSignature = `0x${firstAuthorization.signatureHex}`;
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
  assert.deepEqual(
    (await publishMonthlyAuthorizations(publication)).failures,
    [],
  );
  const authorization = await readPublished();
  assert.equal(authorization.plan.messageHex, nextDigest.slice(2));
  await retainPublished(authorization);
  assert.deepEqual(
    await keeperStore.journal.get(
      `${keeperKey}:attempt:${legacyAuthorization.plan.messageHex}`,
    ),
    legacyAuthorization,
  );
  assert.equal(
    keeperStore.db
      .query<{ n: number }, [string]>(
        "SELECT count(*) n FROM journal WHERE key LIKE ?",
      )
      .get(`${keeperKey}:attempt:%`)?.n,
    3,
  );
  assert.deepEqual(
    fixture.sqlite
      .prepare("SELECT authorization FROM monthly_payment_authorizations")
      .get(),
    permanentAuthorization,
  );
  assert.equal(
    (
      fixture.sqlite
        .prepare(
          "SELECT count(*) n FROM monthly_payment_authorization_attempts",
        )
        .get() as { n: number }
    ).n,
    2,
  );
  assert.deepEqual(
    fixture.sqlite
      .prepare("SELECT snapshot_sha256,snapshot FROM monthly_payment_runs")
      .get(),
    frozen,
  );
  const signature = `0x${authorization.signatureHex}`;
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
  await submitEvmMonthly(env, authorization);
  await finalized();
  assert.deepEqual(await publishMonthlyAuthorizations(publication), {
    published: [],
    failures: [],
  });
  assert.deepEqual(await readPublished(), authorization);
  const totals = await readVaultTotals({ ...config, network: "base-sepolia" });
  assert.equal(totals.freeBalance, "0");
  assert.equal(
    totals.reserved,
    "100000000",
    "combined snapshot includes both awards and the pending month",
  );
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 98000000n);
  if (process.env.SLOP_MONTHLY_EVIDENCE_DIR) {
    await storeVaultSnapshot(
      fixture.db,
      { projectId, network, chain: "base", vault, asset: token },
      totals,
      now.toISOString(),
    );
    const response = await handlePaymentsApi(
      new Request(
        `https://slop.cash/api/v1/payments/projects/${projectId}/vault`,
      ),
      { db: fixture.db },
    );
    assert.equal(response.status, 200);
    mkdirSync(process.env.SLOP_MONTHLY_EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(
        process.env.SLOP_MONTHLY_EVIDENCE_DIR,
        "monthly-reserve-totals.json",
      ),
      JSON.stringify(
        {
          totals,
          vaultResponse: await response.json(),
          project: (await fixture.getProject(projectId))?.manifest,
          config: { ...config, chainId: config.chainId.toString() },
          provenance:
            "Actual local Anvil vault and migrated SQLite; public fixture accounts only",
        },
        null,
        2,
      ),
    );
  }
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
    sourceDigest: `0x${escrowAwardOrigin(projectId, "2026-12", "9999")}`,
  };
  // A later month's admission is not blocked by these leaves (test/MonthlyReserveV2.t.sol); manual
  // awards are.
  await send(vault, commit(laterManual), owner.address, false);
  const laterDigest = `0x${"d".repeat(64)}`;
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
  assert.equal(payment.netMicro, legacyRoot ? "980001" : "980000");
  assert.equal(payment.feeMicro, legacyRoot ? "20000" : "20001");
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 98000000n);
  const tree = evmMonthlySumTree(next.entries);
  await send(
    vault,
    buildCommitMonthlyLeafCalldata(period, next.entries[0], 1, tree.proofs[0]),
    gas.address,
    false,
  );
  const firstLeaf = await keeperTick(true, new Date("2027-01-04T00:00:01Z"));
  assert(
    firstLeaf.some(
      (item) =>
        item.operation === `monthly:${period}` &&
        item.state === "execution-checked",
    ),
    JSON.stringify(firstLeaf),
  );
  await finalized();
  assert.equal(
    BigInt(await value(vault, "pendingMonthlyGross()")),
    97000000n,
    "keeper resumes one admitted leaf after Off and admission expiry",
  );
  await send(
    vault,
    buildCommitMonthlyLeafCalldata(period, next.entries[0], 0, tree.proofs[0]),
    gas.address,
    false,
  );
  await send(vault, commit(laterManual), owner.address, false);
  // A new permissionless keeper has no prior cursor. Already-finalized leaves consume its
  // work bound too; a long prefix must not cause an unbounded scan or extra transaction.
  await submitEvmMonthly(env, authorization, false, 20);
  await finalized();
  const resumed = journal();
  env.JOURNAL = resumed.store;
  const beforeResume = await value(vault, "pendingMonthlyGross()");
  const boundedResume = await submitEvmMonthly(env, authorization, false, 16);
  assert.equal(boundedResume.transactionId, null);
  assert.equal(boundedResume.complete, false);
  assert.equal(await value(vault, "pendingMonthlyGross()"), beforeResume);
  let complete = false;
  for (let runs = 0; runs < 2 * Math.ceil(entries.length / 16) + 2; ++runs) {
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
    98999999n,
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
  await send(vault, buildSetMonthlyCommitmentCalldata("1", true));
  await finalized();
  const empty = await prepareEvmMonthlyReservation(
    config,
    "2026-12",
    laterDigest,
    [laterManual],
  );
  assert(empty);
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.reservation.remainingGross, "0");
  const emptyMessage = evmMonthlyReserveDigest(
    chainId,
    vault,
    "2026-12",
    empty.reservation,
  );
  const emptyAuthorization: MonthlyAuthorization = {
    plan: {
      ...authorization.plan,
      request: {
        ...authorization.plan.request,
        period: "2026-12",
        snapshotSha256: laterDigest.slice(2),
      },
      entries: [],
      totalGrossBase: "1",
      evmReservation: empty.reservation,
      allocationRoot: empty.reservation.allocationRoot,
      messageHex: emptyMessage.slice(2),
    },
    signatureHex: (
      await authority.sign({ hash: emptyMessage as `0x${string}` })
    ).slice(2),
  };
  await submitEvmMonthly(env, emptyAuthorization);
  await finalized();
  assert.equal(
    (await submitEvmMonthly(env, emptyAuthorization, false)).complete,
    true,
    "an all-funded month terminates without leaves",
  );
  assert.equal(BigInt(await value(vault, "pendingMonthlyGross()")), 0n);
  await send(
    vault,
    buildReserveMonthlyCalldata(
      "2026-12",
      empty.reservation,
      `0x${emptyAuthorization.signatureHex}`,
    ),
    gas.address,
    false,
  );
  const gasUsed: bigint[] = [];
  for (const item of [
    ...execution.records.values(),
    ...resumed.records.values(),
  ]) {
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
  // A small legacy call can already be in flight when a V2 successor is published. Keep its
  // exact transaction, then accept its independently authenticated finalized root as the winner.
  const raceFactory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    registrar.address,
    fee.address,
    authority.address,
    "0",
  ]);
  await send(
    raceFactory,
    buildCreateVaultCalldata({
      projectId: projectDigest,
      asset: token,
      monthlyCap: "2",
      automaticMonthly: true,
    }),
  );
  const raceVault = `0x${(await value(raceFactory, "vaults(bytes32)", [vaultKey])).slice(-40)}`;
  await send(
    token,
    encodeFunctionData({
      abi: ABI,
      functionName: "approve",
      args: [raceVault as `0x${string}`, 2n],
    }),
  );
  await send(raceVault, buildDepositCalldata("2"));
  const raceConfig: EvmEscrowConfig = {
    ...config,
    vault: raceVault,
    factory: raceFactory,
    codeSha256: digest(String(await rpc("eth_getCode", [raceVault, "latest"]))),
    factoryCodeSha256: digest(
      String(await rpc("eth_getCode", [raceFactory, "latest"])),
    ),
    evmUpgrade: await captureUpgrade(rpc, raceFactory, raceVault),
  };
  const raceEntries = ["7001", "7002"].map((githubUserId) => ({
    githubUserId,
    grossMicro: "1",
    sourceDigest: `0x${escrowAwardOrigin(projectId, "2026-12", githubUserId)}`,
  }));
  await send(
    raceVault,
    buildCommitAwardCalldata({
      ...raceEntries[0],
      obligationId: evmAwardId(chainId, raceVault, raceEntries[0].sourceDigest),
    }),
  );
  await finalized();
  const raceSnapshot = "e".repeat(64);
  const legacyRootHash = evmAllocationRoot(raceEntries);
  const legacyMessage = evmMonthlyDigest(
    chainId,
    raceVault,
    "2026-12",
    legacyRootHash,
  );
  const raceDeployment = {
    ...authorization.plan.deployment,
    vault: raceVault,
    factory: raceFactory,
    codeSha256: raceConfig.codeSha256,
    factoryCodeSha256: raceConfig.factoryCodeSha256,
    evmUpgrade: raceConfig.evmUpgrade,
  };
  const legacyRace: MonthlyAuthorization = {
    plan: {
      ...authorization.plan,
      evmReservation: undefined,
      request: {
        ...authorization.plan.request,
        period: "2026-12",
        snapshotSha256: raceSnapshot,
      },
      deployment: raceDeployment,
      totalGrossBase: "2",
      entries: raceEntries,
      allocationRoot: legacyRootHash,
      messageHex: legacyMessage.slice(2),
    },
    signatureHex: (
      await authority.sign({ hash: legacyMessage as `0x${string}` })
    ).slice(2),
  };
  const raceReserve = await prepareEvmMonthlyReservation(
    raceConfig,
    "2026-12",
    `0x${raceSnapshot}`,
    raceEntries,
  );
  assert(raceReserve);
  const raceMessage = evmMonthlyReserveDigest(
    chainId,
    raceVault,
    "2026-12",
    raceReserve.reservation,
  );
  const successor: MonthlyAuthorization = {
    plan: {
      ...legacyRace.plan,
      evmReservation: raceReserve.reservation,
      entries: raceReserve.entries.map((entry) => ({
        ...entry,
        grossMicro: String(entry.grossMicro),
      })),
      allocationRoot: raceReserve.reservation.allocationRoot,
      messageHex: raceMessage.slice(2),
    },
    signatureHex: (
      await authority.sign({ hash: raceMessage as `0x${string}` })
    ).slice(2),
    legacyAuthorization: legacyRace,
  };
  const raceJournal = journal();
  const raceEnv: ExecutorEnvironment = {
    ...env,
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      {
        ...raceConfig,
        chainId: chainId.toString(),
        network,
        chain: "base",
        projectId,
        gasCeiling: "500000",
      },
    ]),
    JOURNAL: raceJournal.store,
  };
  await rpc("evm_setAutomine", [false]);
  const pendingLegacy = await submitEvmMonthly(raceEnv, legacyRace);
  assert(pendingLegacy.transactionId);
  const beforeReplacementNonce = await rpc("eth_getTransactionCount", [
    gas.address,
    "pending",
  ]);
  const pendingSuccessor = await submitEvmMonthly(raceEnv, successor);
  assert.equal(
    pendingSuccessor.transactionId,
    pendingLegacy.transactionId,
    "successor resumes the original exact signed transaction",
  );
  assert.equal(
    await rpc("eth_getTransactionCount", [gas.address, "pending"]),
    beforeReplacementNonce,
    "successor consumes no new nonce",
  );
  assert.equal(
    [...raceJournal.records.values()].filter(
      (item) => (item as { transactionId?: string })?.transactionId,
    ).length,
    1,
  );
  await rpc("evm_setAutomine", [true]);
  await finalized();
  // A later authority rotation cannot invalidate the root that already committed.
  await send(
    raceFactory,
    execFileSync(
      "cast",
      ["calldata", "proposeIdentityAuthority(address)", recipient.address],
      { encoding: "utf8" },
    ).trim(),
    registrar.address,
  );
  await rpc("evm_increaseTime", [172801]);
  await rpc("anvil_mine", ["0x1"]);
  await send(
    raceFactory,
    execFileSync("cast", ["calldata", "executeIdentityAuthorityRotation()"], {
      encoding: "utf8",
    }).trim(),
    gas.address,
  );
  await finalized();
  raceConfig.identityAuthority = recipient.address.toLowerCase();
  raceEnv.PAYMENT_DEPLOYMENTS = JSON.stringify([
    {
      ...raceConfig,
      chainId: chainId.toString(),
      network,
      chain: "base",
      projectId,
      gasCeiling: "500000",
    },
  ]);
  const legacyWinner = await submitEvmMonthly(raceEnv, successor, false);
  assert.equal(legacyWinner.complete, true);
  assert.equal(legacyWinner.transactionId, null);
  assert.equal(BigInt(await value(raceVault, "pendingMonthlyGross()")), 0n);
  assert.equal(
    (await readVaultTotals({ ...raceConfig, network })).freeBalance,
    "0",
  );
  fixture.sqlite.close();
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
        principalAndFeesAfterOneOldPayment: "98999999",
        legacyImplementationUpgrade: Boolean(legacyRoot),
        oldAwardFee: payment.feeMicro,
        preUpgradeWalletSignature: "accepted",
        uncertainLegacyAdmission: "same-transaction-finalized-winner",
        keeper:
          "public HTTP, durable V1-to-V2 and later attempt cache, restart, one leaf after Off/window",
        allFundedMonth: "sealed-with-no-leaves",
        manualRace: "rejected-before-reserve",
        optedOutAndWindowExpired: "leaves-completed",
        replay: "refused",
        withdrawalOfReservedFunds: "refused",
        monthlyReleaseService:
          "retained D1 capture; idempotent authority signature; exact owner release; canonical slot and transaction identity verified",
        monthlyReleaseInspection: legacyRoot
          ? "not-run-on-legacy"
          : "wrong-sum-only; healthy/missing/mismatch/noncanonical held",
      },
      null,
      2,
    ),
  );
} finally {
  keeperApi?.stop(true);
  keeperStore?.close();
  anvil.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (anvil.exitCode !== null) resolve();
    else anvil.once("exit", () => resolve());
  });
}
