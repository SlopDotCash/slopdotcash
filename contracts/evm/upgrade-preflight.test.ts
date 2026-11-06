import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import {
  type CompiledImplementation,
  IMPLEMENTATION_SLOT,
  prepareUpgradeTransaction,
  type UpgradeApproval,
} from "./upgrade-preflight";

const GOOD_CODE = "0x6001600055";
const MALICIOUS_CODE = "0x60006000fd";
const GOOD_DIGEST =
  "8880a54d03747df9eda6b310443a788558dc080c804db3fde94aee0382f66ea9";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROXY = "0x2222222222222222222222222222222222222222";

const approval: UpgradeApproval = {
  schemaVersion: 1,
  kind: "vault",
  contract: "ProjectEscrow",
  implementation: ADDRESS,
  runtimeCodeSha256: GOOD_DIGEST,
  source: {
    commit: "a".repeat(40),
    evmTree: "e".repeat(40),
    projectEscrowBlob: "b".repeat(40),
    foundryTomlSha256: "c".repeat(64),
  },
  storageLayoutSha256: "d".repeat(64),
  previousStorage: [
    { label: "owner", slot: "0", offset: 0, type: "t_address" },
  ],
};
const compiled: CompiledImplementation = {
  kind: "vault",
  contract: "ProjectEscrow",
  implementation: ADDRESS,
  runtimeCode: GOOD_CODE,
  runtimeCodeSha256: GOOD_DIGEST,
  source: approval.source,
  storageLayoutSha256: approval.storageLayoutSha256,
  storage: approval.previousStorage,
};

const rpcFor =
  (code: string, uuid = IMPLEMENTATION_SLOT) =>
  async (method: string) => {
    if (method === "eth_getCode") return code;
    if (method === "eth_call") return uuid;
    throw new Error(`Unexpected RPC method ${method}`);
  };

describe("UUPS upgrade preflight", () => {
  test("rejects a compatible-UUID implementation whose runtime is not independently compiled", async () => {
    await expect(
      prepareUpgradeTransaction({
        approval,
        compiled,
        proxy: PROXY,
        rpc: rpcFor(MALICIOUS_CODE),
      }),
    ).rejects.toThrow(
      "runtime bytecode does not match the approved independent build",
    );
  });

  test("accepts the approved implementation and emits only its zero-value upgrade call", async () => {
    const transaction = await prepareUpgradeTransaction({
      approval,
      compiled,
      proxy: PROXY,
      rpc: rpcFor(GOOD_CODE),
    });
    expect(transaction).toEqual({
      to: PROXY,
      value: "0x0",
      data: encodeFunctionData({
        abi: parseAbi(["function upgradeToAndCall(address,bytes)"]),
        functionName: "upgradeToAndCall",
        args: [ADDRESS, "0x"],
      }),
      implementation: ADDRESS,
      kind: "vault",
      runtimeCodeSha256: GOOD_DIGEST,
      sourceCommit: approval.source.commit,
    });
  });

  test("rejects a contract-kind substitution before producing calldata", async () => {
    await expect(
      prepareUpgradeTransaction({
        approval,
        compiled: { ...compiled, kind: "factory", contract: "EscrowFactory" },
        proxy: PROXY,
        rpc: rpcFor(GOOD_CODE),
      }),
    ).rejects.toThrow(
      "approved contract kind does not match the independent build",
    );
  });

  test("rejects an incompatible storage layout before producing calldata", async () => {
    await expect(
      prepareUpgradeTransaction({
        approval,
        compiled: {
          ...compiled,
          storage: [
            { label: "owner", slot: "1", offset: 0, type: "t_address" },
          ],
        },
        proxy: PROXY,
        rpc: rpcFor(GOOD_CODE),
      }),
    ).rejects.toThrow("storage layout is not append-compatible");
  });

  test("rejects unapproved source provenance before producing calldata", async () => {
    await expect(
      prepareUpgradeTransaction({
        approval,
        compiled: {
          ...compiled,
          source: { ...compiled.source, evmTree: "f".repeat(40) },
        },
        proxy: PROXY,
        rpc: rpcFor(GOOD_CODE),
      }),
    ).rejects.toThrow(
      "independent build provenance does not match the approval",
    );
  });

  test("rejects an implementation with no runtime code", async () => {
    await expect(
      prepareUpgradeTransaction({
        approval,
        compiled,
        proxy: PROXY,
        rpc: rpcFor("0x"),
      }),
    ).rejects.toThrow("implementation has no runtime code");
  });
});
