/** Native ETH lifecycle through the real wallet helpers, escrow, and finalized readers on Anvil. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import {
  checkVaultAction,
  reviewVaultAction,
  sendVaultAction,
  type VaultConnection,
} from "../../src/lib/evm-vault-actions";
import {
  buildBindCalldata,
  buildClaimFeesCalldata,
  buildCommitAwardCalldata,
  buildCommitMonthlyCalldata,
  buildCreateVaultCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildWithdrawCalldata,
  EVM_NATIVE_ASSET,
  type EvmEscrowConfig,
  evmAllocationRoot,
  evmAwardId,
  evmBindingDigest,
  evmMonthlyDigest,
  evmVaultKey,
  readVaultTotals,
  verifyPayment,
  verifyReserve,
} from "./adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "./integration/upgrade";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = process.env.SLOP_NATIVE_EVM_TEST_PORT ?? "18549";
const rpcUrl = `http://127.0.0.1:${port}`;
const chainId = 84532n;
const anvil = spawn(
  "anvil",
  ["--port", port, "--chain-id", String(chainId), "--silent"],
  {
    stdio: "ignore",
  },
);
const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const authority = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const donor = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const feeRecipient = "0x0000000000000000000000000000000000000fee";
const projectId = `0x${"91".repeat(32)}`;
const gross = 200_000_000_000_000_000n;
const deposit = 1_000_000_000_000_000_000n;
const refund = 300_000_000_000_000_000n;
const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
};
const balance = async (address: string) =>
  BigInt(String(await rpc("eth_getBalance", [address, "latest"])));
const hashCode = async (address: string) =>
  createHash("sha256")
    .update(
      Buffer.from(
        String(await rpc("eth_getCode", [address, "latest"])).slice(2),
        "hex",
      ),
    )
    .digest("hex");
function deploy(contract: string, args: string[] = []): string {
  if (contract === "src/ProjectEscrow.sol:EscrowFactory" && args.length)
    return deployUpgradeableFactory(deploy, args);
  return JSON.parse(
    execFileSync(
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
    ),
  ).deployedTo;
}
type Receipt = {
  status: string;
  gasUsed: string;
  effectiveGasPrice: string;
};
async function finalized(transaction: string): Promise<Receipt> {
  await rpc("anvil_mine", ["0x40"]);
  const result = (await rpc("eth_getTransactionReceipt", [
    transaction,
  ])) as Receipt;
  assert.equal(result.status, "0x1");
  return result;
}
const gasPaid = (receipt: Receipt) =>
  BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
async function send(to: string, data: string, from = owner, value = 0n) {
  return String(
    await rpc("eth_sendTransaction", [
      { from, to, data, value: `0x${value.toString(16)}`, gas: "0x7a1200" },
    ]),
  );
}
async function createNativeVault(factory: string) {
  const transaction = await send(
    factory,
    buildCreateVaultCalldata({
      projectId,
      asset: EVM_NATIVE_ASSET,
      monthlyCap: String(deposit),
      automaticMonthly: true,
    }),
  );
  await finalized(transaction);
  const data = execFileSync(
    "cast",
    [
      "calldata",
      "vaults(bytes32)",
      evmVaultKey({ owner, projectId, asset: EVM_NATIVE_ASSET }),
    ],
    { encoding: "utf8" },
  ).trim();
  return `0x${String(await rpc("eth_call", [{ to: factory, data }, "latest"])).slice(-40)}`;
}
function wallet(address: string): VaultConnection {
  return {
    address,
    sign: async () => {
      throw new Error("No message signature is needed for vault funding");
    },
    evmRequest: (method, params) =>
      method === "eth_accounts"
        ? Promise.resolve([address])
        : rpc(method, params),
  };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (anvil.exitCode !== null)
      throw new Error("Native Anvil could not start");
    try {
      await rpc("eth_chainId", []);
      ready = true;
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready, "Anvil started");
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner,
    feeRecipient,
    authority,
    "0",
  ]);
  const vault = await createNativeVault(factory);
  const config: EvmEscrowConfig = {
    rpcUrl,
    chainId,
    vault,
    asset: EVM_NATIVE_ASSET,
    owner,
    identityAuthority: authority,
    feeRecipient,
    codeSha256: await hashCode(vault),
    bindingDelaySeconds: "0",
    factory,
    factoryCodeSha256: await hashCode(factory),
    registrar: owner,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  const deployment: EscrowDeployment = {
    ...config,
    network: "base-sepolia",
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    deploymentTransaction: `0x${"1".repeat(64)}`,
    sourceCommit: "1".repeat(40),
    rotationDelaySeconds: null,
  };
  const donorWallet = wallet(donor);
  const reviewed = await reviewVaultAction(
    deployment,
    donorWallet,
    "deposit",
    "1",
  );
  assert.equal(reviewed.gross, String(deposit));
  assert.equal(reviewed.decimals, 18);
  assert.equal(reviewed.approvalNeeded, false);
  assert.equal(reviewed.resetAllowance, false);
  await assert.rejects(
    sendVaultAction(
      deployment,
      donorWallet,
      "deposit",
      "1",
      "approve",
      () => {},
    ),
  );
  const donorBefore = await balance(donor);
  const depositTx = await sendVaultAction(
    deployment,
    donorWallet,
    "deposit",
    "1",
    "send",
    () => {},
  );
  const depositReceipt = await finalized(depositTx);
  assert.equal(
    await balance(donor),
    donorBefore - deposit - gasPaid(depositReceipt),
  );
  assert.equal(await balance(vault), deposit);
  assert.equal(
    await checkVaultAction(
      deployment,
      donorWallet,
      "deposit",
      String(deposit),
      depositTx,
      "send",
    ),
    "finalized",
  );
  await assert.rejects(
    checkVaultAction(
      deployment,
      donorWallet,
      "deposit",
      String(deposit + 1n),
      depositTx,
      "send",
    ),
  );
  for (const value of [0n, deposit - 1n, deposit + 1n]) {
    await assert.rejects(
      rpc("eth_call", [
        {
          from: donor,
          to: vault,
          data: buildDepositCalldata(deposit),
          value: `0x${value.toString(16)}`,
        },
        "latest",
      ]),
    );
  }
  await assert.rejects(
    rpc("eth_call", [
      { from: donor, to: vault, data: "0x", value: "0x1" },
      "latest",
    ]),
  );
  const rejectedBefore = await balance(donor);
  const wrongValueTx = await send(vault, buildDepositCalldata(1n), donor, 2n);
  await rpc("anvil_mine", ["0x40"]);
  const rejectedReceipt = (await rpc("eth_getTransactionReceipt", [
    wrongValueTx,
  ])) as Receipt;
  assert.equal(rejectedReceipt.status, "0x0");
  assert.equal(await balance(donor), rejectedBefore - gasPaid(rejectedReceipt));
  assert.equal(await balance(vault), deposit);
  const token = deploy("integration/TestDollar.sol:TestDollar");
  const tokenCreate = await send(
    factory,
    buildCreateVaultCalldata({ projectId, asset: token, monthlyCap: "100" }),
  );
  await finalized(tokenCreate);
  const tokenKey = execFileSync(
    "cast",
    [
      "calldata",
      "vaults(bytes32)",
      evmVaultKey({ owner, projectId, asset: token }),
    ],
    { encoding: "utf8" },
  ).trim();
  const tokenVault = `0x${String(await rpc("eth_call", [{ to: factory, data: tokenKey }, "latest"])).slice(-40)}`;
  const unexpectedValue = await send(
    tokenVault,
    buildDepositCalldata(1n),
    donor,
    1n,
  );
  await rpc("anvil_mine", ["0x40"]);
  assert.equal(
    ((await rpc("eth_getTransactionReceipt", [unexpectedValue])) as Receipt)
      .status,
    "0x0",
  );
  assert.equal(
    await balance(tokenVault),
    0n,
    "an ERC20 vault never retains ETH sent with a deposit",
  );

  const source = `0x${"92".repeat(32)}`;
  const award = evmAwardId(chainId, vault, source);
  const reserveTx = await send(
    vault,
    buildCommitAwardCalldata({
      obligationId: award,
      githubUserId: "101",
      grossMicro: String(gross),
      sourceDigest: source,
    }),
  );
  await finalized(reserveTx);
  assert.equal(
    (await verifyReserve(config, reserveTx, 0, award)).grossMicro,
    String(gross),
  );
  const binding = {
    githubUserId: "101",
    destination: recipient,
    expectedVersion: "0",
    claimDigest: source,
    expiresAt: "18446744073709551615",
  };
  const recipientKey = Uint8Array.from(
    Buffer.from(
      "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      "hex",
    ),
  );
  const signature = secp256k1.sign(
    Buffer.from(evmBindingDigest(chainId, vault, binding).slice(2), "hex"),
    recipientKey,
    { prehash: false, format: "recovered" },
  );
  const walletSignature = `0x${Buffer.from(signature.slice(1)).toString("hex")}${(signature[0] + 27).toString(16)}`;
  await finalized(
    await send(
      vault,
      buildBindCalldata({ ...binding, walletSignature }),
      authority,
    ),
  );
  const recipientBefore = await balance(recipient);
  const payTx = await send(vault, buildPayCalldata(award, "1"), recipient);
  const paidReceipt = await finalized(payTx);
  const payoutFee = gross / 50n;
  assert.equal(
    await balance(recipient),
    recipientBefore + gross - payoutFee - gasPaid(paidReceipt),
  );
  assert.equal(
    (await verifyPayment(config, payTx, 0, award)).netMicro,
    String(gross - payoutFee),
  );
  const timestamp = Number(
    (
      (await rpc("eth_getBlockByNumber", ["latest", false])) as {
        timestamp: string;
      }
    ).timestamp,
  );
  const shifted = new Date((timestamp - 72 * 60 * 60) * 1000);
  const month = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const period = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthlyGross = 100_000_000_000_000_000n;
  const monthlySource = `0x${"93".repeat(32)}`;
  const entries = [
    {
      githubUserId: "101",
      grossMicro: String(monthlyGross),
      sourceDigest: monthlySource,
    },
  ];
  const monthlyDigest = evmMonthlyDigest(
    chainId,
    vault,
    period,
    evmAllocationRoot(entries),
  );
  const authorityKey = Uint8Array.from(
    Buffer.from(
      "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      "hex",
    ),
  );
  const signed = secp256k1.sign(
    Buffer.from(monthlyDigest.slice(2), "hex"),
    authorityKey,
    { prehash: false, format: "recovered" },
  );
  const attestation = `0x${Buffer.from(signed.slice(1)).toString("hex")}${(signed[0] + 27).toString(16)}`;
  const monthlyTx = await send(
    vault,
    buildCommitMonthlyCalldata(period, entries, attestation),
    donor,
  );
  await finalized(monthlyTx);
  const monthlyAward = evmAwardId(chainId, vault, monthlySource);
  assert.equal(
    (await verifyReserve(config, monthlyTx, 0, monthlyAward)).grossMicro,
    String(monthlyGross),
  );
  const beforeMonthlyPayment = await balance(recipient);
  const monthlyPayment = await send(
    vault,
    buildPayCalldata(monthlyAward, "1"),
    recipient,
  );
  const monthlyReceipt = await finalized(monthlyPayment);
  const monthlyFee = monthlyGross / 50n;
  assert.equal(
    await balance(recipient),
    beforeMonthlyPayment + monthlyGross - monthlyFee - gasPaid(monthlyReceipt),
  );
  assert.equal(
    (await verifyPayment(config, monthlyPayment, 0, monthlyAward)).netMicro,
    String(monthlyGross - monthlyFee),
  );
  const ownerBefore = await balance(owner);
  const withdrawal = await sendVaultAction(
    deployment,
    wallet(owner),
    "withdraw",
    "0.3",
    "send",
    () => {},
  );
  const withdrawalReceipt = await finalized(withdrawal);
  const withdrawalFee = refund / 50n;
  assert.equal(
    await balance(owner),
    ownerBefore + refund - withdrawalFee - gasPaid(withdrawalReceipt),
  );
  assert.equal(
    await checkVaultAction(
      deployment,
      wallet(owner),
      "withdraw",
      String(refund),
      withdrawal,
      "send",
    ),
    "finalized",
  );
  const feeBefore = await balance(feeRecipient);
  await finalized(await send(vault, buildClaimFeesCalldata()));
  assert.equal(
    await balance(feeRecipient),
    feeBefore + payoutFee + monthlyFee + withdrawalFee,
  );
  assert.equal(await balance(vault), deposit - gross - monthlyGross - refund);
  const totals = await readVaultTotals({
    rpcUrl,
    chainId,
    network: "base-sepolia",
    vault,
  });
  assert.equal(totals.asset, EVM_NATIVE_ASSET);
  assert.equal(totals.decimals, 18);
  assert.equal(totals.totalDeposited, String(deposit));
  assert.equal(
    totals.totalPaid,
    String(gross - payoutFee + monthlyGross - monthlyFee),
  );
  assert.equal(
    totals.freeBalance,
    String(deposit - gross - monthlyGross - refund),
  );
  assert.equal(totals.accruedFees, "0");

  const hostileFee = deploy(
    "integration/NativeFeeReceiver.sol:NativeFeeReceiver",
  );
  const hostileFactory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner,
    hostileFee,
    authority,
    "0",
  ]);
  const hostileVault = await createNativeVault(hostileFactory);
  await finalized(
    await send(hostileVault, buildDepositCalldata(100n), owner, 100n),
  );
  await finalized(await send(hostileVault, buildWithdrawCalldata(50n)));
  const failedFeeTx = await send(hostileVault, buildClaimFeesCalldata());
  await rpc("anvil_mine", ["0x40"]);
  assert.equal(
    ((await rpc("eth_getTransactionReceipt", [failedFeeTx])) as Receipt).status,
    "0x0",
  );
  assert.equal(await balance(hostileFee), 0n);
  assert.equal(await balance(hostileVault), 51n);
  await finalized(
    await send(
      hostileFee,
      execFileSync(
        "cast",
        ["calldata", "acceptAndReenter(address)", hostileVault],
        { encoding: "utf8" },
      ).trim(),
    ),
  );
  await finalized(await send(hostileVault, buildClaimFeesCalldata()));
  assert.equal(await balance(hostileFee), 1n);
  assert.equal(await balance(hostileVault), 50n);
  const errorData = execFileSync("cast", ["calldata", "reentryError()"], {
    encoding: "utf8",
  }).trim();
  const reentry = String(
    await rpc("eth_call", [{ to: hostileFee, data: errorData }, "latest"]),
  );
  assert.equal(
    reentry.slice(0, 10),
    execFileSync("cast", ["sig", "ReentrantCall()"], {
      encoding: "utf8",
    }).trim(),
  );
  console.log(
    "Native ETH integration passed: real wallet deposit, exact value, sender gas accounting, reserve, signed binding, payout, monthly allocation and payment, owner refund, fee claim, finalized totals, rejected receiver recovery and reentry refusal.",
  );
} finally {
  anvil.kill("SIGTERM");
}
