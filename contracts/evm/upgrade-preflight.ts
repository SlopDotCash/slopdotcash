import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeFunctionData, getAddress, parseAbi } from "viem";

export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type UpgradeKind = "vault" | "factory";
export interface StorageEntry {
  astId?: number;
  contract?: string;
  label: string;
  slot: string;
  offset: number;
  type: string;
}
export interface StorageType {
  encoding: string;
  label: string;
  numberOfBytes: string;
  key?: string;
  value?: string;
  base?: string;
  members?: StorageEntry[];
}
export interface StorageLayout {
  storage: StorageEntry[];
  types: Record<string, StorageType>;
}
export interface BuildProvenance {
  commit: string;
  evmTree: string;
  projectEscrowBlob: string;
  foundryTomlSha256: string;
}
interface ApprovedBuild {
  implementation: string;
  runtimeCodeSha256: string;
  source: BuildProvenance;
  storageLayoutSha256: string;
}
export interface UpgradeApproval extends ApprovedBuild {
  schemaVersion: 2;
  kind: UpgradeKind;
  contract: "ProjectEscrow" | "EscrowFactory";
  previous: ApprovedBuild;
}
export interface CompiledImplementation extends ApprovedBuild {
  kind: UpgradeKind;
  contract: "ProjectEscrow" | "EscrowFactory";
  runtimeCode: string;
  storageLayout: StorageLayout;
}
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

interface RpcBlock {
  number: string;
  hash: string;
}

const canonicalBlock = (value: unknown): RpcBlock => {
  assert(value && typeof value === "object", "RPC canonical block is missing");
  const block = value as { number?: unknown; hash?: unknown };
  assert(
    typeof block.number === "string" &&
      /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(block.number),
    "RPC canonical block has an invalid number",
  );
  assert(
    typeof block.hash === "string" && /^0x[0-9a-f]{64}$/.test(block.hash),
    "RPC canonical block has an invalid hash",
  );
  return { number: block.number, hash: block.hash };
};

const canonicalCode = (value: unknown, emptyMessage: string) => {
  assert(
    typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value),
    emptyMessage,
  );
  return `0x${value.slice(2).toLowerCase()}`;
};
const sha256Code = (code: string) =>
  createHash("sha256")
    .update(Buffer.from(code.slice(2), "hex"))
    .digest("hex");
const sameSource = (left: BuildProvenance, right: BuildProvenance) =>
  left.commit === right.commit &&
  left.evmTree === right.evmTree &&
  left.projectEscrowBlob === right.projectEscrowBlob &&
  left.foundryTomlSha256 === right.foundryTomlSha256;
const sameBuild = (
  approval: ApprovedBuild,
  compiled: CompiledImplementation,
  prefix: string,
) => {
  assert.equal(
    getAddress(approval.implementation),
    getAddress(compiled.implementation),
    `${prefix} implementation address does not match the independent build`,
  );
  assert(
    sameSource(approval.source, compiled.source),
    `${prefix} build provenance does not match the approval`,
  );
  const runtime = canonicalCode(
    compiled.runtimeCode,
    `${prefix} independent build has non-canonical runtime bytecode`,
  );
  assert.equal(
    compiled.runtimeCodeSha256,
    sha256Code(runtime),
    `${prefix} independent build runtime digest is internally inconsistent`,
  );
  assert.equal(
    approval.runtimeCodeSha256,
    compiled.runtimeCodeSha256,
    `${prefix} approved runtime bytecode does not match the independent build`,
  );
  assert.equal(
    approval.storageLayoutSha256,
    compiled.storageLayoutSha256,
    `${prefix} approved storage layout does not match the independent build`,
  );
};

function compatibleType(
  oldId: string,
  nextId: string,
  oldTypes: Record<string, StorageType>,
  nextTypes: Record<string, StorageType>,
  seen = new Set<string>(),
): boolean {
  const pair = `${oldId}\0${nextId}`;
  if (seen.has(pair)) return true;
  seen.add(pair);
  const oldType = oldTypes[oldId];
  const nextType = nextTypes[nextId];
  if (!oldType || !nextType) return false;
  if (
    oldType.encoding !== nextType.encoding ||
    oldType.label !== nextType.label ||
    oldType.numberOfBytes !== nextType.numberOfBytes
  )
    return false;
  for (const relation of ["key", "value", "base"] as const) {
    if (Boolean(oldType[relation]) !== Boolean(nextType[relation]))
      return false;
    if (
      oldType[relation] &&
      !compatibleType(
        oldType[relation],
        nextType[relation] as string,
        oldTypes,
        nextTypes,
        seen,
      )
    )
      return false;
  }
  if (Boolean(oldType.members) !== Boolean(nextType.members)) return false;
  if (oldType.members) {
    if (oldType.members.length !== nextType.members?.length) return false;
    for (let index = 0; index < oldType.members.length; index++) {
      const oldMember = oldType.members[index];
      const nextMember = nextType.members[index];
      if (
        !nextMember ||
        oldMember.label !== nextMember.label ||
        oldMember.slot !== nextMember.slot ||
        oldMember.offset !== nextMember.offset ||
        !compatibleType(
          oldMember.type,
          nextMember.type,
          oldTypes,
          nextTypes,
          seen,
        )
      )
        return false;
    }
  }
  return true;
}

const appendCompatible = (
  oldLayout: StorageLayout,
  nextLayout: StorageLayout,
) =>
  oldLayout.storage.length <= nextLayout.storage.length &&
  oldLayout.storage.every((oldEntry, index) => {
    const nextEntry = nextLayout.storage[index];
    return (
      Boolean(nextEntry) &&
      oldEntry.label === nextEntry.label &&
      oldEntry.slot === nextEntry.slot &&
      oldEntry.offset === nextEntry.offset &&
      compatibleType(
        oldEntry.type,
        nextEntry.type,
        oldLayout.types,
        nextLayout.types,
      )
    );
  });

export async function prepareUpgradeTransaction({
  approval,
  compiled,
  previousCompiled,
  proxy,
  rpc,
}: {
  approval: UpgradeApproval;
  compiled: CompiledImplementation;
  previousCompiled: CompiledImplementation;
  proxy: string;
  rpc: Rpc;
}) {
  assert.equal(approval.schemaVersion, 2, "unsupported approval schema");
  assert(
    approval.kind === compiled.kind && approval.contract === compiled.contract,
    "approved contract kind does not match the independent build",
  );
  assert(
    approval.kind === previousCompiled.kind &&
      approval.contract === previousCompiled.contract,
    "target proxy contract kind does not match the approval",
  );
  sameBuild(approval, compiled, "target");
  sameBuild(approval.previous, previousCompiled, "prior");
  assert(
    appendCompatible(previousCompiled.storageLayout, compiled.storageLayout),
    "storage layout is not append-compatible",
  );

  const normalizedProxy = getAddress(proxy);
  const block = canonicalBlock(
    await rpc("eth_getBlockByNumber", ["latest", false]),
  );
  const blockTag = { blockHash: block.hash, requireCanonical: true } as const;
  const implementationWord = String(
    await rpc("eth_getStorageAt", [
      normalizedProxy,
      IMPLEMENTATION_SLOT,
      blockTag,
    ]),
  );
  assert(
    /^0x0{24}[0-9a-fA-F]{40}$/.test(implementationWord),
    "target proxy has an invalid ERC-1967 implementation slot",
  );
  const currentImplementation = getAddress(
    `0x${implementationWord.slice(-40)}`,
  );
  assert.equal(
    currentImplementation,
    getAddress(previousCompiled.implementation),
    "target proxy does not select the approved prior implementation",
  );
  const currentCode = canonicalCode(
    await rpc("eth_getCode", [currentImplementation, blockTag]),
    "RPC returned non-canonical current implementation bytecode",
  );
  assert.equal(
    currentCode,
    canonicalCode(
      previousCompiled.runtimeCode,
      "prior independent build has non-canonical runtime bytecode",
    ),
    "target proxy implementation bytecode does not match the independent prior build",
  );

  const implementation = getAddress(compiled.implementation);
  const onchainCode = canonicalCode(
    await rpc("eth_getCode", [implementation, blockTag]),
    "RPC returned non-canonical runtime bytecode",
  );
  assert.equal(
    onchainCode,
    canonicalCode(
      compiled.runtimeCode,
      "target independent build has non-canonical runtime bytecode",
    ),
    "runtime bytecode does not match the approved independent build",
  );
  assert.equal(
    sha256Code(onchainCode),
    compiled.runtimeCodeSha256,
    "runtime bytecode digest does not match the approved independent build",
  );
  const uuid = String(
    await rpc("eth_call", [
      { to: implementation, data: "0x52d1902d" },
      blockTag,
    ]),
  );
  assert.equal(uuid.toLowerCase(), IMPLEMENTATION_SLOT, "unexpected UUPS UUID");
  const confirmedBlock = canonicalBlock(
    await rpc("eth_getBlockByNumber", [block.number, false]),
  );
  assert(
    confirmedBlock.number === block.number &&
      confirmedBlock.hash === block.hash,
    "RPC canonical block changed during preflight",
  );

  return {
    to: normalizedProxy,
    value: "0x0" as const,
    data: encodeFunctionData({
      abi: parseAbi(["function upgradeToAndCall(address,bytes)"]),
      functionName: "upgradeToAndCall",
      args: [implementation, "0x"],
    }),
    implementation,
    kind: compiled.kind,
    runtimeCodeSha256: compiled.runtimeCodeSha256,
    sourceCommit: compiled.source.commit,
    snapshot: {
      blockNumber: block.number,
      blockHash: block.hash,
      currentImplementation,
      currentRuntimeCodeSha256: sha256Code(currentCode),
    },
    preBroadcastRevalidation: {
      required: true as const,
      instruction:
        "Immediately before broadcast, rerun this preflight and require an identical snapshot and transaction payload.",
    },
  };
}
