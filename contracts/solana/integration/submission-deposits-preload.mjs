/** Genesis accounts of the submission deposit stages: the exact program bytes with canonical
 * upgradeable-loader metadata (as program-genesis.mjs does for the escrow) and, for the
 * rehearsal stage, states a live validator cannot reach: a mint at the mainnet USDC address
 * and two deposits made about thirty days ago. Synthetic local state; never a mainnet write.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  addresses,
  BPF_UPGRADEABLE_LOADER,
  context,
  fixtureKey,
  localPayer,
  PRODUCTION_DELAY,
  PROGRAM_NAME,
  PROGRAM_PATH,
  programId,
} from "./submission-deposits.mjs";

/** Circle's USDC mint on Solana mainnet. Here it is local bytes with local authorities. */
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
/** Slop's Solana fee wallet (contracts/DEPLOY-MAINNET.md). Only its address is used. */
export const FEE_WALLET = new PublicKey(
  "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
);
export const usdcAuthority = fixtureKey("usdc-mint-and-freeze-authority");
export const agedMint = fixtureKey("aged-mint").publicKey;
export const agedPayer = fixtureKey("aged-payer");
export const agedKept = fixtureKey("aged-kept").publicKey;
/** Ids far above anything the stage creates, so live deposits never meet them. */
export const AGED_REACHED = 9_000_000_001n;
export const AGED_EARLY = 9_000_000_002n;
export const AGED_AMOUNT = 2_000_000n;

const stage = process.argv[2];
const output = [];
function account(label, address, owner, data, executable = false) {
  const path = `.local/submission-deposits-${label}.json`;
  writeFileSync(
    path,
    JSON.stringify({
      pubkey: address.toBase58(),
      account: {
        // Local genesis funds only, comfortably above rent.
        lamports: executable || label === "program-data" ? 100_000_000_000 : 10_000_000,
        data: [data.toString("base64"), "base64"],
        owner: owner.toBase58(),
        executable,
        rentEpoch: 0,
        space: data.length,
      },
    }),
  );
  output.push(`--account ${address.toBase58()} ${path}`);
}

function mint({ authority, supply }) {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: authority,
      supply,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 1,
      freezeAuthority: authority,
    },
    data,
  );
  return data;
}

function tokenAccount({ mint: ofMint, owner, amount }) {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: ofMint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return data;
}

async function main() {
  if (stage !== "rehearsal" && stage !== "lifecycle")
    throw new Error("Usage: submission-deposits-preload.mjs rehearsal|lifecycle");
  mkdirSync(".local", { recursive: true });
  const programData = addresses.programData();
  const pointer = Buffer.alloc(36);
  pointer.writeUInt32LE(2);
  programData.toBuffer().copy(pointer, 4);
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3);
  header[12] = 1;
  localPayer().publicKey.toBuffer().copy(header, 13);
  account("program", programId, BPF_UPGRADEABLE_LOADER, pointer, true);
  account(
    "program-data",
    programData,
    BPF_UPGRADEABLE_LOADER,
    Buffer.concat([header, readFileSync(PROGRAM_PATH)]),
  );
  if (stage === "rehearsal") {
    const coder = context.program.coder.accounts;
    const { BN } = anchor;
    const now = Math.floor(Date.now() / 1000);
    account(
      "usdc-mint",
      USDC_MINT,
      TOKEN_PROGRAM_ID,
      mint({ authority: usdcAuthority.publicKey, supply: 0n }),
    );
    account(
      "aged-mint",
      agedMint,
      TOKEN_PROGRAM_ID,
      mint({ authority: usdcAuthority.publicKey, supply: 2n * AGED_AMOUNT }),
    );
    const [, ledgerBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("ledger"), agedMint.toBuffer()],
      programId,
    );
    const [, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), agedMint.toBuffer()],
      programId,
    );
    account(
      "aged-ledger",
      addresses.ledger(agedMint),
      programId,
      await coder.encode("ledger", {
        mint: agedMint,
        openTotal: new BN((2n * AGED_AMOUNT).toString()),
        bump: ledgerBump,
        vaultBump,
      }),
    );
    account(
      "aged-vault",
      addresses.vault(agedMint),
      TOKEN_PROGRAM_ID,
      tokenAccount({
        mint: agedMint,
        owner: addresses.ledger(agedMint),
        amount: 2n * AGED_AMOUNT,
      }),
    );
    // One deposit five minutes past the thirty days, one an hour short of them.
    for (const [label, id, depositedAt] of [
      ["aged-reached", AGED_REACHED, now - PRODUCTION_DELAY - 300],
      ["aged-early", AGED_EARLY, now - PRODUCTION_DELAY + 3600],
    ]) {
      const [, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("deposit"), new BN(id.toString()).toArrayLike(Buffer, "le", 8)],
        programId,
      );
      account(
        label,
        addresses.deposit(id),
        programId,
        await coder.encode("deposit", {
          id: new BN(id.toString()),
          payer: agedPayer.publicKey,
          mint: agedMint,
          keptTo: agedKept,
          item: [...Buffer.alloc(32, 9)],
          amount: new BN(AGED_AMOUNT.toString()),
          depositedAt: new BN(depositedAt),
          bump,
        }),
      );
    }
  }
  console.log(output.join(" "));
}

if (process.argv[1]?.endsWith("submission-deposits-preload.mjs")) await main();
export { PROGRAM_NAME };
