/** Tests GitHub issue and immutable README wallet observation without a network. */

import { describe, expect, it, vi } from "vitest";
import { formatPublishedWallet } from "../src/lib/wallets";
import { fetchPublishedGithubWallet } from "./github-wallets";

const ADDRESS = "11111111111111111111111111111111";
const COMMIT = "c".repeat(40);

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
      .mockResolvedValueOnce(jsonResponse([]))
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
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
        token: "test-token",
      }),
    ).resolves.toEqual({
      address: ADDRESS,
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceCommit: COMMIT,
      sourceUrl: `https://github.com/finish-line/finish-line/blob/${COMMIT}/README.md`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toContain(`?ref=${COMMIT}`);
  });

  it("prefers one canonical open Slop wallet claim issue", async () => {
    const marker = formatPublishedWallet(ADDRESS);
    const body = `# Wallet claim\n\n${marker}\n`;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse([
        {
          number: 42,
          node_id: "I_wallet_claim",
          title: "Slop wallet claim",
          body,
          updated_at: "2026-08-01T12:00:00.000Z",
          html_url: "https://github.com/elizaOS/slopdotcash/issues/42",
          user: { login: "finish-line", node_id: "U_finish_line" },
        },
      ]),
    );
    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      address: ADDRESS,
      chain: "solana",
      sourceActorId: "U_finish_line",
      sourceIssueId: "I_wallet_claim",
      sourceIssueNumber: 42,
      sourceUpdatedAt: "2026-08-01T12:00:00.000Z",
      sourceUrl: "https://github.com/elizaOS/slopdotcash/issues/42",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed on duplicate open wallet claim issues", async () => {
    const issue = {
      number: 42,
      node_id: "I_wallet_claim",
      title: "Slop wallet claim",
      body: formatPublishedWallet(ADDRESS),
      updated_at: "2026-08-01T12:00:00.000Z",
      html_url: "https://github.com/elizaOS/slopdotcash/issues/42",
      user: { login: "finish-line", node_id: "U_finish_line" },
    };
    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse([issue, { ...issue, number: 43 }]),
          ),
      }),
    ).rejects.toThrow(/multiple open wallet claim issues/u);
  });

  it("returns null for a missing profile repository or absent marker", async () => {
    await expect(
      fetchPublishedGithubWallet("no-profile", "2026-08-02T00:00:00.000Z", {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(jsonResponse([]))
          .mockResolvedValueOnce(jsonResponse({}, 404)),
      }),
    ).resolves.toBeNull();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
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
      fetchPublishedGithubWallet("no-wallet", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed on moving references and malformed immutable bytes", async () => {
    const mutable = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: "main" }]));
    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: mutable,
      }),
    ).rejects.toThrow(/commit SHA/u);

    const malformed = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
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
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: malformed,
      }),
    ).rejects.toThrow(/encoding/u);
  });

  it("rejects an oversized API response before reading its body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
    );

    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
      }),
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
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
