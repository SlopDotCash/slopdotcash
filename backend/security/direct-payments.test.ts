// Direct bounty payments (PRD sections 6 and 7): a payer-side condition that
// stops the unsigned Solana request is the payer's refusal to act on. It must
// reach the API as a refusal with its reason, not as an unhandled Error that
// `backend/http.ts` turns into HTTP 500 "Internal error".
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaBase58,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  ESCROW_NETWORKS,
  SOLANA_NATIVE_ASSET,
} from "../../src/lib/escrow-policy.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  directConsent,
  insertDirectIntent,
  prepareDirectIntent,
  recoverDirectIntent,
  refreshDirectIntent,
} from "./direct-payments";

const OWNER = { githubId: "720000001", githubLogin: "direct-owner" };
const REPORTER = { githubId: "720000002", githubLogin: "direct-reporter" };
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const secretKey = (seed: number) => new Uint8Array(32).fill(seed);
const keypair = (seed: number) =>
  solanaBase58(ed25519.getPublicKey(secretKey(seed)));

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
    code: "payer_refused",
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
    code: "payer_refused",
    message: "The payer is not a native wallet account",
  });
});

test("an RPC on another cluster is still an internal fault, not a refusal", async () => {
  const caught = await prepareNativeAward({ getGenesisHash: keypair(8) });
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("Wrong Solana cluster");
  expect((caught as { status?: unknown }).status).toBeUndefined();
});

test("refreshing or recovering a Solana direct payment checks the intent network's genesis hash", async () => {
  const payerSecret = secretKey(1),
    payer = keypair(1),
    recipient = keypair(2),
    fee = keypair(3),
    blockhash = keypair(4),
    parentBlockhash = keypair(5),
    tipBlockhash = keypair(6);
  const devnetGenesis = ESCROW_NETWORKS["solana-devnet"].genesisHash as string;
  let activeGenesis = devnetGenesis;
  let expired = false;
  const serveRpc = () =>
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const { id, method, params } = (await request.json()) as {
          id: number;
          method: string;
          params?: unknown[];
        };
        if (method === "getGenesisHash")
          return Response.json({ jsonrpc: "2.0", id, result: activeGenesis });
        if (method === "getSlot")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: expired ? 101 : 100,
          });
        if (method === "getLatestBlockhash")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: {
              context: { slot: expired ? 101 : 100 },
              value: {
                blockhash: expired ? tipBlockhash : blockhash,
                lastValidBlockHeight: expired ? 350 : 250,
              },
            },
          });
        if (method === "getBlock") {
          const slot = params?.[0];
          return Response.json({
            jsonrpc: "2.0",
            id,
            result:
              slot === 101
                ? {
                    blockhash: tipBlockhash,
                    parentSlot: 100,
                    previousBlockhash: blockhash,
                    signatures: [],
                  }
                : {
                    blockhash,
                    parentSlot: 99,
                    previousBlockhash: parentBlockhash,
                    signatures: [],
                  },
          });
        }
        if (method === "getFeeForMessage")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: { context: { slot: 100 }, value: 5000 },
          });
        if (method === "getMinimumBalanceForRentExemption")
          return Response.json({ jsonrpc: "2.0", id, result: 890880 });
        if (method === "getAccountInfo")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: {
              context: { slot: 100 },
              value: {
                lamports: 10_000_000_000,
                owner: SOLANA_NATIVE_ASSET,
                data: ["", "base64"],
                executable: false,
                rentEpoch: 0,
              },
            },
          });
        if (method === "simulateTransaction")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: { context: { slot: 100 }, value: { err: null } },
          });
        if (method === "isBlockhashValid")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: {
              context: { slot: expired ? 101 : 100 },
              value: !expired,
            },
          });
        if (method === "getBlockHeight")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: expired ? 300 : 200,
          });
        if (method === "getFirstAvailableBlock")
          return Response.json({ jsonrpc: "2.0", id, result: 0 });
        if (method === "getSignatureStatuses")
          return Response.json({
            jsonrpc: "2.0",
            id,
            result: { context: { slot: 101 }, value: [null] },
          });
        if (method === "getTransaction")
          return Response.json({ jsonrpc: "2.0", id, result: null });
        throw new Error(`Unexpected RPC method: ${method}`);
      },
    });
  const primaryRpc = serveRpc();
  const secondaryRpc = serveRpc();
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
    // Omit `genesisHash` in settings so all steps rely on ESCROW_NETWORKS[network].genesisHash.
    const config = (network: string) =>
      network === "solana-devnet"
        ? {
            rpcUrl: `http://127.0.0.1:${primaryRpc.port}`,
            recoveryRpcUrl: `http://127.0.0.1:${secondaryRpc.port}`,
            feeRecipient: fee,
          }
        : null;
    const caseId = "sc_direct_pay_devnet_cluster";
    sqlite
      .prepare(
        "INSERT INTO security_cases(id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,severity,loss_finding,root_cause_key,appeal_state,revision,created_at,updated_at) VALUES(?,'direct-pay','example/direct-pay','GHSA-aaaa-bbbb-cccd',?,?,'verified',?,?,?,1,?,'confirmed','not-started','approved','rail-unavailable','embargoed','private','critical','verified-potential','root-audit','none',3,?,?)",
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
      "solana-devnet",
      REPORTER.githubId,
      config,
    );
    sqlite
      .prepare(
        "INSERT INTO security_payment_consents(case_id,deployment,reporter_github_id,accepted_at,case_revision) VALUES(?,?,?,?,2)",
      )
      .run(caseId, JSON.stringify(consent), REPORTER.githubId, stamp);
    const intent = await prepareDirectIntent(
      db,
      {
        caseId,
        projectId: "direct-pay",
        reporterId: REPORTER.githubId,
        payerId: OWNER.githubId,
        terms,
        grossBase: "4000000000",
        split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
        network: "solana-devnet",
        at: stamp,
      },
      config,
    );
    sqlite
      .prepare(
        "INSERT INTO security_direct_awards(case_id,project_id,root_cause_key,terms,gross_base,approved_at) VALUES(?,'direct-pay','root-audit',?,'4000000000',?)",
      )
      .run(caseId, JSON.stringify(terms), stamp);
    sqlite
      .prepare(
        "INSERT INTO security_case_events(case_id,case_revision,kind,actor_github_id,actor_role,idempotency_key,detail,at) VALUES(?,3,'prepare-payment',?,'financial','prepare-payment-key-1','{}',?)",
      )
      .run(caseId, OWNER.githubId, stamp);
    await insertDirectIntent(
      db,
      caseId,
      3,
      "prepare-payment-key-1",
      intent,
      stamp,
    ).run();

    // 1. Refreshing on the matching cluster while the blockhash is valid returns null.
    expect(
      await refreshDirectIntent(
        db,
        {
          caseId,
          revision: 4,
          key: "refresh-valid-cluster",
          network: "solana-devnet",
          at: stamp,
        },
        config,
      ),
    ).toBeNull();

    // 2. Refreshing when the RPC is on another cluster must throw "Wrong Solana cluster",
    // whether isBlockhashValid would return true or false.
    activeGenesis = keypair(8);
    for (const isExpired of [false, true]) {
      expired = isExpired;
      let refreshError: unknown = null;
      try {
        await refreshDirectIntent(
          db,
          {
            caseId,
            revision: 4,
            key: "refresh-wrong-cluster",
            network: "solana-devnet",
            at: stamp,
          },
          config,
        );
      } catch (error) {
        refreshError = error;
      }
      expect(refreshError).toBeInstanceOf(Error);
      expect((refreshError as Error).message).toBe("Wrong Solana cluster");
      expect((refreshError as { status?: unknown }).status).toBeUndefined();
    }

    // 3. Recovering on solana-devnet without an explicit settings.genesisHash override
    // must use ESCROW_NETWORKS["solana-devnet"].genesisHash, not solana-mainnet's.
    activeGenesis = devnetGenesis;
    expired = true;
    const challengeStep = await recoverDirectIntent(
      db,
      {
        caseId,
        payerId: OWNER.githubId,
        revision: 4,
        key: "recover-challenge-key",
        at: stamp,
      },
      config,
    );
    expect(challengeStep.detail).toMatchObject({
      generation: 0,
      state: "signature-required",
    });
    const challenge = (
      challengeStep.detail as {
        messages?: { messageId: string; message: string }[];
      }
    ).messages?.[0];
    if (!challenge) throw new Error("Expected recovery challenge");
    const signature = solanaBase58(
      ed25519.sign(solanaBase64Bytes(challenge.message), payerSecret),
    );
    const retiredStep = await recoverDirectIntent(
      db,
      {
        caseId,
        payerId: OWNER.githubId,
        revision: 5,
        key: "recover-complete-key",
        at: stamp,
        signatures: [{ messageId: challenge.messageId, signature }],
      },
      config,
    );
    expect(retiredStep.detail).toEqual({
      generation: 1,
      legIndex: 0,
      retirement: "expired-and-unpaid",
    });
  } finally {
    await primaryRpc.stop(true);
    await secondaryRpc.stop(true);
  }
});
