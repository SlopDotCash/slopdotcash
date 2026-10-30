// Live cycle against a local solana-test-validator with a throwaway keypair.
// The validator clones the public programs, lookup tables and accounts of
// one current Jupiter route. Only a throwaway funder receives seeded tokens;
// a real local token transfer funds the fee wallet. No mainnet token moves.
// SLOP_FEE_TEST_TOKEN=pmup selects the owner-approved Token-2022 mint.
// SLOP_FEE_TEST_TOKEN=sol creates a native escrow, claims its earned SOL fees,
// and proves the exact atomic wrap and USDC swap without spending gas topups.
//   bun workers/fee-converter/solana-local.integration.ts

import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import { inspectMintAccount } from "../../contracts/solana/token";
import {
  ata,
  concat,
  createAta,
  le,
  message,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { runOnce } from "./index";
import { parseTransaction } from "./solana";
import { resolveSolanaAccounts } from "./solana-accounts";
import { WRAPPED_SOL } from "./solana-native-route";

const selected = process.env.SLOP_FEE_TEST_TOKEN ?? "jup";
if (selected !== "jup" && selected !== "pmup" && selected !== "sol")
  throw new Error("Select jup, pmup or sol");
const nativeInput = selected === "sol";
const INPUT_MINT = nativeInput
  ? WRAPPED_SOL
  : selected === "pmup"
    ? "35fWL6pdJqpconRZPrawUAQegw1QF3p2tgN7mzhTpump"
    : "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
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
const JUPITER_API = "https://api.jup.ag/swap/v1";
const PORT = Number(process.env.SLOP_FEE_TEST_PORT ?? "28899");
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65000)
  throw new Error("Invalid local validator port");
const RPC = `http://127.0.0.1:${PORT}`;
const AMOUNT = nativeInput
  ? 100_000_000n
  : selected === "pmup"
    ? 30_000_000_000n
    : 30_000_000n;
// A native claim costs 5,000 lamports and the next send reserves 5,000,000.
// The actual claim receipt must prove that exact remainder before we quote it.
const NATIVE_FEES = AMOUNT + 5_005_000n;
const quoteCache = new Map<string, unknown>();
let capturedSwap: unknown;
let capturedQuote: unknown;
let capturedWallet = "";
let captureComplete = false;
// Capture real provider responses before cloning. Replay only exact requests
// during local execution, so changing market routes cannot escape the snapshot.
const pinnedRoute: typeof fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = new URL(String(input));
  if (url.href.startsWith(`${JUPITER_API}/quote?`)) {
    url.searchParams.set("asLegacyTransaction", "false");
    url.searchParams.set("instructionVersion", "V2");
    if (selected === "jup" || nativeInput) {
      url.searchParams.set("dexes", "Whirlpool");
      url.searchParams.set("onlyDirectRoutes", "true");
    } else {
      // Stable on-chain AMMs survive local snapshot startup; expiring RFQ
      // oracle prices do not. This restriction belongs only to this harness.
      url.searchParams.set("dexes", "Pump.fun Amm,Whirlpool");
    }
    url.searchParams.sort();
    const cached = quoteCache.get(url.href);
    if (cached) return Response.json(cached);
    if (
      captureComplete &&
      url.searchParams.get("inputMint") === INPUT_MINT &&
      (!nativeInput ||
        BigInt(url.searchParams.get("amount") ?? "0") > NATIVE_FEES)
    )
      throw new Error("Uncaptured input route request after local snapshot");
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`Jupiter quote HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(String(body.error));
    quoteCache.set(url.href, body);
    return Response.json(body);
  }
  if (url.href === `${JUPITER_API}/swap` && typeof init?.body === "string") {
    const body = JSON.parse(init.body);
    if (capturedSwap) {
      if (
        JSON.stringify(body.quoteResponse) !== JSON.stringify(capturedQuote) ||
        body.userPublicKey !== capturedWallet ||
        body.asLegacyTransaction !== false ||
        (selected === "pmup" && body.useSharedAccounts !== true)
      )
        throw new Error("Swap differs from the captured local route");
      return Response.json(capturedSwap);
    }
    const response = await fetch(url, {
      ...init,
      body: JSON.stringify({
        ...body,
        asLegacyTransaction: false,
        dynamicComputeUnitLimit: false,
        skipUserAccountsRpcCalls: true,
      }),
    });
    if (!response.ok) throw new Error(`Jupiter swap HTTP ${response.status}`);
    capturedSwap = await response.json();
    capturedQuote = body.quoteResponse;
    capturedWallet = body.userPublicKey;
    return Response.json(capturedSwap);
  }
  const response = await fetch(input, init);
  if (
    url.origin === RPC &&
    typeof init?.body === "string" &&
    JSON.parse(init.body).method === "simulateTransaction"
  ) {
    const details = await response.clone().json();
    if (details.result?.value?.err || details.error)
      writeFileSync(
        join(dir, "failed-simulation.json"),
        JSON.stringify(details, null, 2),
      );
  }
  return response;
}) as typeof fetch;
async function mainnetRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error || body.result === undefined)
    throw new Error(`Mainnet snapshot failed: ${method}`);
  return body.result;
}

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
const fundingSeed = crypto.getRandomValues(new Uint8Array(32));
const fundingWallet = solanaBase58(ed25519.getPublicKey(fundingSeed));
const mintState = await mainnetRpc<{ value: unknown }>("getAccountInfo", [
  INPUT_MINT,
  { encoding: "base64", commitment: "finalized" },
]);
const tokenProgram = inspectMintAccount(
  mintState.value,
  INPUT_MINT,
).tokenProgram;
const fundingAccount = ata(INPUT_MINT, fundingWallet, tokenProgram);
console.log(`throwaway ${selected} fee wallet ${wallet}`);

await pinnedRoute(
  `${JUPITER_API}/quote?inputMint=${INPUT_MINT}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=100&swapMode=ExactIn&restrictIntermediateTokens=true`,
);
// Learn the route's accounts from an unsigned Jupiter transaction for this wallet.
const quote = await (
  await pinnedRoute(
    `${JUPITER_API}/quote?inputMint=${INPUT_MINT}&outputMint=${USDC}&amount=${AMOUNT}&slippageBps=50&swapMode=ExactIn&restrictIntermediateTokens=true`,
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
      asLegacyTransaction: false,
      ...(selected === "pmup" ? { useSharedAccounts: true } : {}),
    }),
  })
).json()) as { swapTransaction: string };
const raw = solanaBase64Bytes(built.swapTransaction);
const parsed = parseTransaction(raw);
const proof = await resolveSolanaAccounts(raw, parsed, mainnetRpc);
const jupAccount = ata(INPUT_MINT, wallet, tokenProgram);
const candidateKeys = [
  ...new Set([
    ...proof.keys,
    ...proof.tables.map((t) => t.address),
    INPUT_MINT,
    USDC,
  ]),
].filter((key) => key !== wallet && key !== jupAccount && !BUILTIN.has(key));
const snapshot = await mainnetRpc<{
  context: { slot: number };
  value: ({
    executable: boolean;
    owner: string;
    lamports: number;
    data: [string, string];
    rentEpoch: number;
  } | null)[];
}>("getMultipleAccounts", [
  candidateKeys,
  { commitment: "finalized", encoding: "base64" },
]);
const programs = candidateKeys.filter((_, i) => snapshot.value[i]?.executable);
if (!programs.includes(JUPITER))
  throw new Error("Snapshot has no executable Jupiter program");
const tableKeys = new Set(proof.tables.map((table) => table.address));
const clones = candidateKeys.filter(
  (key, i) => !snapshot.value[i]?.executable && !tableKeys.has(key),
);
captureComplete = true;
console.log(
  `route ${quote.routePlan?.[0]?.swapInfo?.ammKey}; cloning ${clones.length} accounts`,
);

const dir = mkdtempSync(join(tmpdir(), "fee-converter-solana-"));
const nativeFixture = nativeInput
  ? await import(
      new URL(
        "../../contracts/solana/integration/fee-converter-native-fixture.mjs",
        import.meta.url,
      ).href
    )
  : null;
const nativeGenesis =
  nativeFixture?.nativeFixtureGenesis(dir, [
    ...fundingSeed,
    ...ed25519.getPublicKey(fundingSeed),
  ]) ?? [];
writeFileSync(
  join(dir, "route-evidence.json"),
  JSON.stringify(
    {
      selected,
      wallet,
      tokenProgram,
      quote,
      built,
      proof,
      snapshot,
      candidateKeys,
      programs,
      clones,
    },
    null,
    2,
  ),
);
console.log(`local evidence ${dir}`);
// Local bank slots start at zero. Preserve the captured lookup addresses,
// authority and deactivation state, but rebase only extension timing so the
// table is warm locally without warping oracle clocks years into the future.
// Normalize the local fixture rent epoch; RPC u64::MAX cannot round-trip
// through JSON.parse/stringify as a safe JavaScript integer.
const tableFiles = proof.tables.flatMap((table, i) => {
  const original = snapshot.value[candidateKeys.indexOf(table.address)];
  if (!original) throw new Error("Captured lookup table account is missing");
  const data = solanaBase64Bytes(original.data[0]);
  new DataView(data.buffer, data.byteOffset).setBigUint64(12, 0n, true);
  data[20] = 0;
  const path = join(dir, `lookup-${i}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      pubkey: table.address,
      account: {
        ...original,
        rentEpoch: 0,
        data: [solanaBase64(data), "base64"],
      },
    }),
  );
  return ["--account", table.address, path];
});
const accountFile = join(dir, "jup-account.json");
writeFileSync(
  accountFile,
  JSON.stringify({
    pubkey: fundingAccount,
    account: {
      lamports: 2_039_280,
      data: [tokenAccount(INPUT_MINT, fundingWallet, AMOUNT), "base64"],
      owner: tokenProgram,
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
    ...programs.flatMap((key) => ["--clone-upgradeable-program", key]),
    ...clones.flatMap((key) => ["--maybe-clone", key]),
    ...tableFiles,
    ...(nativeInput
      ? nativeGenesis
      : ["--account", fundingAccount, accountFile]),
  ],
  {
    stdout: Bun.file(join(dir, "validator.stdout.log")),
    stderr: Bun.file(join(dir, "validator.stderr.log")),
  },
);
try {
  for (let i = 0; ; i++) {
    if (validator.exitCode !== null)
      throw new Error(
        `Local validator exited ${validator.exitCode}; see ${dir}/validator.stderr.log and validator.stdout.log`,
      );
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

  for (const mint of [INPUT_MINT, USDC]) {
    const info = await rpc<{ value: { owner: string } | null }>(
      "getAccountInfo",
      [mint, { encoding: "base64" }],
    );
    if (!info.value) throw new Error(`mint ${mint} was not cloned`);
  }
  // A real local SPL transfer creates the receipt. Only the funder's initial
  // token account is seeded; the fee wallet starts without a JUP account.
  const funded = await rpc<string>("requestAirdrop", [
    fundingWallet,
    nativeInput ? 20_000_000_000 : 100000000,
  ]);
  async function finalized(signature: string) {
    for (let i = 0; i < 120; i++) {
      const state = await rpc<{
        value: ({ err: unknown; confirmationStatus: string } | null)[];
      }>("getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]);
      if (state.value[0]?.confirmationStatus === "finalized") {
        if (state.value[0].err !== null)
          throw new Error("local receipt transaction failed");
        return;
      }
      await Bun.sleep(500);
    }
    throw new Error("local receipt transaction did not finalize");
  }
  await finalized(funded);
  const nativeProject = nativeFixture
    ? await nativeFixture.createNativeFeeFixture(
        RPC,
        [...fundingSeed, ...ed25519.getPublicKey(fundingSeed)],
        wallet,
        NATIVE_FEES.toString(),
      )
    : null;
  if (!nativeInput) {
    const latest = await rpc<{ value: { blockhash: string } }>(
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    );
    const incoming = message(fundingWallet, latest.value.blockhash, [
      createAta(fundingWallet, INPUT_MINT, wallet, tokenProgram),
      {
        program: tokenProgram,
        accounts: [
          { key: fundingAccount, write: true },
          { key: jupAccount, write: true },
          { key: fundingWallet, write: false },
        ],
        data: concat(Uint8Array.of(3), le(AMOUNT)),
      },
    ]);
    const receiptSignature = await rpc<string>("sendTransaction", [
      btoa(
        String.fromCharCode(
          ...concat(
            Uint8Array.of(1),
            ed25519.sign(incoming, fundingSeed),
            incoming,
          ),
        ),
      ),
      { encoding: "base64", preflightCommitment: "confirmed" },
    ]);
    await finalized(receiptSignature);
    const received = await rpc<{ value: { amount: string } }>(
      "getTokenAccountBalance",
      [jupAccount],
    );
    if (received.value.amount !== AMOUNT.toString())
      throw new Error(
        "local fee wallet did not receive the intended SPL receipt",
      );
    console.log(
      JSON.stringify({
        check: "actual local SPL receipt",
        receiptSignature,
        amount: received.value.amount,
        mainnet: false,
      }),
    );
  }
  const databasePath = join(dir, "journal.sqlite");
  let { db, sqlite } = sqliteD1(undefined, databasePath);
  const env = {
    FEE_DB: db,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "solana",
    FEE_WALLET_SOLANA: wallet,
    FEE_WALLET_KEY_SOLANA: keypair,
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
      solana: {
        perTransaction: "5000000",
        perDay: "20000000",
        additionalFeeReserve: "0",
      },
    }),
    JUPITER_API_URL: JUPITER_API,
    RPC_URL_SOLANA: RPC,
    // Harness limits for a local chain only; production limits come from
    // the reviewed wrangler.toml.
    FEE_CONVERTER_MIN_VALUE_MICRO: "1000000",
    FEE_CONVERTER_GAS_MULTIPLE: "10",
    FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
    FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
    FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
    FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
    FEE_CONVERTER_ALLOWLIST: JSON.stringify({
      solana: [nativeInput ? SOLANA_NATIVE_ASSET : INPUT_MINT],
    }),
  };
  const overrides = {
    fetch: pinnedRoute,
    localBlockhash: true,
    ...(nativeInput
      ? { localGenesisHash: await rpc<string>("getGenesisHash", []) }
      : {}),
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
  if (nativeProject) {
    await runOnce(env, undefined, overrides);
    if (
      (
        sqlite.query("SELECT COUNT(*) AS n FROM fee_conversions").get() as {
          n: number;
        }
      ).n !== 0
    )
      throw new Error("A wallet gas topup became native fee income");
    const manifest = JSON.stringify({
      id: nativeProject.projectId,
      status: "active",
      escrow: { deployments: [nativeProject.deployment] },
    });
    const digest = createHash("sha256").update(manifest).digest("hex");
    const timestamp = new Date().toISOString();
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
      )
      .run(
        nativeProject.projectId,
        manifest,
        digest,
        "local native fee proof",
        timestamp,
      );
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
      )
      .run(nativeProject.projectId, manifest, digest, timestamp, timestamp);
    const [claimed] = await runOnce(env, undefined, overrides);
    console.log("native claim:", JSON.stringify(claimed));
    if (claimed.claimed !== 1)
      throw new Error("Native fee claim was not submitted");
    for (let i = 0; i < 80; i++) {
      await Bun.sleep(1000);
      await runOnce(env, undefined, overrides);
      const claim = sqlite
        .query(
          "SELECT state, amount_out FROM fee_conversions WHERE kind='claim'",
        )
        .get() as { state: string; amount_out: string | null } | null;
      const conversion = sqlite
        .query("SELECT state FROM fee_conversions WHERE kind='conversion'")
        .get();
      if (conversion) break;
      if (
        claim?.state === "finalized" &&
        claim.amount_out !== NATIVE_FEES.toString()
      )
        throw new Error("Native claim amount does not match the real fee");
    }
  }
  console.log(
    "run 1 (receipt trigger):",
    JSON.stringify(await runOnce(env, undefined, overrides, "receipts")),
    state(),
  );
  if (state().state !== "submitted") throw new Error("send was not submitted");
  // Drop the database connection and every client from the send run. The
  // next run must recover its signature, route proof and limits from disk.
  sqlite.close();
  ({ db, sqlite } = sqliteD1([], databasePath));
  env.FEE_DB = db;
  for (let i = 0; i < 60 && state().state === "submitted"; i++) {
    await Bun.sleep(2_000);
    await runOnce(env, undefined, overrides);
  }
  const rows = sqlite
    .query(
      "SELECT state, amount_in, quote_amount_out, min_amount_out, amount_out, tx_id, expires_at, reason FROM fee_conversions WHERE kind='conversion'",
    )
    .all() as { state: string; amount_in: string; amount_out: string | null }[];
  console.log(JSON.stringify(rows, null, 2));
  const usdc = await rpc<{ value: { amount: string } }>(
    "getTokenAccountBalance",
    [ata(USDC, wallet)],
  );
  const jupLeft = await rpc<{ value: { amount: string } }>(
    "getTokenAccountBalance",
    [jupAccount],
  );
  console.log(
    `local USDC ${usdc.value.amount}; input left ${jupLeft.value.amount}`,
  );
  if (
    rows.length !== 1 ||
    rows[0].state !== "finalized" ||
    (nativeInput && rows[0].amount_in !== AMOUNT.toString()) ||
    rows[0].amount_out !== usdc.value.amount ||
    jupLeft.value.amount !== "0"
  )
    throw new Error(
      "Solana local live cycle did not finalize with matching proceeds",
    );
  await runOnce(env, undefined, overrides);
  const count = sqlite
    .query("SELECT COUNT(*) AS n FROM fee_conversions WHERE kind='conversion'")
    .get() as { n: number };
  if (count.n !== 1) throw new Error("a repeat run added a record");
  const native = sqlite
    .query(
      "SELECT tx_id,maximum_wei,actual_wei FROM fee_native_gas WHERE state='signed' ORDER BY rowid",
    )
    .all() as {
    tx_id: string;
    maximum_wei: string;
    actual_wei: string | null;
  }[];
  if (
    native.length !== (nativeInput ? 2 : 1) ||
    native.some((row) => row.actual_wei === null)
  )
    throw new Error("Solana native cost did not reconcile through its journal");
  const swapCost = native.at(-1);
  if (!swapCost || swapCost.actual_wei === null)
    throw new Error("Missing finalized swap cost");
  const receipt = await rpc<{
    meta: { preBalances: number[]; postBalances: number[]; fee: number };
  }>("getTransaction", [
    swapCost.tx_id,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  const debit =
    BigInt(receipt.meta.preBalances[0]) -
    BigInt(receipt.meta.postBalances[0]) -
    (nativeInput ? AMOUNT : 0n);
  if (
    BigInt(swapCost.actual_wei) !== debit ||
    debit < BigInt(receipt.meta.fee) ||
    debit > BigInt(swapCost.maximum_wei)
  )
    throw new Error(
      "Solana native cost differs from the canonical fee-payer debit",
    );
  console.log(
    JSON.stringify({
      check: "Solana native budget finalized cost",
      reservedLamports: swapCost.maximum_wei,
      actualLamports: swapCost.actual_wei,
      networkFeeLamports: receipt.meta.fee,
    }),
  );
  if (nativeProject) await nativeProject.assertPrincipal();
  console.log(
    `PASS: ${selected} Solana local live cycle (${parsed.legacy ? "legacy" : "v0"}, ${proof.tables.length} lookup tables)`,
  );
} finally {
  validator.kill();
}
