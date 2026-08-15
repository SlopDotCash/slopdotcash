/** Tests GitHub issue and immutable README wallet observation without a network. */

import { describe, expect, it, vi } from "vitest";
import { formatPublishedWallet } from "../src/lib/wallets";
import { fetchPublishedGithubWallet } from "./github-wallets";

const ADDRESS = "11111111111111111111111111111111";
const COMMIT = "c".repeat(40);
const ACTOR_ID = "U_finish_line";
const IDENTITY = { id: 123456, login: "finish-line", node_id: ACTOR_ID };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("GitHub wallet observation", () => {
  it("refetches profile bytes at an immutable commit", async () => {
    const markdown = `# finish-line\n${formatPublishedWallet(ADDRESS)}\n`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(IDENTITY))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: COMMIT }]))
      .mockResolvedValueOnce(
        jsonResponse({
          type: "file",
          path: "README.md",
          encoding: "base64",
          content: Buffer.from(markdown).toString("base64"),
        }),
      );
    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: fetchMock, token: "test-token" },
      ),
    ).resolves.toEqual({
      address: ADDRESS,
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceCommit: COMMIT,
      sourceUrl: `https://github.com/finish-line/finish-line/blob/${COMMIT}/README.md`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toContain(`?ref=${COMMIT}`);
  });

  it("prefers the authenticated actor's current D1 wallet claim", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(IDENTITY))
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: 1,
          claimId: "wallet_claim_01",
          githubActorId: "123456",
          githubLogin: "finish-line",
          address: ADDRESS,
          source: "d1_registry",
          issueRepository: null,
          issueNumber: null,
          sourceBodySha256: "a".repeat(64),
          observedAt: "2026-08-01T12:00:00.000Z",
          recordDigest: "b".repeat(64),
          supersedesClaimId: null,
        }),
      );
    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: fetchMock },
      ),
    ).resolves.toMatchObject({
      address: ADDRESS,
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceActorId: ACTOR_ID,
      sourceClaimId: "wallet_claim_01",
      sourceRecordSha256: "b".repeat(64),
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/wallet_claim_01",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the live GitHub actor identity changes", async () => {
    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        {
          fetch: vi
            .fn()
            .mockResolvedValueOnce(
              jsonResponse({ ...IDENTITY, node_id: "U_attacker" }),
            ),
        },
      ),
    ).rejects.toThrow(/identity changed/u);
  });

  it("returns null for a missing profile repository or absent marker", async () => {
    await expect(
      fetchPublishedGithubWallet(
        "U_no_profile",
        "no-profile",
        "2026-08-02T00:00:00.000Z",
        { fetch: vi.fn().mockResolvedValueOnce(jsonResponse({}, 404)) },
      ),
    ).resolves.toBeNull();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 234567,
          login: "no-wallet",
          node_id: "U_no_wallet",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: COMMIT }]))
      .mockResolvedValueOnce(
        jsonResponse({
          type: "file",
          path: "README.md",
          encoding: "base64",
          content: Buffer.from("# no wallet\n").toString("base64"),
        }),
      );
    await expect(
      fetchPublishedGithubWallet(
        "U_no_wallet",
        "no-wallet",
        "2026-08-02T00:00:00.000Z",
        { fetch: fetchMock },
      ),
    ).resolves.toBeNull();
  });

  it("fails closed on moving references and malformed immutable bytes", async () => {
    const mutable = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(IDENTITY))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: "main" }]));
    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: mutable },
      ),
    ).rejects.toThrow(/commit SHA/u);

    const malformed = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(IDENTITY))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: COMMIT }]))
      .mockResolvedValueOnce(
        jsonResponse({
          type: "file",
          path: "README.md",
          encoding: "base64",
          content: "not base64!?",
        }),
      );
    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: malformed },
      ),
    ).rejects.toThrow(/encoding/u);
  });

  it("rejects an oversized API response before reading its body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
    );

    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("response is oversized");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a transient Bun transport failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("connection refused"), {
          code: "ConnectionRefused",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(IDENTITY))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchPublishedGithubWallet(
        ACTOR_ID,
        "finish-line",
        "2026-08-02T00:00:00.000Z",
        { fetch: fetchMock },
      ),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
