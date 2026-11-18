/**
 * The submission-fee Worker against a real local chain and the compiled
 * SubmissionDeposits contract. On Anvil it deposits fees, lets the Worker
 * read and judge them, and lets it send what is due: a refund for a short
 * deposit, a refund for a merge, a kept fee for a close. It checks token
 * balances on the chain, not the Worker's own record.
 *
 * Default: one plain local chain with test tokens. Public Anvil fixture keys
 * only; no hosted database, no public chain.
 *   bun workers/submission-fee/anvil.integration.ts
 *
 * Rehearsal on private forks of the real chains, with the real tokens, fee
 * wallet, burn address and price pool (nothing leaves the fork):
 *   SLOP_FEE_FORK_BASE=<Base RPC URL> SLOP_FEE_FORK_ROBINHOOD=<Robinhood RPC URL> \
 *     bun workers/submission-fee/anvil.integration.ts
 *
 * `SLOP_FEE_CONTRACTS_ROOT` names another `contracts/evm` folder to compile
 * the contract from.
 */
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
  type SubmissionFeeTerms,
  slopFeeBase,
  slopRateText,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { D1BuybackStore } from "../fee-converter/buyback-store";
import { createEvmFeeChain, readPoolRate } from "./chain";
import { type NetworkConfig, OFFICIAL_POOL } from "./config";
import type { FeeChain } from "./core";
import { type Env, type Overrides, runDeposits } from "./index";

const evmRoot =
  process.env.SLOP_FEE_CONTRACTS_ROOT ??
  fileURLToPath(new URL("../../contracts/evm/", import.meta.url));
// A test token that emits Transfer, as the real tokens do.
const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
// Public Anvil mnemonic accounts: 0 owns, 1 resolves, 2 pays.
const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const resolver = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const resolverKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const payer = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const REPOSITORY = 4242;
const FEE = 2_000_000n;
const ETHER = `0x${(10n ** 18n).toString(16)}`;
// Slopbot's table (migration 0141), from the shared interface.
const ITEMS = `CREATE TABLE IF NOT EXISTS submission_fee_items (
  repository_id INTEGER NOT NULL, pull_number INTEGER NOT NULL, project_id TEXT NOT NULL,
  item TEXT NOT NULL, stable_minor TEXT NOT NULL, asked_at TEXT NOT NULL, paid_at TEXT,
  paid_network TEXT, paid_deposit_id INTEGER, outcome TEXT, outcome_at TEXT,
  PRIMARY KEY (repository_id, pull_number))`;

interface Target {
  label: string;
  network: "base-mainnet" | "robinhood-mainnet";
  chainId: number;
  port: number;
  forkUrl?: string;
  /** On a fork: accounts that hold the real tokens, impersonated to fund the payer. */
  holders?: { stable: string; slop?: string };
}

const forkBase = process.env.SLOP_FEE_FORK_BASE;
const forkRobinhood = process.env.SLOP_FEE_FORK_ROBINHOOD;
const basePort = Number(process.env.SLOP_FEE_ANVIL_PORT ?? "18571");
const targets: Target[] =
  forkBase || forkRobinhood
    ? [
        ...(forkBase
          ? [
              {
                label: "Base fork",
                network: "base-mainnet" as const,
                chainId: 8453,
                port: basePort,
                forkUrl: forkBase,
                // Morpho on Base, a large USDC holder.
                holders: {
                  stable: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
                },
              },
            ]
          : []),
        ...(forkRobinhood
          ? [
              {
                label: "Robinhood Chain fork",
                network: "robinhood-mainnet" as const,
                chainId: 4663,
                port: basePort + 1,
                forkUrl: forkRobinhood,
                // The SLOP treasury holds USDG; the referral distributor holds SLOP.
                holders: {
                  stable: "0x96028De971a9D37404F5030F6284b40640E2D1a2",
                  slop: "0x6A24E993E59cbA950C6F91A964BEF2A5F91227CC",
                },
              },
            ]
          : []),
      ]
    : [
        {
          label: "local chain",
          network: "robinhood-mainnet" as const,
          chainId: 4663,
          port: basePort,
        },
      ];

const { db, sqlite } = sqliteD1();
sqlite.exec(ITEMS);
const logs: Record<string, unknown>[] = [];
const children: ChildProcess[] = [];

function cast(args: string[]) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim();
}

async function rehearse(target: Target) {
  const rpcUrl = `http://127.0.0.1:${target.port}`;
  const say = (text: string) => console.log(`[${target.label}] ${text}`);
  const anvil = spawn(
    "anvil",
    [
      "--port",
      String(target.port),
      "--silent",
      // Finalized is sixteen blocks behind the head, so the run controls it by mining.
      "--slots-in-an-epoch",
      "8",
      ...(target.forkUrl
        ? ["--fork-url", target.forkUrl]
        : ["--chain-id", String(target.chainId)]),
    ],
    { stdio: "ignore" },
  );
  children.push(anvil);
  const rpc = async (method: string, params: unknown[] = []) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };
    if (body.error) throw new Error(JSON.stringify(body.error));
    return body.result;
  };
  for (let i = 0; ; i += 1) {
    try {
      await rpc("eth_chainId");
      break;
    } catch {
      if (anvil.exitCode !== null || i > 300)
        throw new Error("anvil did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(Number(await rpc("eth_chainId")), target.chainId);
  const mine = (blocks: number) =>
    rpc("anvil_mine", [`0x${blocks.toString(16)}`]);
  const send = async (
    from: string,
    to: string,
    signature: string,
    args: string[],
  ) => {
    await rpc("anvil_impersonateAccount", [from]);
    const hash = await rpc("eth_sendTransaction", [
      {
        from,
        to,
        data: cast(["calldata", signature, ...args]),
        gas: "0x7a120",
      },
    ]);
    await mine(1);
    const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
      status: string;
    };
    assert.equal(receipt.status, "0x1", `${signature} reverted`);
  };
  const balance = (token: string, account: string) =>
    BigInt(
      cast([
        "call",
        "--rpc-url",
        rpcUrl,
        token,
        "balanceOf(address)(uint256)",
        account,
      ]).split(" ")[0],
    );
  const create = (contract: string, args: string[] = [], root = evmRoot) =>
    (
      JSON.parse(
        execFileSync(
          "forge",
          [
            "create",
            "--root",
            root,
            contract,
            "--rpc-url",
            rpcUrl,
            "--unlocked",
            "--from",
            owner,
            "--broadcast",
            "--json",
            ...(args.length ? ["--constructor-args", ...args] : []),
          ],
          { encoding: "utf8" },
        ),
      ).deployedTo as string
    ).toLowerCase();

  for (const account of [owner, resolver, payer])
    await rpc("anvil_setBalance", [account, ETHER]);

  // The tokens: the real ones on a fork, test tokens on a plain chain.
  const real = SUBMISSION_FEE_TOKENS[target.network];
  let stable: string;
  let slop: string | null;
  let terms: SubmissionFeeTerms;
  const feeWallet = SUBMISSION_FEE_KEPT_TO[target.network];
  if (target.forkUrl && target.holders) {
    stable = (real.usdc ?? real.usdg) as string;
    slop = target.holders.slop ? (real.slop as string) : null;
    terms = {};
    await rpc("anvil_setBalance", [target.holders.stable, ETHER]);
    await send(target.holders.stable, stable, "transfer(address,uint256)", [
      payer,
      (FEE * 10n).toString(),
    ]);
    if (slop && target.holders.slop) {
      await rpc("anvil_setBalance", [target.holders.slop, ETHER]);
      await send(target.holders.slop, slop, "transfer(address,uint256)", [
        payer,
        (10_000n * 10n ** 18n).toString(),
      ]);
    }
  } else {
    stable = create("src/FeeTestToken.sol:FeeTestToken", [], fixtureRoot);
    slop = create("src/FeeTestToken.sol:FeeTestToken", [], fixtureRoot);
    terms = {
      tokens: { [target.network]: { usdg: stable, slop } },
      keptTo: SUBMISSION_FEE_KEPT_TO,
      burn: SUBMISSION_FEE_BURN,
    };
    await send(owner, stable, "mint(address,uint256)", [
      payer,
      (FEE * 10n).toString(),
    ]);
    await send(owner, slop, "mint(address,uint256)", [
      payer,
      (10_000n * 10n ** 18n).toString(),
    ]);
  }

  const contract = create("src/SubmissionDeposits.sol:SubmissionDeposits", [
    owner,
    resolver,
    String(30 * 24 * 3600),
  ]);
  const startBlock = Number(await rpc("eth_blockNumber"));
  say(`SubmissionDeposits at ${contract}, from block ${startBlock}`);

  const network: NetworkConfig = {
    network: target.network,
    chainId: target.chainId,
    contract,
    startBlock,
    rpcUrl,
    confirmations: 2,
    scanPageBlocks: 500,
    gas: {
      perTransactionWei: "2000000000000000",
      perDayWei: "9000000000000000",
    },
  };
  const env = (mode: string): Env => ({
    SUBMISSION_FEE_MODE: mode,
    SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI: network.gas.perTransactionWei,
    SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI: network.gas.perDayWei,
    SUBMISSION_FEE_RESOLVER_KEY: resolverKey,
    SUBMISSION_FEE_DB: db as never,
  });
  // The real client and the real signing path; only the deployment is local.
  let dropBroadcasts = 0;
  let signedSends = 0;
  const overrides: Overrides = {
    config: (config) => ({ ...config, networks: [network], unset: [], terms }),
    chain: (config, privateKey) => {
      const chain: FeeChain = createEvmFeeChain({
        network: config,
        privateKey,
      });
      const { broadcast, prepare } = chain;
      return {
        ...chain,
        prepare: async (entries, authorize) => {
          const prepared = await prepare(entries, authorize);
          signedSends += 1;
          return prepared;
        },
        broadcast: async (rawTx) => {
          if (dropBroadcasts > 0) {
            dropBroadcasts -= 1;
            throw new Error("the process died before the bytes left");
          }
          return broadcast(rawTx);
        },
      };
    },
    log: (event) => logs.push(event),
    onError: (error) => console.error(error),
  };
  const run = async (mode: "dry_run" | "live") => {
    const result = await runDeposits(env(mode), undefined, overrides);
    assert.equal(result.status, "ran");
    const [outcome] = (result as { networks: Record<string, unknown>[] })
      .networks;
    assert.equal(outcome.error, undefined, JSON.stringify(outcome));
    return outcome;
  };
  const row = (table: string, where: string) =>
    sqlite.query(`SELECT * FROM ${table} WHERE ${where}`).get() as Record<
      string,
      unknown
    > | null;
  const depositRow = (id: number) =>
    row(
      "submission_fee_deposits",
      `network = '${target.network}' AND deposit_id = ${id}`,
    );
  const itemRow = (pull: number) =>
    row(
      "submission_fee_items",
      `repository_id = ${REPOSITORY} AND pull_number = ${pull}`,
    );
  // Pull request numbers are distinct per network, so both share one database.
  const pull = (index: number) => target.chainId * 100 + index;
  const ask = (index: number) =>
    sqlite
      .query(
        "INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at) VALUES (?, ?, 'rehearsal', ?, ?, ?)",
      )
      .run(
        REPOSITORY,
        pull(index),
        submissionFeeItem(REPOSITORY, pull(index)),
        FEE.toString(),
        new Date().toISOString(),
      );
  const decide = (index: number, outcome: string) =>
    sqlite
      .query(
        "UPDATE submission_fee_items SET outcome = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .run(outcome, REPOSITORY, pull(index));
  let deposits = 0;
  const pay = async (
    index: number,
    token: string,
    amount: bigint,
    keptTo: string,
  ) => {
    await send(payer, token, "approve(address,uint256)", [
      contract,
      amount.toString(),
    ]);
    await send(payer, contract, "deposit(bytes32,address,uint128,address)", [
      submissionFeeItem(REPOSITORY, pull(index)),
      token,
      amount.toString(),
      keptTo,
    ]);
    deposits += 1;
    return deposits;
  };
  const finalize = () => mine(20);

  // Three pull requests: one will be merged, one closed, one paid short.
  for (const index of [1, 2, 3]) ask(index);
  const payerStart = balance(stable, payer);
  const feeWalletStart = balance(stable, feeWallet);
  const merged = await pay(1, stable, FEE, feeWallet);
  const short = await pay(2, stable, FEE - 1n, feeWallet);
  const closed = await pay(3, stable, FEE, feeWallet);
  assert.equal(balance(stable, payer), payerStart - (3n * FEE - 1n));

  // Seen before finality: the two that count mark their pull requests paid.
  await mine(2);
  let outcome = await run("live");
  assert.equal(outcome.paid, 2);
  assert.equal(outcome.send, "none");
  assert.equal(depositRow(merged)?.accepted, 1);
  assert.equal(depositRow(merged)?.finalized_at, null);
  assert.equal(depositRow(short)?.accepted, 0);
  assert.equal(depositRow(short)?.reject_reason, "amount_below_due");
  assert.equal(itemRow(pull(1))?.paid_deposit_id, merged);
  assert.equal(itemRow(pull(2))?.paid_deposit_id, null);
  assert.equal(itemRow(pull(3))?.paid_deposit_id, closed);
  say("deposits seen and judged before finality; nothing sent");

  // Finalized. A dry run records the refund it would send and signs nothing.
  await finalize();
  outcome = await run("dry_run");
  assert.equal(outcome.send, "recorded");
  assert.equal(signedSends, 0);
  assert.equal(balance(stable, payer), payerStart - (3n * FEE - 1n));
  const dry = row(
    "submission_fee_sends",
    `network = '${target.network}' AND mode = 'dry_run'`,
  );
  assert.equal(dry?.deposits, JSON.stringify([{ id: short, refund: true }]));
  assert.equal(dry?.raw_tx, null);
  say("dry run recorded the short deposit's refund and sent nothing");

  // Live: the run dies after recording the signed bytes and before sending.
  dropBroadcasts = 1;
  outcome = await run("live");
  assert.equal(outcome.send, "in_flight");
  assert.equal(signedSends, 1);
  const journal = () =>
    sqlite
      .query(
        `SELECT state, tx_id, raw_tx, deposits FROM submission_fee_sends WHERE network = '${target.network}' AND mode = 'live' ORDER BY rowid`,
      )
      .all() as {
      state: string;
      tx_id: string;
      raw_tx: string;
      deposits: string;
    }[];
  assert.equal(journal()[0].state, "unknown");
  const firstBytes = journal()[0].raw_tx;
  // The next run resends the same bytes and signs nothing new.
  outcome = await run("live");
  assert.equal(outcome.send, "in_flight");
  assert.equal(signedSends, 1);
  assert.equal(journal().length, 1);
  assert.equal(journal()[0].raw_tx, firstBytes);
  assert.equal(journal()[0].state, "submitted");
  await mine(1);
  await finalize();
  outcome = await run("live");
  assert.equal(outcome.resolved, 1);
  assert.equal(journal()[0].state, "finalized");
  assert.equal(depositRow(short)?.state, "refunded");
  assert.equal(depositRow(short)?.resolve_tx, journal()[0].tx_id);
  assert.equal(balance(stable, payer), payerStart - 2n * FEE);
  assert.equal(signedSends, 1);
  say(
    "short deposit refunded once, after a send that died was resent unchanged",
  );

  // Slopbot's rows: the merge is refunded, the close is kept.
  decide(1, "refund_due");
  decide(3, "kept_due");
  outcome = await run("live");
  assert.equal(outcome.send, "sent");
  assert.equal(
    journal()[1].deposits,
    JSON.stringify([
      { id: merged, refund: true },
      { id: closed, refund: false },
    ]),
  );
  await mine(1);
  // Included but not finalized: still in flight, nothing recorded as done.
  await mine(1);
  outcome = await run("live");
  assert.equal(outcome.send, "in_flight");
  assert.equal(depositRow(merged)?.state, "refund_due");
  await finalize();
  outcome = await run("live");
  assert.equal(outcome.resolved, 2);
  assert.equal(depositRow(merged)?.state, "refunded");
  assert.equal(depositRow(closed)?.state, "kept");
  assert.equal(itemRow(pull(1))?.outcome, "refunded");
  assert.equal(itemRow(pull(3))?.outcome, "kept");
  assert.equal(balance(stable, payer), payerStart - FEE);
  assert.equal(balance(stable, feeWallet), feeWalletStart + FEE);
  assert.equal(balance(stable, contract), 0n);
  assert.equal(signedSends, 2);
  say("merge refunded, close kept: the fee wallet holds exactly one fee more");

  // The kept fee is fee income of this network's stablecoin; nothing else is.
  const converter = target.network === "base-mainnet" ? "base" : "robinhood";
  const income = await new D1BuybackStore(db as never).feeIncome(
    converter,
    stable,
    feeWallet,
    "2026-11-12T00:00:00.000Z",
  );
  assert.equal(income, FEE);
  say(`kept fee counted as fee income: ${income}`);

  if (slop) {
    // SLOP at half price, at a stored rate. On a fork the rate is the
    // official pool's own price, read the way the hourly job reads it.
    let rate = "75";
    if (target.forkUrl) {
      const reading = await readPoolRate({ ...OFFICIAL_POOL, rpcUrl });
      rate = slopRateText(reading.scaled);
      say(
        `official pool read at block ${reading.blockNumber}: ${rate} SLOP per 1.00`,
      );
    }
    sqlite
      .query("INSERT INTO submission_fee_rates VALUES (?, ?, 'rehearsal', ?)")
      .run(
        `2026-01-0${target.port % 9}T00:00:00.000Z`,
        rate,
        new Date().toISOString(),
      );
    const due = BigInt(slopFeeBase(FEE.toString(), rate));
    ask(4);
    ask(5);
    const burnStart = balance(slop, SUBMISSION_FEE_BURN);
    const slopStart = balance(slop, payer);
    const burned = await pay(4, slop, due, SUBMISSION_FEE_BURN);
    // The right amount, but a kept fee would reach the fee wallet, not burn.
    const misdirected = await pay(5, slop, due, feeWallet);
    await mine(2);
    await finalize();
    outcome = await run("live");
    assert.equal(depositRow(burned)?.accepted, 1);
    assert.equal(depositRow(misdirected)?.reject_reason, "wrong_kept_to");
    decide(4, "kept_due");
    // The refusal's refund went out in that run; settle it, then the burn.
    for (let round = 0; round < 3; round += 1) {
      await mine(1);
      await finalize();
      outcome = await run("live");
    }
    assert.equal(depositRow(burned)?.state, "kept");
    assert.equal(depositRow(misdirected)?.state, "refunded");
    assert.equal(balance(slop, SUBMISSION_FEE_BURN), burnStart + due);
    assert.equal(balance(slop, payer), slopStart - due);
    assert.equal(balance(slop, feeWallet) >= 0n, true);
    assert.equal(
      await new D1BuybackStore(db as never).feeIncome(
        converter,
        slop,
        feeWallet,
        "2026-11-12T00:00:00.000Z",
      ),
      0n,
    );
    say(
      `${due} SLOP base units burned; a misdirected SLOP deposit refunded; no SLOP income`,
    );
  }

  // Settled: another run reads the chain and sends nothing.
  const before = signedSends;
  await finalize();
  outcome = await run("live");
  assert.equal(outcome.send, "none");
  assert.equal(signedSends, before);
  anvil.kill();
  say("done");
}

try {
  for (const root of [evmRoot, fixtureRoot])
    execFileSync("forge", ["build", "--root", root], { stdio: "ignore" });
  for (const target of targets) await rehearse(target);
  console.log(
    `submission-fee rehearsal passed on ${targets.map((target) => target.label).join(" and ")}`,
  );
} catch (error) {
  console.error(
    logs
      .slice(-12)
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  throw error;
} finally {
  for (const child of children) child.kill();
}
