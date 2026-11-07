import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { encodeFunctionData, parseAbi } from "viem";
import {
  type CompiledImplementation,
  IMPLEMENTATION_SLOT,
  prepareUpgradeTransaction,
  type StorageLayout,
  type UpgradeApproval,
} from "./upgrade-preflight";

const GOOD_CODE = "0x6001600055";
const NEXT_CODE = "0x6002600055";
const MALICIOUS_CODE = "0x60006000fd";
const sha256 = (code: string) =>
  createHash("sha256")
    .update(Buffer.from(code.slice(2), "hex"))
    .digest("hex");
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CURRENT = "0x3333333333333333333333333333333333333333";
const PROXY = "0x2222222222222222222222222222222222222222";
const storageWord = (address: string) =>
  `0x${address.slice(2).padStart(64, "0")}`;

const previousLayout: StorageLayout = {
  storage: [
    {
      astId: 1,
      contract: "ProjectEscrow.sol:ProjectEscrow",
      label: "owner",
      slot: "0",
      offset: 0,
      type: "t_address",
    },
  ],
  types: {
    t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
  },
};
const nextLayout: StorageLayout = {
  storage: [
    ...previousLayout.storage,
    {
      astId: 2,
      contract: "ProjectEscrow.sol:ProjectEscrow",
      label: "revision",
      slot: "1",
      offset: 0,
      type: "t_uint256",
    },
  ],
  types: {
    ...previousLayout.types,
    t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
  },
};
const source = {
  commit: "a".repeat(40),
  evmTree: "e".repeat(40),
  projectEscrowBlob: "b".repeat(40),
  foundryTomlSha256: "c".repeat(64),
};
const previousSource = { ...source, commit: "1".repeat(40) };
const approval = (): UpgradeApproval => ({
  schemaVersion: 2,
  kind: "vault",
  contract: "ProjectEscrow",
  implementation: ADDRESS,
  runtimeCodeSha256: sha256(NEXT_CODE),
  source,
  storageLayoutSha256: "d".repeat(64),
  previous: {
    implementation: CURRENT,
    runtimeCodeSha256: sha256(GOOD_CODE),
    source: previousSource,
    storageLayoutSha256: "e".repeat(64),
  },
});
const compiled = (): CompiledImplementation => ({
  kind: "vault",
  contract: "ProjectEscrow",
  implementation: ADDRESS,
  runtimeCode: NEXT_CODE,
  runtimeCodeSha256: sha256(NEXT_CODE),
  source,
  storageLayoutSha256: "d".repeat(64),
  storageLayout: nextLayout,
});
const previousCompiled = (): CompiledImplementation => ({
  kind: "vault",
  contract: "ProjectEscrow",
  implementation: CURRENT,
  runtimeCode: GOOD_CODE,
  runtimeCodeSha256: sha256(GOOD_CODE),
  source: previousSource,
  storageLayoutSha256: "e".repeat(64),
  storageLayout: previousLayout,
});
const rpcFor =
  (
    options: {
      targetCode?: string;
      currentCode?: string;
      current?: string;
      uuid?: string;
    } = {},
  ) =>
  async (method: string, params: unknown[]) => {
    if (method === "eth_getBlockByNumber")
      return {
        number: "0x123",
        hash: `0x${"ab".repeat(32)}`,
      };
    if (method === "eth_getStorageAt")
      return storageWord(options.current ?? CURRENT);
    if (method === "eth_getCode")
      return String(params[0]).toLowerCase() === CURRENT.toLowerCase()
        ? (options.currentCode ?? GOOD_CODE)
        : (options.targetCode ?? NEXT_CODE);
    if (method === "eth_call") return options.uuid ?? IMPLEMENTATION_SLOT;
    throw new Error(`Unexpected RPC method ${method}`);
  };
const inputs = () => ({
  approval: approval(),
  compiled: compiled(),
  previousCompiled: previousCompiled(),
  proxy: PROXY,
});

describe("UUPS upgrade preflight", () => {
  test("pins every state read to one canonical block and records the mandatory pre-broadcast revalidation", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const base = rpcFor();
    const transaction = await prepareUpgradeTransaction({
      ...inputs(),
      rpc: async (method, params) => {
        calls.push([method, params]);
        return base(method, params);
      },
    });
    const blockTag = {
      blockHash: `0x${"ab".repeat(32)}`,
      requireCanonical: true,
    };
    expect(calls).toEqual([
      ["eth_getBlockByNumber", ["latest", false]],
      ["eth_getStorageAt", [PROXY, IMPLEMENTATION_SLOT, blockTag]],
      ["eth_getCode", [CURRENT, blockTag]],
      ["eth_getCode", [ADDRESS, blockTag]],
      ["eth_call", [{ to: ADDRESS, data: "0x52d1902d" }, blockTag]],
      ["eth_getBlockByNumber", ["0x123", false]],
    ]);
    expect(transaction.snapshot).toEqual({
      blockNumber: "0x123",
      blockHash: `0x${"ab".repeat(32)}`,
      currentImplementation: CURRENT,
      currentRuntimeCodeSha256: sha256(GOOD_CODE),
    });
    expect(transaction.preBroadcastRevalidation).toEqual({
      required: true,
      instruction:
        "Immediately before broadcast, rerun this preflight and require an identical snapshot and transaction payload.",
    });
  });

  test("rejects a canonical block whose hash changes while state is read", async () => {
    let blockReads = 0;
    await expect(
      prepareUpgradeTransaction({
        ...inputs(),
        rpc: async (method, params) => {
          if (method === "eth_getBlockByNumber") {
            blockReads++;
            return {
              number: "0x123",
              hash: `0x${(blockReads === 1 ? "ab" : "cd").repeat(32)}`,
            };
          }
          return rpcFor()(method, params);
        },
      }),
    ).rejects.toThrow("RPC canonical block changed during preflight");
  });

  test("rejects malformed or mismatched canonical block responses", async () => {
    for (const block of [
      { number: "291", hash: `0x${"ab".repeat(32)}` },
      { number: "0x123", hash: "0x1234" },
      { number: "0x124", hash: `0x${"ab".repeat(32)}` },
    ]) {
      let reads = 0;
      await expect(
        prepareUpgradeTransaction({
          ...inputs(),
          rpc: async (method, params) => {
            if (method === "eth_getBlockByNumber") {
              reads++;
              return reads === 1
                ? { number: "0x123", hash: `0x${"ab".repeat(32)}` }
                : block;
            }
            return rpcFor()(method, params);
          },
        }),
      ).rejects.toThrow(/canonical block/);
    }
  });
  test("rejects a target proxy whose current implementation is the other approved contract kind", async () => {
    const value = inputs();
    value.previousCompiled = {
      ...value.previousCompiled,
      kind: "factory",
      contract: "EscrowFactory",
    };
    await expect(
      prepareUpgradeTransaction({ ...value, rpc: rpcFor() }),
    ).rejects.toThrow("target proxy contract kind does not match the approval");
  });

  test("accepts equivalent build provenance with a different property order", async () => {
    const value = inputs();
    value.approval.source = {
      foundryTomlSha256: source.foundryTomlSha256,
      projectEscrowBlob: source.projectEscrowBlob,
      evmTree: source.evmTree,
      commit: source.commit,
    };
    value.approval.previous.source = {
      foundryTomlSha256: previousSource.foundryTomlSha256,
      projectEscrowBlob: previousSource.projectEscrowBlob,
      evmTree: previousSource.evmTree,
      commit: previousSource.commit,
    };

    await expect(
      prepareUpgradeTransaction({ ...value, rpc: rpcFor() }),
    ).resolves.toMatchObject({ implementation: ADDRESS });
  });

  test("rejects a proxy whose implementation slot does not select the independently built prior implementation", async () => {
    await expect(
      prepareUpgradeTransaction({
        ...inputs(),
        rpc: rpcFor({ current: "0x4444444444444444444444444444444444444444" }),
      }),
    ).rejects.toThrow(
      "target proxy does not select the approved prior implementation",
    );
  });

  test("rejects a one-entry previous-layout approval by using the complete independently compiled prior layout", async () => {
    const value = inputs();
    value.compiled.storageLayout = { storage: [], types: nextLayout.types };
    await expect(
      prepareUpgradeTransaction({ ...value, rpc: rpcFor() }),
    ).rejects.toThrow("storage layout is not append-compatible");
  });

  test("rejects a struct member type change even when storage rows are unchanged", async () => {
    const value = inputs();
    value.previousCompiled.storageLayout = {
      storage: [
        {
          astId: 1,
          contract: "C",
          label: "record",
          slot: "0",
          offset: 0,
          type: "t_struct_old",
        },
      ],
      types: {
        t_struct_old: {
          encoding: "inplace",
          label: "struct Record",
          numberOfBytes: "32",
          members: [
            {
              astId: 2,
              contract: "C",
              label: "amount",
              slot: "0",
              offset: 0,
              type: "t_uint128",
            },
          ],
        },
        t_uint128: {
          encoding: "inplace",
          label: "uint128",
          numberOfBytes: "16",
        },
      },
    };
    value.compiled.storageLayout = {
      storage: [
        {
          astId: 1,
          contract: "C",
          label: "record",
          slot: "0",
          offset: 0,
          type: "t_struct_new",
        },
      ],
      types: {
        t_struct_new: {
          encoding: "inplace",
          label: "struct Record",
          numberOfBytes: "32",
          members: [
            {
              astId: 9,
              contract: "C",
              label: "amount",
              slot: "0",
              offset: 0,
              type: "t_uint256",
            },
          ],
        },
        t_uint256: {
          encoding: "inplace",
          label: "uint256",
          numberOfBytes: "32",
        },
      },
    };
    await expect(
      prepareUpgradeTransaction({ ...value, rpc: rpcFor() }),
    ).rejects.toThrow("storage layout is not append-compatible");
  });

  test("rejects odd-length, truncated and non-canonical RPC bytecode", async () => {
    for (const targetCode of ["0x600160005", "0X6002600055", "6002600055"]) {
      await expect(
        prepareUpgradeTransaction({ ...inputs(), rpc: rpcFor({ targetCode }) }),
      ).rejects.toThrow("RPC returned non-canonical runtime bytecode");
    }
  });

  test("rejects bytecode that differs before hashing", async () => {
    await expect(
      prepareUpgradeTransaction({
        ...inputs(),
        rpc: rpcFor({ targetCode: MALICIOUS_CODE }),
      }),
    ).rejects.toThrow(
      "runtime bytecode does not match the approved independent build",
    );
  });

  test("rejects an implementation with the wrong proxiableUUID", async () => {
    await expect(
      prepareUpgradeTransaction({
        ...inputs(),
        rpc: rpcFor({ uuid: `0x${"ff".repeat(32)}` }),
      }),
    ).rejects.toThrow("unexpected UUPS UUID");
  });

  test("accepts the approved implementation and emits only its zero-value upgrade call", async () => {
    const value = inputs();
    const transaction = await prepareUpgradeTransaction({
      ...value,
      rpc: rpcFor(),
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
      runtimeCodeSha256: value.compiled.runtimeCodeSha256,
      sourceCommit: value.approval.source.commit,
      snapshot: {
        blockNumber: "0x123",
        blockHash: `0x${"ab".repeat(32)}`,
        currentImplementation: CURRENT,
        currentRuntimeCodeSha256: sha256(GOOD_CODE),
      },
      preBroadcastRevalidation: {
        required: true,
        instruction:
          "Immediately before broadcast, rerun this preflight and require an identical snapshot and transaction payload.",
      },
    });
  });
});
