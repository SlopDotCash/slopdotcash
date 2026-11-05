import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type Hex, keccak256 } from "viem";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { buildTree } from "../../workers/referral-accrual/merkle";
import type { ClaimSnapshot } from "./cache";
import { handleReferralClaims } from "./claims";

const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const distributor = "0x3333333333333333333333333333333333333333";
const code: Hex = "0x60006000";
const unit = 10n ** 18n;
const now = new Date();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function harness(mode: "live" | "dry_run" = "live") {
  const { db, sqlite } = sqliteD1();
  function file(period: string, epoch: number, cumulative: bigint) {
    const tree = buildTree([{ address: wallet, cumulativeBase: cumulative }]);
    if (!tree) throw new Error("Missing fixture tree");
    const body = JSON.stringify({
      referrers: [
        {
          githubId: "900000100",
          githubLogin: "referrer",
          wallet,
          cumulativeBase: cumulative.toString(),
          leaf: { hash: tree.leaves[0].hash, proof: tree.leaves[0].proof },
        },
      ],
    });
    sqlite
      .query(
        "INSERT INTO referral_accrual_files(period,epoch,run_id,mode,body,body_sha256,merkle_root,tree_total_base,leaf_count,created_at) VALUES(?,?,'rrun_fixture0001',?,?,?,?,?,1,?)",
      )
      .run(
        period,
        epoch,
        mode,
        body,
        sha(body),
        tree.root,
        cumulative.toString(),
        now.toISOString(),
      );
    return tree;
  }
  // An empty month has already filed: file epoch 1 maps to contract epoch 0.
  sqlite
    .query(
      "INSERT INTO referral_accrual_files(period,epoch,run_id,mode,body,body_sha256,merkle_root,tree_total_base,leaf_count,created_at) VALUES('2026-11',0,'rrun_fixture0000',?,?,?,NULL,'0',0,?)",
    )
    .run(mode, '{"referrers":[]}', sha('{"referrers":[]}'), now.toISOString());
  const first = file("2026-12", 1, 100n * unit);
  file("2027-01", 2, 150n * unit);
  sqlite
    .query(
      "INSERT INTO referral_claim_wallets(referrer_github_id,wallet,pinned_period,created_at) VALUES('900000100',?,'2026-12',?)",
    )
    .run(wallet, now.toISOString());
  const snapshot: ClaimSnapshot = {
    program: {
      network: "robinhood-testnet",
      chainId: 46630,
      distributor,
      token,
      decimals: 18,
      codeHash: keccak256(code),
    },
    deploymentBlock: "1",
    block: {
      number: "100",
      hash: `0x${"a".repeat(64)}`,
      timestamp: Math.floor(now.getTime() / 1000),
    },
    observedAt: now.toISOString(),
    paused: false,
    pauseAt: null,
    latestPaused: false,
    ended: false,
    epochs: [
      {
        epoch: 0,
        period: "2026-12",
        root: first.root,
        totalBase: (100n * unit).toString(),
        claimableAt: Math.floor(now.getTime() / 1000) - 100,
        voided: false,
      },
    ],
    claimed: { [wallet]: (20n * unit).toString() },
  };
  const save = (value: ClaimSnapshot, errorAt: string | null = null) =>
    sqlite
      .query(
        "INSERT INTO referral_claim_cache VALUES('program',?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at,error_at=excluded.error_at",
      )
      .run(JSON.stringify(value), value.observedAt, errorAt);
  save(snapshot);
  const read = async (actor: string | null = "900000100") => {
    const response = await handleReferralClaims(
      new Request("https://slop.cash/api/v1/referrals/me"),
      {
        db,
        sessionActor: async () => (actor ? { githubId: actor } : null),
        now: () => now,
      },
    );
    if (!response) throw new Error("Missing response");
    return { status: response.status, body: await response.json() };
  };
  return { sqlite, snapshot, save, read };
}

test("claim API maps contract epoch through its filed period and keeps another actor's proof private", async () => {
  const h = harness();
  const { body } = await h.read();
  expect(body).toMatchObject({
    status: "ready",
    accruedBase: (150n * unit).toString(),
    claimedBase: (20n * unit).toString(),
    claimableBase: (80n * unit).toString(),
    pendingBase: (50n * unit).toString(),
    claim: { epoch: 0, period: "2026-12" },
  });
  expect((await h.read(null)).status).toBe(401);
  expect((await h.read("900000200")).body).toMatchObject({
    wallet: null,
    accruedBase: "0",
    claimedBase: "0",
    claimableBase: "0",
    claim: null,
  });
  h.sqlite.close();
});

test("cache failure and expiry preserve last verified totals; never-activated is hidden and first failure is unknown", async () => {
  const h = harness();
  h.save(h.snapshot, now.toISOString());
  expect((await h.read()).body).toMatchObject({
    status: "stale",
    claimedBase: (20n * unit).toString(),
    claimableBase: (80n * unit).toString(),
  });
  h.save({
    ...h.snapshot,
    observedAt: new Date(now.getTime() - 49 * 3600_000).toISOString(),
  });
  expect((await h.read()).body.status).toBe("stale");
  h.sqlite.exec("DELETE FROM referral_claim_cache");
  expect((await h.read()).body).toEqual({ enabled: false });
  h.sqlite
    .query("INSERT INTO referral_claim_cache VALUES('program',NULL,NULL,?)")
    .run(now.toISOString());
  expect((await h.read()).body).toMatchObject({
    status: "unknown",
    claimedBase: null,
    claimableBase: null,
    pendingBase: null,
  });
  h.sqlite.close();
  // PRD section 11: dry-run accruals before the owner's activation stay
  // hidden, also when the claim cache has a program.
  const dryRun = harness("dry_run");
  expect((await dryRun.read()).body).toEqual({ enabled: false });
  dryRun.sqlite.close();
});

test("pendingUntil is the next maturing root, not the latest one, and survives a voided latest root", async () => {
  const h = harness();
  const day = 24 * 3600;
  const time = h.snapshot.block.timestamp;
  // Two roots are posted and still maturing: contract epoch 1 (the filed
  // 2027-01 root, cumulative 150) matures first, epoch 2 three weeks of
  // accrual later. The screen must name the earlier date.
  const tree150 = buildTree([{ address: wallet, cumulativeBase: 150n * unit }]);
  const tree200 = buildTree([{ address: wallet, cumulativeBase: 200n * unit }]);
  if (!tree150 || !tree200) throw new Error("Missing fixture tree");
  const body200 = JSON.stringify({
    referrers: [
      {
        githubId: "900000100",
        githubLogin: "referrer",
        wallet,
        cumulativeBase: (200n * unit).toString(),
        leaf: { hash: tree200.leaves[0].hash, proof: tree200.leaves[0].proof },
      },
    ],
  });
  h.sqlite
    .query(
      "INSERT INTO referral_accrual_files(period,epoch,run_id,mode,body,body_sha256,merkle_root,tree_total_base,leaf_count,created_at) VALUES('2027-02',3,'rrun_fixture0002','live',?,?,?,?,1,?)",
    )
    .run(
      body200,
      sha(body200),
      tree200.root,
      (200n * unit).toString(),
      now.toISOString(),
    );
  h.snapshot.epochs.push(
    {
      epoch: 1,
      period: "2027-01",
      root: tree150.root,
      totalBase: (150n * unit).toString(),
      claimableAt: time + 3 * day,
      voided: false,
    },
    {
      epoch: 2,
      period: "2027-02",
      root: tree200.root,
      totalBase: (200n * unit).toString(),
      claimableAt: time + 10 * day,
      voided: false,
    },
  );
  h.save(h.snapshot);
  expect((await h.read()).body).toMatchObject({
    claimableBase: (80n * unit).toString(),
    pendingBase: (100n * unit).toString(),
    pendingUntil: new Date((time + 3 * day) * 1000).toISOString(),
  });
  // Voiding the latest root must not hide the earlier root's date: its
  // rewards are still pending and still mature on schedule.
  h.snapshot.epochs[2].voided = true;
  h.save(h.snapshot);
  expect((await h.read()).body).toMatchObject({
    latestVoided: true,
    pendingUntil: new Date((time + 3 * day) * 1000).toISOString(),
  });
  h.sqlite.close();
});

test("a paused pending window never matures, and a void retains the preceding root", async () => {
  const h = harness();
  const time = h.snapshot.block.timestamp;
  const pending = {
    ...h.snapshot.epochs[0],
    epoch: 1,
    period: "2027-01",
    claimableAt: time - 10,
  };
  h.snapshot.epochs.push(pending);
  h.snapshot.paused = true;
  h.snapshot.pauseAt = time - 50;
  h.save(h.snapshot);
  expect((await h.read()).body).toMatchObject({ claim: { epoch: 0 } });
  h.snapshot.paused = false;
  pending.voided = true;
  h.save(h.snapshot);
  expect((await h.read()).body).toMatchObject({
    latestVoided: true,
    claim: { epoch: 0 },
  });
  h.sqlite.close();
});
