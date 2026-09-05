import { describe, expect, it } from "vitest";
import type { IdentityAssertion, OAuthFlow } from "./contracts";
import { type D1Database, D1IdentityPersistence } from "./persistence";

const flow: OAuthFlow = {
  id: "flow_abcdefghijklmnopqrst",
  stateHash: "a".repeat(64),
  pollCapabilityHash: "b".repeat(64),
  encryptedPkceVerifier: "ciphertext",
  pkceIv: "initialization-vector",
  audience: "private-trace-api",
  status: "pending",
  githubActorId: null,
  githubLogin: null,
  createdAt: "2026-08-15T20:00:00.000Z",
  expiresAt: "2026-08-15T20:05:00.000Z",
  callbackCompletedAt: null,
  assertionIssuedAt: null,
};

function database(result: {
  success: boolean;
  meta?: { changes?: number };
}): D1Database {
  return {
    prepare() {
      const statement = {
        bind() {
          return statement;
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          return result;
        },
      };
      return statement;
    },
  };
}

const assertion: IdentityAssertion = {
  tokenHash: "a".repeat(64),
  githubActorId: "123456",
  githubLogin: "octocat",
  audience: "private-trace-api",
  createdAt: "2026-08-15T20:00:00.000Z",
  expiresAt: "2026-08-15T20:01:30.000Z",
  consumedAt: null,
};

function assertionDatabase(options: {
  insertSuccess: boolean;
  stored: boolean;
}): D1Database {
  return {
    prepare(query) {
      const statement = {
        bind() {
          return statement;
        },
        async first<T>() {
          return options.stored && query.startsWith("SELECT")
            ? ({
                token_hash: assertion.tokenHash,
                github_actor_id: assertion.githubActorId,
                github_login: assertion.githubLogin,
                audience: assertion.audience,
                created_at: assertion.createdAt,
                expires_at: assertion.expiresAt,
                consumed_at: null,
              } as T)
            : null;
        },
        async run() {
          return { success: options.insertSuccess };
        },
      };
      return statement;
    },
  };
}

describe("D1 identity persistence", () => {
  it.each([
    { insertSuccess: false, stored: false },
    { insertSuccess: true, stored: false },
  ])("does not confirm an assertion absent from D1", async (options) => {
    await expect(
      new D1IdentityPersistence(assertionDatabase(options)).createAssertion(
        assertion,
      ),
    ).resolves.toBeNull();
  });

  it("confirms the exact durable assertion", async () => {
    await expect(
      new D1IdentityPersistence(
        assertionDatabase({ insertSuccess: true, stored: true }),
      ).createAssertion(assertion),
    ).resolves.toEqual(assertion);
  });

  it("returns the original assertion when a later retry finds its token", async () => {
    const retry = {
      ...assertion,
      createdAt: "2026-08-15T20:00:02.000Z",
      expiresAt: "2026-08-15T20:01:32.000Z",
    };
    await expect(
      new D1IdentityPersistence(
        assertionDatabase({ insertSuccess: true, stored: true }),
      ).createAssertion(retry),
    ).resolves.toEqual(assertion);
  });
  it("returns a consumed assertion from the same statement that consumes it", async () => {
    const queries: string[] = [];
    const db: D1Database = {
      prepare(query) {
        queries.push(query);
        const statement = {
          bind() {
            return statement;
          },
          async first<T>() {
            if (!query.includes("UPDATE identity_assertions")) {
              throw new Error(
                "identity lookup ran after assertion consumption",
              );
            }
            return {
              token_hash: "a".repeat(64),
              github_actor_id: "123456",
              github_login: "octocat",
              audience: "private-trace-api",
              created_at: "2026-08-15T20:00:00.000Z",
              expires_at: "2026-08-15T20:01:30.000Z",
              consumed_at: "2026-08-15T20:00:30.000Z",
            } as T;
          },
          async run() {
            throw new Error("assertion consumption did not return its row");
          },
        };
        return statement;
      },
    };

    await expect(
      new D1IdentityPersistence(db).consumeAssertion(
        "a".repeat(64),
        "private-trace-api",
        "2026-08-15T20:00:30.000Z",
      ),
    ).resolves.toMatchObject({
      githubActorId: "123456",
      githubLogin: "octocat",
      consumedAt: "2026-08-15T20:00:30.000Z",
    });
    expect(queries).toHaveLength(1);
  });
  it.each([
    { success: false, meta: { changes: 1 } },
    { success: true, meta: { changes: 0 } },
  ])("does not report an OAuth flow that D1 did not insert", async (result) => {
    await expect(
      new D1IdentityPersistence(database(result)).createFlow(flow),
    ).resolves.toBe(false);
  });
});
