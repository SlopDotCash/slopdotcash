import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  legacyMint,
  preloadArgs,
  programId,
  projectData,
} from "./legacy-project.mjs";

/**
 * Month pledge states that no live validator can reach, which test-e2e.sh preloads.
 * A live pledge names only the current UTC month, while commit_monthly accepts only the
 * month before it, so a pledge for the recordable month and a lapsed pledge are preloaded.
 * The pre-pledge project is a Project of the 332-byte layout that live mainnet vaults
 * use, for the migrate_project check. The local payer owns all three so it can sign.
 * Public seeds: test use only.
 */
const sha256 = (value) => createHash("sha256").update(value).digest();
const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const RUN = process.env.SLOP_E2E_RUN ?? "";
export const pledgeOwner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET, "utf8"))),
).publicKey;
/** The monthly period recordable at `seconds`: the month before the one containing
 * `seconds - 72 hours`, as YYYYMM. */
export function openPeriodAt(seconds) {
  const shifted = new Date((seconds - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  return open.getUTCFullYear() * 100 + open.getUTCMonth() + 1;
}
/** A period whose window closed long ago. */
export const LAPSED_PERIOD = 202001;
export const PLEDGE_DEPOSIT = 10_000_000n;
export const OPEN_PLEDGE = 2_000_000n;
export const LAPSED_PLEDGE = 1_000_000n;
export const PRE_PLEDGE_DEPOSIT = 4_000_000n;
export const PLEDGE_NETWORK = sha256("solana:localnet:legacy");
const period32 = (period) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(period);
  return bytes;
};
const projectAddress = (name) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      pledgeOwner.toBuffer(),
      sha256(`${name}${RUN}`),
      Buffer.from([0]),
    ],
    programId,
  );
export const vaultAddress = (project) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), project.toBuffer()],
    programId,
  )[0];
export const pledgeAddress = (project, period) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("pledge"), project.toBuffer(), period32(period)],
    programId,
  );
/** Monthly switch off, cap 100: an open pledge for the recordable month and a lapsed one. */
export const [pledgeOffProject, pledgeOffBump] = projectAddress("pledge-off");
/** Monthly switch on, cap 5 USDC: an open pledge for the recordable month. */
export const [pledgeNetProject, pledgeNetBump] = projectAddress("pledge-net");
/** The 332-byte layout from before month pledges, monthly on with cap 7. */
export const [prePledgeProject, prePledgeBump] = projectAddress("pre-pledge");

function project(name, bump, { cap, enabled, pledged, deposited, size }) {
  const data = Buffer.concat([projectData(), Buffer.alloc(size - 316)]);
  pledgeOwner.toBuffer().copy(data, 8);
  sha256(`${name}${RUN}`).copy(data, 40);
  data[248] = bump;
  data.writeBigInt64LE(0n, 249); // zero binding delay
  data.writeBigUInt64LE(deposited, 208);
  data.writeBigUInt64LE(cap, 307);
  data[315] = enabled ? 1 : 0;
  if (size === 340) data.writeBigUInt64LE(pledged, 332);
  return data;
}
function vault(projectKey, amount) {
  const data = Buffer.alloc(165);
  legacyMint.publicKey.toBuffer().copy(data, 0);
  projectKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1; // initialized
  return data;
}
const PLEDGE_DISCRIMINATOR = sha256("account:MonthPledge").subarray(0, 8);
function pledge(projectKey, period, amount) {
  const data = Buffer.alloc(54);
  PLEDGE_DISCRIMINATOR.copy(data, 0);
  projectKey.toBuffer().copy(data, 8);
  data.writeUInt32LE(period, 40);
  data.writeBigUInt64LE(amount, 44);
  data[52] = 1; // open
  data[53] = pledgeAddress(projectKey, period)[1];
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const open = openPeriodAt(Math.floor(Date.now() / 1000));
  const accounts = [
    [
      "pledge-off-project",
      pledgeOffProject,
      programId,
      project("pledge-off", pledgeOffBump, {
        cap: 100n,
        enabled: false,
        pledged: OPEN_PLEDGE + LAPSED_PLEDGE,
        deposited: PLEDGE_DEPOSIT,
        size: 340,
      }),
    ],
    [
      "pledge-net-project",
      pledgeNetProject,
      programId,
      project("pledge-net", pledgeNetBump, {
        cap: 5_000_000n,
        enabled: true,
        pledged: OPEN_PLEDGE,
        deposited: PLEDGE_DEPOSIT,
        size: 340,
      }),
    ],
    [
      "pre-pledge-project",
      prePledgeProject,
      programId,
      project("pre-pledge", prePledgeBump, {
        cap: 7n,
        enabled: true,
        pledged: 0n,
        deposited: PRE_PLEDGE_DEPOSIT,
        size: 332,
      }),
    ],
    [
      "pledge-off-open",
      pledgeAddress(pledgeOffProject, open)[0],
      programId,
      pledge(pledgeOffProject, open, OPEN_PLEDGE),
    ],
    [
      "pledge-off-lapsed",
      pledgeAddress(pledgeOffProject, LAPSED_PERIOD)[0],
      programId,
      pledge(pledgeOffProject, LAPSED_PERIOD, LAPSED_PLEDGE),
    ],
    [
      "pledge-net-open",
      pledgeAddress(pledgeNetProject, open)[0],
      programId,
      pledge(pledgeNetProject, open, OPEN_PLEDGE),
    ],
  ];
  for (const [name, projectKey, amount] of [
    ["pledge-off", pledgeOffProject, PLEDGE_DEPOSIT],
    ["pledge-net", pledgeNetProject, PLEDGE_DEPOSIT],
    ["pre-pledge", prePledgeProject, PRE_PLEDGE_DEPOSIT],
  ])
    accounts.push([
      `${name}-vault`,
      vaultAddress(projectKey),
      TOKEN_PROGRAM,
      vault(projectKey, amount),
    ]);
  console.log(preloadArgs(accounts).join(" "));
}
