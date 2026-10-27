import { describe, expect, test } from "bun:test";
import { parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertEscrowPolicy,
  assertEscrowTransition,
  isMaxNativeCostWei,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { assertEvmNativeCost, preflightEvmDeployment } from "./core";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const deployment = () => ({
  network: "base-mainnet" as const,
  vault: address("1"),
  asset: address("2"),
  owner: address("3"),
  identityAuthority: address("4"),
  feeRecipient: address("5"),
  factory: address("6"),
  registrar: address("7"),
  factoryCodeSha256: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  deploymentTransaction: `0x${"c".repeat(64)}`,
  codeSha256: "d".repeat(64),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: null,
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
});
const policy = (limit?: unknown) => ({
  schemaVersion: "1",
  effectiveCycle: "2026-11",
  chain: "base",
  feeBasisPoints: 200,
  withdrawalFeeBasisPoints: 200,
  feeMode: "deduct-from-gross",
  deployments: [
    {
      ...deployment(),
      ...(limit === undefined ? {} : { maxNativeCostWei: limit }),
    },
  ],
});

describe("optional EVM operation envelope", () => {
  test("accepts only canonical positive uint256 native units, never numbers or zero", () => {
    for (const value of [
      "1",
      "1000000000000000",
      ((1n << 256n) - 1n).toString(),
    ]) {
      expect(isMaxNativeCostWei(value)).toBe(true);
      expect(assertEscrowPolicy(policy(value))).toBeDefined();
    }
    for (const value of [
      null,
      1,
      0,
      "0",
      "01",
      "-1",
      "1.5",
      " 1",
      "1e6",
      (1n << 256n).toString(),
    ]) {
      expect(isMaxNativeCostWei(value)).toBe(false);
      expect(() => assertEscrowPolicy(policy(value))).toThrow();
    }
    const solana = { ...policy("1"), chain: "solana" };
    Object.assign(solana.deployments[0], { rotationAuthority: address("8") });
    expect(() => assertEscrowPolicy(solana)).toThrow("native cost limit");
  });
  test("normal registry projection preserves an optional limit without changing defaults", () => {
    const plain = assertEscrowPolicy(policy()).deployments[0];
    expect(paymentDeploymentRecord("example", plain)).not.toHaveProperty(
      "maxNativeCostWei",
    );
    const limited = assertEscrowPolicy(policy("900000000000000"))
      .deployments[0];
    expect(paymentDeploymentRecord("example", limited).maxNativeCostWei).toBe(
      "900000000000000",
    );
  });
  test("only the operational limit may change in an owner revision", () => {
    const before = assertEscrowPolicy(policy("100"));
    for (const limit of [undefined, "50", "200"])
      expect(() =>
        assertEscrowTransition(before, assertEscrowPolicy(policy(limit))),
      ).not.toThrow();
    const changed = assertEscrowPolicy(policy("50"));
    changed.deployments[0].vault = address("8");
    expect(() => assertEscrowTransition(before, changed)).toThrow("immutable");
  });
  test("invalid runtime pin refuses before any RPC", async () => {
    let requests = 0;
    const prior = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests++;
      throw Error("RPC must not run");
    }) as unknown as typeof fetch;
    try {
      await expect(
        preflightEvmDeployment(
          {
            PAYMENT_DEPLOYMENTS: JSON.stringify([
              {
                ...paymentDeploymentRecord("example", deployment()),
                maxNativeCostWei: "0",
              },
            ]),
            PAYMENT_RPC_URLS: "{}",
          },
          { network: "base-mainnet", vault: address("1") },
        ),
      ).rejects.toThrow("native cost limit");
      expect(requests).toBe(0);
    } finally {
      globalThis.fetch = prior;
    }
  });
  test("gas times maximum fee, including native value, must fit before signing", () => {
    const bound = { maxNativeCostWei: "1000" };
    expect(() =>
      assertEvmNativeCost(bound, { gas: 100n, maxFeePerGas: 10n }),
    ).not.toThrow();
    expect(() =>
      assertEvmNativeCost(bound, { gas: 100n, maxFeePerGas: 10n, value: 1n }),
    ).toThrow();
    expect(() =>
      assertEvmNativeCost(bound, { gas: 101n, maxFeePerGas: 10n }),
    ).toThrow();
  });
  test("raising or removing a current cap cannot enlarge a retained operation", () => {
    const original = { maxNativeCostWei: "1000" },
      replacement = { gas: 100n, maxFeePerGas: 11n };
    for (const current of [{}, { maxNativeCostWei: "2000" }])
      expect(() =>
        assertEvmNativeCost(current, replacement, original),
      ).toThrow();
    expect(() =>
      assertEvmNativeCost(
        { maxNativeCostWei: "500" },
        { gas: 100n, maxFeePerGas: 6n },
        original,
      ),
    ).toThrow();
  });
  test("legacy operations retain defaults but a newly tightened current cap holds new sends", () => {
    const legacy = {};
    const envelope = { gas: 100n, maxFeePerGas: 30n };
    expect(() => assertEvmNativeCost({}, envelope, legacy)).not.toThrow();
    expect(() =>
      assertEvmNativeCost({ maxNativeCostWei: "2999" }, envelope, legacy),
    ).toThrow();
    // A canonical old receipt is evaluated against its original record, not this later cap.
    expect(() => assertEvmNativeCost({}, envelope, legacy)).not.toThrow();
  });
  test("a cancellation's smaller gas limit does not excuse a fee envelope over the original bound", async () => {
    const wallet = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const raw = await wallet.signTransaction({
      type: "eip1559",
      chainId: 8453,
      nonce: 1,
      to: wallet.address,
      value: 0n,
      data: "0x",
      gas: 21000n,
      maxFeePerGas: 1000000n,
      maxPriorityFeePerGas: 1n,
    });
    const tx = parseTransaction(raw);
    if (tx.gas === undefined || tx.maxFeePerGas === undefined)
      throw new Error("Missing signed gas envelope");
    const cap = { maxNativeCostWei: "20999999999" };
    expect(() =>
      assertEvmNativeCost(
        {},
        { gas: tx.gas, maxFeePerGas: tx.maxFeePerGas, value: tx.value },
        cap,
      ),
    ).toThrow();
    expect(() =>
      assertEvmNativeCost(
        {},
        { gas: tx.gas, maxFeePerGas: tx.maxFeePerGas },
        { maxNativeCostWei: "21000000000" },
      ),
    ).not.toThrow();
  });
  test("this is per-operation, not a lifetime or aggregate qualification allowance", () => {
    const cap = { maxNativeCostWei: "1000" },
      tx = { gas: 100n, maxFeePerGas: 10n };
    assertEvmNativeCost(cap, tx);
    assertEvmNativeCost(cap, tx);
  });
});
