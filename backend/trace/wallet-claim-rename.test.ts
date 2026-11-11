// A GitHub login rename must not create a successor wallet claim for the
// same address: the numeric actor ID is stable across renames, so the trace
// route dedups on registry source + address, matching registerPaymentWallet
// (commit 549c0152 fixed only that path).
import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { signApiToken } from "./auth";
import { CloudflareTracePersistence } from "./cloudflare-persistence";
import { handleTraceApi } from "./handler";

const SECRET = "trace-test-secret-0123456789abcdef";
const now = new Date("2026-10-27T00:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const wallet = privateKeyToAccount(`0x${"8".repeat(64)}`);
const other = privateKeyToAccount(`0x${"9".repeat(64)}`);

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1Database;
  const deps = {
    persistence: new CloudflareTracePersistence(database, {} as never),
    authSecret: SECRET,
    operatorGithubIds: new Set<string>(),
    now: () => now,
    randomId: () => crypto.randomUUID(),
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({ status: "unavailable" as const }),
  };
  const claimCount = () =>
    (
      sqlite.query("SELECT COUNT(*) n FROM wallet_claims").get() as {
        n: number;
      }
    ).n;
  async function register(
    login: string,
    address: string,
    supersedesClaimId?: string,
  ) {
    const token = await signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: "github:123",
        githubId: "123",
        githubLogin: login,
        roles: ["contributor"],
        iat: nowSeconds,
        exp: nowSeconds + 600,
        jti: `test-jti-${login}-123456`,
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
          chain: "base",
          address,
          ...(supersedesClaimId ? { supersedesClaimId } : {}),
        }),
      }),
      deps as never,
    );
    return {
      status: response.status,
      body: (await response.json()) as { claimId?: string; error?: string },
    };
  }
  return { sqlite, claimCount, register };
}

test("re-registering the same address after a login rename reuses the claim", async () => {
  const f = fixture();
  try {
    const first = await f.register("alice", wallet.address.toLowerCase());
    expect(first.status).toBe(201);
    expect(first.body.claimId).toBeTruthy();
    expect(f.claimCount()).toBe(1);
    // After the rename the client reloads the current claim and resubmits
    // the same address with supersedesClaimId = current id, as the route
    // requires. The old claim must be reused, not superseded.
    const second = await f.register(
      "alice-renamed",
      wallet.address.toLowerCase(),
      first.body.claimId,
    );
    expect(second.status).toBe(200);
    expect(second.body.claimId).toBe(first.body.claimId);
    expect(f.claimCount()).toBe(1);
  } finally {
    f.sqlite.close();
  }
});

test("registering a different address after a rename still creates a successor", async () => {
  const f = fixture();
  try {
    const first = await f.register("alice", wallet.address.toLowerCase());
    expect(first.status).toBe(201);
    expect(f.claimCount()).toBe(1);
    const second = await f.register(
      "alice-renamed",
      other.address.toLowerCase(),
      first.body.claimId,
    );
    expect(second.status).toBe(201);
    expect(second.body.claimId).not.toBe(first.body.claimId);
    expect(f.claimCount()).toBe(2);
  } finally {
    f.sqlite.close();
  }
});
