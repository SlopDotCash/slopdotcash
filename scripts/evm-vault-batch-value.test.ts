/**
 * A deposit sent with a month lock goes to the owner's wallet as one atomic
 * EIP-5792 request: sendMonthLock passes its lock call to sendVaultBatch after
 * the deposit. ProjectEscrow.deposit takes a native vault's ETH as the call's
 * value, so that deposit call must carry exactly the deposited amount; a token
 * vault's deposit carries none and its exact approval goes first (PRD section
 * 6). The Anvil proof is contracts/evm/native.integration.ts, which
 * test:contracts:evm runs only in the scheduled escrow job, never on a pull
 * request; this test drives the same send path in every unit run.
 * Model: formal/models/ui/ui_vault_month_lock.qnt.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import {
  buildDepositCalldata,
  EVM_NATIVE_ASSET,
} from "../contracts/evm/adapter";
import type { EscrowDeployment } from "../src/lib/escrow-policy.mjs";
import {
  sendVaultBatch,
  type VaultConnection,
} from "../src/lib/evm-vault-actions";

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const word = (value: bigint | string) =>
  `0x${(typeof value === "string" ? value.slice(2).toLowerCase() : value.toString(16)).padStart(64, "0")}`;
const OWNER = address(1);
const VAULT = address(3);
const FACTORY = address(4);
const TOKEN = address(5);
const CODE = "0x6000";
const CODE_SHA = createHash("sha256")
  .update(Buffer.from("6000", "hex"))
  .digest("hex");
const tokenAbi = parseAbi(["function approve(address,uint256) returns (bool)"]);
const VAULT_HEX = VAULT as `0x${string}`;
const lock = {
  to: VAULT,
  data: encodeFunctionData({
    abi: parseAbi(["function pledgeMonths(uint32,uint8,uint128)"]),
    args: [202611, 1, 1n],
  }),
  value: "0x0" as const,
};

/** A batching owner wallet over a finalized vault of `asset` that records what it is asked to send. */
function ownerWallet(asset: string, decimals: bigint) {
  const sent: { method: string; params: unknown[] }[] = [];
  const getters = new Map(
    Object.entries({
      "registrar()": word(address(6)),
      "feeRecipient()": word(address(7)),
      "bindingDelay()": word(0n),
      "AUTHORITY_ROTATION_DELAY()": word(604800n),
      "token()": word(asset),
      "owner()": word(OWNER),
      "factory()": word(FACTORY),
      "purpose()": word(0n),
      "projectId()": `0x${"e".repeat(64)}`,
      "vaults(bytes32)": word(VAULT),
      "decimals()": word(decimals),
      "totals()": `0x${"0".repeat(640)}`,
      "balanceOf(address)": word(10n ** 24n),
      "allowance(address,address)": word(0n),
    }).map(([signature, value]) => [toFunctionSelector(signature), value]),
  );
  const wallet: VaultConnection = {
    address: OWNER,
    sign: async () => {
      throw new Error("A vault batch is never signed as a message");
    },
    evmRequest: async (method: string, params: unknown[]) => {
      if (method === "eth_accounts") return [OWNER];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_getBlockByNumber")
        return {
          number: "0x20",
          hash: `0x${"b".repeat(64)}`,
          timestamp: "0x1",
        };
      if (method === "eth_getCode") return CODE;
      if (method === "eth_getStorageAt") return word(0n);
      // The vault holds no ETH yet; the owner's wallet holds 1 ETH.
      if (method === "eth_getBalance")
        return params[0] === VAULT ? "0x0" : "0xde0b6b3a7640000";
      if (method === "wallet_getCapabilities")
        return { "0x14a34": { atomic: { status: "supported" } } };
      if (method === "eth_call") {
        const value = getters.get(
          (params[0] as { data: string }).data.slice(0, 10) as `0x${string}`,
        );
        if (value !== undefined) return value;
      }
      if (method === "eth_estimateGas" || method === "wallet_sendCalls") {
        sent.push({ method, params });
        return method === "eth_estimateGas" ? "0x5208" : { id: "batch-1" };
      }
      throw new Error(`Unexpected wallet request: ${method}`);
    },
  };
  return { wallet, sent };
}

test.each([
  ["native ETH vault", EVM_NATIVE_ASSET, 18n, "500000000000000000", false],
  ["token vault", TOKEN, 6n, "500000", true],
] as const)(
  "a %s sends its deposit and month lock with the deposit's own value",
  async (_name, asset, decimals, gross, approval) => {
    const deployment: EscrowDeployment = {
      network: "base-sepolia",
      vault: VAULT,
      factory: FACTORY,
      asset,
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
    const { wallet, sent } = ownerWallet(asset, decimals);
    const id = await sendVaultBatch(
      deployment,
      wallet,
      "0.5",
      () => {},
      "ordinary",
      "finalized",
      [lock],
    );

    const deposit = {
      to: VAULT,
      data: buildDepositCalldata(gross),
      value:
        asset === EVM_NATIVE_ASSET ? `0x${BigInt(gross).toString(16)}` : "0x0",
    };
    const calls = [
      ...(approval
        ? [
            {
              to: TOKEN,
              data: encodeFunctionData({
                abi: tokenAbi,
                args: [VAULT_HEX, BigInt(gross)],
              }),
              value: "0x0",
            },
          ]
        : []),
      deposit,
      lock,
    ];
    expect(id).toBe("batch-1");
    expect(sent).toEqual([
      { method: "eth_estimateGas", params: [{ from: OWNER, ...calls[0] }] },
      {
        method: "wallet_sendCalls",
        params: [
          {
            version: "2.0.0",
            from: OWNER,
            chainId: "0x14a34",
            atomicRequired: true,
            calls,
          },
        ],
      },
    ]);
  },
);
