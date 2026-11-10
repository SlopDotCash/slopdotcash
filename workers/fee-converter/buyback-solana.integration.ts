// SLOP buyback bridge order from Solana on a local validator, with throwaway
// keys (PRD section 6, "SLOP buyback and burn").
//   bun workers/fee-converter/buyback-solana.integration.ts
//
// The validator clones the deployed deBridge DLN source program and the
// accounts one order reads. The real Worker entry point (runOnce), Solana
// client, migrated SQLite journal and the separate bridge native budget then
// quote a live DLN proposal, check every field and account of it, sign it
// and send it only to the local validator. The DLN API and the Jupiter price
// quote are live, read-only calls. Robinhood Chain is a local Anvil fork,
// read only: the public RPC keeps no state at its finalized block, which the
// order-status reads require. Nothing is signed or sent there.
//
// Fee income is seeded: one finalized journal row with its settled native
// record, because this harness has no earlier conversion to earn it. The
// order is never filled here; the EVM fork test covers fill, purchase and
// burn. Requires the reviewed validator image (see contracts/solana/README.md)
// and a TMPDIR shared with the container runtime. Local results do not
// qualify a production deployment or a live fill.

import { strict as assert } from "node:assert";
import { closeSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { programAddress, solanaBase58 } from "../../contracts/solana/adapter";
import { ata } from "../../contracts/solana/transactions";
import { startLocalSolanaValidator } from "../../scripts/local-solana-validator.mjs";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { encodeBase64 } from "../../src/lib/byte-encoding";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { DLN, ROBINHOOD_USDG } from "./buyback-config";
import { dlnGiveOrderWallet } from "./debridge-solana";
import { runOnce } from "./index";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PORT = Number(process.env.SLOP_TEST_BUYBACK_SOLANA_PORT ?? "28999");
const RPC = `http://127.0.0.1:${PORT}`;
const ROBINHOOD_RPC = `http://127.0.0.1:${PORT + 50}`;
/** USDC fee income; the odd unit proves the floor of the half. */
const FEES = 1_000_000_001n;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}
const tokenBalance = async (account: string) =>
  BigInt(
    (
      await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [
        account,
        { commitment: "finalized" },
      ])
    ).value.amount,
  );

const seed = crypto.getRandomValues(new Uint8Array(32));
const publicKey = ed25519.getPublicKey(seed);
const wallet = solanaBase58(publicKey);
const keypair = JSON.stringify([...seed, ...publicKey]);
const receiverKey = generatePrivateKey();
const receiver = privateKeyToAccount(receiverKey).address.toLowerCase();
const usdcAccount = ata(USDC, wallet, TOKEN_PROGRAM);
console.log(`throwaway Solana fee wallet ${wallet}, receiver ${receiver}`);

const encoder = new TextEncoder();
const chain = new Uint8Array(32);
chain[30] = 0x12;
chain[31] = 0x37;
// The program state one order reads; each is derived, never taken from a response.
const clones = [
  programAddress(DLN.solanaProgram, [encoder.encode("STATE")]),
  programAddress(DLN.solanaProgram, [
    encoder.encode("AUTHORIZED_NATIVE_SENDER"),
    chain,
  ]),
  programAddress(DLN.solanaProgram, [
    encoder.encode("FEE_LEDGER_WALLET"),
    decodeBase58Bytes(USDC),
  ]),
  USDC,
];

const dir = mkdtempSync(join(tmpdir(), "buyback-solana-"));
const accountFile = join(dir, "usdc-account.json");
const data = new Uint8Array(165);
data.set(decodeBase58Bytes(USDC), 0);
data.set(decodeBase58Bytes(wallet), 32);
new DataView(data.buffer).setBigUint64(64, FEES, true);
data[108] = 1; // initialized
writeFileSync(
  accountFile,
  JSON.stringify({
    pubkey: usdcAccount,
    account: {
      lamports: 2_039_280,
      data: [encodeBase64(data), "base64"],
      owner: TOKEN_PROGRAM,
      executable: false,
      rentEpoch: 0,
      space: 165,
    },
  }),
);
console.log(`local evidence ${dir}`);
const stdout = openSync(join(dir, "validator.stdout.log"), "w", 0o600);
const stderr = openSync(join(dir, "validator.stderr.log"), "w", 0o600);
let validator:
  | Awaited<ReturnType<typeof startLocalSolanaValidator>>
  | undefined;
let failure: { error: unknown } | undefined;
let anvil: ReturnType<typeof Bun.spawn> | undefined;
const robinhood = async (method: string, params: unknown[]) => {
  const response = await fetch(ROBINHOOD_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await response.json()) as { result?: unknown }).result;
};
try {
  anvil = Bun.spawn(
    [
      "anvil",
      "--fork-url",
      process.env.ROBINHOOD_FORK_URL ??
        "https://rpc.mainnet.chain.robinhood.com",
      "--port",
      String(PORT + 50),
      "--silent",
    ],
    { stdout: "ignore", stderr: "inherit" },
  );
  for (let i = 0; ; i++) {
    try {
      if ((await robinhood("eth_chainId", [])) === "0x1237") break;
    } catch {}
    if (i > 120) throw new Error("anvil Robinhood fork did not start");
    await Bun.sleep(500);
  }
  await robinhood("anvil_mine", ["0x80"]);
  validator = await startLocalSolanaValidator({
    args: [
      "--reset",
      "--quiet",
      "--ticks-per-slot",
      "8",
      "--ledger",
      join(dir, "ledger"),
      "--rpc-port",
      String(PORT),
      "--faucet-port",
      String(PORT + 41),
      "--gossip-port",
      String(PORT + 32),
      "--dynamic-port-range",
      `${PORT + 2}-${PORT + 31}`,
      "--url",
      "https://api.mainnet-beta.solana.com",
      "--clone-upgradeable-program",
      DLN.solanaProgram,
      ...clones.flatMap((key) => ["--clone", key]),
      "--account",
      usdcAccount,
      accountFile,
    ],
    rpcPort: PORT,
    readonlyMounts: [dir],
    stdio: ["ignore", stdout, stderr],
    receiptPath: join(dir, "validator-receipt.json"),
  });
  for (let i = 0; ; i++) {
    if (validator.process.exitCode !== null)
      throw new Error(
        `Local validator exited ${validator.process.exitCode}; see ${dir}`,
      );
    try {
      if ((await rpc<string>("getHealth", [])) === "ok") break;
    } catch {}
    if (i > 240) throw new Error("validator did not start");
    await Bun.sleep(500);
  }
  const finalized = async (signature: string) => {
    for (let i = 0; i < 240; i++) {
      const state = await rpc<{
        value: ({ err: unknown; confirmationStatus: string } | null)[];
      }>("getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]);
      if (state.value[0]?.confirmationStatus === "finalized") {
        assert.equal(state.value[0].err, null, "local transaction failed");
        return;
      }
      await Bun.sleep(500);
    }
    throw new Error("local transaction did not finalize");
  };
  await finalized(await rpc<string>("requestAirdrop", [wallet, 2_000_000_000]));
  assert.equal(await tokenBalance(usdcAccount), FEES);

  const { db, sqlite } = sqliteD1();
  // Seeded income: a finalized conversion into USDC with its settled native
  // record, exactly as the journal holds a real one.
  const at = new Date(Date.now() - 60_000).toISOString();
  const seededTx = solanaBase58(crypto.getRandomValues(new Uint8Array(64)));
  sqlite
    .query(
      `INSERT INTO fee_conversions (kind, id, run_id, network, mode, fee_wallet, token,
         target_token, amount_in, min_amount_out, tx_id, raw_tx, expires_at, amount_out,
         state, created_at, updated_at, submitted_at, finalized_at)
       VALUES ('conversion', 'seed-000001', 'seed-run-1', 'solana', 'live', ?,
         'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', ?, ?, '1', ?, 'seed', 1, ?,
         'finalized', ?, ?, ?, ?)`,
    )
    .run(
      wallet,
      USDC,
      FEES.toString(),
      seededTx,
      FEES.toString(),
      at,
      at,
      at,
      at,
    );
  sqlite
    .query(
      `INSERT INTO fee_native_gas (id, network, fee_wallet, nonce, intent_hash, run_id,
         maximum_wei, per_transaction_wei, per_day_wei, state, tx_id, conversion_id,
         created_at, actual_wei, settled_day, receipt_block_hash)
       VALUES ('seed-gas-1', 'solana', ?, 0, 'seed', 'seed-run-1', '5000', '5000000',
         '20000000', 'signed', ?, 'seed-000001', ?, '5000', '2026-01-01', 'seed')`,
    )
    .run(wallet, seededTx, at);

  const env = {
    FEE_DB: db,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "solana,robinhood",
    FEE_WALLET_SOLANA: wallet,
    FEE_WALLET_KEY_SOLANA: keypair,
    FEE_WALLET_ROBINHOOD: receiver,
    FEE_WALLET_KEY_ROBINHOOD: receiverKey,
    RPC_URL_SOLANA: RPC,
    RPC_URL_ROBINHOOD: ROBINHOOD_RPC,
    FEE_CONVERTER_MIN_VALUE_MICRO: "5000000",
    FEE_CONVERTER_GAS_MULTIPLE: "10",
    FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
    FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
    FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
    FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
    // The fee-conversion native budgets of the reviewed wrangler.toml.
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
      solana: {
        perTransaction: "5000000",
        perDay: "20000000",
        additionalFeeReserve: "0",
      },
      robinhood: {
        perTransaction: "200000000000000",
        perDay: "2000000000000000",
        additionalFeeReserve: "0",
      },
    }),
    BUYBACK_MODE: "live",
    BUYBACK_START_AT: new Date(Date.now() - 3_600_000).toISOString(),
    BUYBACK_SHARE_BPS: "5000",
    BUYBACK_BURN_BPS: "5000",
    BUYBACK_MIN_BRIDGE_MICRO: "250000000",
    BUYBACK_MAX_BRIDGE_COST_BPS: "300",
    BUYBACK_MAX_BRIDGE_NATIVE_FEE: JSON.stringify({ solana: "60000000" }),
    BUYBACK_SOLANA_BRIDGE_NATIVE: JSON.stringify({
      perTransaction: "60000000",
      perDay: "120000000",
    }),
    BUYBACK_MIN_BUY_MICRO: "25000000",
    BUYBACK_MIN_BURN_MICRO: "1000000",
    BUYBACK_MAX_SLIPPAGE_BPS: "100",
    BUYBACK_MAX_PRICE_IMPACT_BPS: "300",
    BUYBACK_RUN_CAP_MICRO: "2000000000",
    BUYBACK_DAILY_CAP_MICRO: "5000000000",
    BUYBACK_UNFILLED_ALERT_SECONDS: "3600",
  };
  const bridgeRows = () =>
    sqlite
      .query(
        "SELECT * FROM fee_conversions WHERE kind = 'bridge' ORDER BY rowid",
      )
      .all() as Record<string, string | number | null>[];
  const lamportsBefore = (
    await rpc<{ value: number }>("getBalance", [
      wallet,
      { commitment: "finalized" },
    ])
  ).value;

  const [first] = await runOnce(env as never, undefined, undefined, "recovery");
  console.log(`1 order: ${JSON.stringify(first.buyback)}`);
  const [order] = bridgeRows();
  assert.ok(order, "a bridge order was journaled");
  assert.equal(order.state, "submitted", String(order.reason));
  assert.equal(order.amount_in, (FEES / 2n).toString());
  assert.equal(order.route, "debridge");
  assert.equal(order.target_token, ROBINHOOD_USDG);
  const terms = JSON.parse(order.quote as string);
  assert.equal(terms.receiver, receiver);
  assert.equal(terms.takeChainId, "4663");
  assert.equal(terms.takeToken, ROBINHOOD_USDG);
  await finalized(order.tx_id as string);

  const [second] = await runOnce(
    env as never,
    undefined,
    undefined,
    "recovery",
  );
  console.log(`2 reconcile: ${JSON.stringify(second.buyback)}`);
  const [deposit] = bridgeRows();
  assert.equal(deposit.state, "finalized");
  assert.equal(deposit.amount_out, deposit.amount_in);
  assert.equal(
    await tokenBalance(usdcAccount),
    FEES - FEES / 2n,
    "exactly the buyback half left the wallet",
  );
  const escrowed = await tokenBalance(dlnGiveOrderWallet(terms.orderId));
  assert.ok(
    escrowed > 0n && escrowed <= FEES / 2n,
    "the order's escrow, derived from its order id, holds the deposit",
  );
  const gas = sqlite
    .query(
      "SELECT purpose, maximum_wei, actual_wei, per_day_wei FROM fee_native_gas WHERE tx_id = ?",
    )
    .get(order.tx_id as string) as Record<string, string | null>;
  assert.equal(gas.purpose, "bridge");
  assert.equal(gas.per_day_wei, "120000000");
  const lamportsAfter = (
    await rpc<{ value: number }>("getBalance", [
      wallet,
      { commitment: "finalized" },
    ])
  ).value;
  assert.equal(
    gas.actual_wei,
    String(lamportsBefore - lamportsAfter),
    "the settled native cost is the wallet's whole SOL debit",
  );
  assert.ok(BigInt(gas.actual_wei as string) <= BigInt(terms.nativeFee));
  // An unfilled order is in transit: no outcome, no refund, no second order.
  assert.equal(second.buyback?.inTransit, 1);
  assert.equal(second.buyback?.errors, 0, "status reads succeed");
  assert.equal(bridgeRows().length, 1);
  assert.equal(
    (
      sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get() as {
        n: number;
      }
    ).n,
    0,
  );
  console.log(
    JSON.stringify({
      check: "Solana bridge order on a local validator",
      orderId: terms.orderId,
      deposited: deposit.amount_in,
      arrival: terms.takeAmount,
      escrowed: escrowed.toString(),
      nativeLamports: gas.actual_wei,
      quotedNativeLamports: terms.nativeFee,
    }),
  );
  console.log("PASS: Solana buyback bridge order");
} catch (error) {
  failure = { error };
} finally {
  anvil?.kill();
  await validator?.close().catch((error: unknown) => {
    console.error("validator cleanup failed", error);
  });
  for (const descriptor of [stdout, stderr]) closeSync(descriptor);
}
if (failure) throw failure.error;
