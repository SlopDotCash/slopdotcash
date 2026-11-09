// Actual migrated SQLite/D1 regression definitions, authored without execution.
// Captured ISO timestamps model the caller's clock boundary; these tests do not
// claim D1 deployment, browser, provider or cryptographic acceptance.
import { expect, test } from "bun:test";
import type { D1Database, D1Statement } from "../../backend/d1";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { IdentityAssertion, OAuthFlow } from "./contracts";
import { D1IdentityPersistence } from "./persistence";

const AT = "2026-11-09T12:00:00.000Z";
const BEFORE = "2026-11-09T12:04:59.999Z";
const EXPIRY = "2026-11-09T12:05:00.000Z";
const flow = (): OAuthFlow => ({ id: "flow-a", stateHash: "a".repeat(64),
  pollCapabilityHash: "b".repeat(64), encryptedPkceVerifier: "private-cipher", pkceIv: "private-iv",
  audience: "slop-points-web", status: "pending", githubActorId: null, githubLogin: null,
  createdAt: AT, expiresAt: EXPIRY, callbackCompletedAt: null, assertionIssuedAt: null });
const assertion = (): IdentityAssertion => ({ tokenHash: "c".repeat(64), githubActorId: "123",
  githubLogin: "octo", githubNodeId: "U_octo", audience: "slop-points-web",
  createdAt: AT, expiresAt: "2026-11-09T12:01:30.000Z", consumedAt: null });

function intercepted(db: D1Database, hooks: {
  before?: (sql: string, operation: "first" | "run") => Promise<void>;
  after?: (sql: string, operation: "first" | "run") => Promise<void>;
}): D1Database {
  const wrap = (sql: string, statement: D1Statement): D1Statement => ({
    bind(...values) { return wrap(sql, statement.bind(...values)); },
    async first<T>() {
      await hooks.before?.(sql, "first");
      const result = await statement.first<T>();
      await hooks.after?.(sql, "first");
      return result;
    },
    async run() {
      await hooks.before?.(sql, "run");
      const result = await statement.run();
      await hooks.after?.(sql, "run");
      return result;
    },
  });
  return { prepare: (sql) => wrap(sql, db.prepare(sql)) };
}
async function fixture() {
  const { db, sqlite } = sqliteD1();
  const persistence = new D1IdentityPersistence(db);
  const initial = flow();
  expect(await persistence.createFlow(initial)).toBe(true);
  const complete = async () => {
    expect(await persistence.claimCallback(initial.stateHash, AT)).not.toBeNull();
    expect(await persistence.completeCallback(initial.id, "123", "octo", AT, "U_octo")).toBe(true);
  };
  return { db, sqlite, persistence, initial, complete,
    row: () => sqlite.query("SELECT * FROM identity_oauth_flows WHERE id=?").get(initial.id),
    close: () => sqlite.close() };
}

test("callback claim returns its pre-claim verifier snapshot and scrubs the stored verifier", async () => {
  const f = await fixture();
  try {
    expect(await f.persistence.claimCallback(f.initial.stateHash, AT)).toEqual(f.initial);
    expect(f.row()).toMatchObject({ status: "callback_processing", encrypted_pkce_verifier: null, pkce_iv: null });
    expect(await f.persistence.claimCallback(f.initial.stateHash, AT)).toBeNull();
  } finally { f.close(); }
});

test("concurrent callback claims have one winner", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      f.persistence.claimCallback(f.initial.stateHash, AT),
      f.persistence.claimCallback(f.initial.stateHash, AT),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(f.row()).toMatchObject({ status: "callback_processing", encrypted_pkce_verifier: null });
  } finally { f.close(); }
});

test("cleanup between callback SELECT and UPDATE prevents the claim", async () => {
  const f = await fixture();
  try {
    const client = new D1IdentityPersistence(intercepted(f.db, { after: async (sql, operation) => {
      if (operation === "first" && sql.includes("state_hash = ? AND status = 'pending'"))
        await f.persistence.deleteExpired(EXPIRY);
    } }));
    expect(await client.claimCallback(f.initial.stateHash, AT)).toBeNull();
    expect(f.row()).toBeNull();
  } finally { f.close(); }
});

test("a lost claim reply leaves the verifier consumed and prevents replay", async () => {
  const f = await fixture();
  try {
    const client = new D1IdentityPersistence(intercepted(f.db, { after: async (sql, operation) => {
      if (operation === "run" && sql.includes("SET status = 'callback_processing'")) throw new Error("claim reply lost");
    } }));
    await expect(client.claimCallback(f.initial.stateHash, AT)).rejects.toThrow("claim reply lost");
    expect(f.row()).toMatchObject({ status: "callback_processing", encrypted_pkce_verifier: null, pkce_iv: null });
    expect(await f.persistence.claimCallback(f.initial.stateHash, AT)).toBeNull();
  } finally { f.close(); }
});

test("completion and failure race from processing to exactly one terminal state", async () => {
  const f = await fixture();
  try {
    await f.persistence.claimCallback(f.initial.stateHash, AT);
    const results = await Promise.all([
      f.persistence.completeCallback(f.initial.id, "123", "octo", AT, "U_octo"),
      f.persistence.failCallback(f.initial.id),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(["callback_complete", "callback_failed"]).toContain((f.row() as { status: string }).status);
    expect(await f.persistence.failCallback(f.initial.id)).toBe(false);
  } finally { f.close(); }
});

test("callback completion rejects exact expiry while failure remains terminal", async () => {
  const f = await fixture();
  try {
    await f.persistence.claimCallback(f.initial.stateHash, BEFORE);
    expect(await f.persistence.completeCallback(f.initial.id, "123", "octo", EXPIRY)).toBe(false);
    expect(await f.persistence.failCallback(f.initial.id)).toBe(true);
    expect(await f.persistence.completeCallback(f.initial.id, "123", "octo", BEFORE)).toBe(false);
  } finally { f.close(); }
});

test("all flow lookups refuse exact expiry and preserve captured earlier timestamps", async () => {
  const f = await fixture();
  try {
    expect(await f.persistence.findAuthorizableFlow(f.initial.id, f.initial.stateHash, EXPIRY)).toBeNull();
    expect(await f.persistence.findPollableFlow(f.initial.id, f.initial.pollCapabilityHash, EXPIRY)).toBeNull();
    expect(await f.persistence.claimCallback(f.initial.stateHash, EXPIRY)).toBeNull();
    expect(await f.persistence.claimCallback(f.initial.stateHash, BEFORE)).not.toBeNull();
    expect(await f.persistence.completeCallback(f.initial.id, "123", "octo", BEFORE)).toBe(true);
  } finally { f.close(); }
});

test.each(["pending", "callback_processing", "callback_failed", "assertion_issued", "absent"])(
  "linked assertion insertion refuses parent state %s", async (state) => {
    const f = await fixture();
    try {
      if (state === "absent") f.sqlite.query("DELETE FROM identity_oauth_flows WHERE id=?").run(f.initial.id);
      else if (state !== "pending") {
        await f.persistence.claimCallback(f.initial.stateHash, AT);
        if (state === "callback_failed") await f.persistence.failCallback(f.initial.id);
        if (state === "assertion_issued") {
          await f.persistence.completeCallback(f.initial.id, "123", "octo", AT);
          await f.persistence.markAssertionIssued(f.initial.id, AT);
        }
      }
      expect(await f.persistence.createAssertion(assertion(), f.initial.id)).toBeNull();
    } finally { f.close(); }
  },
);

test("assertion readback remains bound to its captured input during caller mutation", async () => {
  const f = await fixture();
  try {
    await f.complete();
    const other: IdentityAssertion = { ...assertion(), tokenHash: "d".repeat(64), githubActorId: "456", githubLogin: "other", githubNodeId: "U_other" };
    await f.persistence.createAssertion(other, null);
    const mutable = assertion(), expected = { ...mutable };
    const client = new D1IdentityPersistence(intercepted(f.db, { after: async (sql, operation) => {
      if (operation === "run" && sql.includes("INSERT INTO identity_assertions")) Object.assign(mutable, other);
    } }));
    expect(await client.createAssertion(mutable, f.initial.id)).toEqual(expected);
    expect(mutable.tokenHash).toBe(other.tokenHash);
  } finally { f.close(); }
});

test("conflicting token insertion preserves original timestamps instead of extending validity", async () => {
  const f = await fixture();
  try {
    await f.complete();
    const first = assertion();
    expect(await f.persistence.createAssertion(first, f.initial.id)).toEqual(first);
    expect(await f.persistence.createAssertion({ ...first, createdAt: BEFORE, expiresAt: EXPIRY }, f.initial.id)).toEqual(first);
  } finally { f.close(); }
});

test("lost assertion INSERT reply retains its row for exact retry readback", async () => {
  const f = await fixture();
  try {
    await f.complete();
    const client = new D1IdentityPersistence(intercepted(f.db, { after: async (sql, operation) => {
      if (operation === "run" && sql.includes("INSERT INTO identity_assertions")) throw new Error("insert reply lost");
    } }));
    await expect(client.createAssertion(assertion(), f.initial.id)).rejects.toThrow("insert reply lost");
    expect(await f.persistence.createAssertion(assertion(), f.initial.id)).toEqual(assertion());
  } finally { f.close(); }
});

test("consumption between INSERT and readback prevents returning a used assertion", async () => {
  const f = await fixture();
  try {
    await f.complete();
    const client = new D1IdentityPersistence(intercepted(f.db, { after: async (sql, operation) => {
      if (operation === "run" && sql.includes("INSERT INTO identity_assertions"))
        await f.persistence.consumeAssertion(assertion().tokenHash, assertion().audience, AT);
    } }));
    expect(await client.createAssertion(assertion(), f.initial.id)).toBeNull();
  } finally { f.close(); }
});

test("issued parent prevents recreation after expired assertion cleanup", async () => {
  const f = await fixture();
  try {
    await f.complete();
    await f.persistence.createAssertion(assertion(), f.initial.id);
    await f.persistence.markAssertionIssued(f.initial.id, AT);
    await f.persistence.deleteExpired(assertion().expiresAt);
    expect(await f.persistence.createAssertion({ ...assertion(), createdAt: BEFORE, expiresAt: EXPIRY }, f.initial.id)).toBeNull();
  } finally { f.close(); }
});

test("independent local tokens can be stored without a parent flow", async () => {
  const f = await fixture();
  try { expect(await f.persistence.createAssertion(assertion(), null)).toEqual(assertion()); }
  finally { f.close(); }
});

test("concurrent issuance marks have one winner and exact expiry refuses", async () => {
  const f = await fixture();
  try {
    await f.complete();
    expect(await f.persistence.markAssertionIssued(f.initial.id, EXPIRY)).toBe(false);
    expect((await Promise.all([f.persistence.markAssertionIssued(f.initial.id, BEFORE), f.persistence.markAssertionIssued(f.initial.id, BEFORE)])).filter(Boolean)).toHaveLength(1);
    expect(f.row()).toMatchObject({ status: "assertion_issued", assertion_issued_at: BEFORE });
  } finally { f.close(); }
});

test("consumption is audience-bound, exclusive, and rejects the exact expiry boundary", async () => {
  const f = await fixture();
  try {
    await f.persistence.createAssertion(assertion(), null);
    expect(await f.persistence.consumeAssertion(assertion().tokenHash, "private-trace-api", AT)).toBeNull();
    expect(await f.persistence.consumeAssertion(assertion().tokenHash, assertion().audience, assertion().expiresAt)).toBeNull();
    const values = await Promise.all([
      f.persistence.consumeAssertion(assertion().tokenHash, assertion().audience, AT),
      f.persistence.consumeAssertion(assertion().tokenHash, assertion().audience, AT),
    ]);
    expect(values.filter(Boolean)).toHaveLength(1);
    expect(values.find(Boolean)).toMatchObject({ ...assertion(), consumedAt: AT });
  } finally { f.close(); }
});
