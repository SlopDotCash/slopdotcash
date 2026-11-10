/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A wallet claim records only the authenticated account's statement of an
 * address (PRD section 3, "Wallet registration and recovery": "Bind a wallet
 * with both authenticated account evidence and the destination wallet's
 * signature. Neither proof establishes the other identity."). A Solana claim
 * proof used as a cycle-index wallet proof must therefore reference the
 * destination's possession attestation (`sourceAttestationSha256`, the digest
 * published by the claim's public possession view); a Solana proof without
 * it is rejected at every layer that accepts the proof form. The trace
 * possession flow issues attestations for Solana only, so other chains keep
 * the previous proof form.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../backend/trace/handler";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { assertCycleIndex, type CycleIndex } from "../src/lib/cycle-index";
import { assertFundingPreparation } from "../src/lib/funding-review-data";
import {
  assertRewardAllocationManifest,
  assertUnsafeDestinationReport,
} from "../src/lib/rewards";
import {
  type WalletPossessionChallenge,
  walletPossessionMessage,
} from "../src/lib/wallet-possession";
import { fixtureCheckout } from "../tests/fixture-checkout";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";

const repositoryRoot = resolve(import.meta.dir, "..");

/** Deep copy without the attestation reference on every claim proof. */
function withoutAttestation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAttestation);
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "sourceAttestationSha256")
        copy[key] = withoutAttestation(entry);
    }
    return copy;
  }
  return value;
}

function readFixture(relative: string): unknown {
  return JSON.parse(
    readFileSync(join(repositoryRoot, relative), "utf8"),
  ) as unknown;
}

const ACTOR = { id: "424242", login: "window-tester" };

function reportWithWallet(wallet: Record<string, unknown>) {
  return {
    kind: "unsafe-destination",
    projectId: "asi",
    cycleId: "2026-09",
    intentId: "pay_asi_2026_09_0001_424242",
    suggestedMinor: "100",
    carryMinor: "100",
    reportedAt: "2026-10-01T00:00:00.000Z",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    wallet,
    sourceRepository: "SlopDotCash/slopdotcash",
    sourceCommit: "a".repeat(40),
  };
}

describe("wallet claim proofs require a possession attestation", () => {
  test("allocation manifest rejects a claim proof without attestation", () => {
    const proposal = readFixture(
      "tests/fixtures/history/cycles/asi/2026-09/proposal.json",
    );
    expect(() => assertRewardAllocationManifest(proposal)).not.toThrow();
    expect(() =>
      assertRewardAllocationManifest(withoutAttestation(proposal)),
    ).toThrow(/unexpected or missing fields/u);
  });

  test("funding preparation rejects a claim proof without attestation", () => {
    const preparation = readFixture(
      "tests/fixtures/history/funding/preparations/asi-2026-08.json",
    );
    expect(() => assertFundingPreparation(preparation)).not.toThrow();
    expect(() =>
      assertFundingPreparation(withoutAttestation(preparation)),
    ).toThrow(/sourceAttestationSha256/u);
  });

  test("cycle index rejects a claim proof without attestation", () => {
    const workingCopy = fixtureCheckout("wallet-claim-attestation-");
    try {
      const generated = spawnSync(
        process.execPath,
        [join(workingCopy, "scripts/sync-cycle-index.ts")],
        {
          cwd: workingCopy,
          encoding: "utf8",
          env: { ...process.env, TMPDIR: join(workingCopy, ".bun-tmp") },
        },
      );
      expect(generated.status).toBe(0);
      const published = JSON.parse(
        readFileSync(
          join(workingCopy, "public/data/cycles/index.json"),
          "utf8",
        ),
      ) as CycleIndex;
      const claimWallets = published.cycles.flatMap((cycle) =>
        cycle.contributors.filter(
          (contributor) =>
            contributor.wallet && "sourceClaimId" in contributor.wallet,
        ),
      );
      expect(claimWallets.length).toBeGreaterThan(0);
      expect(() => assertCycleIndex(published)).not.toThrow();
      expect(() => assertCycleIndex(withoutAttestation(published))).toThrow(
        /unexpected or missing fields/u,
      );
    } finally {
      rmSync(workingCopy, { recursive: true, force: true });
    }
  }, 60_000);

  test("only Solana claim proofs must reference an attestation", () => {
    const solanaAddress = "5h6LapuyAfbJaiczZa2fbvsiib2HVrTzZ1ZcQnU7jKHc";
    const baseAddress = "0x0000000000000000000000000000000000000001";
    const digest = "c".repeat(64);
    const solanaWallet = {
      address: solanaAddress,
      chain: "solana",
      observedAt: "2026-10-01T00:00:00.000Z",
      sourceActorId: ACTOR.id,
      sourceClaimId: "claim_window",
      sourceRecordSha256: "b".repeat(64),
      sourceAttestationSha256: digest,
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/claim_window",
    };
    const { sourceAttestationSha256: _dropped, ...solanaUnattested } =
      solanaWallet;
    const baseWallet = {
      ...solanaWallet,
      address: baseAddress,
      chain: "base",
    };
    const { sourceAttestationSha256: _alsoDropped, ...baseUnattested } =
      baseWallet;
    // A Solana proof without the attestation reference is rejected, and the
    // same proof with it is accepted.
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(solanaUnattested), ACTOR),
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(solanaWallet), ACTOR),
    ).not.toThrow();
    // Other chains have no trace attestation flow, so their proof form is
    // unchanged: no attestation reference is required or accepted.
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(baseUnattested), ACTOR),
    ).not.toThrow();
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(baseWallet), ACTOR),
    ).toThrow(/unexpected or missing fields/u);
  });

  test("the public possession view publishes the digest a proof references", async () => {
    const BASE58_ALPHABET =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const base58 = (bytes: Uint8Array): string => {
      let value = BigInt(
        `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      );
      let text = "";
      while (value > 0n) {
        text = BASE58_ALPHABET[Number(value % 58n)] + text;
        value /= 58n;
      }
      let leading = 0;
      while (leading < bytes.length && bytes[leading] === 0) leading += 1;
      return "1".repeat(leading) + (text || "");
    };
    const issuedAt = Date.parse("2026-10-14T00:00:00.000Z");
    const secret = "wallet-claim-attestation-test-secret-0123456789";
    const secretKey = new Uint8Array(32).fill(9);
    const address = base58(ed25519.getPublicKey(secretKey));
    const { db, sqlite: sql } = sqliteD1(MIGRATIONS);
    sql
      .query(
        `INSERT INTO wallet_claims (id, github_user_id, github_login, wallet_address,
          chain, source, issue_repository, issue_number, source_body_sha256,
          observed_at, record_sha256, supersedes_claim_id, created_at)
         VALUES (?, ?, 'window-tester', ?, 'solana', 'd1_registry', NULL, NULL,
          ?, ?, ?, NULL, ?)`,
      )
      .run(
        "claim_window",
        ACTOR.id,
        address,
        "a".repeat(64),
        "2026-10-13T00:00:00.000Z",
        "b".repeat(64),
        "2026-10-13T00:00:00.000Z",
      );
    const now = issuedAt;
    let counter = 0;
    const deps: TraceApiDependencies = {
      persistence: new CloudflareTracePersistence(db, {} as R2Bucket),
      authSecret: secret,
      operatorGithubIds: new Set<string>(),
      now: () => new Date(now),
      randomId: () => `attestation-test-${++counter}`,
      verifyIdentityAssertion: async () => null,
      privateIntakeStatus: async () => ({ status: "unavailable" }),
    };
    const authenticated = async (path: string, body?: unknown) => {
      const iat = Math.floor(now / 1000);
      const token = await signApiToken(
        {
          iss: "slop.cash",
          aud: "private-trace-api",
          sub: `github:${ACTOR.id}`,
          githubId: ACTOR.id,
          githubLogin: ACTOR.login,
          roles: ["contributor"],
          iat,
          exp: iat + 300,
          jti: `attestation-test-jti-${++counter}`,
        },
        secret,
      );
      return handleTraceApi(
        new Request(
          `http://localhost/api/v1/wallet-claims/claim_window/${path}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          },
        ),
        deps,
      );
    };
    const challengeResponse = await authenticated("possession-challenge");
    expect(challengeResponse.status).toBe(201);
    const challenge = (
      (await challengeResponse.json()) as {
        challenge: WalletPossessionChallenge;
      }
    ).challenge;
    const signature = Buffer.from(
      ed25519.sign(
        new TextEncoder().encode(walletPossessionMessage(challenge)),
        secretKey,
      ),
    ).toString("base64");
    const attested = await authenticated("possession", {
      challenge,
      signature,
    });
    expect(attested.status).toBe(201);
    expect(((await attested.json()) as { state: string }).state).toBe("proven");
    // The public possession view (no auth) publishes the same digest the
    // proof form must reference.
    const publicView = await handleTraceApi(
      new Request(
        "http://localhost/api/v1/wallet-claims/claim_window/possession",
        { method: "GET" },
      ),
      deps,
    );
    expect(publicView.status).toBe(200);
    const published = (await publicView.json()) as {
      state: string;
      messageDigest: string;
    };
    expect(published.state).toBe("proven");
    expect(published.messageDigest).toBe(
      await sha256Hex(
        new TextEncoder().encode(walletPossessionMessage(challenge)),
      ),
    );
    // A proof carrying exactly that published digest is accepted; the same
    // proof without it is rejected.
    const wallet = {
      address,
      chain: "solana",
      observedAt: "2026-10-01T00:00:00.000Z",
      sourceActorId: ACTOR.id,
      sourceClaimId: "claim_window",
      sourceRecordSha256: "b".repeat(64),
      sourceAttestationSha256: published.messageDigest,
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/claim_window",
    };
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(wallet), ACTOR),
    ).not.toThrow();
    const { sourceAttestationSha256: _removed, ...unattested } = wallet;
    expect(() =>
      assertUnsafeDestinationReport(reportWithWallet(unattested), ACTOR),
    ).toThrow(/unexpected or missing fields/u);
  });
});
