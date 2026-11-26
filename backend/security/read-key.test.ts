/**
 * Personal read-only security keys (operator decision, 25 November 2026; PRD
 * section 8), against the real migrations.
 */
import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { SECURITY_READ_KEY_PATTERN } from "../../src/lib/security-read-key";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Statement, D1TransactionalDatabase } from "../d1";
import { handleSecurityReadKey, securityReadKeyActor } from "./read-key";

const ORIGIN = "https://slop.cash";
const NOW = new Date("2026-11-25T15:00:00.000Z");
const NIC = { githubId: "900000201", githubLogin: "reviewer" };
const OTHER = { githubId: "900000202", githubLogin: "other" };

function fixture() {
  const { db, sqlite } = sqliteD1();
  for (const [index, account] of [NIC, OTHER].entries())
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run(
        `actor-${index}`,
        account.githubId,
        account.githubLogin,
        "2026-10-01T00:00:00.000Z",
      );
  const database = db as unknown as D1TransactionalDatabase<D1Statement>;
  let clock = NOW;
  let seed = 0;
  const manage = async (
    as: typeof NIC | null,
    method: string,
    headers: Record<string, string> = {},
  ) => {
    const response = await handleSecurityReadKey(
      new Request(`${ORIGIN}/api/v1/security-read-key`, {
        method,
        headers:
          method === "GET"
            ? headers
            : {
                origin: ORIGIN,
                "content-type": "application/json",
                ...headers,
              },
        body: method === "GET" ? undefined : "{}",
      }),
      {
        db: database,
        sessionActor: async () => as,
        now: () => clock,
        randomBytes: () => {
          seed += 1;
          return new Uint8Array(32).fill(seed);
        },
      },
    );
    if (response === null) throw new Error("route not handled");
    return { status: response.status, body: await response.json() };
  };
  const read = (
    secret: string,
    path = "security-cases",
    method = "GET",
    scheme = "Bearer",
  ) =>
    securityReadKeyActor(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers: { authorization: `${scheme} ${secret}` },
      }),
      database,
      clock,
    );
  return {
    sqlite,
    manage,
    read,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe("personal read-only security key", () => {
  test("a member creates a key once, only its hash is stored, and it reads as that member", async () => {
    const t = fixture();
    expect((await t.manage(NIC, "GET")).body).toEqual({ key: null });
    const created = await t.manage(NIC, "POST");
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(SECURITY_READ_KEY_PATTERN.test(secret)).toBe(true);
    const rows = t.sqlite
      .query("SELECT key_sha256, github_id FROM security_read_keys")
      .all() as { key_sha256: string; github_id: string }[];
    expect(rows).toEqual([
      { key_sha256: await sha256Hex(secret), github_id: NIC.githubId },
    ]);
    expect(JSON.stringify(rows)).not.toContain(secret);
    // The status read never returns the key again.
    const status = await t.manage(NIC, "GET");
    expect(status.body.secret).toBeUndefined();
    expect(status.body.key.createdAt).toBe(NOW.toISOString());
    expect(await t.read(secret)).toEqual(NIC);
    expect(await t.read(secret, "security-cases/sc_abc")).toEqual(NIC);
    expect(await t.read(secret, "security-submissions")).toEqual(NIC);
    expect((await t.manage(OTHER, "GET")).body).toEqual({ key: null });
  });

  test("a key reaches no write and no other API", async () => {
    const t = fixture();
    const secret = (await t.manage(NIC, "POST")).body.secret as string;
    for (const method of ["POST", "PUT", "DELETE", "PATCH"])
      expect(await t.read(secret, "security-cases", method)).toBeNull();
    for (const path of [
      "security-read-key",
      "security-routine",
      "security-programs/x/intake",
      "security-submissions/authorize/callback",
      "security-cases/sc_abc/actions",
      "notifications",
      "projects",
      "points/me",
    ])
      expect(await t.read(secret, path)).toBeNull();
    expect(await t.read(secret, "security-cases", "GET", "Basic")).toBeNull();
    expect(await t.read(`${secret}x`)).toBeNull();
    expect(await t.read(secret.replace(/.$/u, "A"))).toBeNull();
    // A key cannot manage keys: only the website session can.
    expect(
      (await t.manage(null, "POST", { authorization: `Bearer ${secret}` }))
        .status,
    ).toBe(401);
  });

  test("a new key or a revoke stops the old key at once", async () => {
    const t = fixture();
    const first = (await t.manage(NIC, "POST")).body.secret as string;
    const second = (await t.manage(NIC, "POST")).body.secret as string;
    expect(second).not.toBe(first);
    expect(await t.read(first)).toBeNull();
    expect(await t.read(second)).toEqual(NIC);
    expect((await t.manage(NIC, "DELETE")).body).toEqual({ key: null });
    expect(await t.read(second)).toBeNull();
    expect(
      (
        t.sqlite
          .query(
            "SELECT COUNT(*) n FROM security_read_keys WHERE revoked_at IS NULL",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });

  test("a closed account's key reads nothing, and writes must come from the site", async () => {
    const t = fixture();
    const secret = (await t.manage(NIC, "POST")).body.secret as string;
    t.sqlite.run(
      "UPDATE points_members SET closed_at = ?, public = 0 WHERE github_id = ?",
      [NOW.toISOString(), NIC.githubId],
    );
    expect(await t.read(secret)).toBeNull();
    expect(
      (await t.manage(OTHER, "POST", { origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    expect((await t.manage(null, "GET")).status).toBe(401);
  });

  test("last use is recorded at most once an hour", async () => {
    const t = fixture();
    const secret = (await t.manage(NIC, "POST")).body.secret as string;
    const used = () =>
      (
        t.sqlite.query("SELECT last_used_at FROM security_read_keys").get() as {
          last_used_at: string | null;
        }
      ).last_used_at;
    expect(used()).toBeNull();
    await t.read(secret);
    expect(used()).toBe(NOW.toISOString());
    t.advance(10 * 60 * 1000);
    await t.read(secret);
    expect(used()).toBe(NOW.toISOString());
    t.advance(60 * 60 * 1000);
    await t.read(secret);
    expect(used()).not.toBe(NOW.toISOString());
  });
});
