/** Real Anvil transactions, deploys the compiled escrow and test asset. Run with Bun. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mnemonicToAccount } from "viem/accounts";
import {
  type JournalStore,
  submitEvmMonthly,
} from "../../workers/payment-executor/core";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import {
  type BindingInput,
  buildBindCalldata,
  buildCancelBindingCalldata,
  buildClaimFeesCalldata,
  buildCommitAwardCalldata,
  buildCommitMonthlyCalldata,
  buildCreateVaultCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildWithdrawCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  evmAllocationRoot,
  evmAwardId,
  evmBindingDigest,
  evmMonthlyDigest,
  evmVaultKey,
  type MonthlyAllocationEntry,
  readEvmAuthorityRotation,
  readVaultTotals,
  verifyBinding,
  verifyEvmDeployment,
  verifyPayment,
  verifyReserve,
} from "./adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "./integration/upgrade";

const root = fileURLToPath(new URL(".", import.meta.url));
const rpcUrl = "http://127.0.0.1:18546";
const anvil = spawn("anvil", ["--port", "18546", "--silent"], {
  stdio: "ignore",
});
const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const attester = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const bytesOf = (value: string) =>
  Uint8Array.from(value.replace(/^0x/, "").match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
// Public Anvil mnemonic account 1: the identity authority, which also attests monthly allocations.
const attesterKey = bytesOf(
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
// Public Anvil mnemonic account 2; it controls the recipient and accepts each binding.
const recipientKey = Uint8Array.from(
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a".match(
    /../g,
  ) ?? [],
  (pair) => Number.parseInt(pair, 16),
);
const fee = "0x0000000000000000000000000000000000000fee";
const nextAttester = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
// Public Anvil account 4: a third party that deposits without any project role.
const donor = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const projectId = `0x${"1".padStart(64, "0")}`;
const source = `0x${"2".padStart(64, "0")}`;
const delay = "3600";
async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
function deploy(contract: string, args: string[] = []) {
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
      owner,
      "--broadcast",
      "--json",
      ...(args.length ? ["--constructor-args", ...args] : []),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output).deployedTo as string;
}
async function send(
  to: string,
  signature: string,
  args: string[],
  from = owner,
) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const tx = await rpc("eth_sendTransaction", [
    { from, to, data, gas: "0x7a1200" },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  return tx as string;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (anvil.exitCode !== null)
      throw new Error("Isolated Anvil could not start");
    try {
      await rpc("eth_chainId", []);
      ready = true;
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready, "Anvil startup");
  const token = deploy("integration/TestDollar.sol:TestDollar");
  // The registrar is an explicit constructor parameter (the owner account here).
  // It holds only the authority rotation; vault creation is permissionless.
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner,
    fee,
    attester,
    delay,
  ]);
  const vaultOf = async (
    asset: string,
    payoutPolicy?: "security-bounty",
    vaultOwner = owner,
  ) =>
    `0x${(
      (await rpc("eth_call", [
        {
          to: factory,
          data: execFileSync(
            "cast",
            [
              "calldata",
              "vaults(bytes32)",
              evmVaultKey({
                owner: vaultOwner,
                projectId,
                asset,
                payoutPolicy,
              }),
            ],
            { encoding: "utf8" },
          ).trim(),
        },
        "latest",
      ])) as string
    ).slice(-40)}`;
  /** The sender creates and owns the vault; the calldata names no owner. */
  const createVault = async (
    asset: string,
    payoutPolicy?: "security-bounty",
    from = owner,
  ) => {
    await rpc("eth_sendTransaction", [
      {
        from,
        to: factory,
        gas: "0x7a1200",
        data: buildCreateVaultCalldata({
          projectId,
          asset,
          payoutPolicy,
          ...(payoutPolicy
            ? {}
            : {
                monthlyCap: "50000000",
                ...(from === donor ? { automaticMonthly: false } : {}),
              }),
        }),
      },
    ]);
    await rpc("anvil_mine", ["0x1"]);
    return vaultOf(asset, payoutPolicy, from);
  };
  assert.throws(
    () => buildCreateVaultCalldata({ projectId, asset: token }),
    /monthly cap is required/,
    "ordinary creation requires the owner's cap",
  );
  const vault = await createVault(token);
  // Any account creates its own vault for the same project; it never replaces the owner's.
  const donorVault = await createVault(token, undefined, donor);
  assert.notEqual(donorVault, vault);
  assert.equal(await vaultOf(token), vault);
  const monthlyField = (address: string, signature: string) =>
    execFileSync("cast", ["call", address, signature, "--rpc-url", rpcUrl], {
      encoding: "utf8",
    }).trim();
  assert.equal(
    monthlyField(vault, "monthlyEnabled()(bool)"),
    "true",
    "creation enables the owner's monthly cap",
  );
  assert.equal(
    BigInt(monthlyField(vault, "monthlyCap()(uint128)").split(" ")[0]),
    50000000n,
  );
  assert.equal(
    monthlyField(donorVault, "monthlyEnabled()(bool)"),
    "false",
    "creation preserves explicit opt-out",
  );
  const id = evmAwardId(31337n, vault, source);
  assert.notEqual(
    evmAwardId(46630n, vault, source),
    evmAwardId(31337n, vault, source),
    "Award ids bind the chain id, so Robinhood Chain Testnet never collides with Anvil",
  );
  const signDigest = (digest: string, key: Uint8Array) => {
    const signed = secp256k1.sign(bytesOf(digest), key, {
      prehash: false,
      format: "recovered",
    });
    return `0x${Array.from(signed.slice(1), (b) => b.toString(16).padStart(2, "0")).join("")}${(signed[0] + 27).toString(16)}`;
  };
  /** The destination wallet signs the exact binding; the authority submits it unchanged. */
  const acceptBinding = (binding: BindingInput, target = vault) =>
    signDigest(evmBindingDigest(31337n, target, binding), recipientKey);
  await send(token, "mint(address,uint256)", [owner, "100000000"]);
  await send(token, "approve(address,uint256)", [vault, "100000000"]);
  await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: vault,
      gas: "0x7a1200",
      data: buildDepositCalldata("100000000"),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  // Deposits are permissionless: a third party funds the same free balance.
  await send(token, "mint(address,uint256)", [donor, "15000000"]);
  await send(token, "approve(address,uint256)", [vault, "15000000"], donor);
  const donorDeposit = (await rpc("eth_sendTransaction", [
    {
      from: donor,
      to: vault,
      gas: "0x7a1200",
      data: buildDepositCalldata(15000000n),
    },
  ])) as string;
  await rpc("anvil_mine", ["0x1"]);
  const donorLog = (
    (await rpc("eth_getTransactionReceipt", [donorDeposit])) as {
      logs: { topics: string[]; data: string; address: string }[];
    }
  ).logs.find((log) => log.address.toLowerCase() === vault.toLowerCase());
  assert.equal(donorLog?.topics[0], EVM_ESCROW_EVENT_TOPICS.Deposited);
  assert.equal(
    donorLog?.topics[1],
    `0x${donor.slice(2).toLowerCase().padStart(64, "0")}`,
    "Deposited names the depositor",
  );
  assert.equal(BigInt(donorLog?.data ?? "0x0"), 15000000n);
  const reserveTx = (await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: vault,
      gas: "0x7a1200",
      data: buildCommitAwardCalldata({
        obligationId: id,
        githubUserId: "101",
        grossMicro: "100000000",
        sourceDigest: source,
      }),
    },
  ])) as string;
  await rpc("anvil_mine", ["0x1"]);
  const runtimeCode = (await rpc("eth_getCode", [vault, "latest"])) as string;
  const codeSha256 = async (address: string) =>
    createHash("sha256")
      .update(
        Buffer.from(
          ((await rpc("eth_getCode", [address, "latest"])) as string).slice(2),
          "hex",
        ),
      )
      .digest("hex");
  const config = {
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
    rpcUrl,
    chainId: 31337n,
    vault,
    asset: token,
    owner,
    identityAuthority: attester,
    feeRecipient: fee,
    codeSha256: createHash("sha256")
      .update(Buffer.from(runtimeCode.slice(2), "hex"))
      .digest("hex"),
    bindingDelaySeconds: delay,
    factory,
    factoryCodeSha256: await codeSha256(factory),
    registrar: owner,
  };
  await assert.rejects(
    verifyReserve(config, reserveTx, 0, id),
    /not finalized/,
  );
  await rpc("anvil_mine", ["0x40"]);
  await assert.rejects(
    verifyReserve({ ...config, asset: owner }, reserveTx, 0, id),
    /asset, factory or registrar|implementation/,
  );
  // The factory is pinned by address, runtime code and registrar. A second
  // factory with the same constructor arguments has identical code but did
  // not create this vault.
  const otherFactory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner,
    fee,
    attester,
    delay,
  ]);
  await assert.rejects(
    verifyEvmDeployment({ ...config, factory: otherFactory }, "latest"),
    /asset, factory or registrar|implementation/,
  );
  await assert.rejects(
    verifyEvmDeployment(
      { ...config, factoryCodeSha256: "f".repeat(64) },
      "latest",
    ),
    /factory code/,
  );
  await assert.rejects(
    verifyEvmDeployment({ ...config, registrar: attester }, "latest"),
    /asset, factory or registrar|implementation/,
  );
  await assert.rejects(
    verifyReserve({ ...config, codeSha256: "f".repeat(64) }, reserveTx, 0, id),
    /runtime code/,
  );
  await assert.rejects(
    verifyReserve({ ...config, bindingDelaySeconds: "0" }, reserveTx, 0, id),
    /delays do not match/,
  );
  const reservation = await verifyReserve(config, reserveTx, 0, id);
  assert.equal(reservation.githubUserId, "101");
  assert.equal(reservation.grossMicro, "100000000");
  assert.equal(reservation.feeMicro, "2000000");
  assert.equal(reservation.sourceDigest, source);
  await assert.rejects(
    verifyReserve({ ...config, chainId: 84532n }, reserveTx, 0, id),
    /Wrong chain/,
  );
  await assert.rejects(
    verifyReserve({ ...config, chainId: 46630n }, reserveTx, 0, id),
    /Wrong chain/,
    "A Robinhood Chain Testnet config refuses a reservation read from the 31337 node",
  );
  await assert.rejects(
    verifyReserve({ ...config, vault: token }, reserveTx, 0, id),
    /deployment/,
  );
  await assert.rejects(
    verifyReserve(config, reserveTx, 0, source),
    /Wrong event/,
  );
  await assert.rejects(verifyReserve(config, reserveTx, 1, id), /event index/);
  const firstBinding: BindingInput = {
    githubUserId: "101",
    destination: recipient,
    expectedVersion: "0",
    claimDigest: source,
    expiresAt: "18446744073709551615",
  };
  // The authority alone cannot bind: a missing or foreign wallet signature reverts.
  const unsigned = await rpc("eth_sendTransaction", [
    {
      from: attester,
      to: vault,
      gas: "0x7a1200",
      data: buildBindCalldata({
        ...firstBinding,
        walletSignature: `0x${"0".repeat(130)}`,
      }),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  assert.equal(
    ((await rpc("eth_getTransactionReceipt", [unsigned])) as { status: string })
      .status,
    "0x0",
  );
  const bindingTx = await rpc("eth_sendTransaction", [
    {
      from: attester,
      to: vault,
      gas: "0x7a1200",
      data: buildBindCalldata({
        ...firstBinding,
        walletSignature: acceptBinding(firstBinding),
      }),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  await assert.rejects(
    verifyBinding(config, bindingTx, 0, "101"),
    /not finalized/,
  );
  await rpc("anvil_mine", ["0x40"]);
  const binding = await verifyBinding(config, bindingTx, 0, "101");
  assert.equal(binding.destination, recipient.toLowerCase());
  assert.equal(binding.bindingVersion, "1");
  assert.equal(binding.claimDigest, source);
  assert.ok(BigInt(binding.activatesAt) > 0n);
  await assert.rejects(verifyBinding(config, bindingTx, 0, "202"), /identity/);
  // An award inside its commitment period cannot pay; the owner can still cancel its binding.
  const early = await rpc("eth_sendTransaction", [
    {
      from: recipient,
      to: vault,
      gas: "0x7a1200",
      data: buildPayCalldata(id, binding.bindingVersion),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  assert.equal(
    ((await rpc("eth_getTransactionReceipt", [early])) as { status: string })
      .status,
    "0x0",
  );
  const cancelTx = await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: vault,
      gas: "0x7a1200",
      data: buildCancelBindingCalldata("101", "1"),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  assert.equal(
    ((await rpc("eth_getTransactionReceipt", [cancelTx])) as { status: string })
      .status,
    "0x1",
  );
  const secondBinding: BindingInput = { ...firstBinding, expectedVersion: "1" };
  await rpc("eth_sendTransaction", [
    {
      from: attester,
      to: vault,
      gas: "0x7a1200",
      data: buildBindCalldata({
        ...secondBinding,
        walletSignature: acceptBinding(secondBinding),
      }),
    },
  ]);
  await rpc("evm_increaseTime", [Number(delay)]);
  await rpc("anvil_mine", ["0x1"]);
  const paymentTx = await rpc("eth_sendTransaction", [
    {
      from: recipient,
      to: vault,
      gas: "0x7a1200",
      data: buildPayCalldata(id, "2"),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  await assert.rejects(
    verifyPayment(config, paymentTx, 0, id),
    /not finalized/,
  );
  await rpc("anvil_mine", ["0x40"]);
  const selector = (error: string) =>
    execFileSync("cast", ["sig", error], { encoding: "utf8" }).trim();
  const simulate = (to: string, data: string, from = owner) =>
    rpc("eth_call", [{ from, to, data }, "latest"]);
  await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: vault,
      gas: "0x7a1200",
      data: buildWithdrawCalldata("10000000"),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  const refunded = execFileSync(
    "cast",
    ["call", token, "balanceOf(address)(uint256)", owner, "--rpc-url", rpcUrl],
    { encoding: "utf8" },
  ).trim();
  // 2% unused-fund withdrawal fee, floor(gross / 50): 10 gross returns 9.8.
  assert.equal(refunded.split(" ")[0], "9800000");
  const payment = await verifyPayment(config, paymentTx, 0, id);
  assert.equal(payment.destination, recipient.toLowerCase());
  assert.equal(payment.bindingVersion, "2");
  assert.equal(payment.grossMicro, "100000000");
  assert.equal(payment.feeMicro, "2000000");
  assert.equal(payment.netMicro, "98000000");
  const recipientBalance = execFileSync(
    "cast",
    [
      "call",
      token,
      "balanceOf(address)(uint256)",
      recipient,
      "--rpc-url",
      rpcUrl,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(recipientBalance.split(" ")[0], "98000000");
  // Fees accrue in the vault and anyone can move them to the fee recipient.
  await rpc("eth_sendTransaction", [
    {
      from: recipient,
      to: vault,
      gas: "0x7a1200",
      data: buildClaimFeesCalldata(),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  const feeBalance = execFileSync(
    "cast",
    ["call", token, "balanceOf(address)(uint256)", fee, "--rpc-url", rpcUrl],
    { encoding: "utf8" },
  ).trim();
  // 2 payout fee and 0.2 withdrawal fee.
  assert.equal(feeBalance.split(" ")[0], "2200000");
  await rpc("anvil_mine", ["0x40"]);
  const totals = await readVaultTotals({
    rpcUrl,
    network: "anvil",
    vault,
    chainId: 31337n,
  });
  const { blockNumber, blockTime, ...counters } = totals;
  assert.ok(BigInt(blockNumber) > 0n && !Number.isNaN(Date.parse(blockTime)));
  assert.deepEqual(
    counters,
    {
      network: "anvil",
      vault: vault.toLowerCase(),
      asset: token.toLowerCase(),
      decimals: 6,
      totalDeposited: "115000000",
      totalPaid: "98000000",
      totalPayoutFees: "2000000",
      totalGrossWithdrawn: "10000000",
      totalWithdrawalFees: "200000",
      freeBalance: "5000000",
      reservedPrincipal: "0",
      reservedFees: "0",
      accruedFees: "0",
      reserved: null,
    },
    "readVaultTotals returns every counter at the finalized block",
  );
  await assert.rejects(
    readVaultTotals({ rpcUrl, network: "anvil", vault, chainId: 8453n }),
    /Wrong chain/,
  );
  // The same factory creates a second vault for the project in an 18-decimal
  // token, with amounts beyond uint64.
  const wide = deploy("test/WideToken.sol:WideToken", ["18"]);
  const wideVault = await createVault(wide);
  assert.notEqual(wideVault, vault);
  const wideGross = 20_000_000n * 10n ** 18n;
  assert.ok(wideGross > 1n << 64n, "beyond uint64");
  await send(wide, "mint(address,uint256)", [donor, `${wideGross * 2n}`]);
  await send(
    wide,
    "approve(address,uint256)",
    [wideVault, `${wideGross * 2n}`],
    donor,
  );
  await rpc("eth_sendTransaction", [
    {
      from: donor,
      to: wideVault,
      gas: "0x7a1200",
      data: buildDepositCalldata(wideGross * 2n),
    },
  ]);
  const wideId = evmAwardId(31337n, wideVault, source);
  const wideReserve = (await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: wideVault,
      gas: "0x7a1200",
      data: buildCommitAwardCalldata({
        obligationId: wideId,
        githubUserId: "101",
        grossMicro: wideGross,
        sourceDigest: source,
      }),
    },
  ])) as string;
  await rpc("anvil_mine", ["0x40"]);
  const wideConfig = {
    ...config,
    vault: wideVault,
    asset: wide,
    codeSha256: await codeSha256(wideVault),
  };
  const wideReservation = await verifyReserve(
    wideConfig,
    wideReserve,
    0,
    wideId,
  );
  assert.equal(wideReservation.grossMicro, wideGross.toString());
  assert.equal(wideReservation.feeMicro, (wideGross / 50n).toString());
  await assert.rejects(
    verifyEvmDeployment({ ...wideConfig, asset: token }, "latest"),
    /asset, factory or registrar|implementation/,
    "a vault verifies only against its own asset",
  );
  await rpc("anvil_mine", ["0x40"]);
  const wideTotals = await readVaultTotals({
    rpcUrl,
    network: "anvil",
    vault: wideVault,
    chainId: 31337n,
  });
  assert.equal(wideTotals.decimals, 18);
  assert.equal(wideTotals.totalDeposited, (wideGross * 2n).toString());
  assert.equal(wideTotals.freeBalance, wideGross.toString());
  assert.equal(wideTotals.reservedFees, (wideGross / 50n).toString());
  assert.equal(
    wideTotals.reservedPrincipal,
    (wideGross - wideGross / 50n).toString(),
  );
  await assert.rejects(
    verifyReserve(config, paymentTx, 0, id),
    /Wrong event topics/,
  );
  // A private bounty uses its own bounty vault for the same project and asset,
  // with the same binding and payment recovery and an explicit 75/25 policy.
  const bountyVault = await createVault(token, "security-bounty");
  assert.notEqual(bountyVault, vault);
  const bountySource = `0x${"b".repeat(64)}`;
  const bountyId = evmAwardId(31337n, bountyVault, bountySource);
  const bountyConfig = {
    ...config,
    vault: bountyVault,
    codeSha256: await codeSha256(bountyVault),
    payoutPolicy: "security-bounty" as const,
  };
  const bountyCommit = buildCommitAwardCalldata({
    obligationId: bountyId,
    githubUserId: "101",
    grossMicro: "100000000",
    sourceDigest: bountySource,
    payoutPolicy: "security-bounty",
  });
  await send(token, "mint(address,uint256)", [owner, "100000000"]);
  await send(token, "approve(address,uint256)", [bountyVault, "100000000"]);
  await send(bountyVault, "deposit(uint128)", ["100000000"]);
  // Purpose isolation: the ordinary vault refuses a bounty award and the bounty vault an ordinary one.
  await assert.rejects(
    simulate(vault, bountyCommit),
    new RegExp(selector("WrongPurpose()")),
  );
  await assert.rejects(
    simulate(
      bountyVault,
      buildCommitAwardCalldata({
        obligationId: bountyId,
        githubUserId: "101",
        grossMicro: "100000000",
        sourceDigest: bountySource,
      }),
    ),
    new RegExp(selector("WrongPurpose()")),
  );
  await assert.rejects(
    verifyEvmDeployment({ ...bountyConfig, payoutPolicy: undefined }, "latest"),
    /purpose/,
    "an ordinary deployment config refuses a bounty vault",
  );
  const bountyReserve = await rpc("eth_sendTransaction", [
    { from: owner, to: bountyVault, gas: "0x7a1200", data: bountyCommit },
  ]);
  const bountyBinding: BindingInput = { ...firstBinding, expectedVersion: "0" };
  await rpc("eth_sendTransaction", [
    {
      from: attester,
      to: bountyVault,
      gas: "0x7a1200",
      data: buildBindCalldata({
        ...bountyBinding,
        walletSignature: acceptBinding(bountyBinding, bountyVault),
      }),
    },
  ]);
  await rpc("anvil_mine", ["0x40"]);
  assert.equal(
    (await verifyReserve(bountyConfig, bountyReserve, 0, bountyId)).feeMicro,
    "25000000",
  );
  await rpc("evm_increaseTime", [3601]);
  const bountyPaid = await rpc("eth_sendTransaction", [
    {
      from: recipient,
      to: bountyVault,
      gas: "0x7a1200",
      data: buildPayCalldata(bountyId, "1"),
    },
  ]);
  await rpc("anvil_mine", ["0x40"]);
  assert.equal(
    (await verifyPayment(bountyConfig, bountyPaid, 0, bountyId)).netMicro,
    "75000000",
  );
  const duplicateBounty = await send(bountyVault, "pay(bytes32,uint64)", [
    bountyId,
    "1",
  ]);
  assert.equal(
    (await rpc("eth_getTransactionReceipt", [duplicateBounty])).status,
    "0x0",
  );
  assert.throws(
    () =>
      buildCommitAwardCalldata({
        obligationId: bountyId,
        githubUserId: "101",
        grossMicro: "100000001",
        sourceDigest: bountySource,
        payoutPolicy: "security-bounty",
      }),
    /exact/,
  );
  // Bounded monthly commitment: the owner sets a cap and turns it on; after the
  // cutoff anyone submits the period's allocation with the authority's signature.
  const now = Number(
    (
      (await rpc("eth_getBlockByNumber", ["latest", false])) as {
        timestamp: string;
      }
    ).timestamp,
  );
  // The open period is the month before the month that contains now - 72 hours.
  const shifted = new Date((now - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const period = `${open.getUTCFullYear()}-${String(open.getUTCMonth() + 1).padStart(2, "0")}`;
  const periodNumber = period.replace("-", "");
  const entries: MonthlyAllocationEntry[] = [
    {
      githubUserId: "101",
      grossMicro: "30000000",
      sourceDigest: `0x${"c1".repeat(32)}`,
    },
    {
      githubUserId: "202",
      grossMicro: "20000000",
      sourceDigest: `0x${"c2".repeat(32)}`,
    },
    {
      githubUserId: "303",
      grossMicro: "10000000",
      sourceDigest: `0x${"c3".repeat(32)}`,
    },
  ];
  const root = evmAllocationRoot(entries);
  const digest = evmMonthlyDigest(31337n, vault, period, root);
  const monthly = buildCommitMonthlyCalldata(
    period,
    entries,
    signDigest(digest, attesterKey),
  );
  await send(token, "mint(address,uint256)", [owner, "100000000"]);
  await send(token, "approve(address,uint256)", [vault, "100000000"]);
  await send(vault, "deposit(uint128)", ["100000000"]);
  await send(vault, "setMonthlyCommitment(uint128,bool)", [
    "50000000",
    "false",
  ]);
  await assert.rejects(
    simulate(vault, monthly, donor),
    new RegExp(selector("MonthlyDisabled()")),
    "the owner can opt out after creation",
  );
  await send(vault, "setMonthlyCommitment(uint128,bool)", ["50000000", "true"]);
  await assert.rejects(
    simulate(vault, monthly, donor),
    new RegExp(selector("MonthlyCapExceeded()")),
    "60 is above the owner's 50 cap",
  );
  await send(vault, "setMonthlyCommitment(uint128,bool)", ["60000000", "true"]);
  const onChain = (signature: string, args: string[]) =>
    execFileSync(
      "cast",
      ["call", vault, signature, ...args, "--rpc-url", rpcUrl],
      { encoding: "utf8" },
    ).trim();
  assert.equal(
    onChain("monthlyDigest(uint32,bytes32)(bytes32)", [periodNumber, root]),
    digest,
    "the adapter digest equals ProjectEscrow.monthlyDigest",
  );
  await assert.rejects(
    simulate(
      vault,
      buildCommitMonthlyCalldata(
        period,
        entries,
        signDigest(digest, recipientKey),
      ),
      donor,
    ),
    new RegExp(selector("InvalidAttestation()")),
    "only the identity authority attests",
  );
  assert.notEqual(
    evmMonthlyDigest(31337n, donorVault, period, root),
    digest,
    "the digest binds the vault, so a signature for one vault never commits in another",
  );
  // A manual reservation lands after the allocation was signed. The batch must
  // keep it intact and reserve the remaining awards rather than revert or pay twice.
  const manualEntry = entries[1];
  const manualTx = await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: vault,
      gas: "0x7a1200",
      data: buildCommitAwardCalldata({
        obligationId: evmAwardId(31337n, vault, manualEntry.sourceDigest),
        githubUserId: manualEntry.githubUserId,
        grossMicro: manualEntry.grossMicro,
        sourceDigest: manualEntry.sourceDigest,
      }),
    },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  const records = new Map<string, unknown>();
  const monthlyJournal: JournalStore = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      records.set(key, structuredClone(value));
    },
    async transaction<T>(fn: (store: JournalStore) => Promise<T>) {
      return fn(monthlyJournal);
    },
  };
  const gasAccount = mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex: 4 },
  );
  const monthlyEnv = {
    PAYMENTS_DB: {
      prepare() {
        throw new Error("Monthly execution must not read wallet consents");
      },
      async batch() {
        throw new Error("Unexpected database mutation");
      },
    },
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      {
        ...config,
        chain: "base",
        chainId: "31337",
        network: "anvil",
        projectId,
        gasCeiling: "8000000",
      },
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({ anvil: rpcUrl }),
    SIGNER: gasAccount,
    JOURNAL: monthlyJournal,
    ALLOW_LOCAL_TEST_CHAIN: true,
  };
  // The existing explicit local-chain override is used only by this harness.
  const monthlyAuthorization = {
    plan: {
      request: {
        projectId,
        period,
        network: "anvil",
        snapshotSha256: "a".repeat(64),
      },
      deployment: { ...config, network: "anvil" },
      family: "evm",
      allocationRoot: root,
      messageHex: digest.slice(2),
      totalGrossBase: "60000000",
      entries: entries.map((entry) => ({
        ...entry,
        grossMicro: entry.grossMicro.toString(),
      })),
    },
    signatureHex: signDigest(digest, attesterKey).slice(2),
  } as unknown as MonthlyAuthorization;
  await assert.rejects(
    submitEvmMonthly(monthlyEnv, {
      ...monthlyAuthorization,
      signatureHex: signDigest(digest, recipientKey).slice(2),
    }),
    /authority signature/,
  );
  const submitted = await submitEvmMonthly(monthlyEnv, monthlyAuthorization);
  assert.equal(submitted.alreadyCommitted, false);
  assert.ok(submitted.transactionId);
  const monthlyTx = submitted.transactionId;
  await rpc("anvil_mine", ["0x1"]);
  const nonceAfter = await rpc("eth_getTransactionCount", [donor, "latest"]);
  assert.deepEqual(
    await submitEvmMonthly(monthlyEnv, monthlyAuthorization),
    submitted,
    "an unfinalized retry returns the same journaled transaction",
  );
  await rpc("anvil_mine", ["0x40"]);
  assert.deepEqual(await submitEvmMonthly(monthlyEnv, monthlyAuthorization), {
    transactionId: null,
    alreadyCommitted: true,
  });
  assert.equal(
    await rpc("eth_getTransactionCount", [donor, "latest"]),
    nonceAfter,
    "a committed monthly retry spends no gas",
  );
  await rpc("anvil_mine", ["0x40"]);
  assert.equal(
    onChain("monthlyRoots(uint32)(bytes32)", [periodNumber]),
    root,
    "the adapter root equals ProjectEscrow.allocationRoot",
  );
  for (const [index, entry] of entries.entries()) {
    const monthlyId = evmAwardId(31337n, vault, entry.sourceDigest);
    const reserved = await verifyReserve(
      config,
      index === 1 ? manualTx : monthlyTx,
      index === 2 ? 1 : 0,
      monthlyId,
    );
    assert.equal(reserved.githubUserId, entry.githubUserId);
    assert.equal(reserved.grossMicro, entry.grossMicro);
    assert.equal(
      reserved.feeMicro,
      (BigInt(entry.grossMicro) / 50n).toString(),
    );
  }
  await assert.rejects(
    simulate(vault, monthly, donor),
    new RegExp(selector("MonthlyAlreadyCommitted()")),
    "one commitment per period; the signature cannot replay",
  );
  await send(vault, "setMonthlyCommitment(uint128,bool)", [
    "60000000",
    "false",
  ]);
  assert.equal(onChain("monthlyEnabled()(bool)", []), "false", "owner opt-out");
  // Identity authority rotation: the registrar (the deployer here) proposes and
  // the change takes effect after 7 days. The adapter pins the factory and its
  // rotation rules, not the authority in force, so verification continues
  // through the rotation without a manifest change.
  assert.deepEqual(await readEvmAuthorityRotation(config, "latest"), {
    factory: factory.toLowerCase(),
    identityAuthority: attester.toLowerCase(),
    pendingIdentityAuthority: null,
    effectiveAt: null,
  });
  await send(factory, "proposeIdentityAuthority(address)", [nextAttester]);
  const pending = await readEvmAuthorityRotation(config, "latest");
  assert.equal(pending.pendingIdentityAuthority, nextAttester.toLowerCase());
  assert.ok(BigInt(pending.effectiveAt ?? "0") > 0n);
  await send(factory, "executeIdentityAuthorityRotation()", [], recipient);
  assert.equal(
    (await readEvmAuthorityRotation(config, "latest")).identityAuthority,
    nextAttester.toLowerCase(),
  );
  await rpc("anvil_mine", ["0x40"]);
  await verifyEvmDeployment(config);
  assert.equal(
    (await verifyPayment(config, paymentTx, 0, id)).netMicro,
    "98000000",
    "a payment made before the rotation still verifies after it",
  );
  const beforeUpgrade = await readVaultTotals(config);
  const nextVaultLogic = deploy("src/ProjectEscrow.sol:ProjectEscrow");
  const nextFactoryLogic = deploy("src/ProjectEscrow.sol:EscrowFactory");
  await send(vault, "upgradeToAndCall(address,bytes)", [nextVaultLogic, "0x"]);
  await send(factory, "upgradeToAndCall(address,bytes)", [
    nextFactoryLogic,
    "0x",
  ]);
  await rpc("anvil_mine", ["0x40"]);
  await assert.rejects(
    verifyEvmDeployment(config),
    /implementation/,
    "Unreviewed upgrades cannot reuse the old approval",
  );
  const upgradedConfig = {
    ...config,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  await verifyEvmDeployment(upgradedConfig);
  const afterUpgrade = await readVaultTotals(upgradedConfig);
  assert.deepEqual(
    {
      ...afterUpgrade,
      blockNumber: beforeUpgrade.blockNumber,
      blockTime: beforeUpgrade.blockTime,
    },
    beforeUpgrade,
    "Both proxy upgrades preserve exact funded vault counters",
  );
  assert.equal(
    (await verifyPayment(config, paymentTx, 0, id)).netMicro,
    "98000000",
    "Historical payment keeps its original reviewed implementation",
  );
  await assert.rejects(
    verifyPayment(upgradedConfig, paymentTx, 0, id),
    /implementation/,
    "A new implementation approval cannot rewrite historical payment provenance",
  );
  console.log(
    "EVM adapter integration passed: real factory deployment, permissionless owner-keyed vault creation, separate ordinary and bounty vaults, permissionless deposit, 18-decimal vault beyond uint64, readVaultTotals, 2% withdrawal fee, vault-bound award, wallet-accepted immediate and cancellable binding, payment, fee claim, signed capped once-per-period monthly commitment from any sender, owner opt-out, finalized gating, wrong chain/vault/award/index/delay/purpose rejection, immediate authority rotation.",
  );
} finally {
  anvil.kill("SIGTERM");
}
