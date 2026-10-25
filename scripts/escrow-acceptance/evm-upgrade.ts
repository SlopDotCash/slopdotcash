/**
 * Test-network qualification of the EVM factory upgrade to monthly reserve V2
 * (contracts/DEPLOY-MAINNET.md section 4). It applies the checks of
 * contracts/evm/integration/mainnet-upgrade-rehearsal.ts to a real test
 * network factory instead of a mainnet fork:
 *
 *   bun scripts/escrow-acceptance/evm-upgrade.ts plan    <network> <directory>
 *   bun scripts/escrow-acceptance/evm-upgrade.ts execute <network> <directory>
 *   bun scripts/escrow-acceptance/evm-upgrade.ts verify  <network> <directory>
 *
 * `plan` and `verify` read finalized chain state only and use no key. `plan`
 * records the factory roles, both current implementations, every vault from
 * the factory's VaultCreated logs with its storage, the reviewed CREATE2
 * implementations from the compiled source, and the ordered unsigned
 * transactions. `execute` signs those transactions with the upgrade authority
 * key from ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY, which must be the
 * authority the factory reports. It saves each signed transaction before
 * broadcast, so a rerun never signs a step twice. `verify` checks the
 * upgraded proxies against the plan.
 *
 * Mainnet chain ids are refused before any read of a key. Exit code 75 means
 * a transaction waits for finality; run the same command again.
 */
import { renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodeFunctionData, type Hex, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CREATE2_DEPLOYER,
  expectedImplementation,
  IMPLEMENTATION_SALT,
  IMPLEMENTATION_SLOT,
  INITIALIZABLE_SLOT,
  sha256Hex,
  VAULT_CREATED_TOPIC,
} from "../../contracts/evm/integration/upgrade";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { EvmChain, FACTORY, VAULT } from "./evm";
import {
  assertEvmTestChain,
  evmKey,
  isAcceptanceNetwork,
  isLoopbackRpc,
  jsonRpc,
  RpcError,
  requireEnv,
  rpcHost,
  type StepRecord,
  sourceCommit,
  WAITING_EXIT_CODE,
  Waiting,
} from "./shared";

const SCHEMA = "slop-escrow-upgrade-qualification:v1";
const evmRoot = resolve(import.meta.dir, "..", "..", "contracts", "evm");
const PROXY = parseAbi([
  "function upgradeToAndCall(address,bytes)",
  "function setVaultImplementation(address)",
  "function initialize(address,address,address,uint64,address,address)",
  "function initialize(bytes32,address,address,uint8,address,uint64)",
]);

interface VaultRecord {
  vault: string;
  implementation: string;
  codeSha256: string;
  slots: string[];
  initialized: string;
}
interface PlannedTransaction {
  key: string;
  to: string;
  data: string;
  signer: "upgrade-authority";
  purpose: string;
}
interface Qualification {
  schema: typeof SCHEMA;
  network: string;
  mode: "public-testnet" | "local";
  rpcHost: string;
  chainId: string;
  sourceCommit: string;
  factory: string;
  plannedAt: string;
  plannedAtBlock: string;
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
  errors: string[];
}

const [command, network, directory] = process.argv.slice(2);
if (
  !["plan", "execute", "verify"].includes(command ?? "") ||
  !network ||
  !directory ||
  !isAcceptanceNetwork(network) ||
  network.startsWith("solana-")
) {
  console.error(
    "Usage: bun scripts/escrow-acceptance/evm-upgrade.ts <plan|execute|verify> <base-sepolia|ethereum-sepolia|robinhood-testnet> <directory>",
  );
  process.exit(2);
}
const out = resolve(directory);
const file = join(out, "upgrade.json");
const rpcUrl = requireEnv("ESCROW_ACCEPTANCE_RPC_URL");
const factory = requireEnv("ESCROW_ACCEPTANCE_FACTORY").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(factory))
  throw new Error("ESCROW_ACCEPTANCE_FACTORY must be an EVM address");
// Chain identity first: a mainnet chain id stops the command here.
const chainId = assertEvmTestChain(
  network,
  BigInt((await jsonRpc(rpcUrl, "eth_chainId", [])) as string),
);
const policy = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS] as {
  scanPageBlocks?: string;
};
let state: Qualification | null = null;
const persist = async () => {
  if (!state) return;
  await mkdir(out, { recursive: true });
  await Bun.write(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
};
const chain = new EvmChain(rpcUrl, Number(chainId), persist);
const rpc = (method: string, params: unknown[]) => chain.rpc(method, params);
const hex = (value: bigint) => `0x${value.toString(16)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
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
/** Every declared vault storage slot (0 to 18) and the initializer version, as the rehearsal reads them. */
async function vaultRecord(vault: string, block: string): Promise<VaultRecord> {
  const slots: string[] = [];
  for (let slot = 0n; slot <= 18n; slot++)
    slots.push(await word(vault, slot, block));
  const implementation = await implementationOf(vault, block);
  return {
    vault,
    implementation,
    codeSha256: await codeSha256(vault, block),
    slots,
    initialized: await word(vault, INITIALIZABLE_SLOT, block),
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
  const page = BigInt(policy.scanPageBlocks ?? "2000");
  const vaults: string[] = [];
  for (let start = from; start <= to; start += page) {
    const end = start + page - 1n < to ? start + page - 1n : to;
    const logs = (await rpc("eth_getLogs", [
      {
        address: factory,
        topics: [VAULT_CREATED_TOPIC],
        fromBlock: hex(start),
        toBlock: hex(end),
      },
    ])) as { topics: string[] }[];
    for (const log of logs) vaults.push(`0x${log.topics[3].slice(-40)}`);
  }
  return vaults;
}
async function finalizedBlock() {
  return hex(await chain.finalizedNumber());
}
const upgradeData = (implementation: string, data: Hex = "0x") =>
  encodeFunctionData({
    abi: PROXY,
    functionName: "upgradeToAndCall",
    args: [implementation as Hex, data],
  });

async function plan(): Promise<Qualification> {
  const fromBlock = BigInt(
    requireEnv("ESCROW_ACCEPTANCE_FACTORY_DEPLOYMENT_BLOCK"),
  );
  const block = await finalizedBlock();
  const roles = {
    upgradeAuthority: await address("upgradeAuthority", block),
    registrar: await address("registrar", block),
    identityAuthority: await address("identityAuthority", block),
    pendingIdentityAuthority: await address("pendingIdentityAuthority", block),
    feeRecipient: await address("feeRecipient", block),
    bindingDelay: String(
      await chain.read<bigint>(factory, FACTORY, "bindingDelay", [], block),
    ),
  };
  const factoryImplementation = await implementationOf(factory, block);
  const vaultImplementation = await address("vaultImplementation", block);
  const vault = expectedImplementation(evmRoot, "ProjectEscrow");
  const factoryLogic = expectedImplementation(evmRoot, "EscrowFactory");
  if (
    same(vault.predicted, vaultImplementation) &&
    same(factoryLogic.predicted, factoryImplementation)
  )
    throw new Error("The factory already runs the reviewed implementations");
  if ((await rpc("eth_getCode", [CREATE2_DEPLOYER, block])) === "0x")
    throw new Error(`The CREATE2 deployer ${CREATE2_DEPLOYER} is missing`);
  const vaults = await createdVaults(fromBlock, BigInt(block));
  const records: VaultRecord[] = [];
  for (const target of vaults) records.push(await vaultRecord(target, block));
  const deploy = (label: string, code: string) => ({
    key: `deploy-${label}-implementation`,
    to: CREATE2_DEPLOYER.toLowerCase(),
    data: `${IMPLEMENTATION_SALT}${code.slice(2)}`,
    signer: "upgrade-authority" as const,
    purpose: `Deploy the reviewed ${label} implementation through the CREATE2 deployer (skipped when the code is already present).`,
  });
  return {
    schema: SCHEMA,
    network,
    mode: isLoopbackRpc(rpcUrl) ? "local" : "public-testnet",
    rpcHost: rpcHost(rpcUrl),
    chainId,
    sourceCommit: sourceCommit(),
    factory,
    plannedAt: new Date().toISOString(),
    plannedAtBlock: BigInt(block).toString(),
    notice:
      "Test network upgrade qualification. It does not qualify a mainnet upgrade, mainnet gas or a mainnet key.",
    roles,
    before: {
      factoryCodeSha256: await codeSha256(factory, block),
      factoryImplementation,
      factoryImplementationCodeSha256: await codeSha256(
        factoryImplementation,
        block,
      ),
      vaultImplementation,
      vaultImplementationCodeSha256: await codeSha256(
        vaultImplementation,
        block,
      ),
      factorySlots: await factorySlots(block),
      factoryInitialized: await word(factory, INITIALIZABLE_SLOT, block),
      vaults: records,
    },
    review: {
      salt: IMPLEMENTATION_SALT,
      create2Deployer: CREATE2_DEPLOYER.toLowerCase(),
      vaultImplementation: vault.predicted.toLowerCase(),
      vaultImplementationCodeSha256: vault.digest,
      factoryImplementation: factoryLogic.predicted.toLowerCase(),
      factoryImplementationCodeSha256: factoryLogic.digest,
    },
    // DEPLOY-MAINNET.md section 4.5: implementations, every vault, then the factory and its template.
    transactions: [
      deploy("vault", vault.creationCode),
      deploy("factory", factoryLogic.creationCode),
      ...records.map((record) => ({
        key: `upgrade-vault:${record.vault}`,
        to: record.vault,
        data: upgradeData(vault.predicted),
        signer: "upgrade-authority" as const,
        purpose: "Upgrade an existing vault with empty initialization data.",
      })),
      {
        key: "upgrade-factory",
        to: factory,
        data: upgradeData(factoryLogic.predicted),
        signer: "upgrade-authority",
        purpose: "Upgrade the factory proxy.",
      },
      {
        key: "select-vault-implementation",
        to: factory,
        data: encodeFunctionData({
          abi: PROXY,
          functionName: "setVaultImplementation",
          args: [vault.predicted],
        }),
        signer: "upgrade-authority",
        purpose: "Select the new vault logic for future vaults.",
      },
    ],
    steps: {},
    stragglers: [],
    verification: null,
    status: "planned",
    errors: [],
  };
}

async function execute(run: Qualification) {
  const authority = privateKeyToAccount(
    evmKey("ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY"),
  );
  const current = await address("upgradeAuthority", "latest");
  if (
    !same(authority.address, run.roles.upgradeAuthority) ||
    !same(current, run.roles.upgradeAuthority)
  )
    throw new Error(
      "ESCROW_ACCEPTANCE_UPGRADE_AUTHORITY_KEY is not the factory upgrade authority in the plan",
    );
  run.status = "executing";
  const send = async (item: PlannedTransaction) => {
    if (!run.steps[item.key]) {
      // A step already in its target state (for example code another account
      // deployed at the CREATE2 address) is recorded and not sent.
      const done = await (async () => {
        if (item.key === "deploy-vault-implementation")
          return (
            (await rpc("eth_getCode", [
              run.review.vaultImplementation,
              "latest",
            ])) !== "0x"
          );
        if (item.key === "deploy-factory-implementation")
          return (
            (await rpc("eth_getCode", [
              run.review.factoryImplementation,
              "latest",
            ])) !== "0x"
          );
        if (item.key.startsWith("upgrade-vault:"))
          return same(
            await implementationOf(item.to, "latest"),
            run.review.vaultImplementation,
          );
        if (item.key === "upgrade-factory")
          return same(
            await implementationOf(factory, "latest"),
            run.review.factoryImplementation,
          );
        return same(
          await address("vaultImplementation", "latest"),
          run.review.vaultImplementation,
        );
      })();
      if (done) {
        run.verification ??= {};
        const skipped = (run.verification.alreadyDone ?? []) as string[];
        if (!skipped.includes(item.key)) skipped.push(item.key);
        run.verification.alreadyDone = skipped;
        await persist();
        return;
      }
    }
    await chain.send(run.steps, item.key, authority, item.to, item.data as Hex);
  };
  for (const item of run.transactions) await send(item);
  // Section 4.5 step 4: a vault created before the new template was selected still runs old logic.
  const selected = run.steps["select-vault-implementation"]?.block;
  const late = await createdVaults(
    BigInt(run.plannedAtBlock) + 1n,
    BigInt(selected ?? ((await rpc("eth_blockNumber", [])) as string)),
  );
  for (const vault of late) {
    if (run.before.vaults.some((record) => same(record.vault, vault))) continue;
    if (!run.stragglers.includes(vault)) run.stragglers.push(vault);
    if (
      !run.steps[`upgrade-vault:${vault}`] &&
      same(
        await implementationOf(vault, "latest"),
        run.review.vaultImplementation,
      )
    )
      continue;
    await chain.send(
      run.steps,
      `upgrade-vault:${vault}`,
      authority,
      vault,
      upgradeData(run.review.vaultImplementation) as Hex,
    );
  }
  run.status = "executed";
}

async function mustRevert(from: string, to: string, data: string) {
  try {
    await rpc("eth_call", [{ from, to, data }, "latest"]);
  } catch (error) {
    if (error instanceof RpcError) return error.message;
    throw error;
  }
  throw new Error(`Call to ${to} succeeded but must revert`);
}

async function verify(run: Qualification) {
  const final = await chain.finalizeSteps(run.steps);
  const block = hex(BigInt(final.block));
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
  for (const target of [
    ...run.before.vaults.map((record) => record.vault),
    ...run.stragglers,
  ]) {
    const after = await vaultRecord(target, block);
    const before = run.before.vaults.find((record) =>
      same(record.vault, target),
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
    }
    vaults.push({
      vault: target,
      implementation: after.implementation,
      straggler: !before,
    });
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
  run.verification = {
    ...(run.verification ?? {}),
    finalizedBlock: final.block,
    transactions: final.transactions,
    vaults,
    refusals,
    supersededAtBlock: upgradeBlocks.length
      ? upgradeBlocks.reduce((a, b) => (a > b ? a : b)).toString()
      : null,
    mismatches,
  };
  run.status = mismatches.length ? "failed" : "passed";
  if (mismatches.length) run.errors.push(...mismatches);
}

const stored = (await Bun.file(file).exists())
  ? ((await Bun.file(file).json()) as Qualification)
  : null;
if (stored && stored.schema !== SCHEMA)
  throw new Error(`${file} is not ${SCHEMA} evidence`);
if (
  stored &&
  (stored.network !== network ||
    stored.chainId !== chainId ||
    stored.factory !== factory ||
    stored.sourceCommit !== sourceCommit())
)
  throw new Error(
    "This directory belongs to another network, factory or source commit. Use a new directory.",
  );
let code = 0;
try {
  if (command === "plan") {
    if (stored) throw new Error(`${file} already holds a plan`);
    state = await plan();
  } else {
    if (!stored) throw new Error(`Run plan first: ${file} is missing`);
    state = stored;
    if (command === "execute") await execute(state);
    else await verify(state);
  }
} catch (error) {
  if (!state) throw error;
  if (error instanceof Waiting) {
    state.status = "waiting";
    code = WAITING_EXIT_CODE;
    console.log(`[${network}] waiting: ${error.message}`);
  } else {
    state.status = "failed";
    state.errors.push(error instanceof Error ? error.message : String(error));
    code = 1;
  }
}
await persist();
if (state) {
  console.log(
    JSON.stringify(
      {
        network,
        command,
        status: state.status,
        upgradeAuthority: state.roles.upgradeAuthority,
        vaults: state.before.vaults.length,
        stragglers: state.stragglers,
        review: state.review,
        errors: state.errors,
        evidence: file,
      },
      null,
      2,
    ),
  );
  if (state.status === "failed") code = 1;
}
process.exit(code);
