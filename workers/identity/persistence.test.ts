import { describe, expect, it } from "vitest";
import { type D1Database, D1IdentityPersistence } from "./persistence";

describe("D1 identity persistence", () => {
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
});
