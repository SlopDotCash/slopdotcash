// Local dry run against an in-memory D1 with every migration applied and the
// JSON fixture named on the command line. It loads no key and touches no
// hosted database. Usage:
//   bun workers/referral-accrual/dry-run.ts <fixture.json> [<as-of ISO time>]
// The fixture lists projects (id, referrer), wallets (githubId, address) and
// payouts (projectId, grossBase, paidAt, optional network, chain, asset,
// decimals). Parameters come from the environment with the wrangler.toml
// defaults as fallback, so a run shows what the hosted Worker would file.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runOnce } from "./index";
import { sqliteD1 } from "./sqlite-d1";

const [fixturePath, asOf] = process.argv.slice(2);
if (!fixturePath) {
  console.error(
    "usage: bun workers/referral-accrual/dry-run.ts <fixture.json> [<as-of ISO time>]",
  );
  process.exit(2);
}

interface Fixture {
  projects: {
    id: string;
    referrer: { githubId: string; githubLogin: string } | null;
  }[];
  wallets?: { githubId: string; githubLogin: string; address: string }[];
  payouts: {
    projectId: string;
    grossBase: string;
    paidAt: string;
    network?: string;
    chain?: string;
    asset?: string;
    decimals?: number;
  }[];
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const { db, sqlite } = sqliteD1();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

for (const project of fixture.projects) {
  const manifest = JSON.stringify({ id: project.id, status: "active" });
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,'dry-run','2026-10-01T00:00:00.000Z')",
    )
    .run(project.id, manifest, sha(manifest));
  sqlite
    .query(
      "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,referrer_github_id,referrer_github_login) VALUES (?,'active',1,?,?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',?,?)",
    )
    .run(
      project.id,
      manifest,
      sha(manifest),
      project.referrer?.githubId ?? null,
      project.referrer?.githubLogin ?? null,
    );
}
for (const wallet of fixture.wallets ?? []) {
  const claimId = `claim_${wallet.githubId}`;
  sqlite
    .query(
      "INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES (?,?,?,?,'d1_registry',?,'2026-10-15T00:00:00.000Z',?,NULL,'2026-10-15T00:00:00.000Z','robinhood')",
    )
    .run(
      claimId,
      wallet.githubId,
      wallet.githubLogin,
      wallet.address,
      sha(claimId),
      sha(`r${claimId}`),
    );
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges (id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES (?,?,?,'m','2026-10-15T01:00:00.000Z','2026-10-15T00:30:00.000Z')",
    )
    .run(`chal_${claimId}`, claimId, wallet.githubId);
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations (claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES (?,?,'2026-10-15T00:30:00.000Z',?,'dry-run')",
    )
    .run(claimId, wallet.githubId, `chal_${claimId}`);
}
let n = 0;
for (const payout of fixture.payouts) {
  n += 1;
  const id = `0x${n.toString(16).padStart(64, "0")}`;
  const transaction = `0xtx${n.toString(16).padStart(61, "0")}`;
  const network = payout.network ?? "base-mainnet";
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,'1',?,?,?,?,?,?,?,?,'paid',?,?)",
    )
    .run(
      id,
      payout.projectId,
      network,
      payout.chain ?? "base",
      `0x${"5".repeat(40)}`,
      payout.asset ?? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      payout.decimals ?? 6,
      payout.grossBase,
      ((BigInt(payout.grossBase) + 49n) / 50n).toString(),
      sha(id),
      payout.paidAt,
      transaction,
    );
  sqlite
    .query("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
    .run(network, transaction, 0, "0xblock", "paid", id, "{}", payout.paidAt);
}

const result = await runOnce(
  {
    REFERRAL_DB: db,
    REFERRAL_ACCRUAL_MODE: "dry_run",
    REFERRAL_FIRST_PERIOD: process.env.REFERRAL_FIRST_PERIOD ?? "2026-11",
    REFERRAL_RATE_BASE_PER_MICRO:
      process.env.REFERRAL_RATE_BASE_PER_MICRO ?? "3000000000000",
    REFERRAL_TOKEN_DECIMALS: process.env.REFERRAL_TOKEN_DECIMALS ?? "18",
    REFERRAL_POOL_BASE:
      process.env.REFERRAL_POOL_BASE ?? "2000000000000000000000000",
    REFERRAL_PROJECT_CAP_BASE:
      process.env.REFERRAL_PROJECT_CAP_BASE ?? "250000000000000000000000",
    REFERRAL_WINDOW_MONTHS: process.env.REFERRAL_WINDOW_MONTHS ?? "12",
    REFERRAL_EXCLUDED_GITHUB_IDS:
      process.env.REFERRAL_EXCLUDED_GITHUB_IDS ?? "18633264,202660855",
  },
  () => (asOf ? new Date(asOf) : new Date()),
);
console.log(JSON.stringify(result, null, 2));
for (const file of sqlite
  .query("SELECT body FROM referral_accrual_files ORDER BY epoch")
  .all() as { body: string }[])
  console.log(file.body);
