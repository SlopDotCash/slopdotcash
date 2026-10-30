/** Actual local transfers and private receipt writes for the fee-converter integration. */

import type { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { evmDirectTransactions } from "../../backend/security/direct-evm";
import {
  type DirectIntent,
  verifyDirectPayment,
} from "../../backend/security/direct-payments";
import { rewardFields } from "../../src/lib/project-proposal";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { privateBountyTerms } from "../../src/lib/security-bounty-proposal";
import { applicationManifest } from "../../tests/project-application-manifest";
import type { sqliteD1 } from "../../tests/sqlite-d1";
import { type Env, runOnce } from "./index";
import { D1ConversionStore, projectRewardTokens } from "./store";

export async function directFeeScenario(input: {
  db: ReturnType<typeof sqliteD1>["db"];
  sqlite: Database;
  env: Env;
  rpc: (method: string, params: unknown[]) => Promise<unknown>;
  rpcUrl: string;
  wallet: string;
  token: string;
  target: string;
}) {
  const { db, sqlite, env, rpc, rpcUrl, wallet, token, target } = input;
  const [payer, reporter] = (await rpc("eth_accounts", [])) as string[];
  const digest = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const native = `0x${"0".repeat(40)}`;
  const results = [];
  for (const [kind, address, gross] of [
    ["token", token, 40n * 10n ** 18n],
    ["native", native, 10n ** 17n],
  ] as const) {
    const projectId = `direct-fees-${kind}`,
      caseId = `sc_${projectId}`,
      at = new Date(
        Date.now() + (kind === "native" ? 86_400_000 : 0),
      ).toISOString();
    const draft = privateBountyTerms({
      name: projectId,
      repository: `example/${projectId}`,
      commit: "a".repeat(40),
      scope: "Local synthetic payment verification.",
      criteria: "A reproduced synthetic critical flaw.",
      testing: "Use only local synthetic balances.",
      actor: { githubId: "1", githubLogin: "local-owner" },
      funding: {
        mode: "monthly",
        network: "base",
        assetKind: kind,
        tokenAddress: address,
        tokenSymbol: kind === "native" ? "ETH" : "TEST",
        monthlyAmount: kind === "native" ? "0.1" : "40",
      },
    });
    const program = {
      ...draft,
      amount: {
        currency: kind === "native" ? "ETH" : "TEST",
        network: "base",
        decimals: 18,
        grossMinor: gross.toString(),
        asset: {
          network: "base",
          kind,
          address,
          symbol: kind === "native" ? "ETH" : "TEST",
          decimals: 18,
          chainId: REWARD_ASSET_NETWORKS.base.chainId,
          cluster: null,
          verifiedAt: at,
        },
      },
    };
    const manifest = applicationManifest(projectId, `example/${projectId}`, {
      ...rewardFields(
        {
          mode: "none",
          network: "base",
          assetKind: "stablecoin",
          tokenAddress: "",
          tokenSymbol: "",
          monthlyAmount: "",
        },
        new Date(),
      ),
      securityBounty: program,
      status: "active",
    });
    delete manifest.escrow;
    delete manifest.rewardAsset;
    const text = JSON.stringify(manifest);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'local fee fixture',?)",
      )
      .run(projectId, text, digest(text), at);
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
      )
      .run(projectId, text, digest(text), at, at);
    sqlite
      .prepare(
        "INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at,received_at,verified_at,verified_by_github_id,policy_revision) VALUES(?,?,?,'2','local-reporter','verified',?,'confirmed','not-started','approved','rail-unavailable','embargoed','private','none',1,?,?,?,?, '1',1)",
      )
      .run(
        caseId,
        projectId,
        `example/${projectId}`,
        JSON.stringify(program.amount),
        at,
        at,
        at,
        at,
      );
    sqlite
      .prepare(
        "INSERT INTO security_direct_awards(case_id,project_id,root_cause_key,terms,gross_base,approved_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        caseId,
        projectId,
        projectId,
        JSON.stringify(program.amount),
        gross.toString(),
        at,
      );
    const fee = gross / 4n,
      net = gross - fee;
    const intent: DirectIntent = {
      preparedAt: at,
      afterBlock: BigInt(
        (await rpc("eth_blockNumber", [])) as string,
      ).toString(),
      rail: "direct",
      network: "base-mainnet",
      chain: "base",
      asset: { address, decimals: 18, symbol: program.amount.currency },
      payer: { id: "payer", address: payer, digest: digest("payer") },
      recipient: {
        id: "reporter",
        address: reporter,
        digest: digest("reporter"),
      },
      grossBase: gross.toString(),
      feeBase: fee.toString(),
      netBase: net.toString(),
      transfers: [
        { recipient: reporter, amountBase: net.toString() },
        { recipient: wallet, amountBase: fee.toString() },
      ],
    };
    const transactions = evmDirectTransactions({
      rpcUrl,
      chainId: "8453",
      payer,
      asset: intent.asset,
      transfers: intent.transfers,
    });
    sqlite
      .prepare(
        "INSERT INTO security_direct_payments(case_id,network,intent,prepared_at) VALUES(?,?,?,?)",
      )
      .run(caseId, intent.network, JSON.stringify(intent), at);
    if (kind === "token")
      await rpc("eth_sendTransaction", [
        {
          from: payer,
          to: token,
          data: `0x40c10f19${payer.slice(2).padStart(64, "0")}${gross.toString(16).padStart(64, "0")}`,
        },
      ]);
    const hashes = [];
    for (const tx of transactions)
      hashes.push((await rpc("eth_sendTransaction", [tx])) as string);
    await rpc("anvil_mine", ["0x80"]);
    if (kind === "native")
      assert.equal(
        await new D1ConversionStore(db).nativeFeeBalance(
          "base",
          native,
          wallet,
        ),
        0n,
        "received but unverified native transfers are not fee credit",
      );
    const key = `verify-${kind}-direct-fees`;
    const statements = await verifyDirectPayment(
      db,
      { caseId, revision: 2, key, transactionIds: hashes.reverse(), at },
      () => ({ rpcUrl, feeRecipient: wallet }),
    );
    sqlite
      .prepare(
        "INSERT INTO security_case_events(case_id,case_revision,kind,actor_github_id,actor_role,idempotency_key,detail,at) VALUES(?,2,'verify-payment','1','financial',?,'{}',?)",
      )
      .run(caseId, key, at);
    await db.batch(statements);
    // A later public offer uses USDC; the paid historical asset still belongs in conversion discovery.
    const replacement = {
      ...manifest,
      status: "paused" as const,
      securityBounty: {
        ...program,
        amount: {
          currency: "USDC",
          network: "base" as const,
          decimals: 6,
          grossMinor: "4000000",
          asset: {
            network: "base" as const,
            kind: "stablecoin" as const,
            address: target,
            symbol: "USDC",
            decimals: 6,
            chainId: REWARD_ASSET_NETWORKS.base.chainId,
            cluster: null,
            verifiedAt: at,
          },
        },
      },
    };
    assertProjectDefinition(replacement);
    const revision = JSON.stringify(replacement);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,2,?,?,'later offer fixture',?)",
      )
      .run(projectId, revision, digest(revision), at);
    sqlite
      .prepare(
        "UPDATE projects SET revision=2,status='paused',manifest=?,manifest_sha256=? WHERE id=?",
      )
      .run(revision, digest(revision), projectId);
    assert(
      (await projectRewardTokens(db, "base", ["base-mainnet"])).includes(
        address,
      ),
    );
    const nativeGas = () => {
      const costs = new Map<number, bigint>();
      for (const row of sqlite
        .query<
          { nonce: number; actual_wei: string | null; maximum_wei: string },
          []
        >(
          "SELECT nonce,actual_wei,maximum_wei FROM fee_native_gas WHERE state!='abandoned'",
        )
        .all()) {
        const cost = BigInt(row.actual_wei ?? row.maximum_wei);
        if (cost > (costs.get(row.nonce) ?? 0n)) costs.set(row.nonce, cost);
      }
      return [...costs.values()].reduce((a, b) => a + b, 0n);
    };
    if (kind === "native")
      assert.equal(
        await new D1ConversionStore(db).nativeFeeBalance(
          "base",
          native,
          wallet,
        ),
        fee - nativeGas(),
        "Pages clock skew must not hide prior worker gas",
      );
    const localEnv = { ...env, FEE_CONVERTER_ALLOWLIST: "{}" };
    const before = BigInt(
      (await rpc("eth_call", [
        { to: target, data: `0x70a08231${wallet.slice(2).padStart(64, "0")}` },
        "latest",
      ])) as string,
    );
    for (let step = 0; step < 4; step++) {
      await runOnce(localEnv);
      await rpc("anvil_mine", ["0x80"]);
    }
    const rows = sqlite
      .query<
        { amount_in: string; amount_out: string; state: string },
        [string]
      >(
        "SELECT amount_in,amount_out,state FROM fee_conversions WHERE kind='conversion' AND token=?",
      )
      .all(address);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "finalized");
    assert(BigInt(rows[0].amount_in) <= fee);
    const after = BigInt(
      (await rpc("eth_call", [
        { to: target, data: `0x70a08231${wallet.slice(2).padStart(64, "0")}` },
        "latest",
      ])) as string,
    );
    assert.equal(after - before, BigInt(rows[0].amount_out));
    await runOnce(localEnv);
    if (kind === "native")
      assert.equal(
        await new D1ConversionStore(db).nativeFeeBalance(
          "base",
          native,
          wallet,
        ),
        fee - BigInt(rows[0].amount_in) - nativeGas(),
        "all actual gas stays debited despite the future Pages timestamp",
      );
    assert.equal(
      sqlite
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) n FROM fee_conversions WHERE kind='conversion' AND token=?",
        )
        .get(address)?.n,
      1,
    );
    results.push({
      kind,
      earned: fee.toString(),
      sold: rows[0].amount_in,
      proceeds: rows[0].amount_out,
      repeatUnchanged: true,
      ...(kind === "native"
        ? { pagesClockAheadByOneDay: true, allWorkerGasDebited: true }
        : {}),
    });
  }
  console.log(
    JSON.stringify({
      directFeeConversion: results,
      actualChain: true,
      liveFunds: false,
    }),
  );
}
