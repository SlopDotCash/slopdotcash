import { describe, expect, it, vi } from "vitest";
import { main } from "./migrate-wallet-claim-issues.mjs";

const source = {
  address: "11111111111111111111111111111111",
  githubActorId: "123456",
  githubLogin: "octocat",
  issueNumber: 50,
  observedAt: "2026-08-15T00:00:00.000Z",
  sourceBodySha256: "a".repeat(64),
  sourceUrl: "https://github.com/elizaOS/slopdotcash/issues/50",
};

const receipt = {
  schemaVersion: 1,
  claimId: "wallet_claim_01",
  githubActorId: source.githubActorId,
  githubLogin: source.githubLogin,
  address: source.address,
  source: "github_issue",
  issueRepository: "elizaOS/slopdotcash",
  issueNumber: source.issueNumber,
  sourceBodySha256: source.sourceBodySha256,
  observedAt: source.observedAt,
  recordDigest: "b".repeat(64),
  supersedesClaimId: null,
};

describe("wallet issue migration", () => {
  it("imports and refetches an exact public receipt before closure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(Response.json(receipt));
    await main(["--execute", "--close"], {
      claims: [source],
      closeIssue: false,
      fetch: fetchMock,
      tokenProvider: async () => "operator_test_bearer_token_value",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.slop.cash/api/v1/operator/wallet-claims",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.slop.cash/api/v1/wallet-claims/wallet_claim_01",
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      source: "github_issue",
      issueNumber: 50,
      sourceBodySha256: source.sourceBodySha256,
    });
  });

  it("refuses to close without executing migration", async () => {
    await expect(main(["--close"], { claims: [source] })).rejects.toThrow(
      /requires --execute/u,
    );
  });

  it("fails closed when the public receipt changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({
          ...receipt,
          address: "SysvarRent111111111111111111111111111111111",
        }),
      );
    await expect(
      main(["--execute"], {
        claims: [source],
        fetch: fetchMock,
        tokenProvider: async () => "operator_test_bearer_token_value",
      }),
    ).rejects.toThrow(/did not match/u);
  });

  it("stops reading an oversized migration response", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      main(["--execute"], {
        claims: [source],
        fetch: async () => new Response(body, { status: 201 }),
        tokenProvider: async () => "operator_test_bearer_token_value",
      }),
    ).rejects.toThrow(/exceeded its bound/u);
  });

  it("rejects non-canonical response lengths", async () => {
    for (const invalidLength of [" 1", "1 ", "1e2", "+1"]) {
      const body = new Response("{}").body;
      await expect(
        main(["--execute"], {
          claims: [source],
          fetch: async () =>
            ({
              body,
              headers: {
                get: (name: string) =>
                  name.toLowerCase() === "content-length"
                    ? invalidLength
                    : null,
              },
              ok: true,
              status: 201,
            }) as Response,
          tokenProvider: async () => "operator_test_bearer_token_value",
        }),
      ).rejects.toThrow(/invalid length/u);
    }
  });

  it("refuses closure if the issue changes after its D1 receipt is verified", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(Response.json(receipt));
    await expect(
      main(["--execute", "--close"], {
        claims: [source],
        fetch: fetchMock,
        refreshClaim: async () => ({ ...source, address: "changed" }),
        tokenProvider: async () => "operator_test_bearer_token_value",
      }),
    ).rejects.toThrow(/changed after migration/u);
  });
});
