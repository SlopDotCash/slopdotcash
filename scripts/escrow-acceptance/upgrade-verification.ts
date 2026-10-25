/** Read-only upgrade preservation and later-payment reconciliation. Never signs or changes a plan. */
import assert from "node:assert/strict";
import { encodeFunctionData, type Hex, parseAbi } from "viem";
import { verifyEvmDeployment } from "../../contracts/evm/adapter";
import {
  assertFactoryDeploymentBlock,
  IMPLEMENTATION_SLOT,
  INITIALIZABLE_SLOT,
  createdVaults as readCreatedVaults,
  sha256Hex,
  type VaultStorage,
  vaultStorage,
} from "../../contracts/evm/integration/upgrade";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { type EvmChain, FACTORY, VAULT } from "./evm";
import type { StepRecord } from "./shared";
import {
  reconcileUpgradePayments,
  upgradeVaultConfig,
} from "./upgrade-payments";
export const UPGRADE_SCHEMA = "slop-escrow-upgrade-qualification:v1";
const hex = (value: bigint) => `0x${value.toString(16)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const PROXY = parseAbi([
  "function upgradeToAndCall(address,bytes)",
  "function initialize(address,address,address,uint64,address,address)",
]);
const upgradeData = (implementation: string) =>
  encodeFunctionData({
    abi: PROXY,
    functionName: "upgradeToAndCall",
    args: [implementation as Hex, "0x"],
  });
export interface VaultRecord extends VaultStorage {
  vault: string;
  observedAtBlock: string;
  implementation: string;
  codeSha256: string;
}
export interface PlannedTransaction {
  key: string;
  to: string;
  data: string;
  signer: "upgrade-authority";
  purpose: string;
}
export interface Qualification {
  schema: typeof UPGRADE_SCHEMA;
  network: string;
  mode: "public-testnet" | "local";
  rpcHost: string;
  chainId: string;
  sourceCommit: string;
  factory: string;
  plannedAt: string;
  plannedAtBlock: string;
  factoryDeploymentBlock: string;
  notice: string;
  roles: Record<string, string>;
  before: {
    factoryCodeSha256: string;
    factoryImplementation: string;
    factoryImplementationCodeSha256: string;
    vaultImplementation: string;
    vaultImplementationCodeSha256: string;
    factorySlots: string[];
    factoryInitialized: string;
    vaults: VaultRecord[];
  };
  review: {
    salt: string;
    create2Deployer: string;
    vaultImplementation: string;
    vaultImplementationCodeSha256: string;
    factoryImplementation: string;
    factoryImplementationCodeSha256: string;
  };
  transactions: PlannedTransaction[];
  steps: Record<string, StepRecord>;
  stragglers: string[];
  verification: Record<string, unknown> | null;
  status:
    | "planned"
    | "executing"
    | "waiting"
    | "executed"
    | "passed"
    | "failed";
  /** One entry per command run: a refused or failed attempt stays on record. */
  history: { command: string; at: string; status: string; error?: string }[];
}

export function upgradeReader(chain: EvmChain, factory: string, page: bigint) {
  const rpc = (method: string, params: unknown[]) => chain.rpc(method, params);
  const word = async (address: string, slot: string | bigint, block: string) =>
    String(
      await rpc("eth_getStorageAt", [
        address,
        typeof slot === "bigint" ? hex(slot) : slot,
        block,
      ]),
    ).toLowerCase();
  const implementationOf = async (proxy: string, block: string) =>
    `0x${(await word(proxy, IMPLEMENTATION_SLOT, block)).slice(-40)}`;
  const codeSha256 = async (address: string, block: string) =>
    sha256Hex(String(await rpc("eth_getCode", [address, block])));
  const address = async (fn: string, block: string) =>
    (await chain.read<string>(factory, FACTORY, fn, [], block)).toLowerCase();
  async function vaultRecord(
    vault: string,
    block: string,
    fromBlock: bigint,
    previous?: VaultRecord,
  ): Promise<VaultRecord> {
    const implementation = await implementationOf(vault, block);
    return {
      vault,
      observedAtBlock: BigInt(block).toString(),
      implementation,
      codeSha256: await codeSha256(vault, block),
      ...(await vaultStorage(
        rpc,
        vault,
        BigInt(block),
        fromBlock,
        page,
        previous,
      )),
    };
  }
  async function factorySlots(block: string) {
    const slots: string[] = [];
    for (let slot = 0n; slot <= 6n; slot++)
      slots.push(await word(factory, slot, block));
    return slots;
  }
  /** VaultCreated logs in the network's reviewed page size. A provider error stops the command. */
  async function createdVaults(from: bigint, to: bigint) {
    return readCreatedVaults(rpc, factory, from, to, page);
  }

  return {
    word,
    implementationOf,
    codeSha256,
    address,
    vaultRecord,
    factorySlots,
    createdVaults,
  };
}

export async function verifyUpgrade(run: Qualification, chain: EvmChain) {
  const factory = run.factory;
  const page = BigInt(
    (
      ESCROW_NETWORKS[run.network as keyof typeof ESCROW_NETWORKS] as {
        scanPageBlocks?: string;
      }
    ).scanPageBlocks ?? "2000",
  );
  const rpc = (method: string, params: unknown[]) => chain.rpc(method, params);
  const {
    word,
    implementationOf,
    codeSha256,
    address,
    vaultRecord,
    factorySlots,
    createdVaults,
  } = upgradeReader(chain, factory, page);
  const final = await chain.finalizeSteps(run.steps);
  const currentBlock = hex(BigInt(final.block));
  const completed = Object.values(run.steps).map((step) => {
    if (step.status !== "success" || !step.block)
      throw new Error("Upgrade step has no successful finalized receipt");
    return BigInt(step.block);
  });
  if (!completed.length)
    throw new Error("Upgrade preservation boundary is unavailable");
  const preservation = completed.reduce((a, b) => (a > b ? a : b));
  const block = hex(preservation);
  const boundary = (await rpc("eth_getBlockByNumber", [block, false])) as {
    hash: string;
  };
  const current = (await rpc("eth_getBlockByNumber", [
    currentBlock,
    false,
  ])) as { hash: string };
  const mustRevert = (from: string, to: string, data: string) =>
    chain.mustRevert(from, to, data, currentBlock);
  const mismatches: string[] = [];
  const expect = (what: string, actual: unknown, wanted: unknown) => {
    if (String(actual).toLowerCase() !== String(wanted).toLowerCase())
      mismatches.push(`${what}: ${actual}, expected ${wanted}`);
  };
  expect(
    "factory implementation",
    await implementationOf(factory, block),
    run.review.factoryImplementation,
  );
  expect(
    "vault template",
    await address("vaultImplementation", block),
    run.review.vaultImplementation,
  );
  expect(
    "factory implementation code",
    await codeSha256(run.review.factoryImplementation, block),
    run.review.factoryImplementationCodeSha256,
  );
  expect(
    "vault implementation code",
    await codeSha256(run.review.vaultImplementation, block),
    run.review.vaultImplementationCodeSha256,
  );
  expect(
    "factory proxy code",
    await codeSha256(factory, block),
    run.before.factoryCodeSha256,
  );
  // Roles and storage are unchanged; only the template slot (2) moves.
  const slots = await factorySlots(block);
  for (const [index, value] of slots.entries())
    if (index !== 2)
      expect(`factory slot ${index}`, value, run.before.factorySlots[index]);
  expect(
    "factory initializer version",
    await word(factory, INITIALIZABLE_SLOT, block),
    run.before.factoryInitialized,
  );
  for (const [role, fn] of [
    ["upgradeAuthority", "upgradeAuthority"],
    ["registrar", "registrar"],
    ["identityAuthority", "identityAuthority"],
    ["feeRecipient", "feeRecipient"],
  ] as const)
    expect(role, await address(fn, block), run.roles[role]);
  const vaults: Record<string, unknown>[] = [];
  const preserved: VaultRecord[] = [];
  await assertFactoryDeploymentBlock(
    rpc,
    factory,
    BigInt(run.factoryDeploymentBlock),
    BigInt(block),
  );
  const inventory = await createdVaults(
    BigInt(run.factoryDeploymentBlock),
    BigInt(block),
  );
  for (const prior of run.before.vaults)
    if (!inventory.includes(prior.vault))
      mismatches.push(
        `vault ${prior.vault} is missing from finalized creation history`,
      );
  for (const target of inventory) {
    const before = run.before.vaults.find((record) =>
      same(record.vault, target),
    );
    const after = await vaultRecord(
      target,
      block,
      BigInt(run.factoryDeploymentBlock),
      before,
    );
    expect(
      `vault ${target} implementation`,
      after.implementation,
      run.review.vaultImplementation,
    );
    expect(
      `vault ${target} reserve version`,
      await chain.read<number>(
        target,
        VAULT,
        "monthlyReserveVersion",
        [],
        block,
      ),
      2,
    );
    if (before) {
      expect(`vault ${target} proxy code`, after.codeSha256, before.codeSha256);
      expect(
        `vault ${target} initializer version`,
        after.initialized,
        before.initialized,
      );
      for (const [index, value] of after.slots.entries())
        expect(`vault ${target} slot ${index}`, value, before.slots[index]);
      for (const [slot, value] of Object.entries(after.mappings))
        expect(`vault ${target} mapping ${slot}`, value, before.mappings[slot]);
    }
    vaults.push({
      vault: target,
      implementation: after.implementation,
      straggler: run.stragglers.includes(target),
    });
    preserved.push(after);
  }
  // Preservation belongs to Q. Current state belongs to F; only proved later payments
  // may explain differences, so the existing unexplained-storage checks remain strict.
  if (mismatches.length)
    throw new Error(`Upgrade verification failed: ${mismatches.join("; ")}`);
  const { expected, payments: laterPayments } = await reconcileUpgradePayments(
    run,
    chain,
    preserved,
    preservation,
    BigInt(final.block),
    page,
  );
  expect(
    "current factory implementation",
    await implementationOf(factory, currentBlock),
    run.review.factoryImplementation,
  );
  expect(
    "current factory proxy code",
    await codeSha256(factory, currentBlock),
    run.before.factoryCodeSha256,
  );
  expect(
    "current factory implementation code",
    await codeSha256(run.review.factoryImplementation, currentBlock),
    run.review.factoryImplementationCodeSha256,
  );
  expect(
    "current vault implementation code",
    await codeSha256(run.review.vaultImplementation, currentBlock),
    run.review.vaultImplementationCodeSha256,
  );
  for (const [index, value] of (await factorySlots(currentBlock)).entries())
    expect(`current factory slot ${index}`, value, slots[index]);
  expect(
    "current factory initializer version",
    await word(factory, INITIALIZABLE_SLOT, currentBlock),
    run.before.factoryInitialized,
  );
  const currentInventory = await createdVaults(
    BigInt(run.factoryDeploymentBlock),
    BigInt(final.block),
  );
  for (const target of inventory)
    if (!currentInventory.includes(target))
      mismatches.push(
        `vault ${target} is missing from current finalized creation history`,
      );
  for (const target of currentInventory) {
    const baseline = preserved.find((record) => record.vault === target);
    const after = await vaultRecord(
      target,
      currentBlock,
      BigInt(run.factoryDeploymentBlock),
      baseline,
    );
    await verifyEvmDeployment(
      upgradeVaultConfig(run, chain, baseline ?? after),
      currentBlock,
    );
    expect(
      `current vault ${target} reserve version`,
      await chain.read<number>(
        target,
        VAULT,
        "monthlyReserveVersion",
        [],
        currentBlock,
      ),
      2,
    );
    if (baseline) {
      const wanted = expected.get(target);
      assert(wanted, "Missing preserved vault state");
      expect(
        `vault ${target} current initializer version`,
        after.initialized,
        baseline.initialized,
      );
      for (const [index, value] of after.slots.entries())
        expect(
          `vault ${target} slot ${index} at current finalized block`,
          value,
          wanted.slots[index],
        );
      for (const [slot, value] of Object.entries(after.mappings))
        expect(
          `vault ${target} mapping ${slot} at current finalized block`,
          value,
          wanted.mappings[slot],
        );
    }
  }
  // Only the authority can upgrade, and no initializer can run again.
  const outsider = "0x000000000000000000000000000000000000dEaD";
  const refusals = {
    factoryUpgradeByOther: await mustRevert(
      outsider,
      factory,
      upgradeData(run.review.factoryImplementation),
    ),
    vaultUpgradeByOther: run.before.vaults[0]
      ? await mustRevert(
          outsider,
          run.before.vaults[0].vault,
          upgradeData(run.review.vaultImplementation),
        )
      : "no vault",
    factoryInitializeAgain: await mustRevert(
      outsider,
      factory,
      encodeFunctionData({
        abi: PROXY,
        functionName: "initialize",
        args: [
          outsider,
          outsider,
          outsider,
          0n,
          outsider,
          run.review.vaultImplementation as Hex,
        ],
      }),
    ),
  };
  // DEPLOY-MAINNET.md section 4.7: the last proxy upgrade that left the old review.
  const upgradeBlocks = Object.entries(run.steps)
    .filter(([key]) => key.startsWith("upgrade-"))
    .map(([, step]) => BigInt(step.block ?? "0"));
  const verification = {
    ...(run.verification ?? {}),
    finalizedBlock: final.block,
    finalizedBlockHash: current.hash,
    preservationBlock: preservation.toString(),
    preservationBlockHash: boundary.hash,
    laterPayments,
    currentVaults: currentInventory,
    transactions: final.transactions,
    vaults,
    refusals,
    supersededAtBlock: upgradeBlocks.length
      ? upgradeBlocks.reduce((a, b) => (a > b ? a : b)).toString()
      : null,
    mismatches,
  };
  if (mismatches.length)
    throw new Error(`Upgrade verification failed: ${mismatches.join("; ")}`);
  return verification;
}
