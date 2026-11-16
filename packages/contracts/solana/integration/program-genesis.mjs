/** Exact public program bytes at genesis, with canonical upgradeable-loader metadata.
 * Agave's --upgradeable-program can incorrectly mark ProgramData executable.
 * Keep the production verifier strict and create both genesis accounts explicitly.
 * https://github.com/anza-xyz/agave/pull/3694
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";

const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const idl = JSON.parse(readFileSync("target/idl/slop_escrow.json", "utf8"));
const program = new PublicKey(idl.address);
const data = PublicKey.findProgramAddressSync([program.toBuffer()], loader)[0];
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET, "utf8"))),
).publicKey;
const pointer = Buffer.alloc(36);
pointer.writeUInt32LE(2);
data.toBuffer().copy(pointer, 4);
const header = Buffer.alloc(45);
header.writeUInt32LE(3);
header[12] = 1;
authority.toBuffer().copy(header, 13);
const executable = readFileSync("target/deploy/slop_escrow.so");
for (const [address, bytes, isExecutable, path] of [
  [program, pointer, true, ".local/program.json"],
  [
    data,
    Buffer.concat([header, executable]),
    false,
    ".local/program-data.json",
  ],
]) {
  writeFileSync(
    path,
    JSON.stringify({
      pubkey: address.toBase58(),
      account: {
        // Local genesis funds only, comfortably above rent for the compiled code.
        lamports: 100_000_000_000,
        data: [bytes.toString("base64"), "base64"],
        owner: loader.toBase58(),
        executable: isExecutable,
        rentEpoch: 0,
      },
    }),
  );
}
console.log(
  `--account ${program} .local/program.json --account ${data} .local/program-data.json`,
);
