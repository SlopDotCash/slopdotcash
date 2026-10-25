/**
 * Proves the acceptance runner end to end on local chains with throwaway keys:
 * an Anvil fork of each EVM test network (real chain id and real test
 * stablecoin, funded with anvil_dealERC20) and a local Solana validator with
 * the production build of the escrow program. Nothing is broadcast to a public
 * network; the forks only read public state.
 *
 *   bun scripts/escrow-acceptance/local.ts [network ...] [--suite extended]
 *
 * `--suite extended` runs the #902 extended suite on the EVM forks. The fork
 * clock moves to the first PRD monthly commitment window (2026-11), so a
 * factory with V2 monthly reserve logic runs the month through the
 * project-operated keeper.
 *
 * Solana needs `bun run build:contracts:solana` first. The production build
 * accepts the short delays configured by this local workflow.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deployUpgradeableFactory } from "../../contracts/evm/integration/upgrade";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  type Evidence,
  jsonRpc,
  loadEvidence,
  WAITING_EXIT_CODE,
} from "./shared";

const root = resolve(import.meta.dir, "..", "..");
const FORKS: Record<string, string> = {
  "base-sepolia":
    process.env.ESCROW_ACCEPTANCE_FORK_BASE_SEPOLIA ??
    "https://sepolia.base.org",
  "ethereum-sepolia":
    process.env.ESCROW_ACCEPTANCE_FORK_ETHEREUM_SEPOLIA ??
    "https://ethereum-sepolia-rpc.publicnode.com",
  "robinhood-testnet":
    process.env.ESCROW_ACCEPTANCE_FORK_ROBINHOOD_TESTNET ??
    "https://rpc.testnet.chain.robinhood.com",
};
const BINDING_DELAY = 3600;
/** Loopback ports; override them when another local chain already uses the defaults. */
const EVM_PORT = Number(process.env.ESCROW_ACCEPTANCE_LOCAL_EVM_PORT ?? 18731);
const SOLANA_PORT = Number(
  process.env.ESCROW_ACCEPTANCE_LOCAL_SOLANA_PORT ?? 18999,
);
const args = process.argv.slice(2);
const suiteFlag = args.indexOf("--suite");
const suite = suiteFlag === -1 ? "section-21" : args[suiteFlag + 1];
if (suite !== "section-21" && suite !== "extended")
  throw new Error("--suite must be section-21 or extended");
const requested = args.filter(
  (_, index) =>
    suiteFlag === -1 || (index !== suiteFlag && index !== suiteFlag + 1),
);
/** Chain time inside the 2026-11 commitment window (2026-12-04 to 2027-01-04 UTC). */
const MONTHLY_WINDOW_TIME = Date.UTC(2026, 11, 5) / 1000;
const networks = requested.length
  ? requested
  : [...Object.keys(FORKS), "solana-localnet"];
const out = resolve(
  process.env.ESCROW_ACCEPTANCE_LOCAL_OUT ??
    join(root, "evidence", "escrow-acceptance-local"),
);

async function waitFor(check: () => Promise<unknown>, what: string) {
  for (let i = 0; i < 120; i++) {
    try {
      await check();
      return;
    } catch {
      await Bun.sleep(500);
    }
  }
  throw new Error(`${what} did not start`);
}

/** Runs the real CLI with environment variables until it passes or fails. */
async function runUntilDone(
  network: string,
  directory: string,
  env: Record<string, string>,
  advance: () => Promise<void>,
): Promise<Evidence> {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const child = Bun.spawn(
      [
        "bun",
        join(root, "scripts", "escrow-acceptance.ts"),
        network,
        directory,
        ...(suite === "extended" ? ["--suite", "extended"] : []),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          ESCROW_ACCEPTANCE_MAX_WAIT_SECONDS: "20",
          ESCROW_ACCEPTANCE_POLL_SECONDS: "2",
          ...env,
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const code = await child.exited;
    if (code === 0) break;
    if (code !== WAITING_EXIT_CODE)
      throw new Error(`${network}: runner exited ${code}`);
    console.log(`[${network}] run ${attempt} is waiting; advancing the chain`);
    await advance();
  }
  const evidence = await loadEvidence(directory);
  if (evidence?.status !== "passed")
    throw new Error(`${network}: evidence status ${evidence?.status}`);
  if (suite === "extended") {
    const scenarios = Object.entries(evidence.scenarios ?? {});
    if (
      evidence.mode !== "local" ||
      scenarios.length === 0 ||
      !scenarios.every(([, entry]) => entry.status === "passed")
    )
      throw new Error(`${network}: extended scenarios did not all pass`);
    return evidence;
  }
  if (
    evidence.mode !== "local" ||
    evidence.assets.length < 2 ||
    !evidence.assets.every((asset) => asset.status === "passed") ||
    !evidence.assets.some((asset) => asset.decimals !== 6)
  )
    throw new Error(`${network}: evidence does not cover the scenario`);
  return evidence;
}

async function evmFork(network: string, port: number) {
  const forkUrl = FORKS[network];
  const policy = ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS];
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    "anvil",
    [
      "--fork-url",
      forkUrl,
      "--port",
      String(port),
      "--silent",
      "--auto-impersonate",
    ],
    { stdio: "ignore" },
  );
  const rpc = (method: string, params: unknown[]) =>
    jsonRpc(rpcUrl, method, params);
  let mining = true;
  try {
    await waitFor(() => rpc("eth_chainId", []), `${network} fork`);
    const key = () => generatePrivateKey();
    const keys = {
      ESCROW_ACCEPTANCE_REGISTRAR_KEY: key(),
      ESCROW_ACCEPTANCE_OWNER_KEY: key(),
      ESCROW_ACCEPTANCE_DEPOSITOR_KEY: key(),
      ESCROW_ACCEPTANCE_IDENTITY_KEY: key(),
      ESCROW_ACCEPTANCE_RELAYER_KEY: key(),
      ESCROW_ACCEPTANCE_ACTOR_A_KEY: key(),
      ESCROW_ACCEPTANCE_ACTOR_B_KEY: key(),
      ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY: key(),
    };
    const address = (name: keyof typeof keys) =>
      privateKeyToAccount(keys[name]).address;
    const feeRecipient = privateKeyToAccount(key()).address;
    for (const name of [
      "ESCROW_ACCEPTANCE_REGISTRAR_KEY",
      "ESCROW_ACCEPTANCE_OWNER_KEY",
      "ESCROW_ACCEPTANCE_DEPOSITOR_KEY",
      "ESCROW_ACCEPTANCE_IDENTITY_KEY",
      "ESCROW_ACCEPTANCE_RELAYER_KEY",
      "ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY",
    ] as const)
      await rpc("anvil_setBalance", [address(name), "0x8ac7230489e80000"]);
    const create = (contract: string, args: string[] = []) =>
      JSON.parse(
        Bun.spawnSync(
          [
            "forge",
            "create",
            "--root",
            join(root, "contracts", "evm"),
            contract,
            "--rpc-url",
            rpcUrl,
            "--unlocked",
            "--from",
            address("ESCROW_ACCEPTANCE_REGISTRAR_KEY"),
            "--broadcast",
            "--json",
            ...(args.length ? ["--constructor-args", ...args] : []),
          ],
          { stderr: "inherit" },
        ).stdout.toString(),
      ).deployedTo as string;
    // The extended suite expects the deployed zero binding delay; its
    // review-window factory has the 120-second delay of the cancel scenario.
    const factoryWith = (delay: number) =>
      deployUpgradeableFactory(create, [
        address("ESCROW_ACCEPTANCE_REGISTRAR_KEY"),
        feeRecipient,
        address("ESCROW_ACCEPTANCE_IDENTITY_KEY"),
        String(delay),
      ]);
    const factory = factoryWith(suite === "extended" ? 0 : BINDING_DELAY);
    const wide = create("test/WideToken.sol:WideToken", ["18"]);
    const stable = policy.asset as string;
    // The extended scenarios use several vaults of the scenario asset.
    const units = suite === "extended" ? 5000n : 1000n;
    const mint = (to: string, token: string, amount: bigint) =>
      rpc("eth_sendTransaction", [
        {
          from: to,
          to: token,
          data: `0x40c10f19${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`,
        },
      ]);
    for (const holder of [
      "ESCROW_ACCEPTANCE_OWNER_KEY",
      "ESCROW_ACCEPTANCE_DEPOSITOR_KEY",
    ] as const) {
      await rpc("anvil_dealERC20", [
        address(holder),
        stable,
        `0x${(units * 10n ** BigInt(policy.assetDecimals ?? 6)).toString(16)}`,
      ]);
      await mint(address(holder), wide, units * 10n ** 18n);
    }
    const extended: Record<string, string> = {};
    if (suite === "extended") {
      const blockable = create("integration/TestDollar.sol:TestDollar");
      await mint(
        address("ESCROW_ACCEPTANCE_OWNER_KEY"),
        blockable,
        1000n * 10n ** 6n,
      );
      Object.assign(extended, {
        ESCROW_ACCEPTANCE_SCENARIO_ASSET: stable,
        ESCROW_ACCEPTANCE_BLOCKABLE_ASSET: blockable,
        ESCROW_ACCEPTANCE_REVIEW_FACTORY: factoryWith(120),
      });
      await rpc("evm_setNextBlockTimestamp", [MONTHLY_WINDOW_TIME]);
      await rpc("anvil_mine", ["0x1"]);
    }
    // Anvil finalizes 64 blocks behind the head; keep blocks coming.
    void (async () => {
      while (mining) {
        await rpc("anvil_mine", ["0x8"]).catch(() => {});
        await Bun.sleep(1000);
      }
    })();
    const directory = join(out, suite, network);
    rmSync(directory, { recursive: true, force: true });
    return await runUntilDone(
      network,
      directory,
      {
        ...keys,
        ESCROW_ACCEPTANCE_RPC_URL: rpcUrl,
        ESCROW_ACCEPTANCE_FACTORY: factory,
        ESCROW_ACCEPTANCE_ASSETS: `${stable},${wide}`,
        ...extended,
      },
      async () => {
        // The extended suite waits for finality only; section 21 also waits
        // for the binding delay.
        if (suite !== "extended")
          await rpc("evm_increaseTime", [BINDING_DELAY]);
        await rpc("anvil_mine", ["0x1"]);
      },
    );
  } finally {
    mining = false;
    anvil.kill("SIGTERM");
  }
}

async function solanaLocalnet() {
  const so = join(
    root,
    "contracts",
    "solana",
    "target",
    "deploy",
    "slop_escrow.so",
  );
  const programId: string = JSON.parse(
    readFileSync(
      join(root, "contracts", "solana", "idl", "slop_escrow.json"),
      "utf8",
    ),
  ).address;
  const seed = () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const pubkey = (hex: string) =>
    solanaBase58(ed25519.getPublicKey(Buffer.from(hex, "hex")));
  const keys = {
    ESCROW_ACCEPTANCE_OWNER_KEY: seed(),
    ESCROW_ACCEPTANCE_DEPOSITOR_KEY: seed(),
    ESCROW_ACCEPTANCE_IDENTITY_KEY: seed(),
    ESCROW_ACCEPTANCE_RELAYER_KEY: seed(),
    ESCROW_ACCEPTANCE_ACTOR_A_KEY: seed(),
    ESCROW_ACCEPTANCE_ACTOR_B_KEY: seed(),
  };
  const upgradeAuthority = seed();
  const rotationAuthority = seed();
  const feeRecipient = pubkey(seed());
  const ledger = mkdtempSync(join(tmpdir(), "slop-acceptance-ledger-"));
  const rpcUrl = `http://127.0.0.1:${SOLANA_PORT}`;
  const validator = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      ledger,
      "--rpc-port",
      String(SOLANA_PORT),
      "--faucet-port",
      String(SOLANA_PORT + 41),
      "--dynamic-port-range",
      `${SOLANA_PORT + 2}-${SOLANA_PORT + 31}`,
      "--upgradeable-program",
      programId,
      so,
      pubkey(upgradeAuthority),
    ],
    { stdio: "ignore" },
  );
  try {
    await waitFor(
      () => jsonRpc(rpcUrl, "getGenesisHash", []),
      "Solana validator",
    );
    const local = (await import(
      join(root, "contracts", "solana", "scripts", "acceptance.ts")
    )) as {
      prepareLocalnet(input: Record<string, unknown>): Promise<string[]>;
    };
    const mints = await local.prepareLocalnet({
      rpcUrl,
      programId,
      upgradeAuthority,
      identity: pubkey(keys.ESCROW_ACCEPTANCE_IDENTITY_KEY),
      feeRecipient,
      rotationAuthority: pubkey(rotationAuthority),
      fund: [
        pubkey(upgradeAuthority),
        pubkey(keys.ESCROW_ACCEPTANCE_OWNER_KEY),
        pubkey(keys.ESCROW_ACCEPTANCE_DEPOSITOR_KEY),
        pubkey(keys.ESCROW_ACCEPTANCE_IDENTITY_KEY),
        pubkey(keys.ESCROW_ACCEPTANCE_RELAYER_KEY),
      ],
      holders: [
        keys.ESCROW_ACCEPTANCE_OWNER_KEY,
        keys.ESCROW_ACCEPTANCE_DEPOSITOR_KEY,
      ],
    });
    const directory = join(out, suite, "solana-localnet");
    rmSync(directory, { recursive: true, force: true });
    return await runUntilDone(
      "solana-localnet",
      directory,
      {
        ...keys,
        ESCROW_ACCEPTANCE_RPC_URL: rpcUrl,
        ESCROW_ACCEPTANCE_PROGRAM_ID: programId,
        ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256: createHash("sha256")
          .update(readFileSync(so))
          .digest("hex"),
        ESCROW_ACCEPTANCE_PROGRAM_UPGRADE_AUTHORITY: pubkey(upgradeAuthority),
        ESCROW_ACCEPTANCE_ASSETS: mints.join(","),
        ...(suite === "extended"
          ? {
              // The local validator runs only key-recovery (zero delays, as
              // deployed); the other scenarios need dispatch.
              ESCROW_ACCEPTANCE_BINDING_DELAY_SECONDS: "0",
              ESCROW_ACCEPTANCE_ROTATION_DELAY_SECONDS: "0",
              ESCROW_ACCEPTANCE_SCENARIO_ASSET: mints[0],
              ESCROW_ACCEPTANCE_BLOCKABLE_ASSET: mints[0],
              ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY: rotationAuthority,
            }
          : {
              ESCROW_ACCEPTANCE_BINDING_DELAY_SECONDS: "4",
              ESCROW_ACCEPTANCE_ROTATION_DELAY_SECONDS: "4",
            }),
      },
      async () => {},
    );
  } finally {
    validator.kill("SIGTERM");
    rmSync(ledger, { recursive: true, force: true });
  }
}

const summary: Record<string, unknown> = {};
let port = EVM_PORT;
let failed = false;
for (const network of networks) {
  if (network !== "solana-localnet" && !FORKS[network])
    throw new Error(`No local proof for ${network}`);
  try {
    const evidence =
      network === "solana-localnet"
        ? await solanaLocalnet()
        : await evmFork(network, port++);
    summary[network] = {
      status: evidence.status,
      chain: evidence.chain,
      assets: evidence.assets.map((asset) => ({
        address: asset.address,
        decimals: asset.decimals,
        referenceStablecoin: asset.referenceStablecoin,
        status: asset.status,
        vault: asset.vault,
      })),
      scenarios: Object.fromEntries(
        Object.entries(evidence.scenarios ?? {}).map(([name, entry]) => [
          name,
          entry.status,
        ]),
      ),
      deviations: evidence.deviations,
    };
  } catch (error) {
    // One network's failure is reported; the other networks still run.
    failed = true;
    const evidence = await loadEvidence(join(out, suite, network)).catch(
      () => null,
    );
    summary[network] = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      runnerErrors: evidence?.errors ?? [],
    };
  }
}
console.log(JSON.stringify({ out, summary }, null, 2));
process.exit(failed ? 1 : 0);
