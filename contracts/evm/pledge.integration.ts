/** Real local-chain qualification of the month pledge adapter: calldata, events and reads against a vault
 * on Anvil. With SLOP_PLEDGE_LEGACY_ROOT set to a contracts/evm checkout without pledges, the vault is
 * first deployed from that code, then upgraded in place; every existing storage slot must stay unchanged
 * and the upgraded vault must read zero pledged. Uses public Anvil fixture accounts, never a live network. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  buildCreateVaultCalldata,
  buildDepositCalldata,
  buildExpirePledgeCalldata,
  buildPledgeMonthsCalldata,
  buildSetMonthlyCommitmentCalldata,
  buildWithdrawCalldata,
  EVM_PLEDGE_EVENT_TOPICS,
  evmVaultKey,
  readEvmMonthPledges,
  readVaultTotals,
} from "./adapter";
import { deployUpgradeableFactory } from "./integration/upgrade";

const root = fileURLToPath(new URL(".", import.meta.url));
const legacyRoot = process.env.SLOP_PLEDGE_LEGACY_ROOT;
let deploymentRoot = legacyRoot ?? root;
const port = process.env.SLOP_PLEDGE_TEST_PORT ?? "28649";
const rpcUrl = `http://127.0.0.1:${port}`;
const chainId = 84532n;
/** 00:00 UTC on 10 November 2026, and on 4 February 2027 when December's commit window closes. */
const NOVEMBER_10 = 1794268800;
const DECEMBER_WINDOW_CLOSES = 1801699200;
const anvil = spawn(
  "anvil",
  [
    "--port",
    port,
    "--chain-id",
    chainId.toString(),
    "--timestamp",
    NOVEMBER_10.toString(),
    "--silent",
  ],
  { stdio: "ignore" },
);
const [owner, authority, stranger, fee, registrar] = Array.from(
  { length: 5 },
  (_, addressIndex) =>
    mnemonicToAccount(
      "test test test test test test test test test test test junk",
      { addressIndex },
    ),
);
const ABI = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256)",
  "function pledgeMonths(uint32,uint8,uint128)",
  "function expirePledge(uint32)",
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
type Receipt = {
  status: string;
  blockNumber: string;
  logs: { address: string; topics: string[]; data: string }[];
};
async function send(
  to: string,
  data: string,
  from: string = owner.address,
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
  assert.equal(receipt.status, success ? "0x1" : "0x0", `status of ${hash}`);
  return receipt;
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
const slots = (address: string) =>
  Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      rpc("eth_getStorageAt", [address, `0x${index.toString(16)}`, "latest"]),
    ),
  );
const finalize = () => rpc("anvil_mine", ["0x40"]);
const word = (value: bigint) => value.toString(16).padStart(64, "0");

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
  const token = deploy("integration/TestDollar.sol:TestDollar");
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    registrar.address,
    fee.address,
    authority.address,
    "0",
  ]);
  const projectId = `0x${"5".repeat(64)}`;
  await send(
    factory,
    buildCreateVaultCalldata({
      projectId,
      asset: token,
      monthlyCap: "300000000",
      automaticMonthly: true,
    }),
  );
  const key = evmVaultKey({ owner: owner.address, projectId, asset: token });
  const vault = `0x${String(
    await rpc("eth_call", [
      {
        to: factory,
        data: `0x${execFileSync("cast", ["calldata", "vaults(bytes32)", key], { encoding: "utf8" }).trim().slice(2)}`,
      },
      "latest",
    ]),
  ).slice(-40)}`;
  for (const [functionName, args] of [
    ["mint", [owner.address, 1_000_000_000n]],
    ["approve", [vault, 1_000_000_000n]],
  ] as const)
    await send(
      token,
      encodeFunctionData({
        abi: ABI,
        functionName,
        args: args as [`0x${string}`, bigint],
      }),
    );
  await send(vault, buildDepositCalldata(1_000_000_000n));
  await finalize();

  // A contract without pledge support reads as null, not as zero pledged.
  if (legacyRoot) {
    assert.equal(
      await readEvmMonthPledges({ rpcUrl, vault, periods: [202611] }),
      null,
      "a vault from the legacy implementation has no pledge support",
    );
    const before = await slots(vault);
    const totalsBefore = await readVaultTotals({
      rpcUrl,
      chainId,
      vault,
      network: "base-sepolia",
    });
    deploymentRoot = root;
    const implementation = deploy("src/ProjectEscrow.sol:ProjectEscrow");
    await send(
      vault,
      execFileSync(
        "cast",
        ["calldata", "upgradeToAndCall(address,bytes)", implementation, "0x"],
        { encoding: "utf8" },
      ).trim(),
      registrar.address,
    );
    await finalize();
    assert.deepEqual(
      await slots(vault),
      before,
      "an upgrade leaves every existing storage slot unchanged",
    );
    const {
      blockNumber: _before,
      blockTime: _beforeTime,
      ...countersBefore
    } = totalsBefore;
    const {
      blockNumber: _after,
      blockTime: _afterTime,
      ...countersAfter
    } = await readVaultTotals({
      rpcUrl,
      chainId,
      vault,
      network: "base-sepolia",
    });
    assert.deepEqual(countersAfter, countersBefore, "totals unchanged");
  } else {
    assert.equal(
      await readEvmMonthPledges({ rpcUrl, vault: token, periods: [] }),
      null,
      "a contract without openPledgedGross() reads as no pledge support",
    );
  }
  const empty = await readEvmMonthPledges({
    rpcUrl,
    vault,
    periods: [202611, 202612],
  });
  assert.deepEqual(
    empty,
    {
      openPledgedGross: 0n,
      pledges: [
        { period: 202611, amount: 0n, open: false },
        { period: 202612, amount: 0n, open: false },
      ],
    },
    "a vault with pledge support starts with nothing pledged",
  );

  // The builders match an independent ABI encoding.
  assert.equal(
    buildPledgeMonthsCalldata(202611, 2, 300_000_000n),
    encodeFunctionData({
      abi: ABI,
      functionName: "pledgeMonths",
      args: [202611, 2, 300_000_000n],
    }),
  );
  assert.equal(
    buildExpirePledgeCalldata(202612),
    encodeFunctionData({
      abi: ABI,
      functionName: "expirePledge",
      args: [202612],
    }),
  );
  for (const bad of [
    () => buildPledgeMonthsCalldata(202613, 1, 1n),
    () => buildPledgeMonthsCalldata(199912, 1, 1n),
    () => buildPledgeMonthsCalldata(202611.5, 1, 1n),
    () => buildPledgeMonthsCalldata(202611, 0, 1n),
    () => buildPledgeMonthsCalldata(202611, 13, 1n),
    () => buildPledgeMonthsCalldata(202611, 1, 0n),
    () => buildPledgeMonthsCalldata(202611, 1, 1n << 128n),
    () => buildExpirePledgeCalldata(202600),
  ])
    assert.throws(bad, "invalid pledge input is refused before signing");

  // Only the owner pledges; the owner pledges November and December.
  await send(
    vault,
    buildPledgeMonthsCalldata(202611, 2, 300_000_000n),
    stranger.address,
    false,
  );
  const pledged = await send(
    vault,
    buildPledgeMonthsCalldata(202611, 2, 300_000_000n),
  );
  assert.deepEqual(
    pledged.logs.map((log) => [log.topics[0], BigInt(log.topics[1])]),
    [
      [EVM_PLEDGE_EVENT_TOPICS.MonthPledged, 202611n],
      [EVM_PLEDGE_EVENT_TOPICS.MonthPledged, 202612n],
    ],
    "one MonthPledged event per period",
  );
  assert.equal(pledged.logs[0].data, `0x${word(300_000_000n)}`);
  const pledgedBlock = pledged.blockNumber;
  // Turning monthly off does not release pledged funds.
  await send(vault, buildSetMonthlyCommitmentCalldata("0", false));
  await send(vault, buildWithdrawCalldata(400_000_001n), owner.address, false);
  await send(vault, buildWithdrawCalldata(400_000_000n));
  await finalize();
  const open = await readEvmMonthPledges({
    rpcUrl,
    vault,
    periods: [202611, 202612, 202701],
  });
  assert.deepEqual(open, {
    openPledgedGross: 600_000_000n,
    pledges: [
      { period: 202611, amount: 300_000_000n, open: true },
      { period: 202612, amount: 300_000_000n, open: true },
      { period: 202701, amount: 0n, open: false },
    ],
  });

  // Anyone closes both pledges once December's commit window has closed.
  await rpc("evm_setNextBlockTimestamp", [DECEMBER_WINDOW_CLOSES]);
  for (const period of [202611, 202612]) {
    const closed = await send(
      vault,
      buildExpirePledgeCalldata(period),
      stranger.address,
    );
    assert.equal(closed.logs.length, 1);
    assert.equal(
      closed.logs[0].topics[0],
      EVM_PLEDGE_EVENT_TOPICS.PledgeClosed,
    );
    assert.equal(BigInt(closed.logs[0].topics[1]), BigInt(period));
    assert.equal(
      closed.logs[0].data,
      `0x${word(300_000_000n)}${word(0n)}`,
      "closed by lapse, not by a reserve",
    );
  }
  await finalize();
  assert.deepEqual(
    await readEvmMonthPledges({ rpcUrl, vault, periods: [202611] }),
    {
      openPledgedGross: 0n,
      pledges: [{ period: 202611, amount: 300_000_000n, open: false }],
    },
  );
  // A historical block still shows the pledge as it was.
  assert.deepEqual(
    await readEvmMonthPledges({
      rpcUrl,
      vault,
      periods: [202612],
      blockTag: pledgedBlock,
    }),
    {
      openPledgedGross: 600_000_000n,
      pledges: [{ period: 202612, amount: 300_000_000n, open: true }],
    },
  );
  await send(vault, buildWithdrawCalldata(600_000_000n));
  await assert.rejects(
    readEvmMonthPledges({
      rpcUrl,
      vault,
      periods: [202611],
      blockTag: "0xffffffff",
    }),
    "a block that does not exist is an error, not missing support",
  );
  console.log(
    JSON.stringify({
      pledgeIntegration: "ok",
      legacyImplementationUpgrade: Boolean(legacyRoot),
    }),
  );
} finally {
  anvil.kill();
}
