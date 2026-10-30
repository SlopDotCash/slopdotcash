/** Real local Anvil transfers through the private approval/consent/receipt API.
 * All accounts and assets are disposable; no public RPC or funds are used. */

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ESCROW_NETWORKS,
  EVM_NATIVE_ASSET,
} from "../../src/lib/escrow-policy.mjs";
import { rewardFields } from "../../src/lib/project-proposal";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { privateBountyTerms } from "../../src/lib/security-bounty-proposal";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { DirectIntent } from "./direct-payments";
import { handleSecurityApi } from "./handler";

const OWNER = { githubId: "710000001", githubLogin: "direct-owner" };
const REPORTER = { githubId: "710000002", githubLogin: "direct-reporter" };
const port = Number(process.env.SLOP_DIRECT_TEST_PORT ?? 28677);
const rpcUrl = `http://127.0.0.1:${port}`;
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
let sequence = 0;
async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
  });
  const result = (await response.json()) as {
    error?: unknown;
    result: unknown;
  };
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result;
}
for (const scenario of [
  "native",
  "token",
  "usdc",
  "usdg",
  "full-award",
] as const) {
  const chain = scenario === "usdg" ? "robinhood" : "base",
    network = chain === "base" ? "base-mainnet" : "robinhood-mainnet";
  const node = Bun.spawn(
    [
      "anvil",
      "--port",
      String(port),
      "--chain-id",
      ESCROW_NETWORKS[network].chainId as string,
      "--silent",
    ],
    { stdout: "ignore", stderr: "inherit" },
  );
  // Model Base's zero additional local-chain costs explicitly. Anvil is not
  // an OP Stack node; production verifiers never infer zero from absent fees.
  const feeRpc = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await request.text();
      const query = JSON.parse(body) as { method: string };
      const upstream = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const value = await upstream.json();
      if (query.method === "eth_getTransactionReceipt" && value.result)
        value.result.l1Fee = "0x0";
      return Response.json(value);
    },
  });
  const verificationRpcUrl = `http://127.0.0.1:${feeRpc.port}`;
  try {
    for (let i = 0; ; i++) {
      try {
        await rpc("eth_chainId");
        break;
      } catch (error) {
        if (i > 80) throw error;
        await Bun.sleep(100);
      }
    }
    await rpc("anvil_setCode", [
      "0x420000000000000000000000000000000000000f",
      "0x600060005260206000f3",
    ]);
    const [payer, recipient, fee, wrong] = (await rpc(
      "eth_accounts",
    )) as string[];
    let address: string = EVM_NATIVE_ASSET;
    let symbol = "ETH",
      decimals = 18,
      kind = "native";
    if (scenario === "token" || scenario === "usdg" || scenario === "usdc") {
      const code = execFileSync(
        "forge",
        [
          "inspect",
          "--root",
          "contracts/evm",
          scenario === "usdg" || scenario === "usdc"
            ? "FeeConverterUSDC"
            : "FeeConverterToken",
          "deployedBytecode",
        ],
        { encoding: "utf8" },
      ).trim();
      address =
        scenario === "usdg"
          ? REWARD_ASSET_NETWORKS.robinhood.stablecoin.address
          : scenario === "usdc"
            ? REWARD_ASSET_NETWORKS.base.stablecoin.address
            : `0x${"c".repeat(40)}`;
      await rpc("anvil_setCode", [address, code]);
      symbol =
        scenario === "usdg" ? "USDG" : scenario === "usdc" ? "USDC" : "TEST";
      decimals = scenario === "usdg" || scenario === "usdc" ? 6 : 18;
      kind =
        scenario === "usdg" || scenario === "usdc" ? "stablecoin" : "token";
      const amount = 40n * 10n ** BigInt(decimals);
      await rpc("eth_sendTransaction", [
        {
          from: payer,
          to: address,
          data: `0x40c10f19${payer.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`,
        },
      ]);
    }
    const asset = {
      network: chain,
      kind,
      address,
      symbol,
      decimals,
      chainId: REWARD_ASSET_NETWORKS[chain].chainId,
      cluster: null,
      verifiedAt: new Date().toISOString(),
    };
    const gross = (4n * 10n ** BigInt(decimals)).toString();
    const terms = privateBountyTerms({
      name: "Direct payment",
      repository: "example/direct-payment",
      commit: "a".repeat(40),
      scope: "Local synthetic payment verification.",
      criteria: "A reproduced synthetic critical flaw.",
      testing: "Use only local synthetic balances.",
      actor: OWNER,
      funding: {
        mode: "monthly",
        network: chain,
        assetKind: kind as "native" | "token" | "stablecoin",
        tokenAddress: address,
        tokenSymbol: symbol,
        monthlyAmount: "4",
      },
    });
    const program = {
      ...terms,
      amount: {
        currency: symbol,
        network: chain,
        decimals,
        grossMinor: gross,
        asset,
      },
      ...(scenario === "full-award"
        ? { split: { researcherBasisPoints: 10000, slopBasisPoints: 0 } }
        : {}),
    };
    const manifest = applicationManifest(
      "direct-payment",
      "example/direct-payment",
      {
        ...rewardFields(
          {
            mode: "none",
            network: chain,
            assetKind: "stablecoin",
            tokenAddress: "",
            tokenSymbol: "",
            monthlyAmount: "",
          },
          new Date(),
        ),
        securityBounty: program,
        status: "active",
      },
    );
    delete manifest.rewardAsset;
    delete manifest.escrow;
    const { db, sqlite } = sqliteD1();
    const stamp = new Date(Date.now() - 60000).toISOString(),
      text = JSON.stringify(manifest);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('direct-payment',1,?,?,'local fixture',?)",
      )
      .run(text, hash(text), stamp);
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('direct-payment','active',1,?,?,?,?)",
      )
      .run(text, hash(text), stamp, stamp);
    for (const [actor, wallet] of [
      [OWNER, payer],
      [REPORTER, recipient],
    ] as const) {
      const id = `claim-${actor.githubId}`;
      sqlite
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,?)",
        )
        .run(
          id,
          actor.githubId,
          actor.githubLogin,
          wallet,
          hash(id),
          stamp,
          hash(`${id}-record`),
          stamp,
          chain,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'verified fixture',?,?)",
        )
        .run(
          `challenge-${id}`,
          id,
          actor.githubId,
          new Date(Date.now() + 86400000).toISOString(),
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          actor.githubId,
          stamp,
          `challenge-${id}`,
          "verified-fixture-signature",
        );
    }
    let activeRpcUrl = verificationRpcUrl;
    const deps = {
      db,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      sessionActor: async () => OWNER,
      reportingRead: async () => ({ kind: "unavailable" as const }),
      directPayments: (key: string) =>
        key === network ? { rpcUrl: activeRpcUrl, feeRecipient: fee } : null,
    };
    async function call(actor: typeof OWNER, path: string, body?: unknown) {
      const response = await handleSecurityApi(
        new Request(`https://local.test/api/v1/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "https://local.test",
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { ...deps, sessionActor: async () => actor },
      );
      assert(response);
      return {
        status: response.status,
        body: (await response.json()) as {
          error?: string;
          case: {
            revision: number;
            awardState: string;
            paymentState: string;
            settlement: {
              ownerRequest: DirectIntent;
              walletReviewRequired: boolean;
              confirmedTransactionIds: string[];
              remainingTransfers: { recipient: string; amountBase: string }[];
              generation: number;
              recovery: {
                mode: string;
                consented: boolean;
                target: { address: string } | null;
                cancellationRequest?: {
                  from: string;
                  to: string;
                  value: string;
                  data: string;
                  nonce: string;
                  chainId: string;
                };
              } | null;
            };
          };
        },
      };
    }
    async function act(
      actor: typeof OWNER,
      id: string,
      action: string,
      extra: Record<string, unknown> = {},
    ) {
      const current = await call(actor, `security-cases/${id}`);
      return call(actor, `security-cases/${id}/actions`, {
        action,
        expectedRevision: current.body.case.revision,
        idempotencyKey: `direct-local-test-${++sequence}`,
        ...extra,
      });
    }
    function seedCase(id: string, rootCause: string) {
      const split =
        program.split.researcherBasisPoints === 10000
          ? { researcherMinor: gross, slopMinor: "0" }
          : {
              researcherMinor: ((BigInt(gross) * 3n) / 4n).toString(),
              slopMinor: (BigInt(gross) / 4n).toString(),
            };
      const frozen = {
        ...program.amount,
        ...split,
        fundingPolicy: "after-approval",
        split: program.split,
        capacityAwards: null,
      };
      sqlite
        .prepare(
          "INSERT INTO security_cases(id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,severity,loss_finding,root_cause_key,appeal_state,revision,created_at,updated_at) VALUES(?,'direct-payment','example/direct-payment',?, ?,?,'verified',?,?,?,1,?,'confirmed','not-started','pending','not-applicable','embargoed','private','critical','verified-potential',?,'none',1,?,?)",
        )
        .run(
          id,
          (
            {
              "root-one": "GHSA-2345-6789-cfgh",
              "root-two": "GHSA-3456-789c-fghj",
              "root-three": "GHSA-4567-89cf-ghjm",
              "root-four": "GHSA-5678-9cfg-hjmp",
            } as Record<string, string>
          )[rootCause],
          REPORTER.githubId,
          REPORTER.githubLogin,
          stamp,
          stamp,
          OWNER.githubId,
          JSON.stringify(frozen),
          rootCause,
          stamp,
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO security_case_events(case_id,case_revision,kind,actor_github_id,actor_role,idempotency_key,detail,at) VALUES(?,1,'decide',?,'security-maintainer',?,'{\"inScope\":true}',?)",
        )
        .run(id, OWNER.githubId, `${id}-seed`, stamp);
    }
    function rotateReporter(target: string, label: string) {
      const prior = sqlite
        .query<{ id: string }, [string]>(
          "SELECT id FROM effective_payment_wallet_claims WHERE github_user_id=?",
        )
        .get(REPORTER.githubId);
      assert.ok(prior);
      const nextClaim = `claim-reporter-${label}`;
      sqlite
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain,supersedes_claim_id) SELECT ?,github_user_id,github_login,?,source,source_body_sha256,observed_at,?,created_at,chain,id FROM wallet_claims WHERE id=?",
        )
        .run(nextClaim, target, hash(nextClaim), prior.id);
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'rotated test wallet',?,?)",
        )
        .run(
          `challenge-${label}`,
          nextClaim,
          REPORTER.githubId,
          new Date(Date.now() + 86400000).toISOString(),
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
        )
        .run(
          nextClaim,
          REPORTER.githubId,
          stamp,
          `challenge-${label}`,
          "verified-local-fixture",
        );
    }
    async function prepareCase(id: string, rootCause: string) {
      seedCase(id, rootCause);
      const approved = await act(OWNER, id, "award", {
        decision: "amount",
        grossMinor: gross,
        paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
        confirmation: true,
        reason: "Review an isolated nonce recovery.",
      });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(
        (
          await act(REPORTER, id, "consent-payment", {
            network,
            confirmation: true,
          })
        ).status,
        200,
      );
      const prepared = await act(OWNER, id, "prepare-payment", {
        network,
        confirmation: true,
      });
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
      return JSON.parse(
        sqlite
          .query<{ intent: string }, [string]>(
            "SELECT intent FROM security_direct_payments WHERE case_id=?",
          )
          .get(id)?.intent ?? "null",
      ) as DirectIntent;
    }
    const caseId = "sc_direct_payment_1";
    seedCase(caseId, "root-one");
    const awarded = await act(OWNER, caseId, "award", {
      decision: "amount",
      grossMinor: gross,
      paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
      confirmation: true,
      reason: "Approve the isolated synthetic transfer.",
    });
    assert.equal(awarded.status, 200, JSON.stringify(awarded.body));
    assert.equal(awarded.body.case.awardState, "approved");
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT COUNT(*) n FROM security_award_reservations",
        )
        .get()?.n,
      0,
      "direct approval never claims reserved vault funds",
    );
    assert.equal(
      (
        await act(OWNER, caseId, "prepare-payment", {
          network,
          confirmation: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await act(REPORTER, caseId, "consent-payment", {
          network,
          confirmation: true,
        })
      ).status,
      200,
    );
    if (scenario === "token" || scenario === "native") {
      const unavailable = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const body = await request.text();
          const parsed = JSON.parse(body) as { method: string; id: number };
          if (parsed.method.startsWith("debug_"))
            return Response.json({
              jsonrpc: "2.0",
              id: parsed.id,
              error: { code: -32601, message: "method not available" },
            });
          return fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
        },
      });
      activeRpcUrl = `http://127.0.0.1:${unavailable.port}`;
      try {
        const refused = await act(OWNER, caseId, "prepare-payment", {
          network,
          confirmation: true,
        });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.error, "payment_proof_unavailable");
        assert.equal(
          sqlite
            .query<{ n: number }, []>(
              "SELECT COUNT(*) n FROM security_direct_payments",
            )
            .get()?.n,
          0,
        );
      } finally {
        activeRpcUrl = verificationRpcUrl;
        await unavailable.stop(true);
      }
    }
    const prepared = await act(OWNER, caseId, "prepare-payment", {
      network,
      confirmation: true,
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const intent = prepared.body.case.settlement.ownerRequest;
    assert.equal(intent.asset.address.toLowerCase(), address.toLowerCase());
    const transactions = intent.transactions as {
      from: string;
      to: string;
      data: string;
      value: string;
    }[];
    assert.equal(transactions.length, scenario === "full-award" ? 1 : 2);
    const next = "sc_direct_payment_2";
    seedCase(next, "root-two");
    assert.equal(
      (
        await act(OWNER, next, "award", {
          decision: "amount",
          grossMinor: gross,
          paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
          confirmation: true,
          reason: "Approve another isolated synthetic transfer.",
        })
      ).status,
      200,
    );
    await act(REPORTER, next, "consent-payment", {
      network,
      confirmation: true,
    });
    await act(OWNER, next, "prepare-payment", { network, confirmation: true });
    const wrongHash = (await rpc("eth_sendTransaction", [
      { ...transactions[0], from: wrong, to: wrong, nonce: undefined },
    ])) as string;
    await rpc("anvil_mine", ["0x80"]);
    assert.equal(
      (
        await act(OWNER, caseId, "verify-payment", {
          transactionIds: transactions.map(() => wrongHash),
          confirmation: true,
        })
      ).status,
      409,
    );
    if (scenario === "token") {
      const maliciousCode = execFileSync(
        "forge",
        [
          "inspect",
          "--root",
          "contracts/evm",
          "DirectPaymentAdversary",
          "deployedBytecode",
        ],
        { encoding: "utf8" },
      ).trim();
      for (const mode of [1, 2]) {
        const checkpoint = await rpc("evm_snapshot");
        await rpc("anvil_setCode", [address, maliciousCode]);
        const data = execFileSync(
          "cast",
          ["calldata", "setMode(uint256)", String(mode)],
          { encoding: "utf8" },
        ).trim();
        await rpc("eth_sendTransaction", [{ from: wrong, to: address, data }]);
        const fake = [];
        for (const tx of transactions)
          fake.push(await rpc("eth_sendTransaction", [tx]));
        await rpc("anvil_mine", ["0x80"]);
        const refused = await act(OWNER, caseId, "verify-payment", {
          transactionIds: fake,
          confirmation: true,
        });
        assert.equal(
          refused.status,
          409,
          `mode ${mode} must not become paid from exact-looking Transfer logs`,
        );
        assert.ok(
          ["payment_unverified", "payment_proof_unavailable"].includes(
            refused.body.error ?? "",
          ),
        );
        assert.equal(await rpc("evm_revert", [checkpoint]), true);
      }
    }
    if (scenario === "native") {
      const checkpoint = await rpc("evm_snapshot");
      // A wallet can gain receive code after it was verified. This handler
      // refunds all incoming value to the payer although the call succeeds.
      await rpc("anvil_setCode", [recipient, "0x600060006000600034335af15000"]);
      const fake: string[] = [];
      for (const tx of transactions)
        fake.push(
          (await rpc("eth_sendTransaction", [
            { ...tx, gas: "0x186a0" },
          ])) as string,
        );
      await rpc("anvil_mine", ["0x80"]);
      const refused = await act(OWNER, caseId, "verify-payment", {
        transactionIds: fake,
        confirmation: true,
      });
      assert.equal(
        refused.status,
        409,
        "a refunded native transfer cannot be paid",
      );
      assert.equal(refused.body.error, "payment_unverified");
      assert.equal(
        sqlite
          .query<{ n: number }, [string]>(
            "SELECT COUNT(*) n FROM security_direct_transfer_receipts WHERE case_id=?",
          )
          .get(caseId)?.n,
        0,
      );
      assert.equal(await rpc("evm_revert", [checkpoint]), true);
    }
    const payerBefore = BigInt(
      (await rpc("eth_getBalance", [payer, "latest"])) as string,
    );
    const hashes: string[] = [];
    if (scenario === "token" || scenario === "native")
      await rpc("evm_setAutomine", [false]);
    for (const tx of transactions)
      hashes.push((await rpc("eth_sendTransaction", [tx])) as string);
    if (scenario === "native") {
      // Other native credits in the same block must not contaminate the exact
      // transaction-state deltas used to verify either award leg.
      await rpc("eth_sendTransaction", [
        { from: wrong, to: recipient, value: "0x1" },
      ]);
      await rpc("eth_sendTransaction", [
        { from: wrong, to: fee, value: "0x1" },
      ]);
    }
    if (scenario === "token" || scenario === "native") {
      await rpc("anvil_mine", ["0x1"]);
      await rpc("evm_setAutomine", [true]);
    }
    await rpc("anvil_mine", ["0x1"]);
    if (kind === "native") {
      let actualGas = 0n;
      for (const hash of hashes) {
        const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
          gasUsed: string;
          effectiveGasPrice: string;
        };
        actualGas +=
          BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
      }
      const payerAfter = BigInt(
        (await rpc("eth_getBalance", [payer, "latest"])) as string,
      );
      assert.equal(
        payerBefore - payerAfter,
        BigInt(gross) + actualGas,
        "payer covers native award plus exact transaction gas",
      );
    }
    const firstIndex = scenario === "native" ? 1 : 0;
    if (hashes.length === 2) {
      await rpc("anvil_mine", ["0x80"]);
      const partial = await act(OWNER, caseId, "verify-payment", {
        transactionIds: [hashes[firstIndex]],
        confirmation: true,
      });
      assert.equal(partial.status, 200, JSON.stringify(partial.body));
      assert.notEqual(partial.body.case.paymentState, "paid");
      assert.deepEqual(partial.body.case.settlement.confirmedTransactionIds, [
        hashes[firstIndex],
      ]);
      assert.equal(
        partial.body.case.settlement.ownerRequest.transactions?.length,
        1,
      );
      assert.deepEqual(
        partial.body.case.settlement.ownerRequest.transactions?.[0],
        transactions[1 - firstIndex],
      );
      assert.equal(partial.body.case.settlement.remainingTransfers.length, 1);
      const duplicate = await act(OWNER, caseId, "verify-payment", {
        transactionIds: [hashes[firstIndex]],
        confirmation: true,
      });
      assert.equal(duplicate.status, 409);
    }
    assert.notEqual(
      (await call(OWNER, `security-cases/${caseId}`)).body.case.paymentState,
      "paid",
    );
    if (scenario === "native" || scenario === "token") {
      rotateReporter(wrong, "rotated");
      const rotated = await call(OWNER, `security-cases/${caseId}`);
      assert.equal(
        rotated.body.case.settlement.walletReviewRequired,
        scenario !== "native",
      );
      if (scenario === "native") {
        assert.equal(
          rotated.body.case.settlement.ownerRequest.transactions?.length,
          1,
        );
        assert.deepEqual(
          rotated.body.case.settlement.ownerRequest.transactions?.[0],
          transactions[0],
        );
      } else assert.equal(rotated.body.case.settlement.ownerRequest, null);
      const refresh = await act(OWNER, caseId, "prepare-payment", {
        network,
        confirmation: true,
      });
      assert.equal(refresh.status, scenario === "native" ? 200 : 409);
      const unpaid = await call(OWNER, `security-cases/${next}`);
      assert.equal(unpaid.body.case.settlement.walletReviewRequired, true);
      assert.equal(
        unpaid.body.case.settlement.ownerRequest.transactions?.length,
        1,
      );
      assert.equal(
        unpaid.body.case.settlement.ownerRequest.transfers[0].recipient.toLowerCase(),
        fee.toLowerCase(),
      );
    }
    await rpc("anvil_mine", ["0x80"]);
    const paid = await act(OWNER, caseId, "verify-payment", {
      transactionIds: hashes.length === 2 ? [hashes[1 - firstIndex]] : hashes,
      confirmation: true,
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.case.paymentState, "paid");
    assert.equal(
      (
        await act(OWNER, caseId, "verify-payment", {
          transactionIds: hashes,
          confirmation: true,
        })
      ).status,
      409,
    );
    const replay = await act(OWNER, next, "verify-payment", {
      transactionIds: hashes,
      confirmation: true,
    });
    assert.equal(
      replay.status,
      409,
      "one transaction cannot pay two prepared awards",
    );
    assert.ok(
      ["payment_replay", "payment_unverified"].includes(
        replay.body.error ?? "",
      ),
    );
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT COUNT(*) n FROM security_direct_payment_receipts",
        )
        .get()?.n,
      1,
    );
    if (scenario === "native" || scenario === "token") {
      const originalText = sqlite
        .query<{ intent: string }, [string]>(
          "SELECT intent FROM security_direct_payments WHERE case_id=?",
        )
        .get(next)?.intent;
      assert.ok(originalText);
      const original = JSON.parse(originalText) as DirectIntent;
      const originalTransactions = original.transactions;
      assert.ok(originalTransactions?.[0]?.nonce);
      assert.equal(
        (await act(OWNER, next, "recover-payment", { confirmation: true })).body
          .error,
        "payment_consent_required",
      );
      assert.equal(
        (
          await act(REPORTER, next, "consent-payment", {
            network,
            confirmation: true,
          })
        ).status,
        200,
      );
      const unsent = (await call(OWNER, `security-cases/${next}`)).body.case
        .settlement;
      assert.equal(unsent.recovery?.mode, "fee-pending");
      assert.equal(unsent.recovery.cancellationRequest, undefined);
      assert.deepEqual(unsent.ownerRequest.transactions, [
        originalTransactions[1],
      ]);
      assert.equal(
        (await act(OWNER, next, "recover-payment", { confirmation: true })).body
          .error,
        "fee_payment_pending",
      );
      const feeHash = (await rpc("eth_sendTransaction", [
        originalTransactions[1],
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const feeOnly = await act(OWNER, next, "verify-payment", {
        transactionIds: [feeHash],
        confirmation: true,
      });
      assert.equal(feeOnly.status, 200, JSON.stringify(feeOnly.body));
      assert.equal(
        feeOnly.body.case.settlement.recovery?.mode,
        "cancellation-required",
      );
      assert.equal(feeOnly.body.case.settlement.ownerRequest, null);
      const review = (await call(OWNER, `security-cases/${next}`)).body.case
        .settlement;
      assert.equal(review.recovery?.mode, "cancellation-required");
      const beforeDelegation = await rpc("evm_snapshot");
      await rpc("anvil_setCode", [payer, `0xef0100${wrong.slice(2)}`]);
      const unsafe = (await call(OWNER, `security-cases/${next}`)).body.case
        .settlement;
      assert.equal(unsafe.recovery?.mode, "payer-review");
      assert.equal(
        unsafe.recovery.cancellationRequest,
        undefined,
        "do not invite a self-call through delegated payer code",
      );
      assert.equal(await rpc("evm_revert", [beforeDelegation]), true);
      assert.equal(
        review.recovery.target?.address.toLowerCase(),
        wrong.toLowerCase(),
      );
      assert.equal(
        (
          await act(OWNER, next, "recover-payment", {
            confirmation: true,
            cancellationTransactionId: wrongHash,
          })
        ).body.error,
        "cancellation_unverified",
      );
      const cancellation = review.recovery.cancellationRequest;
      assert.ok(cancellation);
      assert.equal(cancellation.nonce, originalTransactions[0].nonce);
      assert.equal(cancellation.to.toLowerCase(), payer.toLowerCase());
      assert.equal(cancellation.value, "0x0");
      assert.equal(cancellation.data, "0x");
      const cancellationHash = (await rpc("eth_sendTransaction", [
        scenario === "token"
          ? { ...cancellation, to: address, data: "0xdeadbeef", gas: "0x186a0" }
          : cancellation,
      ])) as string;
      await rpc("anvil_mine", ["0x1"]);
      if (scenario === "token") {
        const failed = (await rpc("eth_getTransactionReceipt", [
          cancellationHash,
        ])) as { status: string };
        assert.equal(
          failed.status,
          "0x0",
          "a finalized reverted transaction also retires its nonce",
        );
      }
      const early = await act(OWNER, next, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: cancellationHash,
      });
      assert.equal(
        early.status,
        409,
        "a mined but unfinalized cancellation cannot redirect funds",
      );
      await rpc("anvil_mine", ["0x80"]);
      const recovered = await act(OWNER, next, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: cancellationHash,
      });
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      assert.equal(recovered.body.case.settlement.generation, 1);
      assert.deepEqual(recovered.body.case.settlement.confirmedTransactionIds, [
        feeHash,
      ]);
      const replacement = recovered.body.case.settlement.ownerRequest;
      assert.equal(replacement.transactions?.length, 1);
      assert.equal(
        replacement.transfers[0].recipient.toLowerCase(),
        wrong.toLowerCase(),
      );
      assert.equal(replacement.transfers[0].amountBase, original.netBase);
      assert.equal(replacement.grossBase, original.grossBase);
      assert.equal(replacement.feeBase, original.feeBase);
      assert.notEqual(replacement.transactions[0].nonce, cancellation.nonce);
      assert.equal(
        sqlite
          .query<{ intent: string }, [string]>(
            "SELECT intent FROM security_direct_payments WHERE case_id=?",
          )
          .get(next)?.intent,
        originalText,
        "recovery appends a successor without editing the approved original",
      );
      const recipientBalance = async () =>
        BigInt(
          (await rpc(
            scenario === "native" ? "eth_getBalance" : "eth_call",
            scenario === "native"
              ? [wrong, "latest"]
              : [
                  {
                    to: address,
                    data: `0x70a08231${wrong.slice(2).padStart(64, "0")}`,
                  },
                  "latest",
                ],
          )) as string,
        );
      const before = await recipientBalance();
      const replacementHash = (await rpc("eth_sendTransaction", [
        replacement.transactions[0],
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const finished = await act(OWNER, next, "verify-payment", {
        transactionIds: [replacementHash],
        confirmation: true,
      });
      assert.equal(finished.status, 200, JSON.stringify(finished.body));
      assert.equal(finished.body.case.paymentState, "paid");
      const after = await recipientBalance();
      assert.equal(after - before, BigInt(original.netBase));
      await assert.rejects(
        rpc("eth_sendTransaction", [originalTransactions[0]]),
      );
      assert.equal(
        (
          await act(OWNER, next, "recover-payment", {
            confirmation: true,
            cancellationTransactionId: cancellationHash,
          })
        ).status,
        409,
      );
      if (scenario === "native") {
        const legacyId = "sc_direct_payment_3";
        seedCase(legacyId, "root-three");
        assert.equal(
          (
            await act(OWNER, legacyId, "award", {
              decision: "amount",
              grossMinor: gross,
              paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
              confirmation: true,
              reason: "Review an existing unpinned payment request.",
            })
          ).status,
          200,
        );
        const legacy = {
          ...original,
          protocolVersion: undefined,
          afterBlocks: undefined,
          transactions: originalTransactions.map(
            ({ nonce: _nonce, ...transaction }) => transaction,
          ),
        };
        sqlite
          .prepare(
            "INSERT INTO security_direct_payments(case_id,network,intent,prepared_at) VALUES(?,?,?,?)",
          )
          .run(legacyId, network, JSON.stringify(legacy), stamp);
        const held = (await call(OWNER, `security-cases/${legacyId}`)).body.case
          .settlement;
        assert.equal(held.recovery?.mode, "legacy-manual");
        assert.equal(held.ownerRequest, null);
        await act(REPORTER, legacyId, "consent-payment", {
          network,
          confirmation: true,
        });
        const refused = await act(OWNER, legacyId, "recover-payment", {
          confirmation: true,
          cancellationTransactionId: cancellationHash,
        });
        assert.equal(refused.status, 409);
        assert.equal(refused.body.error, "legacy_payment_review_required");
        rotateReporter(recipient, "restored");
        assert.equal(
          (await call(OWNER, `security-cases/${legacyId}`)).body.case.settlement
            .recovery?.mode,
          "resume-original",
        );
        assert.equal(
          (
            await act(REPORTER, legacyId, "consent-payment", {
              network,
              confirmation: true,
            })
          ).status,
          200,
        );
        const resumed = await act(OWNER, legacyId, "recover-payment", {
          confirmation: true,
        });
        assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
        assert.equal(
          resumed.body.case.settlement.ownerRequest.transfers[0].recipient.toLowerCase(),
          recipient.toLowerCase(),
        );
        assert.equal(
          sqlite
            .query<{ n: number }, [string]>(
              "SELECT COUNT(*) n FROM security_direct_nonce_reservations WHERE case_id=?",
            )
            .get(legacyId)?.n,
          0,
          "legacy consent renewal must not fabricate nonce retirement",
        );
      }
    }
    if (scenario === "full-award") {
      const oldIntent = JSON.parse(
        sqlite
          .query<{ intent: string }, [string]>(
            "SELECT intent FROM security_direct_payments WHERE case_id=?",
          )
          .get(next)?.intent ?? "null",
      ) as DirectIntent;
      assert.ok(oldIntent.transactions?.[0]?.nonce);
      const checkpoint = await rpc("evm_snapshot");
      const delegate = `0x${"d".repeat(40)}`;
      await rpc("anvil_setCode", [delegate, "0x00"]);
      await rpc("anvil_setCode", [payer, `0xef0100${delegate.slice(2)}`]);
      const delegatedHash = (await rpc("eth_sendTransaction", [
        { ...oldIntent.transactions[0], to: payer, value: "0x0", data: "0x" },
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const delegated = await act(OWNER, next, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: delegatedHash,
      });
      assert.equal(
        delegated.status,
        409,
        "a delegated wallet's successful self-call cannot prove no award moved",
      );
      assert.equal(delegated.body.error, "cancellation_unverified");
      assert.equal(await rpc("evm_revert", [checkpoint]), true);
      const consumed = (await rpc("eth_sendTransaction", [
        { ...oldIntent.transactions[0], to: payer, value: "0x0", data: "0x" },
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const blocked = (await call(OWNER, `security-cases/${next}`)).body.case
        .settlement;
      assert.equal(blocked.recovery?.mode, "retirement-required");
      assert.equal(
        blocked.recovery.consented,
        true,
        "same verified wallet retains its original consent",
      );
      const recovered = await act(OWNER, next, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: consumed,
      });
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      const replacement = recovered.body.case.settlement.ownerRequest;
      assert.equal(
        replacement.transfers[0].recipient.toLowerCase(),
        recipient.toLowerCase(),
      );
      assert.notEqual(
        replacement.transactions?.[0].nonce,
        oldIntent.transactions[0].nonce,
      );
      const payment = (await rpc("eth_sendTransaction", [
        replacement.transactions?.[0],
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const paid = await act(OWNER, next, "verify-payment", {
        confirmation: true,
        transactionIds: [payment],
      });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal(paid.body.case.paymentState, "paid");
    }
    if (scenario === "native") {
      const id = "sc_direct_payment_4",
        plan = await prepareCase(id, "root-four");
      assert.ok(plan.transactions);
      const cancelled = (await rpc("eth_sendTransaction", [
        { ...plan.transactions[1], to: payer, value: "0x0", data: "0x" },
      ])) as string;
      const researcher = (await rpc("eth_sendTransaction", [
        plan.transactions[0],
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      assert.equal(
        (
          await act(OWNER, id, "verify-payment", {
            confirmation: true,
            transactionIds: [researcher],
          })
        ).status,
        200,
      );
      const before = (await call(OWNER, `security-cases/${id}`)).body.case
        .settlement;
      assert.equal(before.recovery?.mode, "retirement-required");
      const recovered = await act(OWNER, id, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: cancelled,
      });
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      const pending = recovered.body.case.settlement.ownerRequest;
      assert.equal(pending.transactions?.length, 1);
      assert.equal(
        pending.transfers[0].recipient.toLowerCase(),
        fee.toLowerCase(),
      );
      const current = JSON.parse(
        sqlite
          .query<{ intent: string }, [string]>(
            "SELECT intent FROM security_direct_current_payments WHERE case_id=?",
          )
          .get(id)?.intent ?? "null",
      ) as DirectIntent;
      assert.deepEqual(
        current.transactions?.[0],
        plan.transactions[0],
        "paid researcher leg stays byte-identical",
      );
      const paidFee = (await rpc("eth_sendTransaction", [
        pending.transactions[0],
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const paid = await act(OWNER, id, "verify-payment", {
        confirmation: true,
        transactionIds: [paidFee],
      });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal(paid.body.case.paymentState, "paid");
    }
    if (scenario === "token") {
      const id = "sc_direct_payment_3",
        plan = await prepareCase(id, "root-three");
      assert.ok(plan.transactions);
      const cancelledFee = (await rpc("eth_sendTransaction", [
        { ...plan.transactions[1], to: payer, value: "0x0", data: "0x" },
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const recoveredFee = await act(OWNER, id, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: cancelledFee,
      });
      assert.equal(recoveredFee.status, 200, JSON.stringify(recoveredFee.body));
      rotateReporter(recipient, "fee-nonce-rotated");
      assert.equal(
        (
          await act(REPORTER, id, "consent-payment", {
            network,
            confirmation: true,
          })
        ).status,
        200,
      );
      const rotated = (await call(OWNER, `security-cases/${id}`)).body.case
        .settlement;
      assert.equal(
        rotated.recovery?.mode,
        "cancellation-required",
        "higher replacement fee must not block lower researcher cancellation",
      );
      assert.ok(rotated.recovery.cancellationRequest);
      const cancelledResearcher = (await rpc("eth_sendTransaction", [
        rotated.recovery.cancellationRequest,
      ])) as string;
      await rpc("anvil_mine", ["0x80"]);
      const recovered = await act(OWNER, id, "recover-payment", {
        confirmation: true,
        cancellationTransactionId: cancelledResearcher,
      });
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      const pending = recovered.body.case.settlement.ownerRequest;
      assert.equal(pending.transactions?.length, 2);
      assert.equal(
        pending.transfers[0].recipient.toLowerCase(),
        fee.toLowerCase(),
      );
      const ids = [];
      for (const tx of pending.transactions)
        ids.push(await rpc("eth_sendTransaction", [tx]));
      await rpc("anvil_mine", ["0x80"]);
      const paid = await act(OWNER, id, "verify-payment", {
        confirmation: true,
        transactionIds: ids,
      });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal(paid.body.case.paymentState, "paid");
    }
    if (scenario === "usdc") {
      const ordinary = (transactionId: string) =>
        sqlite
          .prepare(
            "INSERT INTO payment_direct_transfers(network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at) VALUES('base-mainnet',?,'ordinary-fixture','2026-10','2','node','local-reporter','base',?,'3000000',?,'local-block','disclosures/local-fixture.json',?)",
          )
          .run(transactionId, recipient, stamp, stamp);
      assert.throws(() => ordinary(hashes[0]));
      const nextPlan = (await call(OWNER, `security-cases/${next}`)).body.case
        .settlement.ownerRequest.transactions as typeof transactions;
      let external = "";
      for (const tx of nextPlan) {
        const hash = (await rpc("eth_sendTransaction", [tx])) as string;
        if (
          tx.to.toLowerCase() === address.toLowerCase() &&
          tx.data.slice(10, 74).endsWith(recipient.slice(2).toLowerCase())
        )
          external = hash;
      }
      assert.ok(external);
      await rpc("anvil_mine", ["0x80"]);
      ordinary(external);
      const reused = await act(OWNER, next, "verify-payment", {
        transactionIds: [external],
        confirmation: true,
      });
      assert.equal(reused.status, 409);
      assert.equal(reused.body.error, "payment_replay");
      // Recreate the pre-0109 shape with this real completed receipt, then upgrade it.
      const upgrade = Database.deserialize(sqlite.serialize());
      for (const trigger of [
        "security_direct_transfer_receipts_no_update",
        "security_direct_transfer_receipts_no_delete",
        "security_direct_transfer_no_public_replay",
        "payment_direct_no_security_replay",
      ])
        upgrade.exec(`DROP TRIGGER ${trigger}`);
      upgrade.exec(
        "DROP TABLE security_direct_transfer_receipts; PRAGMA foreign_keys=ON;",
      );
      upgrade.exec(
        readFileSync(
          "migrations/0109_direct_payment_transfer_receipts.sql",
          "utf8",
        ),
      );
      assert.equal(
        upgrade
          .query<{ n: number }, []>(
            "SELECT COUNT(*) n FROM security_direct_transfer_receipts",
          )
          .get()?.n,
        2,
      );
      assert.equal(
        upgrade
          .query<{ n: number }, []>(
            "SELECT COUNT(*) n FROM security_direct_payment_receipts",
          )
          .get()?.n,
        1,
      );
      upgrade.close();
      const racing = ["sc_direct_payment_3", "sc_direct_payment_4"];
      for (const [index, id] of racing.entries()) {
        seedCase(id, index === 0 ? "root-three" : "root-four");
        assert.equal(
          (
            await act(OWNER, id, "award", {
              decision: "amount",
              grossMinor: gross,
              paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
              confirmation: true,
              reason: "Approve an isolated concurrent replay test.",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await act(REPORTER, id, "consent-payment", {
              network,
              confirmation: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await act(OWNER, id, "prepare-payment", {
              network,
              confirmation: true,
            })
          ).status,
          200,
        );
      }
      const racePlan = (await call(OWNER, `security-cases/${racing[0]}`)).body
        .case.settlement.ownerRequest.transactions as typeof transactions;
      let shared = "";
      for (const tx of racePlan) {
        const hash = (await rpc("eth_sendTransaction", [tx])) as string;
        if (tx.data.slice(10, 74).endsWith(recipient.slice(2).toLowerCase()))
          shared = hash;
      }
      assert.ok(shared);
      await rpc("anvil_mine", ["0x80"]);
      const outcomes = await Promise.all(
        racing.map((id) =>
          act(OWNER, id, "verify-payment", {
            transactionIds: [shared],
            confirmation: true,
          }),
        ),
      );
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status).sort(),
        [200, 409],
      );
      assert.equal(
        sqlite
          .query<{ n: number }, [string]>(
            "SELECT COUNT(*) n FROM security_direct_transfer_receipts WHERE transaction_id=?",
          )
          .get(shared)?.n,
        1,
      );
    }
    console.log(
      JSON.stringify({
        scenario,
        network,
        gross,
        legs: hashes.length,
        paid: true,
        partialRetainedRemainingOnly: true,
        wrongRejected: true,
        replayRejected: true,
        ...(scenario === "usdc"
          ? {
              ordinaryReplayBothOrdersRejected: true,
              concurrentReceiptOneWinner: true,
            }
          : {}),
        ...(scenario === "token"
          ? {
              forgedEventRejected: true,
              feeOnTransferRejected: true,
              traceUnavailableRefusedBeforeSigning: true,
              concurrentBlockTransfers: true,
            }
          : {}),
        ...(scenario === "native"
          ? {
              nativeRefundRejected: true,
              nativeTransactionDeltaIgnoresSameBlockGifts: true,
              traceUnavailableRefusedBeforeSigning: true,
              rotatedWalletBlocksUnpaidResearcherPreservesFeeRemainder: true,
              unsentFeePaidBeforeCancellation: true,
              exactNonceSuccessorPaid: true,
              legacyOriginalOnly: true,
            }
          : {}),
        ...(scenario === "token" ? { revertedNonceSuccessorPaid: true } : {}),
        ...(scenario === "full-award"
          ? {
              sameWalletSpentNonceRecovered: true,
              delegatedCancellationRejected: true,
            }
          : {}),
        liveFunds: false,
      }),
    );
    sqlite.close();
  } finally {
    await feeRpc.stop(true);
    node.kill();
    await node.exited;
  }
}
