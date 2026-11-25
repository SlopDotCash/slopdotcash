// The Worker's Solana ledger against the real `slop-submission-deposits`
// program on a local validator. It loads the locally built program at the
// IDL's address, initializes it, opens a vault for a local six-decimal mint,
// makes real deposits with the same instruction the pay page builds, and
// runs the Worker's real reader, resolver and store against the validator's
// JSON-RPC. Throwaway keys made here only; nothing can reach a public
// cluster, and no keypair file on this machine is read.
//
//   (cd contracts/solana && cargo build-sbf \
//      --manifest-path programs/slop-submission-deposits/Cargo.toml \
//      --tools-version v1.52 -- --locked)
//   bun workers/submission-fee/solana-local.integration.ts
//
// It runs the `solana-test-validator` on PATH, not the pinned container
// image, so its result is not evidence for the pinned validator version.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaAssociatedTokenAddress as ata,
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaProgramAddress,
  solanaPublicKeyBytes,
} from "../../contracts/solana/adapter";
import idl from "../../contracts/solana/idl/slop_submission_deposits.json" with {
  type: "json",
};
import {
  depositInstruction,
  reclaimInstruction,
  submissionConfigAddress,
  submissionDepositAddress,
  submissionInstruction,
  submissionLedgerAddress,
  submissionVaultAddress,
} from "../../contracts/solana/submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "../../contracts/solana/token";
import {
  concat,
  type Instruction,
  message,
} from "../../contracts/solana/transactions";
import { submissionFeeItem } from "../../src/lib/submission-fee.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { parseSolanaConfig } from "./config";
import { type Env, runDeposits } from "./index";
import type { SubmissionFeeD1Database } from "./store";

const PORT = Number(process.env.SLOP_FEE_SOLANA_TEST_PORT ?? "19899");
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65000)
  throw new Error("Invalid local validator port");
const RPC = `http://127.0.0.1:${PORT}`;
const PROGRAM = idl.address;
const SO = resolve(
  import.meta.dir,
  "../../contracts/solana/target/deploy/slop_submission_deposits.so",
);
if (!existsSync(SO))
  throw new Error("Build the program first; see the top of this file.");
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const NETWORK = "solana-mainnet";
const REPOSITORY = 4242;
const FEE = 2_000_000n;

const key = () => {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return { seed, address: solanaBase58(ed25519.getPublicKey(seed)) };
};
const authority = key();
const owner = key();
const resolver = key();
const payerA = key();
const payerB = key();
const feeWallet = key();
const mint = key().address;

const scratch = mkdtempSync(join(tmpdir(), "slop-fee-solana-"));
const accounts: string[] = [];
function preload(address: string, programOwner: string, data: Uint8Array) {
  const path = join(scratch, `${address}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      pubkey: address,
      account: {
        lamports: 10_000_000_000,
        data: [solanaBase64(data), "base64"],
        owner: programOwner,
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    }),
  );
  accounts.push("--account", address, path);
}
const u64 = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};
// A classic SPL mint with six decimals and no authorities.
const mintData = new Uint8Array(82);
mintData.set(u64(1_000_000_000n), 36);
mintData[44] = 6;
mintData[45] = 1;
preload(mint, CLASSIC_TOKEN_PROGRAM, mintData);
function tokenAccount(wallet: string, amount: bigint) {
  const data = new Uint8Array(165);
  data.set(solanaPublicKeyBytes(mint), 0);
  data.set(solanaPublicKeyBytes(wallet), 32);
  data.set(u64(amount), 64);
  data[108] = 1;
  preload(ata(mint, wallet), CLASSIC_TOKEN_PROGRAM, data);
}
tokenAccount(payerA.address, 100_000_000n);
tokenAccount(feeWallet.address, 0n);
// Payer B holds USDC in a token account that is not the associated one, so
// a refund to B has nowhere to go.
const strayB = key().address;
{
  const data = new Uint8Array(165);
  data.set(solanaPublicKeyBytes(mint), 0);
  data.set(solanaPublicKeyBytes(payerB.address), 32);
  data.set(u64(10_000_000n), 64);
  data[108] = 1;
  preload(strayB, CLASSIC_TOKEN_PROGRAM, data);
}
for (const wallet of [owner, resolver, payerA, payerB])
  preload(wallet.address, SYSTEM, new Uint8Array(0));

let validator: ChildProcess | null = null;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Signs and sends one transaction and waits until it is finalized. */
async function send(
  signer: { seed: Uint8Array; address: string },
  list: Instruction[],
) {
  const latest = await rpc<{ value: { blockhash: string } }>(
    "getLatestBlockhash",
    [{ commitment: "finalized" }],
  );
  const body = message(signer.address, latest.value.blockhash, list);
  const signature = ed25519.sign(body, signer.seed);
  const id = await rpc<string>("sendTransaction", [
    solanaBase64(concat(Uint8Array.of(1), signature, body)),
    { encoding: "base64", preflightCommitment: "finalized" },
  ]);
  await finalized(id);
  return id;
}
async function finalized(signature: string) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const status = (
      await rpc<{
        value: ({ err: unknown; confirmationStatus: string } | null)[];
      }>("getSignatureStatuses", [[signature]])
    ).value[0];
    if (status?.err) throw new Error(`${signature} failed`);
    if (status?.confirmationStatus === "finalized") return;
    await sleep(500);
  }
  throw new Error(`${signature} was not finalized`);
}
const balance = async (wallet: string) =>
  BigInt(
    (
      await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [
        ata(mint, wallet),
        { commitment: "finalized" },
      ])
    ).value.amount,
  );
const exists = async (address: string) =>
  (
    await rpc<{ value: unknown }>("getAccountInfo", [
      address,
      { commitment: "finalized", encoding: "base64" },
    ])
  ).value !== null;
const check = (condition: boolean, what: string) => {
  if (!condition) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
};

async function main() {
  validator = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      join(scratch, "ledger"),
      "--bind-address",
      "127.0.0.1",
      "--rpc-port",
      String(PORT),
      "--faucet-port",
      String(PORT + 41),
      "--gossip-port",
      String(PORT + 32),
      "--dynamic-port-range",
      `${PORT + 2}-${PORT + 31}`,
      // Names the mint key, so the validator reads no default keypair file.
      "--mint",
      authority.address,
      "--upgradeable-program",
      PROGRAM,
      SO,
      authority.address,
      ...accounts,
    ],
    { stdio: "ignore" },
  );
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await rpc<string>("getHealth")) === "ok") break;
    } catch {
      if (attempt > 120) throw new Error("The local validator did not start");
    }
    await sleep(500);
  }
  // A program loaded at genesis is callable only after its deployment slot.
  while ((await rpc<number>("getSlot", [{ commitment: "finalized" }])) < 2)
    await sleep(500);
  const genesisHash = await rpc<string>("getGenesisHash");
  console.log(`validator ready on ${RPC}`);

  // The deployment: initialize (30 days), then the mint's vault.
  await send(authority, [
    submissionInstruction(
      PROGRAM,
      "initialize",
      {
        authority: authority.address,
        config: submissionConfigAddress(PROGRAM),
        program_data: solanaProgramAddress(LOADER, [
          solanaPublicKeyBytes(PROGRAM),
        ]),
      },
      {
        owner: owner.address,
        resolver: resolver.address,
        reclaim_delay: 2_592_000n,
      },
    ),
  ]);
  await send(authority, [
    submissionInstruction(PROGRAM, "open_vault", {
      funder: authority.address,
      mint,
      ledger: submissionLedgerAddress(PROGRAM, mint),
      vault: submissionVaultAddress(PROGRAM, mint),
    }),
  ]);
  console.log("program initialized, vault open");

  const { db, sqlite } = sqliteD1();
  const env: Env = {
    SUBMISSION_FEE_DB: db as unknown as SubmissionFeeD1Database,
    SUBMISSION_FEE_MODE: "off",
    SUBMISSION_FEE_SOLANA_MODE: "live",
    SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_TX: "20000",
    SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_DAY: "2000000",
    RPC_URL_SUBMISSION_FEE_SOLANA: RPC,
    SUBMISSION_FEE_SOLANA_RESOLVER_SEED: [...resolver.seed]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
  const logs: Record<string, unknown>[] = [];
  const run = async () => {
    const errors: unknown[] = [];
    const result = await runDeposits(env, () => new Date(), {
      solanaConfig: () =>
        parseSolanaConfig(env, {
          network: NETWORK,
          programId: PROGRAM,
          startSlot: 0,
          mint,
          feeWallet: feeWallet.address,
          genesisHash,
        }),
      log: (event) => logs.push(event),
      onError: (error) => errors.push(error),
    });
    if (errors.length > 0) throw errors[0];
    if (result.status !== "ran") throw new Error(result.status);
    return result.networks[0] as Record<string, unknown>;
  };
  const ask = (pull: number) =>
    sqlite
      .query(
        "INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at) VALUES (?, ?, 'acme', ?, '2000000', ?)",
      )
      .run(
        REPOSITORY,
        pull,
        submissionFeeItem(REPOSITORY, pull),
        new Date().toISOString(),
      );
  const decide = (pull: number, outcome: string) =>
    sqlite
      .query(
        "UPDATE submission_fee_items SET outcome = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .run(outcome, REPOSITORY, pull);
  const row = (id: number) =>
    sqlite
      .query(
        "SELECT * FROM submission_fee_deposits WHERE network = ? AND deposit_id = ?",
      )
      .get(NETWORK, id) as Record<string, unknown> | null;
  const item = (pull: number) =>
    sqlite
      .query(
        "SELECT * FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?",
      )
      .get(REPOSITORY, pull) as Record<string, unknown>;
  const sends = () =>
    sqlite
      .query("SELECT * FROM submission_fee_solana_sends ORDER BY rowid")
      .all() as Record<string, unknown>[];
  /** The pay page's own instruction, signed by the payer. */
  const pay = (
    payer: { seed: Uint8Array; address: string },
    pull: number,
    nonce: bigint,
    source = ata(mint, payer.address),
  ) =>
    send(payer, [
      depositInstruction({
        programId: PROGRAM,
        payer: payer.address,
        mint,
        source,
        item: submissionFeeItem(REPOSITORY, pull),
        amount: FEE,
        keptTo: feeWallet.address,
        nonce,
      }),
    ]);
  /** Runs the Worker until its one send is finalized and recorded. */
  const settle = async () => {
    const sent = await run();
    check(sent.send === "sent", "the Worker signed and sent one transaction");
    const signature = sends().at(-1)?.tx_id as string;
    await finalized(signature);
    const after = await run();
    return { signature, after };
  };

  // 1. A deposit is read from its account and pays its pull request.
  for (const pull of [7, 8, 9, 10, 11, 12, 13, 14]) ask(pull);
  const first = await pay(payerA, 7, 5n);
  const recordA = submissionDepositAddress(PROGRAM, payerA.address, 5n);
  let result = await run();
  check(
    result.recorded === 1 && result.paid === 1,
    "deposit 1 recorded and its pull request paid",
  );
  check(
    row(1)?.tx_hash === first && row(1)?.deposit_account === recordA,
    "its creating signature and record address are stored",
  );
  check(
    row(1)?.payer === payerA.address && row(1)?.token === mint,
    "payer and mint read from the record",
  );

  // 2. A merge: the refund goes to the payer's associated account.
  const before = await balance(payerA.address);
  decide(7, "refund_due");
  let settled = await settle();
  check(
    row(1)?.state === "refunded" && row(1)?.resolve_tx === settled.signature,
    "deposit 1 recorded as refunded from its closing transaction",
  );
  check(item(7).outcome === "refunded", "pull request 7 refunded");
  check(
    (await balance(payerA.address)) === before + FEE,
    "the payer's USDC account rose by the fee",
  );
  check(!(await exists(recordA)), "the record account is closed");

  // 3. The same payer and nonce again: the same address, a new id. It is kept.
  const second = await pay(payerA, 8, 5n);
  result = await run();
  check(
    row(2)?.deposit_account === recordA && row(2)?.tx_hash === second,
    "deposit 2 at the reused address has its own creating transaction",
  );
  check(row(1)?.state === "refunded", "deposit 1 keeps its own outcome");
  decide(8, "kept_due");
  settled = await settle();
  check(
    row(2)?.state === "kept" && row(2)?.resolve_tx === settled.signature,
    "deposit 2 recorded as kept, from the first settlement after its creation",
  );
  check(item(8).outcome === "kept", "pull request 8 kept");
  check(
    (await balance(feeWallet.address)) === FEE,
    "the fee wallet's USDC account holds the kept fee",
  );

  // 4. A payer without an associated USDC account: parked, never created.
  await pay(payerB, 9, 1n, strayB);
  result = await run();
  check(row(3)?.accepted === 1, "deposit 3 from a stray token account counts");
  decide(9, "refund_due");
  result = await run();
  check(
    result.send === "parked" && result.parked === 1,
    "its refund is parked: the payer has no associated USDC account",
  );
  check(
    !(await exists(ata(mint, payerB.address))),
    "the Worker created no token account",
  );

  // 5. A full batch: five refunds in one transaction, with its measured cost.
  for (const [index, pull] of [10, 11, 12, 13, 14].entries())
    await pay(payerA, pull, BigInt(100 + index));
  result = await run();
  check(
    result.recorded === 5 && result.paid === 5,
    "five more deposits recorded",
  );
  for (const pull of [10, 11, 12, 13, 14]) decide(pull, "refund_due");
  settled = await settle();
  const batch = sends().at(-1) as Record<string, unknown>;
  check(
    JSON.parse(batch.deposits as string).length === 5,
    "one transaction carried five resolves",
  );
  const receipt = await rpc<{
    meta: { computeUnitsConsumed: number; fee: number };
  }>("getTransaction", [
    settled.signature,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  const bytes = solanaBase64Bytes(batch.raw_tx as string).length;
  console.log(
    `  measured: 5 resolves = ${bytes} bytes, ${receipt.meta.computeUnitsConsumed} compute units, fee ${receipt.meta.fee} lamports`,
  );
  check(
    bytes <= 1232 && receipt.meta.computeUnitsConsumed < 1_000_000,
    "the batch fits a transaction and the default compute allowance",
  );
  check(
    [4, 5, 6, 7, 8].every((id) => row(id)?.state === "refunded"),
    "all five recorded as refunded",
  );

  // 6. A reclaim before the delay is refused by the program itself.
  let refused = false;
  try {
    await send(payerB, [
      reclaimInstruction({
        programId: PROGRAM,
        payer: payerB.address,
        deposit: submissionDepositAddress(PROGRAM, payerB.address, 1n),
        mint,
        destination: strayB,
      }),
    ]);
  } catch {
    refused = true;
  }
  check(
    refused,
    "the page's reclaim instruction is well formed and refused before the 30 days",
  );
  check(row(3)?.state === "refund_due", "deposit 3 is still due and open");
  console.log("PASS");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => validator?.kill("SIGTERM"));
