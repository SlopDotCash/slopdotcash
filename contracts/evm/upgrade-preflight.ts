import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeFunctionData, getAddress, parseAbi } from "viem";

export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type UpgradeKind = "vault" | "factory";
export interface StorageEntry {
  label: string;
  slot: string;
  offset: number;
  type: string;
}
export interface BuildProvenance {
  commit: string;
  evmTree: string;
  projectEscrowBlob: string;
  foundryTomlSha256: string;
}
export interface UpgradeApproval {
  schemaVersion: 1;
  kind: UpgradeKind;
  contract: "ProjectEscrow" | "EscrowFactory";
  implementation: string;
  runtimeCodeSha256: string;
  source: BuildProvenance;
  storageLayoutSha256: string;
  previousStorage: StorageEntry[];
}
export interface CompiledImplementation {
  kind: UpgradeKind;
  contract: "ProjectEscrow" | "EscrowFactory";
  implementation: string;
  runtimeCode: string;
  runtimeCodeSha256: string;
  source: BuildProvenance;
  storageLayoutSha256: string;
  storage: StorageEntry[];
}
type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

const sha256Code = (code: string) =>
  createHash("sha256")
    .update(Buffer.from(code.replace(/^0x/, ""), "hex"))
    .digest("hex");
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export async function prepareUpgradeTransaction({
  approval,
  compiled,
  proxy,
  rpc,
}: {
  approval: UpgradeApproval;
  compiled: CompiledImplementation;
  proxy: string;
  rpc: Rpc;
}) {
  assert.equal(approval.schemaVersion, 1, "unsupported approval schema");
  assert(
    approval.previousStorage.length > 0,
    "approval must include the reviewed previous storage layout",
  );
  assert(
    approval.kind === compiled.kind && approval.contract === compiled.contract,
    "approved contract kind does not match the independent build",
  );
  assert.equal(
    getAddress(approval.implementation),
    getAddress(compiled.implementation),
    "approved implementation address does not match the independent build",
  );
  assert(
    sameJson(approval.source, compiled.source),
    "independent build provenance does not match the approval",
  );
  assert.equal(
    compiled.runtimeCodeSha256,
    sha256Code(compiled.runtimeCode),
    "independent build runtime digest is internally inconsistent",
  );
  assert.equal(
    approval.runtimeCodeSha256,
    compiled.runtimeCodeSha256,
    "approved runtime bytecode does not match the independent build",
  );
  assert.equal(
    approval.storageLayoutSha256,
    compiled.storageLayoutSha256,
    "approved storage layout does not match the independent build",
  );
  assert(
    approval.previousStorage.every((entry, index) =>
      sameJson(entry, compiled.storage[index]),
    ),
    "storage layout is not append-compatible",
  );

  const implementation = getAddress(compiled.implementation);
  const onchainCode = String(
    await rpc("eth_getCode", [implementation, "latest"]),
  );
  assert(
    /^0x[0-9a-fA-F]+$/.test(onchainCode),
    "implementation has no runtime code",
  );
  assert.equal(
    sha256Code(onchainCode),
    compiled.runtimeCodeSha256,
    "runtime bytecode does not match the approved independent build",
  );
  const uuid = String(
    await rpc("eth_call", [
      { to: implementation, data: "0x52d1902d" },
      "latest",
    ]),
  );
  assert.equal(uuid.toLowerCase(), IMPLEMENTATION_SLOT, "unexpected UUPS UUID");

  return {
    to: getAddress(proxy),
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
  };
}
