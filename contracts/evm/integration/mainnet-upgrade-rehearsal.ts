/**
 * Rehearses the mainnet EVM escrow upgrade (contracts/DEPLOY-MAINNET.md, "Upgrade to development
 * monthly reserve V2") on a local Anvil fork. It never sends anything to the forked network: every
 * transaction goes to the local fork, and the upgrade authority is impersonated there.
 *
 *   bun contracts/evm/integration/mainnet-upgrade-rehearsal.ts <fork-rpc-url> [logs-rpc-url] [anvil-port]
 *
 * The fork RPC must serve recent state for Base (8453), Ethereum (1) or Robinhood Chain (4663).
 * VaultCreated logs up to the fork block are read from logs-rpc-url (default: the fork RPC), so a
 * provider that rate-limits eth_getLogs can be replaced for that read only.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256, toBytes } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  type BindingInput,
  buildBindCalldata,
  buildCommitAwardCalldata,
  buildCommitMonthlyCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildWithdrawCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  type EvmEscrowConfig,
  type EvmImplementationReview,
  evmAllocationRoot,
  evmAwardId,
  evmBindingDigest,
  evmMonthlyDigest,
  type MonthlyAllocationEntry,
  prepareEvmVaultCreation,
  readVaultTotals,
  verifyEvmDeployment,
  verifyPayment,
  verifyReserve,
} from "../adapter";
import {
  buildCommitMonthlyLeafCalldata,
  buildReserveMonthlyCalldata,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
  prepareEvmMonthlyReservation,
  readEvmMonthlyReserve,
} from "../monthly-reserve";
import {
  assertFactoryDeploymentBlock,
  expectedImplementation,
  IMPLEMENTATION_SLOT,
  INITIALIZABLE_SLOT,
  createdVaults as readCreatedVaults,
  sha256Hex,
  type VaultStorage,
  vaultStorage,
} from "./upgrade";

const forkUrl = process.argv[2];
const logsUrl = process.argv[3] ?? forkUrl;
const port = process.argv[4] ?? "18610";
if (!forkUrl) {
  console.error(
    "Usage: bun contracts/evm/integration/mainnet-upgrade-rehearsal.ts <fork-rpc-url> [logs-rpc-url] [anvil-port]",
  );
  process.exit(2);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const rpcUrl = `http://127.0.0.1:${port}`;

// The live deployment (contracts/DEPLOY-MAINNET.md, "Current mainnet deployments").
const FACTORY = "0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb";
const FACTORY_PROXY_SHA256 =
  "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509";
const UPGRADE_AUTHORITY = "0x2Ad20Afa352Ec70E43A6d0E7794cf305c9Cbe35D";
const REGISTRAR = "0xd64F35aC87D9a1FB8eBD44e745c24436B606cF60";
const FEE_RECIPIENT = "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86";
const OLD_REVIEW: EvmImplementationReview = {
  authority: UPGRADE_AUTHORITY,
  vaultImplementation: "0xe137dE4fbAc6438007703065C905a58b03322Fc8",
  vaultImplementationCodeSha256:
    "1c21fa901dc924a7a2dd84b770b7d1cf69ef14ba97957ae5c8986232b8f9d551",
  factoryImplementation: "0xc831Fc745a63161Df6Fae612bDFE77B969b329fE",
  factoryImplementationCodeSha256:
    "62a3bf4a741b8084a63152835047bb71e8396b153a112225910d1dffecd64275",
};
/** The block of each factory proxy's deployment transaction: the first block with VaultCreated logs. */
const FACTORY_DEPLOYMENT_BLOCK: Record<string, bigint> = {
  "8453": 53020390n,
  "1": 26261441n,
  "4663": 96643004n,
};
const anvil = spawn(
  "anvil",
  ["--fork-url", forkUrl, "--port", port, "--silent"],
  { stdio: "ignore" },
);

type Receipt = {
  status: string;
  blockNumber: string;
  gasUsed: string;
  logs: { address: string; topics: string[]; data: string; logIndex: string }[];
};
/** Public fork RPCs rate-limit; a rate-limited upstream read is retried, nothing else is. */
async function rpc(
  method: string,
  params: unknown[],
  url = rpcUrl,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await response.json()) as {
      error?: unknown;
      result: unknown;
    };
    if (!body.error) return body.result;
    const error = JSON.stringify(body.error);
    if (attempt < 8 && /429|rate|limit reached/i.test(error)) {
      await Bun.sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`${method}: ${error}`);
  }
}
const cast = (...args: string[]) =>
  execFileSync("cast", args, { encoding: "utf8" }).trim();
const calldata = (signature: string, ...args: string[]) =>
  cast("calldata", signature, ...args);
/** A decoded single return value, without cast's scientific-notation suffix. */
const read = (to: string, signature: string, ...args: string[]) =>
  cast("call", to, signature, ...args, "--rpc-url", rpcUrl).split(" ")[0];
/** Every return value, one per line, for exact before-and-after comparison. */
const readAll = (to: string, signature: string, ...args: string[]) =>
  cast("call", to, signature, ...args, "--rpc-url", rpcUrl);
const word = async (address: string, slot: string | bigint) =>
  String(
    await rpc("eth_getStorageAt", [
      address,
      typeof slot === "bigint" ? `0x${slot.toString(16)}` : slot,
      "latest",
    ]),
  ).toLowerCase();
const implementationOf = async (proxy: string) =>
  `0x${(await word(proxy, IMPLEMENTATION_SLOT)).slice(-40)}`;
const codeSha256 = async (address: string) =>
  sha256Hex(String(await rpc("eth_getCode", [address, "latest"])));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A fresh account with no mainnet history or code, impersonated and funded on the fork only. */
async function actor() {
  const key = `0x${randomBytes(32).toString("hex")}` as const;
  const address = privateKeyToAddress(key);
  await rpc("anvil_impersonateAccount", [address]);
  await rpc("anvil_setBalance", [address, "0x56bc75e2d63100000"]);
  return { address, key: toBytes(key) };
}
function sign(digest: string, key: Uint8Array) {
  const signed = secp256k1.sign(toBytes(digest as `0x${string}`), key, {
    prehash: false,
    format: "recovered",
  });
  return `0x${Buffer.from(signed.slice(1)).toString("hex")}${(signed[0] + 27).toString(16)}`;
}
/** Twice the fork's current base fee and no tip: the authority's real balance pays real-scale gas. */
async function maxFeePerGas() {
  const block = (await rpc("eth_getBlockByNumber", ["latest", false])) as {
    baseFeePerGas: string;
  };
  return BigInt(block.baseFeePerGas) * 2n + 1n;
}
async function send(from: string, to: string, data: string) {
  const fee = `0x${(await maxFeePerGas()).toString(16)}`;
  const hash = String(
    await rpc("eth_sendTransaction", [
      { from, to, data, maxFeePerGas: fee, maxPriorityFeePerGas: "0x0" },
    ]),
  );
  await rpc("anvil_mine", ["0x1"]);
  const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as Receipt;
  return { hash, receipt, block: BigInt(receipt.blockNumber) };
}
async function sendOk(from: string, to: string, data: string, what: string) {
  const sent = await send(from, to, data);
  assert.equal(sent.receipt.status, "0x1", `${what} succeeds`);
  return sent;
}
async function reverts(from: string, to: string, data: string, what: string) {
  await assert.rejects(
    rpc("eth_call", [{ from, to, data }, "latest"]),
    /revert/i,
    what,
  );
}
function eventIndex(receipt: Receipt, emitter: string, topic: string) {
  const logs = receipt.logs.filter(
    (log) => same(log.address, emitter) && same(log.topics[0], topic),
  );
  assert.equal(logs.length, 1, "exactly one matching event");
  return Number(BigInt(logs[0].logIndex));
}
/** The fee field of the vault's UnusedWithdrawn(address,uint128,uint128,uint128) event. */
function withdrawalFee(receipt: Receipt) {
  const topic = keccak256(
    toBytes("UnusedWithdrawn(address,uint128,uint128,uint128)"),
  );
  const log = receipt.logs.find((entry) => same(entry.topics[0], topic));
  assert(log, "UnusedWithdrawn event");
  return BigInt(`0x${log.data.slice(-64)}`);
}
/** Every vault the factory created in [fromBlock, toBlock], from its VaultCreated logs. */
async function createdVaults(url: string, fromBlock: bigint, toBlock: bigint) {
  return readCreatedVaults(
    (method, params) => rpc(method, params, url),
    FACTORY,
    fromBlock,
    toBlock,
    50_000n,
  );
}
let vaultHistoryStart = 0n;
async function vaultState(vault: string, previous?: VaultStorage) {
  return vaultStorage(
    rpc,
    vault,
    BigInt(String(await rpc("eth_blockNumber", []))),
    vaultHistoryStart,
    50_000n,
    previous,
  );
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 200 && !ready; attempt++) {
    if (anvil.exitCode !== null) throw new Error("Anvil fork could not start");
    try {
      await rpc("eth_chainId", []);
      ready = true;
    } catch {
      await Bun.sleep(100);
    }
  }
  assert(ready, "Anvil fork startup");
  const chainId = BigInt(String(await rpc("eth_chainId", [])));
  assert(
    FACTORY_DEPLOYMENT_BLOCK[chainId.toString()],
    `Unsupported chain ${chainId}`,
  );
  const forkBlock = BigInt(String(await rpc("eth_blockNumber", [])));
  vaultHistoryStart = FACTORY_DEPLOYMENT_BLOCK[chainId.toString()];
  await assertFactoryDeploymentBlock(
    rpc,
    FACTORY,
    vaultHistoryStart,
    forkBlock,
  );
  const report: Record<string, unknown> = {
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    chainId: chainId.toString(),
    forkBlock: forkBlock.toString(),
  };

  // 1. The live deployment matches the recorded review.
  assert.equal(
    await codeSha256(FACTORY),
    FACTORY_PROXY_SHA256,
    "factory proxy code",
  );
  assert(
    same(await implementationOf(FACTORY), OLD_REVIEW.factoryImplementation),
  );
  assert(
    same(
      read(FACTORY, "vaultImplementation()(address)"),
      OLD_REVIEW.vaultImplementation,
    ),
  );
  assert(same(read(FACTORY, "upgradeAuthority()(address)"), UPGRADE_AUTHORITY));
  assert(same(read(FACTORY, "registrar()(address)"), REGISTRAR));
  assert(same(read(FACTORY, "feeRecipient()(address)"), FEE_RECIPIENT));
  assert.equal(
    await codeSha256(OLD_REVIEW.vaultImplementation),
    OLD_REVIEW.vaultImplementationCodeSha256,
  );
  assert.equal(
    await codeSha256(OLD_REVIEW.factoryImplementation),
    OLD_REVIEW.factoryImplementationCodeSha256,
  );
  const mainnetVaults = await createdVaults(
    logsUrl,
    FACTORY_DEPLOYMENT_BLOCK[chainId.toString()],
    forkBlock,
  );
  report.existingMainnetVaults = mainnetVaults;
  const factorySlotsBefore: string[] = [];
  for (let slot = 0n; slot <= 6n; slot++)
    factorySlotsBefore.push(await word(FACTORY, slot));
  const factoryInitializedBefore = await word(FACTORY, INITIALIZABLE_SLOT);

  // 2. Pre-upgrade history on the live logic: a fresh owner's vault with a paid award, an unpaid
  // award, a monthly policy and a fee-free small withdrawal (fees still round down).
  const owner = await actor();
  const authority = await actor();
  const wallet = await actor();
  const relayer = await actor();
  // The fork's identity authority key is not available, so the impersonated registrar rotates it
  // to a fresh fork-only key (rotation delay 0). The upgrade does not touch this role.
  await rpc("anvil_impersonateAccount", [REGISTRAR]);
  await rpc("anvil_setBalance", [REGISTRAR, "0x56bc75e2d63100000"]);
  await sendOk(
    REGISTRAR,
    FACTORY,
    calldata("proposeIdentityAuthority(address)", authority.address),
    "rotation proposal",
  );
  await sendOk(
    relayer.address,
    FACTORY,
    calldata("executeIdentityAuthorityRotation()"),
    "rotation",
  );
  const token = JSON.parse(
    execFileSync(
      "forge",
      [
        "create",
        "--root",
        root,
        "integration/TestDollar.sol:TestDollar",
        "--rpc-url",
        rpcUrl,
        "--unlocked",
        "--from",
        owner.address,
        "--broadcast",
        "--json",
      ],
      { encoding: "utf8" },
    ),
  ).deployedTo as string;
  const projectId = keccak256(toBytes(`rehearsal-${chainId}`));
  await reverts(
    owner.address,
    FACTORY,
    calldata(
      "createWithMonthlyCommitment(bytes32,address,uint128,bool)",
      projectId,
      token,
      "1",
      "true",
    ),
    "the live factory has no atomic monthly setup",
  );
  await sendOk(
    owner.address,
    FACTORY,
    calldata("create(bytes32,address,uint8)", projectId, token, "0"),
    "legacy vault creation",
  );
  const vault = read(
    FACTORY,
    "vaults(bytes32)(address)",
    read(
      FACTORY,
      "vaultKey(address,bytes32,address,uint8)(bytes32)",
      owner.address,
      projectId,
      token,
      "0",
    ),
  );
  assert(same(await implementationOf(vault), OLD_REVIEW.vaultImplementation));
  await sendOk(
    owner.address,
    token,
    calldata("mint(address,uint256)", owner.address, "10000000000"),
    "mint",
  );
  await sendOk(
    owner.address,
    token,
    calldata("approve(address,uint256)", vault, "10000000000"),
    "approve",
  );
  await sendOk(
    owner.address,
    vault,
    buildDepositCalldata("5000000000"),
    "deposit",
  );
  // Gross amounts not divisible by 50, so floor and ceil fees differ.
  const award = (label: string, githubUserId: string, grossMicro: string) => {
    const sourceDigest = keccak256(toBytes(`${label}-${chainId}`));
    return {
      id: evmAwardId(chainId, vault, sourceDigest),
      sourceDigest,
      githubUserId,
      grossMicro,
    };
  };
  const paidBefore = award("paid-before", "101", "1000049");
  const monthlyBefore = award("monthly-before", "102", "2000049");
  const between = award("between-upgrades", "104", "3000049");
  const monthlyNew = award("monthly-new", "103", "1000049");
  const paidAfter = award("paid-after", "101", "1000049");
  const commit = (a: ReturnType<typeof award>) =>
    sendOk(
      owner.address,
      vault,
      buildCommitAwardCalldata({
        obligationId: a.id,
        githubUserId: a.githubUserId,
        grossMicro: a.grossMicro,
        sourceDigest: a.sourceDigest,
      }),
      `commit ${a.githubUserId}`,
    );
  await commit(paidBefore);
  const reserveBefore = await commit(monthlyBefore);
  assert.equal(
    read(vault, "payoutFee(uint128)(uint128)", "1000049"),
    "20000",
    "live fee rounds down",
  );
  await sendOk(
    owner.address,
    vault,
    calldata("setMonthlyCommitment(uint128,bool)", "5000000000", "true"),
    "monthly policy",
  );
  const binding: BindingInput = {
    githubUserId: "101",
    destination: wallet.address,
    expectedVersion: "0",
    claimDigest: paidBefore.sourceDigest,
    expiresAt: "18446744073709551615",
  };
  await sendOk(
    authority.address,
    vault,
    buildBindCalldata({
      ...binding,
      walletSignature: sign(
        evmBindingDigest(chainId, vault, binding),
        wallet.key,
      ),
    }),
    "binding",
  );
  const payBefore = await sendOk(
    relayer.address,
    vault,
    buildPayCalldata(paidBefore.id, "1"),
    "pre-upgrade payment",
  );
  const withdrawBefore = await sendOk(
    owner.address,
    vault,
    buildWithdrawCalldata("49"),
    "pre-upgrade withdrawal",
  );
  assert.equal(
    withdrawalFee(withdrawBefore.receipt),
    0n,
    "pre-upgrade 49-unit withdrawal pays no fee",
  );
  const proxyCodeSha256 = await codeSha256(vault);
  const rehearsalVaultBefore = await vaultState(vault);
  const awardGetter =
    "awards(bytes32)(uint64,uint128,uint128,bytes32,uint64,bool)";
  const awardsBefore = [paidBefore, monthlyBefore].map((a) =>
    readAll(vault, awardGetter, a.id),
  );
  const mainnetBefore = await Promise.all(
    mainnetVaults.map((target) => vaultState(target)),
  );

  // 3. Runbook step 1: deploy both implementations with the checked-in script, as the authority.
  // The authority is impersonated but not funded: its live balance must cover the upgrade.
  await rpc("anvil_impersonateAccount", [UPGRADE_AUTHORITY]);
  const authorityBalance = BigInt(
    String(await rpc("eth_getBalance", [UPGRADE_AUTHORITY, "latest"])),
  );
  execFileSync(
    "forge",
    [
      "script",
      "script/DeployUpgradeImplementations.s.sol:DeployUpgradeImplementations",
      "--rpc-url",
      rpcUrl,
      "--sender",
      UPGRADE_AUTHORITY,
      "--unlocked",
      "--broadcast",
      "--slow",
      "--with-gas-price",
      (await maxFeePerGas()).toString(),
      "--priority-gas-price",
      "0",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const vaultExpected = expectedImplementation(root, "ProjectEscrow");
  const factoryExpected = expectedImplementation(root, "EscrowFactory");
  const NEW_REVIEW: EvmImplementationReview = {
    authority: UPGRADE_AUTHORITY,
    vaultImplementation: vaultExpected.predicted,
    vaultImplementationCodeSha256: vaultExpected.digest,
    factoryImplementation: factoryExpected.predicted,
    factoryImplementationCodeSha256: factoryExpected.digest,
  };
  assert.equal(
    await codeSha256(NEW_REVIEW.vaultImplementation),
    NEW_REVIEW.vaultImplementationCodeSha256,
    "deployed vault logic digest",
  );
  assert.equal(
    await codeSha256(NEW_REVIEW.factoryImplementation),
    NEW_REVIEW.factoryImplementationCodeSha256,
    "deployed factory logic digest",
  );
  report.newReview = NEW_REVIEW;
  // The implementations cannot be initialized directly.
  await reverts(
    relayer.address,
    NEW_REVIEW.factoryImplementation,
    calldata(
      "initialize(address,address,address,uint64,address,address)",
      relayer.address,
      relayer.address,
      owner.address,
      "0",
      relayer.address,
      NEW_REVIEW.vaultImplementation,
    ),
    "factory logic initializer disabled",
  );
  await reverts(
    relayer.address,
    NEW_REVIEW.vaultImplementation,
    calldata(
      "initializeWithMonthlyCommitment(bytes32,address,address,uint8,address,uint64,uint128,bool)",
      projectId,
      token,
      relayer.address,
      "0",
      relayer.address,
      "0",
      "1",
      "true",
    ),
    "vault logic initializer disabled",
  );

  // 4. Runbook step 2: upgrade every vault (the live ones and the rehearsal vault), authority only.
  const upgradeVault = calldata(
    "upgradeToAndCall(address,bytes)",
    NEW_REVIEW.vaultImplementation,
    "0x",
  );
  const upgradeFactory = calldata(
    "upgradeToAndCall(address,bytes)",
    NEW_REVIEW.factoryImplementation,
    "0x",
  );
  const selectVault = calldata(
    "setVaultImplementation(address)",
    NEW_REVIEW.vaultImplementation,
  );
  report.calldata = { upgradeVault, upgradeFactory, selectVault };
  await reverts(
    owner.address,
    vault,
    upgradeVault,
    "the vault owner cannot upgrade",
  );
  await reverts(
    owner.address,
    FACTORY,
    upgradeFactory,
    "nobody else can upgrade the factory",
  );
  const gas: Record<string, string> = {};
  const vaultUpgradeBlocks: Record<string, string> = {};
  for (const target of [...mainnetVaults, vault]) {
    const sent = await sendOk(
      UPGRADE_AUTHORITY,
      target,
      upgradeVault,
      `upgrade vault ${target}`,
    );
    vaultUpgradeBlocks[target] = sent.block.toString();
    gas[`vault ${target}`] = BigInt(sent.receipt.gasUsed).toString();
  }
  // Illustration of the history bound only: an award committed while the vault runs new logic
  // and the factory still runs old logic. The real runbook sends nothing between upgrades.
  const reserveBetween = await commit(between);

  // 5. Runbook steps 3 and 4: upgrade the factory, then select the new vault logic.
  const factoryUpgrade = await sendOk(
    UPGRADE_AUTHORITY,
    FACTORY,
    upgradeFactory,
    "factory upgrade",
  );
  gas.factory = BigInt(factoryUpgrade.receipt.gasUsed).toString();
  const selection = await sendOk(
    UPGRADE_AUTHORITY,
    FACTORY,
    selectVault,
    "select vault logic",
  );
  gas.setVaultImplementation = BigInt(selection.receipt.gasUsed).toString();
  // supersededAtBlock: the last proxy upgrade that left the old review (here the factory upgrade).
  const supersededAtBlock = factoryUpgrade.block;
  report.upgradeBlocks = {
    vaults: vaultUpgradeBlocks,
    factory: factoryUpgrade.block.toString(),
    setVaultImplementation: selection.block.toString(),
  };
  report.gasUsed = gas;
  // Stragglers: a vault created before selection still runs old logic and must also be upgraded.
  for (const target of [
    ...mainnetVaults,
    ...(await createdVaults(rpcUrl, forkBlock + 1n, selection.block)),
  ])
    assert(
      same(await implementationOf(target), NEW_REVIEW.vaultImplementation),
      `vault ${target} upgraded`,
    );

  // 6. State and roles are unchanged; only implementation slots and the selected logic moved.
  assert(
    same(await implementationOf(FACTORY), NEW_REVIEW.factoryImplementation),
  );
  assert(
    same(
      read(FACTORY, "vaultImplementation()(address)"),
      NEW_REVIEW.vaultImplementation,
    ),
  );
  for (let slot = 0n; slot <= 6n; slot++) {
    const now = await word(FACTORY, slot);
    if (slot === 2n)
      assert(
        now.endsWith(NEW_REVIEW.vaultImplementation.slice(2).toLowerCase()),
      );
    else if (slot === 5n)
      assert(
        now.endsWith(authority.address.slice(2).toLowerCase()),
        "rotated authority kept",
      );
    else
      assert.equal(
        now,
        factorySlotsBefore[Number(slot)],
        `factory slot ${slot} unchanged`,
      );
  }
  assert.equal(
    await word(FACTORY, INITIALIZABLE_SLOT),
    factoryInitializedBefore,
    "factory initializer version unchanged",
  );
  for (const [index, target] of mainnetVaults.entries())
    assert.deepEqual(
      await vaultState(target, mainnetBefore[index]),
      mainnetBefore[index],
      `live vault ${target} storage unchanged`,
    );
  const rehearsalVaultAfter = await vaultState(vault);
  assert.equal(read(vault, "pendingMonthlyGross()(uint128)"), "0");
  assert.equal(read(vault, "ordinarySourceSequence()(uint256)"), "1");
  // Only the post-upgrade `between` award advanced the new sequence. Old source maps remain intact.
  // The award committed between upgrades changed the balances and award maps on purpose; every
  // other declared slot and the initializer version are unchanged.
  for (const slot of [0, 1, 2, 3, 4, 7, 8, 9, 10, 18])
    assert.equal(
      rehearsalVaultAfter.slots[slot],
      rehearsalVaultBefore.slots[slot],
      `vault slot ${slot} unchanged`,
    );
  assert.equal(
    rehearsalVaultAfter.initialized,
    rehearsalVaultBefore.initialized,
  );
  for (const [slot, value] of Object.entries(rehearsalVaultBefore.mappings))
    assert.equal(
      rehearsalVaultAfter.mappings[slot],
      value,
      `existing vault mapping ${slot} unchanged`,
    );
  assert.deepEqual(
    [paidBefore, monthlyBefore].map((a) => readAll(vault, awardGetter, a.id)),
    awardsBefore,
    "pre-upgrade awards unchanged",
  );
  assert.equal(
    await codeSha256(vault),
    proxyCodeSha256,
    "vault proxy runtime unchanged",
  );
  assert.equal(
    await codeSha256(FACTORY),
    FACTORY_PROXY_SHA256,
    "factory proxy runtime unchanged",
  );
  await reverts(
    relayer.address,
    vault,
    calldata(
      "initialize(bytes32,address,address,uint8,address,uint64)",
      projectId,
      token,
      relayer.address,
      "0",
      relayer.address,
      "0",
    ),
    "initialize cannot rerun",
  );
  await reverts(
    relayer.address,
    vault,
    calldata(
      "initializeWithMonthlyCommitment(bytes32,address,address,uint8,address,uint64,uint128,bool)",
      projectId,
      token,
      relayer.address,
      "0",
      relayer.address,
      "0",
      "1",
      "true",
    ),
    "initializeWithMonthlyCommitment cannot run on an existing vault",
  );
  await reverts(
    relayer.address,
    FACTORY,
    calldata(
      "initialize(address,address,address,uint64,address,address)",
      relayer.address,
      relayer.address,
      owner.address,
      "0",
      relayer.address,
      NEW_REVIEW.vaultImplementation,
    ),
    "factory initialize cannot rerun",
  );

  // 7. Fees round up after the upgrade.
  assert.equal(
    read(vault, "payoutFee(uint128)(uint128)", "1000049"),
    "20001",
    "fee rounds up",
  );
  const withdrawAfter = await sendOk(
    owner.address,
    vault,
    buildWithdrawCalldata("49"),
    "post-upgrade withdrawal",
  );
  assert.equal(
    withdrawalFee(withdrawAfter.receipt),
    1n,
    "a 49-unit withdrawal now pays 1",
  );

  // 8. commitMonthly counts the pre-upgrade floor-fee award once and adds the new one.
  assert.equal(
    readAll(vault, awardGetter, monthlyBefore.id).split("\n")[2].split(" ")[0],
    "40000",
    "pre-upgrade award holds the floor fee",
  );
  const now = BigInt(
    String(
      (
        (await rpc("eth_getBlockByNumber", ["latest", false])) as {
          timestamp: string;
        }
      ).timestamp,
    ),
  );
  const date = new Date(Number(now) * 1000);
  const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const opensAt = BigInt(
    cast(
      "call",
      vault,
      "monthlyWindow(uint32)(uint64,uint64)",
      period.replace("-", ""),
      "--rpc-url",
      rpcUrl,
    )
      .split("\n")[0]
      .split(" ")[0],
  );
  await rpc("evm_setNextBlockTimestamp", [Number(opensAt)]);
  await rpc("anvil_mine", ["0x1"]);
  const entries: MonthlyAllocationEntry[] = [monthlyBefore, monthlyNew].map(
    (a) => ({
      githubUserId: a.githubUserId,
      grossMicro: a.grossMicro,
      sourceDigest: a.sourceDigest,
    }),
  );
  const freeBefore = BigInt(read(vault, "freeBalance()(uint128)"));
  const feesBefore = BigInt(read(vault, "reservedFees()(uint128)"));
  const attestation = sign(
    evmMonthlyDigest(chainId, vault, period, evmAllocationRoot(entries)),
    authority.key,
  );
  await sendOk(
    relayer.address,
    vault,
    buildCommitMonthlyCalldata(period, entries, attestation),
    "monthly commitment",
  );
  assert.equal(
    BigInt(read(vault, "freeBalance()(uint128)")),
    freeBefore - 1000049n,
    "only the new award is reserved",
  );
  assert.equal(
    BigInt(read(vault, "reservedFees()(uint128)")),
    feesBefore + 20001n,
    "the new award's fee rounds up",
  );
  assert.equal(
    readAll(vault, awardGetter, monthlyBefore.id),
    awardsBefore[1],
    "the pre-upgrade award is unchanged",
  );

  // 9. Atomic monthly setup on the upgraded factory uses the new logic and the same proxy code.
  const second = await actor();
  const secondProject = keccak256(toBytes(`rehearsal-second-${chainId}`));
  await sendOk(
    second.address,
    FACTORY,
    calldata(
      "createWithMonthlyCommitment(bytes32,address,uint128,bool)",
      secondProject,
      token,
      "50000000",
      "true",
    ),
    "createWithMonthlyCommitment",
  );
  const created = read(
    FACTORY,
    "vaults(bytes32)(address)",
    read(
      FACTORY,
      "vaultKey(address,bytes32,address,uint8)(bytes32)",
      second.address,
      secondProject,
      token,
      "0",
    ),
  );
  assert(same(await implementationOf(created), NEW_REVIEW.vaultImplementation));
  assert.equal(read(created, "monthlyCap()(uint128)"), "50000000");
  assert.equal(read(created, "monthlyEnabled()(bool)"), "true");
  assert(same(read(created, "owner()(address)"), second.address));
  assert.equal(
    await codeSha256(created),
    proxyCodeSha256,
    "new vaults keep the reviewed proxy code",
  );

  // 10. A post-upgrade award and payment.
  const reserveAfter = await commit(paidAfter);
  const payAfter = await sendOk(
    relayer.address,
    vault,
    buildPayCalldata(paidAfter.id, "1"),
    "post-upgrade payment",
  );
  await rpc("anvil_mine", ["0x41"]);

  // 11. The adapter accepts pre-upgrade events through history and post-upgrade events through the
  // new review, at each event's own block.
  const base = {
    rpcUrl,
    chainId,
    vault,
    asset: token,
    owner: owner.address,
    identityAuthority: authority.address,
    feeRecipient: FEE_RECIPIENT,
    codeSha256: proxyCodeSha256,
    bindingDelaySeconds: "0",
    factory: FACTORY,
    factoryCodeSha256: FACTORY_PROXY_SHA256,
    registrar: REGISTRAR,
  } satisfies Omit<EvmEscrowConfig, "evmUpgrade">;
  const upgraded: EvmEscrowConfig = {
    ...base,
    evmUpgrade: {
      ...NEW_REVIEW,
      history: [
        { ...OLD_REVIEW, supersededAtBlock: supersededAtBlock.toString() },
      ],
    },
  };
  const paidEvent = (sent: { receipt: Receipt }) =>
    eventIndex(sent.receipt, vault, EVM_ESCROW_EVENT_TOPICS.Paid);
  const reserveEvent = (sent: { receipt: Receipt }) =>
    eventIndex(sent.receipt, vault, EVM_ESCROW_EVENT_TOPICS.AwardCommitted);
  const before = await verifyPayment(
    upgraded,
    payBefore.hash,
    paidEvent(payBefore),
    paidBefore.id,
  );
  assert.equal(
    before.feeMicro,
    "20000",
    "pre-upgrade floor fee verifies through history",
  );
  assert.equal(
    (
      await verifyReserve(
        upgraded,
        reserveBefore.hash,
        reserveEvent(reserveBefore),
        monthlyBefore.id,
      )
    ).feeMicro,
    "40000",
  );
  assert.equal(
    (
      await verifyReserve(
        upgraded,
        reserveBetween.hash,
        reserveEvent(reserveBetween),
        between.id,
      )
    ).feeMicro,
    "60001",
    "an event between upgrades verifies (vault current, factory history)",
  );
  assert.equal(
    (
      await verifyReserve(
        upgraded,
        reserveAfter.hash,
        reserveEvent(reserveAfter),
        paidAfter.id,
      )
    ).feeMicro,
    "20001",
  );
  const after = await verifyPayment(
    upgraded,
    payAfter.hash,
    paidEvent(payAfter),
    paidAfter.id,
  );
  assert.equal(
    after.feeMicro,
    "20001",
    "post-upgrade ceil fee verifies through the new review",
  );
  await verifyEvmDeployment(upgraded, "finalized");
  // V2 must also work on the upgraded, funded legacy vault. Preserve a pre-upgrade floor-fee
  // obligation, then finish the newly reserved leaves after the owner opts out and the window closes.
  const nextDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );
  const nextPeriod = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const window = readAll(
    vault,
    "monthlyWindow(uint32)(uint64,uint64)",
    nextPeriod.replace("-", ""),
  )
    .split("\n")
    .map((value) => BigInt(value.split(" ")[0]));
  await rpc("evm_setNextBlockTimestamp", [Number(window[0])]);
  await rpc("anvil_mine", ["0x41"]);
  const leaves = [
    award("v2-a", "101", "1000049"),
    award("v2-b", "105", "2000049"),
  ].map((a) => ({
    githubUserId: a.githubUserId,
    grossMicro: a.grossMicro,
    sourceDigest: a.sourceDigest,
  }));
  const frozen = [
    {
      githubUserId: monthlyBefore.githubUserId,
      grossMicro: monthlyBefore.grossMicro,
      sourceDigest: monthlyBefore.sourceDigest,
    },
    ...leaves,
  ];
  const preparedMonth = await prepareEvmMonthlyReservation(
    upgraded,
    nextPeriod,
    keccak256(toBytes(`upgrade-rehearsal-v2-${chainId}`)),
    frozen,
  );
  assert(preparedMonth, "the upgraded vault exposes V2");
  assert.equal(
    preparedMonth.entries.length,
    2,
    "the old funded source is excluded",
  );
  const reservation = preparedMonth.reservation;
  const tree = evmMonthlySumTree(preparedMonth.entries);
  const totalsConfig = {
    ...upgraded,
    network:
      chainId === 8453n
        ? ("base-mainnet" as const)
        : chainId === 1n
          ? ("ethereum" as const)
          : ("robinhood-mainnet" as const),
  };
  const reserved = (totals: Awaited<ReturnType<typeof readVaultTotals>>) => {
    if (totals.reserved !== null) return BigInt(totals.reserved);
    assert(totals.reservedPrincipal !== null && totals.reservedFees !== null);
    return BigInt(totals.reservedPrincipal) + BigInt(totals.reservedFees);
  };
  const beforeV2 = await readVaultTotals(totalsConfig);
  assert(beforeV2.freeBalance !== null);
  const admitted = await sendOk(
    relayer.address,
    vault,
    buildReserveMonthlyCalldata(
      nextPeriod,
      reservation,
      sign(
        evmMonthlyReserveDigest(chainId, vault, nextPeriod, reservation),
        authority.key,
      ),
    ),
    "V2 whole-month reserve",
  );
  assert.equal(
    read(vault, "pendingMonthlyGross()(uint128)"),
    reservation.remainingGross,
  );
  assert.equal(
    BigInt(read(vault, "freeBalance()(uint128)")),
    BigInt(beforeV2.freeBalance) - BigInt(reservation.remainingGross),
  );
  assert.equal(readAll(vault, awardGetter, monthlyBefore.id), awardsBefore[1]);
  await sendOk(
    owner.address,
    vault,
    calldata("setMonthlyCommitment(uint128,bool)", "0", "false"),
    "owner opt-out",
  );
  await rpc("evm_setNextBlockTimestamp", [Number(window[1]) + 1]);
  await rpc("anvil_mine", ["0x41"]);
  const pendingTotals = await readVaultTotals(totalsConfig);
  assert.equal(
    reserved(pendingTotals),
    reserved(beforeV2) + BigInt(reservation.remainingGross),
  );
  const leafReceipts = [];
  for (const [index, entry] of preparedMonth.entries.entries()) {
    leafReceipts.push(
      await sendOk(
        relayer.address,
        vault,
        buildCommitMonthlyLeafCalldata(
          nextPeriod,
          entry,
          index,
          tree.proofs[index],
        ),
        "V2 leaf",
      ),
    );
  }
  await rpc("anvil_mine", ["0x41"]);
  assert.equal(read(vault, "pendingMonthlyGross()(uint128)"), "0");
  assert.equal(
    (await readEvmMonthlyReserve(upgraded, nextPeriod)).remaining,
    0n,
  );
  const completedTotals = await readVaultTotals(totalsConfig);
  assert.equal(
    completedTotals.freeBalance,
    pendingTotals.freeBalance,
    "leaves do not debit free funds twice",
  );
  assert.equal(reserved(completedTotals), reserved(pendingTotals));
  for (const [index, sent] of leafReceipts.entries()) {
    await verifyReserve(
      upgraded,
      sent.hash,
      reserveEvent(sent),
      evmAwardId(chainId, vault, preparedMonth.entries[index].sourceDigest),
    );
  }
  const v2Paid = await sendOk(
    relayer.address,
    vault,
    buildPayCalldata(evmAwardId(chainId, vault, leaves[0].sourceDigest), "1"),
    "V2 funded payment after opt-out",
  );
  await rpc("anvil_mine", ["0x41"]);
  await verifyPayment(
    upgraded,
    v2Paid.hash,
    paidEvent(v2Paid),
    evmAwardId(chainId, vault, leaves[0].sourceDigest),
  );
  report.monthlyV2 = {
    period: nextPeriod,
    pendingGross: reservation.remainingGross,
    existingFloorAwardPreserved: true,
    optOutAndWindowCompletion: true,
    reserveGas: BigInt(admitted.receipt.gasUsed).toString(),
    leafGas: leafReceipts.map((sent) =>
      BigInt(sent.receipt.gasUsed).toString(),
    ),
    payment: v2Paid.hash,
    state: "finalized on local fork",
  };
  const prepared = await prepareEvmVaultCreation(upgraded, {
    projectId: keccak256(toBytes(`rehearsal-third-${chainId}`)),
    asset: token,
    owner: relayer.address,
    monthlyCap: "1000000",
    monthlyEnabled: true,
  });
  assert.equal(
    prepared.existingVault,
    null,
    "the setup route opens on the new review",
  );
  // Negative checks: each review is accepted only where it applies.
  await assert.rejects(
    verifyPayment(
      { ...base, evmUpgrade: NEW_REVIEW },
      payBefore.hash,
      paidEvent(payBefore),
      paidBefore.id,
    ),
    /implementation does not match/,
    "without history the pre-upgrade event is rejected",
  );
  await assert.rejects(
    verifyPayment(
      { ...base, evmUpgrade: OLD_REVIEW },
      payAfter.hash,
      paidEvent(payAfter),
      paidAfter.id,
    ),
    /implementation does not match/,
    "the old review alone rejects a post-upgrade event",
  );
  await assert.rejects(
    verifyReserve(
      {
        ...base,
        evmUpgrade: {
          ...NEW_REVIEW,
          history: [
            { ...OLD_REVIEW, supersededAtBlock: vaultUpgradeBlocks[vault] },
          ],
        },
      },
      reserveBetween.hash,
      reserveEvent(reserveBetween),
      between.id,
    ),
    /implementation does not match/,
    "a bound at the first upgrade strands events before the last upgrade",
  );
  await assert.rejects(
    verifyEvmDeployment({ ...base, evmUpgrade: OLD_REVIEW }, "finalized"),
    /implementation does not match/,
    "current state never verifies against the old review",
  );
  report.supersededAtBlock = supersededAtBlock.toString();
  report.authorityBalanceWei = {
    before: authorityBalance.toString(),
    spentOnFork: (
      authorityBalance -
      BigInt(String(await rpc("eth_getBalance", [UPGRADE_AUTHORITY, "latest"])))
    ).toString(),
  };
  report.result = "all checks passed";
  console.log(JSON.stringify(report, null, 2));
} finally {
  anvil.kill();
}
