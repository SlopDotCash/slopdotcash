/**
 * Live poster against a real local chain: deploys the compiled
 * ReferralDistributor and mock token on Anvil, files one epoch from a seeded
 * in-memory D1, lets the Worker post its root in live mode, reconciles the
 * receipt, and claims from a referrer wallet. Public Anvil fixture keys only;
 * no hosted database, no public chain. Run with Bun:
 *   bun workers/referral-accrual/anvil.integration.ts
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runOnce } from "./index";
import { sqliteD1 } from "./sqlite-d1";

const evmRoot = fileURLToPath(new URL("../../contracts/evm/", import.meta.url));
const port = process.env.SLOP_REFERRAL_ANVIL_PORT ?? "18561";
const rpcUrl = `http://127.0.0.1:${port}`;
// Public Anvil mnemonic accounts: 0 deploys and owns, 1 posts, 2 is the referrer.
const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const poster = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const posterKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const referrerWallet = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ONE = 10n ** 18n;
const RATE = 3_000_000_000_000n;
const GROSS = 1_000_000_000n; // 1,000 USDC gross paid in November
const CUMULATIVE = GROSS * RATE; // 3,000 tokens

const anvil = spawn(
  "anvil",
  ["--port", port, "--silent", "--chain-id", "46630"],
  {
    stdio: "ignore",
  },
);

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

function deploy(contract: string, args: string[] = []) {
  const output = execFileSync(
    "forge",
    [
      "create",
      "--root",
      evmRoot,
      contract,
      "--rpc-url",
      rpcUrl,
      "--unlocked",
      "--from",
      owner,
      "--broadcast",
      "--json",
      ...(args.length ? ["--constructor-args", ...args] : []),
    ],
    { encoding: "utf8" },
  );
  return (JSON.parse(output).deployedTo as string).toLowerCase();
}

async function send(
  to: string,
  signature: string,
  args: string[],
  from: string,
) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const hash = await rpc("eth_sendTransaction", [
    { from, to, data, gas: "0x7a1200" },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  const receipt = await rpc("eth_getTransactionReceipt", [hash]);
  assert.equal(receipt.status, "0x1", `${signature} reverted`);
  return receipt;
}

function call(to: string, signature: string, args: string[] = []) {
  return execFileSync(
    "cast",
    ["call", "--rpc-url", rpcUrl, to, signature, ...args],
    { encoding: "utf8" },
  ).trim();
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

try {
  for (let i = 0; ; i += 1) {
    try {
      await rpc("eth_chainId", []);
      break;
    } catch {
      if (anvil.exitCode !== null || i > 100)
        throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  execFileSync("forge", ["build", "--root", evmRoot], { stdio: "ignore" });
  const token = deploy("integration/MockReferralToken.sol:MockReferralToken");
  const distributor = deploy(
    "src/ReferralDistributor.sol:ReferralDistributor",
    [
      token,
      owner,
      poster,
      (250_000n * ONE).toString(),
      "0", // no spacing: the rehearsal posts in one session
    ],
  );
  await send(
    token,
    "mint(address,uint256)",
    [distributor, (2_000_000n * ONE).toString()],
    owner,
  );
  await rpc("anvil_mine", ["0x1"]);

  // One referred project with one finalized November payout and a wallet.
  const { db, sqlite } = sqliteD1();
  const manifest = JSON.stringify({ id: "demo", status: "active" });
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES ('demo',1,?,?,'anvil','2026-10-01T00:00:00.000Z')",
    )
    .run(manifest, sha(manifest));
  sqlite
    .query(
      "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,referrer_github_id,referrer_github_login) VALUES ('demo','active',1,?,?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','900000100','referrer-one')",
    )
    .run(manifest, sha(manifest));
  const claimId = "claim_900000100";
  sqlite
    .query(
      "INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES (?,'900000100','referrer-one',?,'d1_registry',?,'2026-10-15T00:00:00.000Z',?,NULL,'2026-10-15T00:00:00.000Z','robinhood')",
    )
    .run(claimId, referrerWallet, sha(claimId), sha(`r${claimId}`));
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges (id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES ('chal_1',?,'900000100','m','2026-10-15T01:00:00.000Z','2026-10-15T00:30:00.000Z')",
    )
    .run(claimId);
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations (claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES (?,'900000100','2026-10-15T00:30:00.000Z','chal_1','anvil')",
    )
    .run(claimId);
  const obligation = `0x${"1".repeat(64)}`;
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,'demo','1','base-mainnet','base',?,'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',6,?,'20000000',?,'paid','2026-11-05T12:00:00.000Z',?)",
    )
    .run(
      obligation,
      `0x${"5".repeat(40)}`,
      GROSS.toString(),
      sha(obligation),
      `0x${"2".repeat(64)}`,
    );
  sqlite
    .query("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "base-mainnet",
      `0x${"2".repeat(64)}`,
      0,
      "0xblock",
      "paid",
      obligation,
      "{}",
      "2026-11-05T12:00:00.000Z",
    );

  const env = {
    REFERRAL_DB: db,
    REFERRAL_ACCRUAL_MODE: "live",
    REFERRAL_FIRST_PERIOD: "2026-11",
    REFERRAL_RATE_BASE_PER_MICRO: RATE.toString(),
    REFERRAL_TOKEN_DECIMALS: "18",
    REFERRAL_POOL_BASE: (2_000_000n * ONE).toString(),
    REFERRAL_PROJECT_CAP_BASE: (250_000n * ONE).toString(),
    REFERRAL_WINDOW_MONTHS: "12",
    REFERRAL_EXCLUDED_GITHUB_IDS: "18633264,202660855",
    REFERRAL_PROGRAM_ENABLED: "true",
    REFERRAL_DISTRIBUTOR_ADDRESS: distributor,
    REFERRAL_TOKEN_ADDRESS: token,
    REFERRAL_POST_NETWORK: "robinhood-testnet",
    RPC_URL_REFERRAL: rpcUrl,
    REFERRAL_POSTER_KEY: posterKey,
  };
  const at = (iso: string) => () => new Date(iso);

  // Run 1 files November and posts its root.
  const first = await runOnce(env, at("2026-12-02T01:23:00.000Z"));
  assert.equal(first?.status, "ran");
  assert.deepEqual(first?.filed, [
    { period: "2026-11", epoch: 0, rows: 1, leafCount: 1 },
  ]);
  assert.equal(first?.post?.status, "posted");
  const file = sqlite
    .query(
      "SELECT merkle_root, tree_total_base, body FROM referral_accrual_files WHERE period = '2026-11'",
    )
    .get() as { merkle_root: string; tree_total_base: string; body: string };
  assert.equal(BigInt(file.tree_total_base), CUMULATIVE);
  // Anvil marks a block finalized two epochs (64 slots) later; the poster
  // reads the receipt as finalized only once the chain says so.
  await rpc("anvil_mine", ["0x2"]);
  const early = await runOnce(env, at("2026-12-02T01:30:00.000Z"));
  assert.equal(early?.post?.status, "in_flight");
  await rpc("anvil_mine", ["0x41"]);

  // Run 2 reconciles the finalized receipt; the root is inside its window, so
  // nothing more is posted.
  const second = await runOnce(env, at("2026-12-02T02:00:00.000Z"));
  assert.equal(second?.post?.status, "pending_root");
  assert.equal(second?.post?.reconciled, 1);
  const post = sqlite
    .query(
      "SELECT epoch, state, tx_id, merkle_root, total_base, block_number FROM referral_root_posts",
    )
    .get() as {
    epoch: number;
    state: string;
    tx_id: string;
    merkle_root: string;
    total_base: string;
    block_number: string;
  };
  assert.equal(post.state, "finalized");
  assert.equal(post.epoch, 0);
  assert.equal(post.merkle_root, file.merkle_root);
  assert.equal(call(distributor, "nextEpoch()(uint256)"), "1");
  assert.equal(call(distributor, "hasPendingRoot()(bool)"), "true");
  const onChain = call(
    distributor,
    "epochAt(uint256)((bytes32,uint256,uint64,bool))",
    ["0"],
  );
  assert.ok(
    onChain.includes(file.merkle_root),
    `chain root ${onChain} lacks ${file.merkle_root}`,
  );
  const receipt = await rpc("eth_getTransactionReceipt", [post.tx_id]);
  assert.equal(receipt.status, "0x1");
  assert.equal(BigInt(receipt.blockNumber).toString(), post.block_number);

  // Exercise owner-void finality on an isolated local branch, then restore both
  // fixture snapshots so the original claim workflow remains independently covered.
  const snapshot = await rpc("evm_snapshot", []);
  sqlite.exec("SAVEPOINT owner_void_control");
  await send(distributor, "voidRoot(uint256)", ["0"], owner);
  const pendingVoid = await runOnce(env, at("2026-12-02T02:10:00.000Z"));
  assert.equal(pendingVoid?.post?.status, "in_flight");
  assert.equal(
    (
      sqlite.query("SELECT state FROM referral_root_posts").get() as {
        state: string;
      }
    ).state,
    "finalized",
  );
  await rpc("anvil_mine", ["0x41"]);
  const finalVoid = await runOnce(env, at("2026-12-02T02:20:00.000Z"));
  assert.equal(finalVoid?.post?.status, "halted_after_void");
  assert.equal(
    (
      sqlite.query("SELECT state FROM referral_root_posts").get() as {
        state: string;
      }
    ).state,
    "voided",
  );
  sqlite.exec("ROLLBACK TO owner_void_control; RELEASE owner_void_control");
  assert.equal(await rpc("evm_revert", [snapshot]), true);

  // Seven days later the referrer claims its cumulative with the file's proof.
  await rpc("evm_increaseTime", [7 * 24 * 3600]);
  await rpc("anvil_mine", ["0x1"]);
  const body = JSON.parse(file.body) as {
    referrers: {
      wallet: string;
      cumulativeBase: string;
      leaf?: { proof: string[] };
    }[];
  };
  const referrer = body.referrers[0];
  assert.equal(referrer.wallet, referrerWallet.toLowerCase());
  const proof = `[${(referrer.leaf?.proof ?? []).join(",")}]`;
  assert.equal(
    BigInt(
      call(distributor, "claimable(address,uint256,bytes32[])(uint256)", [
        referrerWallet,
        referrer.cumulativeBase,
        proof,
      ]).split(" ")[0],
    ),
    CUMULATIVE,
  );
  await send(
    distributor,
    "claim(uint256,bytes32[])",
    [referrer.cumulativeBase, proof],
    referrerWallet,
  );
  assert.equal(
    BigInt(
      call(token, "balanceOf(address)(uint256)", [referrerWallet]).split(
        " ",
      )[0],
    ),
    CUMULATIVE,
  );
  // A second claim pays nothing more.
  await assert.rejects(
    send(
      distributor,
      "claim(uint256,bytes32[])",
      [referrer.cumulativeBase, proof],
      referrerWallet,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      distributor,
      token,
      root: file.merkle_root,
      post: post.tx_id,
      claimed: CUMULATIVE.toString(),
      nonfinalVoidHeld: true,
      canonicalFinalVoidRecorded: true,
      voidFixtureRolledBackBeforeClaim: true,
    }),
  );
} finally {
  anvil.kill();
}
