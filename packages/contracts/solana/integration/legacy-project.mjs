import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import { configFees, configIdentity } from "./deployment.mjs";

/**
 * A Project of the earlier 316-byte layout, which the current build can no longer
 * create. test-e2e.sh preloads it and its mint into the validator so the e2e suite
 * can run migrate_project against real legacy bytes. Public seeds: test use only.
 */
const sha256 = (value) => createHash("sha256").update(value).digest();
export const sha256Seed = sha256;
const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const programId = new PublicKey(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../idl/slop_escrow.json", import.meta.url)),
    ),
  ).address,
);
export const legacyOwner = Keypair.fromSeed(sha256("slop-e2e-legacy-owner"));
export const legacyMint = Keypair.fromSeed(sha256("slop-e2e-legacy-mint"));
const projectId = sha256("slop-e2e-legacy-project");
export const [legacyProject, bump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("project"),
    legacyOwner.publicKey.toBuffer(),
    projectId,
    Buffer.from([0]),
  ],
  programId,
);
/** Rent-exempt minimum on the local validator: (size + 128) * 3480 * 2 lamports. */
const rentFor = (size) => (size + 128) * 6960;

function mintData() {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  legacyOwner.publicKey.toBuffer().copy(data, 4);
  data[44] = 6;
  data[45] = 1;
  return data;
}
export function projectData() {
  const data = Buffer.alloc(316);
  Buffer.from("cda8bdcab5f78e13", "hex").copy(data, 0);
  legacyOwner.publicKey.toBuffer().copy(data, 8);
  projectId.copy(data, 40);
  sha256("solana:localnet:legacy").copy(data, 72);
  configIdentity.publicKey.toBuffer().copy(data, 104);
  configFees.publicKey.toBuffer().copy(data, 136);
  legacyMint.publicKey.toBuffer().copy(data, 168);
  // Counters 200..248 stay zero.
  data[248] = bump;
  data.writeBigInt64LE(3600n, 249);
  // Pending identity authority 257..289 is the default key; no rotation pending.
  data.writeBigInt64LE(604800n, 298);
  // Purpose 306 ordinary, monthly cap 307 zero, monthly switch 315 off.
  return data;
}

/** Writes each [name, address, owner, data] account under .local and returns the
 * solana-test-validator --account arguments that preload them. */
export function preloadArgs(accounts) {
  mkdirSync(".local", { recursive: true });
  const args = [];
  for (const [name, address, owner, data] of accounts) {
    const file = `.local/${name}.json`;
    writeFileSync(
      file,
      JSON.stringify({
        pubkey: address.toBase58(),
        account: {
          lamports: rentFor(data.length),
          data: [data.toString("base64"), "base64"],
          owner: owner.toBase58(),
          executable: false,
          rentEpoch: 0,
          space: data.length,
        },
      }),
    );
    args.push("--account", address.toBase58(), file);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(
    preloadArgs([
      ["legacy-mint", legacyMint.publicKey, TOKEN_PROGRAM, mintData()],
      ["legacy-project", legacyProject, programId, projectData()],
    ]).join(" "),
  );
}
