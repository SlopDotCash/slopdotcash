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
