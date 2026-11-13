import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { toFunctionSelector } from "viem";
import {
  buildDepositCalldata,
  EVM_ESCROW_EVENT_TOPICS,
} from "../../contracts/evm/adapter";
import type { EscrowDeployment } from "./escrow-policy.mjs";
import {
  checkVaultAction,
  checkVaultBatch,
  type VaultConnection,
} from "./evm-vault-actions";

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const addressWord = (value: string) =>
  `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
const uintWord = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const OWNER = address(1);
const OTHER = address(2);
const VAULT = address(3);
const FACTORY = address(4);
const ASSET = address(5);
const TRANSACTION = `0x${"a".repeat(64)}`;
const BLOCK = `0x${"b".repeat(64)}`;
const CODE = "0x6000";
const CODE_SHA = createHash("sha256")
  .update(Buffer.from(CODE.slice(2), "hex"))
  .digest("hex");
const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault: VAULT,
  factory: FACTORY,
  asset: ASSET,
  owner: OWNER,
  registrar: address(6),
  feeRecipient: address(7),
  identityAuthority: address(8),
  bindingDelaySeconds: "0",
  codeSha256: CODE_SHA,
  factoryCodeSha256: CODE_SHA,
  deploymentTransaction: `0x${"c".repeat(64)}`,
  sourceCommit: "d".repeat(40),
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  rotationDelaySeconds: null,
};
function deposited(depositor = OWNER, gross = 7n, logIndex = "0x9") {
  return {
    address: VAULT,
    topics: [EVM_ESCROW_EVENT_TOPICS.Deposited, addressWord(depositor)],
    data: uintWord(gross),
    logIndex,
    transactionHash: TRANSACTION,
    blockHash: BLOCK,
    blockNumber: "0x10",
    removed: false,
  };
}

/** Read-only RPC fixture exercises the real finality and deployment verifier. */
function fixture(
  logs: ReturnType<typeof deposited>[],
  options: {
    asset?: string;
    finalized?: string;
    canonicalHash?: string;
    status?: string;
    input?: string;
  } = {},
) {
  const reads: string[] = [];
  const getters = new Map(
    Object.entries({
      "registrar()": addressWord(deployment.registrar as string),
      "feeRecipient()": addressWord(deployment.feeRecipient),
      "bindingDelay()": uintWord(0n),
      "AUTHORITY_ROTATION_DELAY()": uintWord(604800n),
      "token()": addressWord(options.asset ?? ASSET),
      "owner()": addressWord(OWNER),
      "factory()": addressWord(FACTORY),
      "purpose()": uintWord(0n),
      "projectId()": `0x${"e".repeat(64)}`,
      "vaults(bytes32)": addressWord(VAULT),
    }).map(([signature, value]) => [toFunctionSelector(signature), value]),
  );
  const request = async (method: string, params: unknown[]) => {
    reads.push(method);
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_getTransactionReceipt") {
      expect(params).toEqual([TRANSACTION]);
      return {
        transactionHash: TRANSACTION,
        blockHash: BLOCK,
        blockNumber: "0x10",
        status: options.status ?? "0x1",
        logs,
      };
    }
    if (method === "eth_getBlockByNumber")
      return {
        number:
          params[0] === "finalized" ? (options.finalized ?? "0x20") : "0x10",
        hash: options.canonicalHash ?? BLOCK,
      };
    if (method === "eth_getTransactionByHash")
      return {
        from: OWNER,
        to: VAULT,
        input: options.input ?? "0x",
        value: "0x0",
      };
    if (method === "eth_getCode") return CODE;
    if (method === "eth_getStorageAt") return uintWord(0n);
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string };
      expect([VAULT, FACTORY]).toContain(call.to);
      const value = getters.get(call.data.slice(0, 10) as `0x${string}`);
      if (value !== undefined) return value;
    }
    throw new Error(`Unexpected fixture RPC: ${method}`);
  };
  const wallet: VaultConnection = {
    address: OWNER,
    sign: async () => {
      throw new Error("Recovery must not sign");
    },
    evmRequest: request,
  };
  return {
    reads,
    check: () => checkVaultBatch(deployment, wallet, "7", null, TRANSACTION),
    send: () =>
      checkVaultAction(deployment, wallet, "deposit", "7", TRANSACTION, "send"),
  };
}

test("a shared receipt verifies the exact wallet deposit among unrelated deposits", async () => {
  const { check, reads } = fixture([deposited(OTHER, 7n, "0x4"), deposited()]);
  expect(await check()).toEqual({
    status: "finalized",
    transactionId: TRANSACTION,
  });
  expect(reads).toContain("eth_getCode");
  expect(reads).toContain("eth_call");
});

test("two deposits by the wallet remain ambiguous", async () => {
  const { check } = fixture([deposited(), deposited(OWNER, 7n, "0xa")]);
  await expect(check()).rejects.toThrow("does not match the request");
});

test("a correct amount does not hide another deposit by the same wallet", async () => {
  const { check } = fixture([deposited(), deposited(OWNER, 11n, "0xa")]);
  await expect(check()).rejects.toThrow("does not match the request");
});

test("another wallet's deposit cannot prove this request", async () => {
  const { check } = fixture([deposited(OTHER)]);
  await expect(check()).rejects.toThrow("does not match");
});

test("the selected wallet deposit must still have the exact amount", async () => {
  const { check } = fixture([deposited(OWNER, 8n)]);
  await expect(check()).rejects.toThrow("does not match this action");
});

test("the selected deposit must still belong to the requested vault", async () => {
  const { check } = fixture([{ ...deposited(), address: address(9) }]);
  await expect(check()).rejects.toThrow("does not match the request");
});

test("a matching event cannot replace the verified asset identity", async () => {
  const { check } = fixture([deposited()], { asset: OTHER });
  await expect(check()).rejects.toThrow("does not match reviewed deployment");
});

test("a matching deposit is received, not verified, before finality", async () => {
  const { check, reads } = fixture([deposited()], { finalized: "0xf" });
  expect(await check()).toEqual({
    status: "received",
    transactionId: TRANSACTION,
  });
  // Received is display only: the deployment and amount are not verified yet.
  expect(reads).not.toContain("eth_call");
});

test("a deposit whose unfinal block was replaced stays pending", async () => {
  const { check } = fixture([deposited()], {
    finalized: "0xf",
    canonicalHash: `0x${"f".repeat(64)}`,
  });
  expect(await check()).toEqual({
    status: "pending",
    transactionId: TRANSACTION,
  });
});

test("a reverted unfinal batch is never reported as received", async () => {
  const { check } = fixture([deposited()], {
    finalized: "0xf",
    status: "0x0",
  });
  expect(await check()).toEqual({
    status: "pending",
    transactionId: TRANSACTION,
  });
});

test("another wallet's unfinal deposit is not reported as received", async () => {
  const { check } = fixture([deposited(OTHER)], { finalized: "0xf" });
  expect(await check()).toEqual({
    status: "pending",
    transactionId: TRANSACTION,
  });
});

test("a matching deposit must still be in the canonical finalized block", async () => {
  const { check } = fixture([deposited()], {
    canonicalHash: `0x${"f".repeat(64)}`,
  });
  await expect(check()).rejects.toThrow("canonical finalized chain");
});

test("a reverted receipt never becomes a verified deposit", async () => {
  const { check } = fixture([deposited()], { status: "0x0" });
  expect(await check()).toEqual({
    status: "failed",
    transactionId: TRANSACTION,
  });
});

test("a direct deposit is received before finality and verified after it", async () => {
  const input = buildDepositCalldata("7");
  const early = fixture([deposited()], { finalized: "0xf", input });
  expect(await early.send()).toBe("received");
  expect(early.reads).not.toContain("eth_call");
  const final = fixture([deposited()], { input });
  expect(await final.send()).toBe("finalized");
  expect(final.reads).toContain("eth_call");
});

test("a reverted unfinal direct deposit is never reported as received", async () => {
  const { send } = fixture([deposited()], {
    finalized: "0xf",
    status: "0x0",
    input: buildDepositCalldata("7"),
  });
  expect(await send()).toBe("pending");
});
