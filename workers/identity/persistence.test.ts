import { describe, expect, it } from "vitest";
import type { IdentityAssertion } from "./contracts";
import { type D1Database, D1IdentityPersistence } from "./persistence";

const assertion: IdentityAssertion = {
  tokenHash: "a".repeat(64),
  githubActorId: "123456",
  githubLogin: "octocat",
  audience: "private-trace-api",
  createdAt: "2026-08-15T20:00:00.000Z",
  expiresAt: "2026-08-15T20:01:30.000Z",
  consumedAt: null,
};

function database(options: {
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
      new D1IdentityPersistence(database(options)).createAssertion(assertion),
    ).resolves.toBeNull();
  });

  it("confirms the exact durable assertion", async () => {
    await expect(
      new D1IdentityPersistence(
        database({ insertSuccess: true, stored: true }),
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
        database({ insertSuccess: true, stored: true }),
      ).createAssertion(retry),
    ).resolves.toEqual(assertion);
  });
});
