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
  assertFactoryDeploymentBlock,
  CREATE2_DEPLOYER,
  expectedImplementation,
  IMPLEMENTATION_SALT,
  INITIALIZABLE_SLOT,
} from "../../contracts/evm/integration/upgrade";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { EvmChain, FACTORY } from "./evm";
import {
  assertEvmTestChain,
  evmKey,
  isAcceptanceNetwork,
  isLoopbackRpc,
  jsonRpc,
  requireEnv,
  rpcHost,
  sourceCommit,
  WAITING_EXIT_CODE,
  Waiting,
} from "./shared";

import {
  type PlannedTransaction,
  type Qualification,
  UPGRADE_SCHEMA as SCHEMA,
  upgradeReader,
  type VaultRecord,
  verifyUpgrade,
} from "./upgrade-verification";

const evmRoot = resolve(import.meta.dir, "..", "..", "contracts", "evm");
const PROXY = parseAbi([
  "function upgradeToAndCall(address,bytes)",
  "function setVaultImplementation(address)",
  "function initialize(address,address,address,uint64,address,address)",
  "function initialize(bytes32,address,address,uint8,address,uint64)",
]);

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
const {
  word,
  implementationOf,
  codeSha256,
  address,
  vaultRecord,
  factorySlots,
  createdVaults,
} = upgradeReader(chain, factory, BigInt(policy.scanPageBlocks ?? "2000"));
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
  await assertFactoryDeploymentBlock(rpc, factory, fromBlock, BigInt(block));
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
  for (const target of vaults)
    records.push(await vaultRecord(target, block, fromBlock));
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
    factoryDeploymentBlock: fromBlock.toString(),
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
    history: [],
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
    const recorded = run.before.vaults.some((record) =>
      same(record.vault, vault),
    );
    if (recorded && !run.stragglers.includes(vault)) continue;
    if (!run.stragglers.includes(vault)) run.stragglers.push(vault);
    if (!recorded) {
      const observed = String(await rpc("eth_blockNumber", []));
      run.before.vaults.push(
        await vaultRecord(vault, observed, BigInt(run.factoryDeploymentBlock)),
      );
      await persist();
    }
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
let failure: string | undefined;
try {
  if (command === "plan") {
    if (stored) throw new Error(`${file} already holds a plan`);
    state = await plan();
  } else {
    if (!stored) throw new Error(`Run plan first: ${file} is missing`);
    state = stored;
    if (command === "execute") await execute(state);
    else {
      state.verification = await verifyUpgrade(state, chain);
      state.status = "passed";
    }
  }
} catch (error) {
  if (!state) throw error;
  failure = error instanceof Error ? error.message : String(error);
  if (error instanceof Waiting) {
    state.status = "waiting";
    code = WAITING_EXIT_CODE;
    console.log(`[${network}] waiting: ${failure}`);
  } else {
    state.status = "failed";
    code = 1;
  }
}
if (state) {
  state.history.push({
    command,
    at: new Date().toISOString(),
    status: state.status,
    ...(failure ? { error: failure } : {}),
  });
  await persist();
  console.log(
    JSON.stringify(
      {
        network,
        command,
        status: state.status,
        error: failure ?? null,
        upgradeAuthority: state.roles.upgradeAuthority,
        vaults: state.before.vaults.length,
        stragglers: state.stragglers,
        review: state.review,
        evidence: file,
      },
      null,
      2,
    ),
  );
}
process.exit(code);
