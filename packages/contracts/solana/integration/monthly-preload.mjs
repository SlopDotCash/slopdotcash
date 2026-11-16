import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  legacyMint,
  preloadArgs,
  programId,
  projectData,
  sha256Seed,
} from "./legacy-project.mjs";

/**
 * Escrow states that no live validator can reach, which test-e2e.sh preloads so the e2e
 * suite runs the program against real bytes. Public seeds: test use only.
 *
 * A past-window funded month is preloaded so the program can prove that time
 * never opens its source to a conflicting owner award. The fixture has one
 * valid leaf, a canonical project PDA and a funded SPL vault.
 */
export const expiredOwner = Keypair.fromSeed(
  sha256Seed("slop-e2e-expired-owner"),
);
const expiredProjectId = sha256Seed("slop-e2e-expired-project");
export const [expiredProject, expiredBump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("project"),
    expiredOwner.publicKey.toBuffer(),
    expiredProjectId,
    Buffer.from([0]),
  ],
  programId,
);
export const EXPIRED_PERIOD = 202001;
export const EXPIRED_ACTOR = 100;
export const EXPIRED_GROSS = 1_000_000;
export const EXPIRED_SOURCE = sha256Seed("slop-e2e-funded-source").toString(
  "hex",
);
const month = PublicKey.findProgramAddressSync(
  [
    Buffer.from("month"),
    expiredProject.toBuffer(),
    Buffer.from(new Uint32Array([EXPIRED_PERIOD]).buffer),
  ],
  programId,
)[0];

function project() {
  const data = Buffer.concat([projectData(), Buffer.alloc(16)]);
  // Its own owner, so no owner listing of the legacy project includes it.
  expiredOwner.publicKey.toBuffer().copy(data, 8);
  expiredProjectId.copy(data, 40);
  data[248] = expiredBump;
  data.writeBigInt64LE(0n, 249); // zero binding delay
  data.writeBigUInt64LE(BigInt(EXPIRED_GROSS), 200); // reserved
  data.writeBigUInt64LE(10_000_000n, 208); // deposited
  data.writeBigUInt64LE(BigInt(EXPIRED_GROSS), 324); // monthly_outstanding
  return data;
}
function expiredVaultData() {
  const data = Buffer.alloc(165);
  legacyMint.publicKey.toBuffer().copy(data, 0);
  expiredProject.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(10_000_000n, 64);
  data[108] = 1;
  return data;
}

function monthData() {
  const data = Buffer.alloc(109);
  Buffer.from("1170c1902bd6fc6b", "hex").copy(data, 0);
  expiredProject.toBuffer().copy(data, 8);
  data.writeUInt32LE(EXPIRED_PERIOD, 40);
  Buffer.from(
    allocationTree([[EXPIRED_ACTOR, EXPIRED_GROSS, EXPIRED_SOURCE]]).root,
    "hex",
  ).copy(data, 44);
  data.writeBigUInt64LE(BigInt(EXPIRED_GROSS), 84); // total; no leaf committed
  data.writeBigInt64LE(1_580_774_400n, 100); // frozen_at, 4 February 2020
  return data;
}

const sha256 = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
export const sourceDigest = (name) => sha256(`source:${name}`).toString("hex");
/**
 * The program's Merkle sum tree over [actor, gross, source digest hex] leaves, built here
 * because the adapter refuses an actor-0 leaf. An odd last node moves up unchanged.
 */
export function allocationTree(leaves) {
  const tree = [
    leaves.map(([actor, gross, source]) => ({
      hash: sha256(
        Buffer.from([0]),
        u64(actor),
        u64(gross),
        Buffer.from(source, "hex"),
      ),
      total: BigInt(gross),
    })),
  ];
  while (tree.at(-1).length > 1) {
    const level = tree.at(-1);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const [left, right] = [level[i], level[i + 1]];
      next.push(
        right
          ? {
              hash: sha256(
                Buffer.from([1]),
                left.hash,
                u64(left.total),
                right.hash,
                u64(right.total),
              ),
              total: left.total + right.total,
            }
          : left,
      );
    }
    tree.push(next);
  }
  return {
    root: tree.at(-1)[0].hash.toString("hex"),
    total: tree.at(-1)[0].total.toString(),
    proof(index) {
      const proof = [];
      for (const level of tree.slice(0, -1)) {
        const sibling = index % 2 === 1 ? index - 1 : index + 1;
        if (sibling < level.length)
          proof.push({
            hash: level[sibling].hash.toString("hex"),
            total: level[sibling].total.toString(),
          });
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}

/**
 * Cross-month: an earlier month of the e2e project "monthly-cross" that already committed
 * three sources to actor 901 for 5 USDC each. Only commit_monthly_award writes the
 * ["monthly-source", project, source] marker, and no live validator holds two recordable
 * months of one project, so the earlier month and its markers are preloaded. The test
 * writes each source's origin and obligation with the same commit_with_fee path. The
 * release rule reads only that obligation; the attester's freeze refuses a marker.
 */
export const CROSS_ACTOR = 901;
export const CROSS_GROSS = 5_000_000;
export const CROSS_SOURCES = ["cross-equal", "cross-more", "cross-other"];
export const EARLIER_PERIOD = 202001;
const owner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET, "utf8"))),
).publicKey;
export const crossProject = PublicKey.findProgramAddressSync(
  [
    Buffer.from("project"),
    owner.toBuffer(),
    sha256(`monthly-cross${process.env.SLOP_E2E_RUN ?? ""}`),
    Buffer.from([0]),
  ],
  programId,
)[0];
function earlierMonth() {
  const tree = allocationTree(
    CROSS_SOURCES.map((name) => [CROSS_ACTOR, CROSS_GROSS, sourceDigest(name)]),
  );
  const data = Buffer.alloc(109);
  Buffer.from("1170c1902bd6fc6b", "hex").copy(data, 0);
  crossProject.toBuffer().copy(data, 8);
  data.writeUInt32LE(EARLIER_PERIOD, 40);
  Buffer.from(tree.root, "hex").copy(data, 44);
  data.writeBigUInt64LE(BigInt(tree.total), 76); // committed: every award
  data.writeBigUInt64LE(BigInt(tree.total), 84); // total
  data.writeBigInt64LE(1_580_774_400n, 100); // frozen_at
  return data;
}
const monthAddress = (projectKey, period) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("month"),
      projectKey.toBuffer(),
      Buffer.from(new Uint32Array([period]).buffer),
    ],
    programId,
  )[0];

/**
 * Short vault: a Project whose counters owe 5 USDC (3 free, 2 reserved) while its vault
 * token account holds one micro-unit less, which the program itself never allows.
 */
export const shortProject = Keypair.fromSeed(
  sha256Seed("slop-e2e-short-vault-project"),
).publicKey;
function shortVaultProject() {
  const data = Buffer.concat([projectData(), Buffer.alloc(16)]);
  Keypair.fromSeed(sha256Seed("slop-e2e-short-vault-owner"))
    .publicKey.toBuffer()
    .copy(data, 8);
  data.writeBigUInt64LE(2_000_000n, 200); // reserved
  data.writeBigUInt64LE(5_000_000n, 208); // deposited
  return data;
}
function shortVault() {
  const data = Buffer.alloc(165);
  legacyMint.publicKey.toBuffer().copy(data, 0);
  shortProject.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(4_999_999n, 64); // amount
  data[108] = 1; // initialized
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // BindingVeto discriminator: the empty marker account.
  const marker = Buffer.from("20b51e0e0a5b1d9e", "hex");
  console.log(
    preloadArgs([
      ["expired-project", expiredProject, programId, project()],
      ["expired-month", month, programId, monthData()],
      [
        "expired-vault",
        PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), expiredProject.toBuffer()],
          programId,
        )[0],
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        expiredVaultData(),
      ],
      ["short-vault-project", shortProject, programId, shortVaultProject()],
      [
        "short-vault",
        PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), shortProject.toBuffer()],
          programId,
        )[0],
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        shortVault(),
      ],
      [
        "earlier-month",
        monthAddress(crossProject, EARLIER_PERIOD),
        programId,
        earlierMonth(),
      ],
      ...CROSS_SOURCES.map((name) => [
        `monthly-source-${name}`,
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("monthly-source"),
            crossProject.toBuffer(),
            Buffer.from(sourceDigest(name), "hex"),
          ],
          programId,
        )[0],
        programId,
        marker,
      ]),
    ]).join(" "),
  );
}
