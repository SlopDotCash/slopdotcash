// Direct bounty payments (PRD sections 6 and 7): a payer-side condition that
// stops the unsigned Solana request is the payer's refusal to act on. It must
// reach the API as a refusal with its reason, not as an unhandled Error that
// `backend/http.ts` turns into HTTP 500 "Internal error".
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { directConsent, prepareDirectIntent } from "./direct-payments";

const OWNER = { githubId: "720000001", githubLogin: "direct-owner" };
const REPORTER = { githubId: "720000002", githubLogin: "direct-reporter" };
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const keypair = (seed: number) =>
  solanaBase58(ed25519.getPublicKey(new Uint8Array(32).fill(seed)));

/** Prepares a native SOL direct award against a fake finalized Solana RPC. */
async function prepareNativeAward(
  rpcOverrides: Record<string, unknown>,
): Promise<unknown> {
  const payer = keypair(1),
    recipient = keypair(2),
    fee = keypair(3),
    blockhash = keypair(4);
  const rpc = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { id, method } = (await request.json()) as {
        id: number;
        method: string;
      };
      const result: Record<string, unknown> = {
        getGenesisHash: GENESIS,
        getSlot: 100,
        getLatestBlockhash: {
          context: { slot: 100 },
          value: { blockhash, lastValidBlockHeight: 250 },
        },
        getBlock: { blockhash },
        getFeeForMessage: { context: { slot: 100 }, value: 5000 },
        getMinimumBalanceForRentExemption: 890880,
        // The payer holds far less than fee + rent reserve + award.
        getAccountInfo: {
          context: { slot: 100 },
          value: {
            lamports: 1000,
            owner: SOLANA_NATIVE_ASSET,
            data: ["", "base64"],
            executable: false,
            rentEpoch: 0,
          },
        },
      };
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: method in rpcOverrides ? rpcOverrides[method] : result[method],
      });
    },
  });
  try {
    const { db, sqlite } = sqliteD1();
    const stamp = "2026-10-30T00:00:00.000Z";
    const manifest = JSON.stringify(
      applicationManifest("direct-pay", "example/direct-pay", {
        status: "active",
      }),
    );
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('direct-pay',1,?,?,'seed',?)",
      )
      .run(manifest, hash(manifest), stamp);
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('direct-pay','active',1,?,?,?,?)",
      )
      .run(manifest, hash(manifest), stamp, stamp);
    for (const [actor, wallet] of [
      [OWNER, payer],
      [REPORTER, recipient],
    ] as const) {
      const id = `claim-${actor.githubId}`;
      sqlite
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,'solana')",
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
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'seed',?,?)",
        )
        .run(
          `challenge-${id}`,
          id,
          actor.githubId,
          "2027-01-01T00:00:00.000Z",
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,'seed')",
        )
        .run(id, actor.githubId, stamp, `challenge-${id}`);
    }
    const terms = {
      currency: "SOL",
      decimals: 9,
      network: "solana",
      asset: {
        network: "solana",
        kind: "native",
        address: SOLANA_NATIVE_ASSET,
        symbol: "SOL",
        decimals: 9,
        chainId: null,
        cluster: "mainnet-beta",
        verifiedAt: stamp,
      },
    } as Parameters<typeof prepareDirectIntent>[1]["terms"];
    const config = (network: string) =>
      network === "solana-mainnet"
        ? {
            rpcUrl: `http://127.0.0.1:${rpc.port}`,
            feeRecipient: fee,
            genesisHash: GENESIS,
          }
        : null;
    const caseId = "sc_direct_pay_underfunded";
    sqlite
      .prepare(
        "INSERT INTO security_cases(id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,severity,loss_finding,root_cause_key,appeal_state,revision,created_at,updated_at) VALUES(?,'direct-pay','example/direct-pay','GHSA-aaaa-bbbb-cccc',?,?,'verified',?,?,?,1,?,'confirmed','not-started','approved','rail-unavailable','embargoed','private','critical','verified-potential','root-audit','none',2,?,?)",
      )
      .run(
        caseId,
        REPORTER.githubId,
        REPORTER.githubLogin,
        stamp,
        stamp,
        OWNER.githubId,
        JSON.stringify(terms),
        stamp,
        stamp,
      );
    const consent = await directConsent(
      db,
      terms,
      "solana-mainnet",
      REPORTER.githubId,
      config,
    );
    sqlite
      .prepare(
        "INSERT INTO security_payment_consents(case_id,deployment,reporter_github_id,accepted_at,case_revision) VALUES(?,?,?,?,2)",
      )
      .run(caseId, JSON.stringify(consent), REPORTER.githubId, stamp);
    try {
      await prepareDirectIntent(
        db,
        {
          caseId,
          projectId: "direct-pay",
          reporterId: REPORTER.githubId,
          payerId: OWNER.githubId,
          terms,
          grossBase: "4000000000",
          split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
          network: "solana-mainnet",
          at: stamp,
        },
        config,
      );
      return null;
    } catch (error) {
      return error;
    }
  } finally {
    await rpc.stop(true);
  }
}

test("an underfunded Solana payer gets a refusal that names the cause", async () => {
  // The fake payer holds 1000 lamports: far below the award, fee and rent.
  const caught = await prepareNativeAward({});
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    status: 409,
    code: "payer_unfunded",
    message: "The payer needs the award, transaction fee and account rent",
  });
});

test("a payer that is not a plain wallet account gets the same refusal", async () => {
  const caught = await prepareNativeAward({
    getAccountInfo: {
      context: { slot: 100 },
      value: {
        lamports: 10_000_000_000,
        owner: keypair(9),
        data: ["", "base64"],
        executable: false,
        rentEpoch: 0,
      },
    },
  });
  expect(caught).toMatchObject({
    status: 409,
    code: "payer_unfunded",
    message: "The payer is not a native wallet account",
  });
});

test("an RPC on another cluster is still an internal fault, not a refusal", async () => {
  const caught = await prepareNativeAward({ getGenesisHash: keypair(8) });
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("Wrong Solana cluster");
  expect((caught as { status?: unknown }).status).toBeUndefined();
});
