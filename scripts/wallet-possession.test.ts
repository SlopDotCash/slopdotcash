/// <reference types="bun-types" />
// Wallet possession proofs: canonical signature encoding, and the single-use
// 15-minute challenge window. The signed message repeats issuedAt and
// expiresAt, so the endpoint must hold a submission to the stored window, not
// to whichever window the client chose to sign. The window tests run the real
// handler and the real D1 persistence over every repository migration.
import { describe, expect, it, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "../backend/payments/possession";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../backend/trace/handler";
import { sha256Hex } from "../backend/trace/validation";
import {
  verifyWalletPossession,
  WALLET_POSSESSION_LIFETIME_MS,
  type WalletPossessionChallenge,
  walletPossessionMessage,
} from "../src/lib/wallet-possession";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base58(bytes: Uint8Array): string {
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
}

/** Changes only the unused low bits of the final base64 character. */
function nonCanonicalEncoding(signature: string): string {
  const chars = signature.split("");
  const value = BASE64_ALPHABET.indexOf(chars[85] as string);
  chars[85] = BASE64_ALPHABET[value | 1] as string;
  return chars.join("");
}

const secret = new Uint8Array(32).fill(7);
const address = base58(ed25519.getPublicKey(secret));

function sign(message: string): string {
  const bytes = ed25519.sign(new TextEncoder().encode(message), secret);
  return Buffer.from(bytes).toString("base64");
}

const issuedAt = Date.parse("2026-10-14T00:00:00.000Z");
const challenge = {
  kind: "slop-wallet-possession" as const,
  schemaVersion: "1" as const,
  audience: "slop.cash" as const,
  challengeId: "0123456789abcdef0123456789abcdef",
  claimId: "claim-1",
  githubActorId: "12345",
  address,
  issuedAt: new Date(issuedAt).toISOString(),
  expiresAt: new Date(issuedAt + WALLET_POSSESSION_LIFETIME_MS).toISOString(),
};

describe("wallet possession signature encoding", () => {
  it("accepts the canonical padded base64 signature", () => {
    const signature = sign(walletPossessionMessage(challenge));
    expect(
      verifyWalletPossession({
        challenge,
        signature,
        claimId: "claim-1",
        githubActorId: "12345",
        address,
        now: issuedAt + 1_000,
      }).signature,
    ).toBe(signature);
  });

  it("rejects a non-canonical encoding of the same signature bytes", () => {
    const signature = sign(walletPossessionMessage(challenge));
    const mutated = nonCanonicalEncoding(signature);
    // The mutation changes no decoded byte; only the encoding is wrong.
    expect(Buffer.from(mutated, "base64")).toEqual(
      Buffer.from(signature, "base64"),
    );
    expect(() =>
      verifyWalletPossession({
        challenge,
        signature: mutated,
        claimId: "claim-1",
        githubActorId: "12345",
        address,
        now: issuedAt + 1_000,
      }),
    ).toThrow("canonical padded base64");
  });
});

describe("payment wallet signature encoding", () => {
  const message = buildPaymentWalletMessage({
    actorId: "12345",
    chain: "solana",
    address,
    claimId: "claim-1",
    claimDigest: "abc",
    nonce: "nonce-1",
    expiresAt: "2026-10-14T01:00:00.000Z",
  });

  it("accepts the canonical padded base64 signature", () => {
    expect(
      verifyPaymentWalletSignature("solana", address, message, sign(message)),
    ).toBe(true);
  });

  it("rejects a non-canonical encoding of the same signature bytes", () => {
    const signature = sign(message);
    const mutated = nonCanonicalEncoding(signature);
    expect(Buffer.from(mutated, "base64")).toEqual(
      Buffer.from(signature, "base64"),
    );
    expect(
      verifyPaymentWalletSignature("solana", address, message, mutated),
    ).toBe(false);
  });
});

const SECRET = "wallet-possession-window-test-secret-0123456789";
const ACTOR = "424242";
const CLAIM = "claim_window";
const MINUTE = 60_000;

function setup() {
  const { db, sqlite: sql } = sqliteD1(MIGRATIONS);
  const secretKey = new Uint8Array(32).fill(9);
  const address = base58(ed25519.getPublicKey(secretKey));
  sql
    .query(
      `INSERT INTO wallet_claims (id, github_user_id, github_login, wallet_address,
        chain, source, issue_repository, issue_number, source_body_sha256,
        observed_at, record_sha256, supersedes_claim_id, created_at)
       VALUES (?, ?, 'window-tester', ?, 'solana', 'd1_registry', NULL, NULL,
        ?, ?, ?, NULL, ?)`,
    )
    .run(
      CLAIM,
      ACTOR,
      address,
      "a".repeat(64),
      "2026-10-13T00:00:00.000Z",
      "b".repeat(64),
      "2026-10-13T00:00:00.000Z",
    );
  let now = issuedAt;
  let counter = 0;
  const deps: TraceApiDependencies = {
    persistence: new CloudflareTracePersistence(db, {} as R2Bucket),
    authSecret: SECRET,
    operatorGithubIds: new Set<string>(),
    now: () => new Date(now),
    randomId: () => `window-test-${++counter}`,
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({ status: "unavailable" }),
  };
  const request = async (path: string, body?: unknown) => {
    const iat = Math.floor(now / 1000);
    const token = await signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: `github:${ACTOR}`,
        githubId: ACTOR,
        githubLogin: "window-tester",
        roles: ["contributor"],
        iat,
        exp: iat + 300,
        jti: `window-test-jti-${++counter}`,
      },
      SECRET,
    );
    return handleTraceApi(
      new Request(`http://localhost/api/v1/wallet-claims/${CLAIM}/${path}`, {
        method: body === null ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body:
          body === undefined || body === null
            ? undefined
            : JSON.stringify(body),
      }),
      deps,
    );
  };
  return {
    sql,
    advance(ms: number) {
      now += ms;
    },
    async issue(): Promise<WalletPossessionChallenge> {
      const response = await request("possession-challenge");
      expect(response.status).toBe(201);
      return (
        (await response.json()) as { challenge: WalletPossessionChallenge }
      ).challenge;
    },
    submit(challenge: WalletPossessionChallenge) {
      const signature = Buffer.from(
        ed25519.sign(
          new TextEncoder().encode(walletPossessionMessage(challenge)),
          secretKey,
        ),
      ).toString("base64");
      return request("possession", { challenge, signature });
    },
    async state(): Promise<string> {
      const response = await request("possession", null);
      return ((await response.json()) as { state: string }).state;
    },
  };
}

function window(
  challenge: WalletPossessionChallenge,
  issuedAt: number,
): WalletPossessionChallenge {
  return {
    ...challenge,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(issuedAt + WALLET_POSSESSION_LIFETIME_MS).toISOString(),
  };
}

describe("wallet possession challenge window", () => {
  test("refuses an expired challenge re-signed over a later window", async () => {
    const api = setup();
    const issued = await api.issue();
    api.advance(2 * 24 * 60 * MINUTE);
    const response = await api.submit(
      window(issued, issuedAt + 2 * 24 * 60 * MINUTE - MINUTE),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      "possession_challenge_unavailable",
    );
    expect(await api.state()).toBe("unproven");
    expect(
      api.sql
        .query("SELECT consumed_at FROM wallet_possession_challenges")
        .get(),
    ).toEqual({ consumed_at: null });
  });

  test("refuses a live challenge signed over a shifted window", async () => {
    const api = setup();
    const issued = await api.issue();
    api.advance(10 * MINUTE);
    const response = await api.submit(window(issued, issuedAt + 5 * MINUTE));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "invalid_possession_proof",
    );
    expect(await api.state()).toBe("unproven");
  });

  test("records a proof over the window the server issued", async () => {
    const api = setup();
    const issued = await api.issue();
    expect(issued.issuedAt).toBe(new Date(issuedAt).toISOString());
    api.advance(10 * MINUTE);
    const response = await api.submit(issued);
    expect(response.status).toBe(201);
    const proof = (await response.json()) as {
      state: string;
      messageDigest: string;
    };
    expect(proof.state).toBe("proven");
    expect(proof.messageDigest).toBe(
      await sha256Hex(
        new TextEncoder().encode(walletPossessionMessage(issued)),
      ),
    );
  });
});
