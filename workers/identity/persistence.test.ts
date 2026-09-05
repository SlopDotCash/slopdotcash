import { describe, expect, it } from "vitest";
import type { OAuthFlow } from "./contracts";
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

describe("D1 identity persistence", () => {
  it.each([
    { success: false, meta: { changes: 1 } },
    { success: true, meta: { changes: 0 } },
  ])("does not report an OAuth flow that D1 did not insert", async (result) => {
    await expect(
      new D1IdentityPersistence(database(result)).createFlow(flow),
    ).resolves.toBe(false);
  });
});
