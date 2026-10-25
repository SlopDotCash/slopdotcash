import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  toBytes,
  toEventSelector,
  toHex,
} from "viem";
import { type EvmUpgrade, evmVaultKey } from "../adapter";

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

type UpgradeRpc = (method: string, params: unknown[]) => Promise<unknown>;
const historyAbi = parseAbi([
  "event AwardCommitted(bytes32 indexed id,uint64 indexed actorId,uint128 gross,uint128 fee,bytes32 sourceDigest)",
  "event DestinationBound(uint64 indexed actorId,address indexed destination,uint64 version,bytes32 claimDigest,uint64 activatesAt)",
  "event BindingCancelled(uint64 indexed actorId,uint64 version)",
  "event Paid(bytes32 indexed id,uint64 indexed actorId,address indexed destination,uint64 version,uint128 gross,uint128 net,uint128 fee)",
  "event MonthlyCommitted(uint32 indexed period,bytes32 allocationRoot,uint128 gross,uint256 awards)",
  "event MonthlyReserved(uint32 indexed period,bytes32 allocationDigest,bytes32 allocationRoot,uint128 wholeGross,uint128 remainingGross,uint32 count,uint256 sourceSequence)",
]);
const historyTopics = historyAbi.map(toEventSelector);

/** Prove the supplied first block, rather than accepting a truncated factory inventory. */
export async function assertFactoryDeploymentBlock(
  rpc: UpgradeRpc,
  factory: string,
  first: bigint,
  through: bigint,
) {
  assert(
    first >= 0n && first <= through,
    "Factory deployment block is outside finalized history",
  );
  const code = await rpc("eth_getCode", [factory, toHex(first)]);
  assert(
    typeof code === "string" && /^0x[0-9a-fA-F]+$/.test(code),
    "Factory has no code at the deployment block",
  );
  if (first > 0n)
    assert.equal(
      await rpc("eth_getCode", [factory, toHex(first - 1n)]),
      "0x",
      "Factory existed before the supplied deployment block",
    );
}

async function historyLogs(
  rpc: UpgradeRpc,
  address: string,
  topics: unknown[],
  from: bigint,
  through: bigint,
  page: bigint,
) {
  assert(page > 0n && from >= 0n && from <= through, "Invalid history range");
  const result: {
    address: string;
    topics: [`0x${string}`, ...`0x${string}`[]];
    data: `0x${string}`;
  }[] = [];
  for (let start = from; start <= through; start += page) {
    const end = start + page - 1n < through ? start + page - 1n : through;
    const logs = await rpc("eth_getLogs", [
      { address, topics, fromBlock: toHex(start), toBlock: toHex(end) },
    ]);
    assert(Array.isArray(logs), "Provider did not return log history");
    for (const log of logs) {
      assert(
        log &&
          log.address?.toLowerCase() === address.toLowerCase() &&
          !log.removed &&
          Array.isArray(log.topics),
        "Invalid history log",
      );
      assert(
        BigInt(log.blockNumber) >= start && BigInt(log.blockNumber) <= end,
        "History log is outside the requested page",
      );
      result.push(log);
    }
  }
  return result;
}

export async function createdVaults(
  rpc: UpgradeRpc,
  factory: string,
  from: bigint,
  through: bigint,
  page: bigint,
) {
  if (from > through) return [];
  const logs = await historyLogs(
    rpc,
    factory,
    [VAULT_CREATED_TOPIC],
    from,
    through,
    page,
  );
  const vaults: string[] = [];
  for (const log of logs) {
    assert(
      log.topics.length === 4 && /^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[3]),
      "Invalid VaultCreated event",
    );
    const event = decodeEventLog({
      abi: parseAbi([
        "event VaultCreated(bytes32 indexed projectId,address indexed owner,address indexed vault,address token,uint8 decimals,uint8 purpose)",
      ]),
      topics: log.topics,
      data: log.data,
    });
    assert(
      event.args.purpose === 0 || event.args.purpose === 1,
      "Invalid vault purpose",
    );
    const key = evmVaultKey({
      owner: event.args.owner,
      projectId: event.args.projectId,
      asset: event.args.token,
      ...(event.args.purpose === 1
        ? { payoutPolicy: "security-bounty" as const }
        : {}),
    });
    const mapped = await rpc("eth_call", [
      {
        to: factory,
        data: encodeFunctionData({
          abi: parseAbi(["function vaults(bytes32) view returns(address)"]),
          functionName: "vaults",
          args: [key as `0x${string}`],
        }),
      },
      toHex(through),
    ]);
    assert.equal(
      String(mapped).toLowerCase(),
      `0x${event.args.vault.slice(2).padStart(64, "0")}`.toLowerCase(),
      "Factory vault mapping differs from creation history",
    );
    vaults.push(event.args.vault.toLowerCase());
  }
  return vaults;
}

export interface VaultStorage {
  slots: string[];
  initialized: string;
  /** Exact storage words for every history-derived award, source, actor and month. */
  mappings: Record<string, string>;
}

/** Current append-only layout, including V2 slots and the mapping values that root slots omit. */
export async function vaultStorage(
  rpc: UpgradeRpc,
  vault: string,
  block: bigint,
  from: bigint,
  page: bigint,
  previous?: VaultStorage,
): Promise<VaultStorage> {
  const word = async (slot: string | bigint) => {
    const value = await rpc("eth_getStorageAt", [
      vault,
      typeof slot === "bigint" ? toHex(slot) : slot,
      toHex(block),
    ]);
    assert(
      typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
      "Provider did not return an exact storage word",
    );
    return value.toLowerCase();
  };
  const slots: string[] = [];
  for (let slot = 0n; slot <= 20n; slot++) slots.push(await word(slot));
  const keys = new Set<string>(Object.keys(previous?.mappings ?? {}));
  const mapping = (key: string | bigint, slot: bigint, length = 1n) => {
    const start = BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          [BigInt(key), slot],
        ),
      ),
    );
    for (let offset = 0n; offset < length; offset++)
      keys.add(toHex(start + offset, { size: 32 }));
  };
  if (!previous) {
    const logs = await historyLogs(
      rpc,
      vault,
      [historyTopics],
      from,
      block,
      page,
    );
    for (const log of logs) {
      const event = decodeEventLog({
        abi: historyAbi,
        topics: log.topics,
        data: log.data,
      });
      if (event.eventName === "AwardCommitted") {
        mapping(event.args.id, 11n, 4n);
        mapping(event.args.sourceDigest, 12n);
      }
      if ("actorId" in event.args) {
        mapping(event.args.actorId, 13n, 3n);
        for (const slot of [14n, 15n, 16n]) mapping(event.args.actorId, slot);
      }
      if ("period" in event.args) {
        mapping(BigInt(event.args.period), 17n);
        mapping(BigInt(event.args.period), 20n, 3n);
      }
    }
  }
  const mappings: Record<string, string> = {};
  for (const key of [...keys].sort()) mappings[key] = await word(key);
  return { slots, initialized: await word(INITIALIZABLE_SLOT), mappings };
}

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
