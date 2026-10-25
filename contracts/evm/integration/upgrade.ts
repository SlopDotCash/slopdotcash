import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  toBytes,
} from "viem";
import type { EvmUpgrade } from "../adapter";

/** The deterministic deployment proxy (Arachnid) used by DeployUpgradeImplementations.s.sol. */
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const IMPLEMENTATION_SALT = keccak256(
  toBytes("slop.escrow.implementation"),
);
/** ERC-1967 implementation slot. */
export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** OpenZeppelin v5 Initializable storage (ERC-7201 namespace "openzeppelin.storage.Initializable"). */
export const INITIALIZABLE_SLOT =
  "0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00";
export const VAULT_CREATED_TOPIC = keccak256(
  toBytes("VaultCreated(bytes32,address,address,address,uint8,uint8)"),
);
export const sha256Hex = (hex: string) =>
  createHash("sha256")
    .update(Buffer.from(hex.replace(/^0x/, ""), "hex"))
    .digest("hex");

/**
 * The CREATE2 address, creation code and reviewed digest of an implementation from the
 * compiled artifact in `<evmRoot>/out`: its runtime code with the UUPS self-reference
 * immutable set to its own address. The address is the same on every chain.
 */
export function expectedImplementation(evmRoot: string, contract: string) {
  const artifact = JSON.parse(
    readFileSync(`${evmRoot}/out/ProjectEscrow.sol/${contract}.json`, "utf8"),
  ) as {
    bytecode: { object: string };
    deployedBytecode: {
      object: string;
      immutableReferences?: Record<string, { start: number; length: number }[]>;
    };
  };
  const creationCode = artifact.bytecode.object as `0x${string}`;
  const predicted = getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_DEPLOYER,
    salt: IMPLEMENTATION_SALT,
    bytecode: creationCode,
  });
  const code = Buffer.from(
    artifact.deployedBytecode.object.replace(/^0x/, ""),
    "hex",
  );
  const self = Buffer.from(
    predicted.slice(2).toLowerCase().padStart(64, "0"),
    "hex",
  );
  for (const references of Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  ))
    for (const { start, length } of references) {
      assert.equal(length, 32);
      self.copy(code, start);
    }
  return {
    predicted,
    creationCode,
    digest: sha256Hex(code.toString("hex")),
  };
}

/** Local-chain fixture: use the same atomic proxy initialization as deployment scripts. */
export function deployUpgradeableFactory(
  deploy: (contract: string, args?: string[]) => string,
  args: string[],
): string {
  const vault = deploy("src/ProjectEscrow.sol:ProjectEscrow");
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory");
  const data = encodeFunctionData({
    abi: parseAbi([
      "function initialize(address,address,address,uint64,address,address)",
    ]),
    functionName: "initialize",
    args: [args[0], args[1], args[2], BigInt(args[3]), args[0], vault] as [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      bigint,
      `0x${string}`,
      `0x${string}`,
    ],
  });
  return deploy(
    "vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    [factory, data],
  );
}

/** Capture observed addresses for local fixture assertions; this does not approve an implementation. */
export async function captureUpgrade(
  rpc: (method: string, params: unknown[]) => Promise<unknown>,
  factory: string,
  vault: string,
): Promise<EvmUpgrade> {
  const slot =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const read = async (address: string) => {
    const storage = String(
      await rpc("eth_getStorageAt", [address, slot, "latest"]),
    );
    const implementation = `0x${storage.slice(-40)}`;
    const code = String(await rpc("eth_getCode", [implementation, "latest"]));
    return {
      implementation,
      digest: createHash("sha256")
        .update(Buffer.from(code.slice(2), "hex"))
        .digest("hex"),
    };
  };
  const f = await read(factory);
  const v = await read(vault);
  const authority = String(
    await rpc("eth_call", [
      {
        to: factory,
        data: encodeFunctionData({
          abi: parseAbi(["function upgradeAuthority() view returns (address)"]),
          functionName: "upgradeAuthority",
        }),
      },
      "latest",
    ]),
  );
  return {
    authority: `0x${authority.slice(-40)}`,
    vaultImplementation: v.implementation,
    vaultImplementationCodeSha256: v.digest,
    factoryImplementation: f.implementation,
    factoryImplementationCodeSha256: f.digest,
  };
}
