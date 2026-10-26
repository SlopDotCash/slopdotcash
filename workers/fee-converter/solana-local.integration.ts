// Live cycle against a local solana-test-validator with a throwaway keypair.
// The validator clones the mainnet Jupiter and Whirlpool programs and the
// accounts of one JUP/USDC Whirlpool route; the fee wallet's JUP account is
// written locally, so no mainnet token moves. Jupiter's public API is only
// read for the route and the unsigned transaction.
//   bun workers/fee-converter/solana-local.integration.ts

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { runOnce } from "./index";
import { associatedTokenAccount, parseTransaction } from "./solana";
import { sqliteD1 } from "./sqlite-d1";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const WHIRLPOOL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const BUILTIN = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS5EPFLc1sHnVxaamhKCvQrb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "SysvarRent111111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);
const JUPITER_API = "https://lite-api.jup.ag/swap/v1";
const PORT = 28899;
const RPC = `http://127.0.0.1:${PORT}`;
const AMOUNT = 30_000_000n; // 30 JUP

// One deterministic, legacy, single-pool route so the cloned accounts match.
const routeParams =
  "&dexes=Whirlpool&onlyDirectRoutes=true&asLegacyTransaction=true";
const pinnedRoute: typeof fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = String(input);
  if (url.startsWith(`${JUPITER_API}/quote?`))
    return fetch(url + routeParams, init);
  if (url === `${JUPITER_API}/swap` && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    return fetch(url, {
      ...init,
      body: JSON.stringify({ ...body, asLegacyTransaction: true }),
    });
  }
  return fetch(input, init);
}) as typeof fetch;

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

function tokenAccount(mint: string, owner: string, amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(decodeBase58Bytes(mint), 0);
  data.set(decodeBase58Bytes(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1; // initialized
  return btoa(String.fromCharCode(...data));
}

const seed = crypto.getRandomValues(new Uint8Array(32));
const publicKey = ed25519.getPublicKey(seed);
const wallet = solanaBase58(publicKey);
const keypair = JSON.stringify([...seed, ...publicKey]);
console.log(`throwaway fee wallet ${wallet}`);

// Learn the route's accounts from an unsigned Jupiter transaction for this wallet.
const quote = await (
  await pinnedRoute(
    `${JUPITER_API}/quote?inputMint=${JUP}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50&swapMode=ExactIn&restrictIntermediateTokens=true`,
  )
).json();
const built = (await (
  await pinnedRoute(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet,
      wrapAndUnwrapSol: false,
    }),
  })
).json()) as { swapTransaction: string };
const parsed = parseTransaction(
  Uint8Array.from(atob(built.swapTransaction), (c) => c.charCodeAt(0)),
);
const jupAccount = associatedTokenAccount(wallet, JUP);
const clones = [...new Set(parsed.staticKeys)].filter(
  (key) =>
    key !== wallet &&
    key !== jupAccount &&
    !BUILTIN.has(key) &&
    key !== JUPITER &&
    key !== WHIRLPOOL,
);
console.log(
  `route ${quote.routePlan?.[0]?.swapInfo?.ammKey}; cloning ${clones.length} accounts`,
);

const dir = mkdtempSync(join(tmpdir(), "fee-converter-solana-"));
const accountFile = join(dir, "jup-account.json");
writeFileSync(
  accountFile,
  JSON.stringify({
    pubkey: jupAccount,
    account: {
      lamports: 2_039_280,
      data: [tokenAccount(JUP, wallet, AMOUNT), "base64"],
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      executable: false,
      rentEpoch: 0,
      space: 165,
    },
  }),
);
try {
  await rpc("getHealth", []);
  throw new Error(`port ${PORT} is already serving a validator; stop it first`);
} catch (error) {
  if (String(error).includes("already serving")) throw error;
}
const validator = Bun.spawn(
  [
    "solana-test-validator",
    "--reset",
    "--quiet",
    "--ledger",
    join(dir, "ledger"),
    "--rpc-port",
    String(PORT),
    "--faucet-port",
    "29900",
    "--gossip-port",
    "28931",
    "--dynamic-port-range",
    "28901-28930",
    "--url",
    "https://api.mainnet-beta.solana.com",
    "--clone-upgradeable-program",
    JUPITER,
    "--clone-upgradeable-program",
    WHIRLPOOL,
    "--clone",
    JUP,
    "--clone",
    USDC,
    ...clones.flatMap((key) => ["--maybe-clone", key]),
    "--account",
    jupAccount,
    accountFile,
  ],
  { stdout: "ignore", stderr: "inherit" },
);
try {
  for (let i = 0; ; i++) {
    try {
      if ((await rpc<string>("getHealth", [])) === "ok") break;
    } catch {}
    if (i > 240) throw new Error("validator did not start");
    await Bun.sleep(500);
  }
  const airdrop = await rpc<string>("requestAirdrop", [wallet, 2_000_000_000]);
  for (let i = 0; i < 60; i++) {
    const s = await rpc<{ value: ({ confirmationStatus: string } | null)[] }>(
      "getSignatureStatuses",
      [[airdrop]],
    );
    if (
      s.value[0]?.confirmationStatus === "confirmed" ||
      s.value[0]?.confirmationStatus === "finalized"
    )
      break;
    await Bun.sleep(500);
  }

  for (const mint of [JUP, USDC]) {
    const info = await rpc<{ value: { owner: string } | null }>(
      "getAccountInfo",
      [mint, { encoding: "base64" }],
    );
    if (!info.value) throw new Error(`mint ${mint} was not cloned`);
  }
  const { db, sqlite } = sqliteD1();
  const env = {
    FEE_DB: db,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "solana",
    FEE_WALLET_SOLANA: wallet,
    FEE_WALLET_KEY_SOLANA: keypair,
    RPC_URL_SOLANA: RPC,
    // Harness limits for a local chain only; production limits come from
    // the reviewed wrangler.toml.
    FEE_CONVERTER_MIN_VALUE_MICRO: "1000000",
    FEE_CONVERTER_GAS_MULTIPLE: "10",
    FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
    FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
    FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
    FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
    FEE_CONVERTER_ALLOWLIST: JSON.stringify({ solana: [JUP] }),
  };
  const overrides = {
    fetch: pinnedRoute,
    localBlockhash: true,
    allowSolanaLive: true,
  };
  const state = () =>
    sqlite
      .query(
        "SELECT state, reason FROM fee_conversions ORDER BY rowid DESC LIMIT 1",
      )
      .get() as {
      state: string;
      reason: string | null;
    };
  console.log(
    "run 1:",
    JSON.stringify(await runOnce(env, undefined, overrides)),
    state(),
  );
  if (state().state !== "submitted") throw new Error("send was not submitted");
  for (let i = 0; i < 60 && state().state === "submitted"; i++) {
    await Bun.sleep(2_000);
    await runOnce(env, undefined, overrides);
  }
  const rows = sqlite
    .query(
      "SELECT state, amount_in, quote_amount_out, min_amount_out, amount_out, tx_id, expires_at, reason FROM fee_conversions",
    )
    .all() as { state: string; amount_out: string | null }[];
  console.log(JSON.stringify(rows, null, 2));
  const usdc = await rpc<{ value: { amount: string } }>(
    "getTokenAccountBalance",
    [associatedTokenAccount(wallet, USDC)],
  );
  const jupLeft = await rpc<{ value: { amount: string } }>(
    "getTokenAccountBalance",
    [jupAccount],
  );
  console.log(
    `local USDC ${usdc.value.amount}; JUP left ${jupLeft.value.amount}`,
  );
  if (
    rows.length !== 1 ||
    rows[0].state !== "finalized" ||
    rows[0].amount_out !== usdc.value.amount ||
    jupLeft.value.amount !== "0"
  )
    throw new Error(
      "Solana local live cycle did not finalize with matching proceeds",
    );
  await runOnce(env, undefined, overrides);
  const count = sqlite
    .query("SELECT COUNT(*) AS n FROM fee_conversions")
    .get() as { n: number };
  if (count.n !== 1) throw new Error("a repeat run added a record");
  console.log("PASS: Solana local live cycle");
} finally {
  validator.kill();
}
