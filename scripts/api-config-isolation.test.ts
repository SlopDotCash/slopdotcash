/** PRD 3/6: unavailable payment configuration must not stop account recovery.
 * Exercise the deployed Pages composition with real migrated SQLite. */
import { expect, test } from "bun:test";
import { onRequest } from "../functions/api/v1/[[path]]";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";

const origin = "https://slop.cash";
const token = "x".repeat(48);

for (const action of ["read", "signout", "funding"] as const) {
  test(`invalid payment RPC configuration preserves ${action} isolation`, async () => {
    const { db, sqlite } = sqliteD1();
    try {
      sqlite.run(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES ('actor','42','member','2026-11-01T00:00:00.000Z',0)",
      );
      sqlite.run(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES (?,'actor','2099-01-01T00:00:00.000Z')",
        [await sha256Hex(token)],
      );
      const path =
        action === "funding"
          ? "payments/projects/no-vault/solana-funding"
          : `points/${action === "read" ? "me" : "signout"}`;
      const request = new Request(`${origin}/api/v1/${path}`, {
        method: action === "read" ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `__Host-slop_points=${token}`,
        },
        ...(action === "read"
          ? {}
          : {
              body: JSON.stringify(
                action === "funding"
                  ? {
                      step: "review",
                      operation: "deposit",
                      network: "solana-mainnet",
                      vault: "11111111111111111111111111111111",
                      wallet: "11111111111111111111111111111111",
                      amount: "1",
                    }
                  : {},
              ),
            }),
      });
      const response = await onRequest({
        request,
        env: {
          SLOP_DB: db,
          PAYMENT_NETWORKS: "[]",
          PAYMENT_RPC_URLS: "{malformed",
          TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
        },
      } as never);
      if (action === "funding") {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(await response.json()).toMatchObject({
          error: "payments_unavailable",
        });
        expect(
          sqlite.query("SELECT count(*) AS n FROM points_sessions").get(),
        ).toEqual({ n: 1 });
      } else {
        expect(response.status).toBe(200);
        if (action === "read")
          expect(await response.json()).toMatchObject({
            actor: { id: "actor" },
          });
        else {
          expect(await response.json()).toEqual({ signedOut: true });
          expect(
            sqlite.query("SELECT count(*) AS n FROM points_sessions").get(),
          ).toEqual({ n: 0 });
        }
      }
    } finally {
      sqlite.close();
    }
  });
}
