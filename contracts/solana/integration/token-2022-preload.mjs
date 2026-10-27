// Synthetic mint state and a throwaway local payer's balance; never a mainnet write.
import { readFileSync, writeFileSync } from "node:fs";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

const mint = new PublicKey("3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      readFileSync(process.env.ANCHOR_WALLET ?? ".local/payer.json", "utf8"),
    ),
  ),
);
const source = getAssociatedTokenAddressSync(
  mint,
  payer.publicKey,
  false,
  TOKEN_2022_PROGRAM_ID,
);
const mintBytes = readFileSync("integration/fixtures/token-2022-mint.bin");
const account = Buffer.alloc(170);
mint.toBuffer().copy(account, 0);
payer.publicKey.toBuffer().copy(account, 32);
account.writeBigUInt64LE(1_000_000_000_000n, 64);
account[108] = 1;
account[165] = 2;
account.writeUInt16LE(7, 166); // Initialized account + ImmutableOwner.
for (const [label, address, bytes] of [
  ["mint", mint, mintBytes],
  ["source", source, account],
]) {
  const path = `.local/token-2022-${label}.json`;
  writeFileSync(
    path,
    JSON.stringify({
      pubkey: address.toBase58(),
      account: {
        lamports: 10_000_000,
        data: [bytes.toString("base64"), "base64"],
        owner: TOKEN_2022_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: bytes.length,
      },
    }),
  );
  process.stdout.write(`--account ${address.toBase58()} ${path} `);
}
