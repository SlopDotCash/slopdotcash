/** Tests immutable GitHub wallet observation without reaching the network. */

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain(`?ref=${COMMIT}`);
  });

  it("returns null for a missing profile repository or absent marker", async () => {
    await expect(
      fetchPublishedGithubWallet("no-profile", "2026-08-02T00:00:00.000Z", {
        fetch: vi.fn().mockResolvedValue(jsonResponse({}, 404)),
      }),
    ).resolves.toBeNull();

    const fetchMock = vi
      .fn()
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
      .mockResolvedValueOnce(jsonResponse({ path: "README.md" }))
      .mockResolvedValueOnce(jsonResponse([{ sha: "main" }]));
    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: mutable,
      }),
    ).rejects.toThrow(/commit SHA/u);

    const malformed = vi
      .fn()
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
      .mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchPublishedGithubWallet("finish-line", "2026-08-02T00:00:00.000Z", {
        fetch: fetchMock,
      }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
