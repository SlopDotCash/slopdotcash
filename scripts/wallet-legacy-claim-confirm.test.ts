// A contributor whose current claim is a historical record (a GitHub issue
// or profile claim imported before the D1 registry) must be able to confirm
// that same address. Only a registry claim can be challenged and authorized,
// so registering the same address writes a registry successor instead of
// returning the historical claim (PRD section 3: users without wallets can
// claim payouts they should already have received).
import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { handlePaymentsApi } from "../backend/payments/handler";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import { handleTraceApi } from "../backend/trace/handler";
import { solanaBase58 } from "../contracts/solana/adapter";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";

const NOW = "2026-10-27T00:00:00.000Z";
const ACTOR = "123";
const secretKey = new Uint8Array(32).fill(7);
const ADDRESS = solanaBase58(ed25519.getPublicKey(secretKey));

async function setup(source: "github_issue" | "profile_readme") {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('m',?,'alice',?,0)",
    )
    .run(ACTOR, NOW);
  const token = "t".repeat(43);
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(await sha256Hex(token), "m", "2027-01-01T00:00:00.000Z");
  // The historical claim for this address, as the legacy import wrote it.
  const issue = source === "github_issue";
  sqlite
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,chain,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at) VALUES('legacy',?,'alice',?,'solana',?,?,?,?,?,?,NULL,?)",
    )
    .run(
      ACTOR,
      ADDRESS,
      source,
      issue ? "SlopDotCash/slopdotcash" : null,
      issue ? 7 : null,
      "a".repeat(64),
      NOW,
      "b".repeat(64),
      NOW,
    );
  const payments = async (path: string, body: unknown) => {
    const response = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://slop.cash",
          cookie: `__Host-slop_points=${token}`,
        },
        body: JSON.stringify(body),
      }),
      { db: db as never, now: () => new Date(NOW) },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return { db, sqlite, payments };
}

for (const source of ["github_issue", "profile_readme"] as const) {
  test(`a ${source} claim's address can be registered, challenged and authorized`, async () => {
    const { sqlite, payments } = await setup(source);
    // src/Earnings.tsx register(): register, then challenge, then authorize.
    const registered = await payments("/wallets/register", {
      chain: "solana",
      address: ADDRESS,
    });
    expect(registered.status).toBe(200);
    const claimId = registered.body.claimId as string;
    expect(claimId).not.toBe("legacy");
    expect(
      sqlite
        .prepare(
          "SELECT source,wallet_address,supersedes_claim_id FROM wallet_claims WHERE id=?",
        )
        .get(claimId),
    ).toEqual({
      source: "d1_registry",
      wallet_address: ADDRESS,
      supersedes_claim_id: "legacy",
    });
    // Registering again returns the same registry claim.
    expect(
      (
        await payments("/wallets/register", {
          chain: "solana",
          address: ADDRESS,
        })
      ).body.claimId,
    ).toBe(claimId);
    const challenge = await payments("/wallets/challenge", { claimId });
    expect(challenge.status).toBe(200);
    const signature = Buffer.from(
      ed25519.sign(
        new TextEncoder().encode(challenge.body.message as string),
        secretKey,
      ),
    ).toString("base64");
    expect(
      await payments("/wallets/authorize", {
        claimId,
        challengeId: challenge.body.challengeId,
        signature,
      }),
    ).toEqual({ status: 200, body: { authorized: true } });
  });
}

test("the skill's wallet claim route also writes a registry successor", async () => {
  const { db } = await setup("github_issue");
  const SECRET = "legacy-claim-confirm-test-secret-0123456789";
  let counter = 0;
  const iat = Math.floor(Date.parse(NOW) / 1000);
  const token = await signApiToken(
    {
      iss: "slop.cash",
      aud: "private-trace-api",
      sub: `github:${ACTOR}`,
      githubId: ACTOR,
      githubLogin: "alice",
      roles: ["contributor"],
      iat,
      exp: iat + 300,
      jti: "legacy-claim-confirm-jti",
    },
    SECRET,
  );
  const response = await handleTraceApi(
    new Request("http://localhost/api/v1/wallet-claims", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chain: "solana",
        address: ADDRESS,
        supersedesClaimId: "legacy",
      }),
    }),
    {
      persistence: new CloudflareTracePersistence(db, {} as R2Bucket),
      authSecret: SECRET,
      operatorGithubIds: new Set<string>(),
      now: () => new Date(NOW),
      randomId: () => `legacy-confirm-${++counter}`,
      verifyIdentityAssertion: async () => null,
      privateIntakeStatus: async () => ({ status: "unavailable" }),
    },
  );
  const claim = (await response.json()) as Record<string, unknown>;
  expect(response.status).toBe(201);
  expect(claim.claimId).not.toBe("legacy");
  expect(claim.source).toBe("d1_registry");
  expect(claim.supersedesClaimId).toBe("legacy");
});
