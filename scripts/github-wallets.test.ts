// The settlement wallet observation must follow the immutable actor id.
// A rename or a reused handle must not hide a valid registry claim, and must
// not throw for the whole reward cycle (PRD ACC-01,
// docs/base-solana-payout-plan.md "Rename account and preserve earnings").
import { describe, expect, test } from "bun:test";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { fetchPublishedGithubWallet } from "./github-wallets";

const NODE = "U_kgDOAAHiQA"; // encodes numeric id 123456
const LEGACY_NODE = "MDQ6VXNlcjEyMzQ1Ng=="; // "04:User123456"
const ADDRESS = "4Nd1mBQtrMJVYVfKf2PJy9NZUse8sLfY4Yt9JZ7bW6Lx";
const AT = "2026-10-01T00:00:00.000Z";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const claim = (login: string) => ({
  schemaVersion: 1,
  claimId: "c1",
  githubActorId: "123456",
  githubLogin: login,
  address: ADDRESS,
  chain: "solana",
  source: "d1_registry",
  sourceBodySha256: "a".repeat(64),
  observedAt: "2026-09-01T00:00:00.000Z",
  recordDigest: "b".repeat(64),
});
const REGISTRY =
  "https://api.slop.cash/api/v1/wallet-claims/actors/123456/current";

/** GitHub after actor 123456 renamed alice -> alice-new and 999999 took alice. */
function renamedWorld(node: string, claimLogin: string) {
  const requests: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === "https://api.github.com/user/123456")
      return json(200, { id: 123456, node_id: node, login: "alice-new" });
    if (url === "https://api.github.com/users/alice-new")
      return json(200, { id: 123456, node_id: node, login: "alice-new" });
    if (url === "https://api.github.com/users/alice")
      return json(200, { id: 999999, node_id: "U_kgDOAA9CPw", login: "alice" });
    if (url === REGISTRY) return json(200, claim(claimLogin));
    return json(404, { message: "Not Found" });
  };
  return { fetchImpl: fetchImpl as typeof fetch, requests };
}

describe("settlement wallet lookup by immutable actor id", () => {
  test("fixture node ids encode the numeric id", () => {
    expect(githubUserIdFromNodeId(NODE)).toBe("123456");
    expect(githubUserIdFromNodeId(LEGACY_NODE)).toBe("123456");
  });

  test("old login from a prior manifest still finds the registry claim", async () => {
    const { fetchImpl, requests } = renamedWorld(NODE, "alice");
    const wallet = await fetchPublishedGithubWallet(NODE, "alice", AT, {
      fetch: fetchImpl,
    });
    expect(wallet?.address).toBe(ADDRESS);
    expect(requests).not.toContain("https://api.github.com/users/alice");
  });

  test("claim recorded under the old login is kept after a rename", async () => {
    const { fetchImpl } = renamedWorld(NODE, "alice");
    const wallet = await fetchPublishedGithubWallet(NODE, "alice-new", AT, {
      fetch: fetchImpl,
    });
    expect(wallet?.address).toBe(ADDRESS);
  });

  test("a reused old handle neither aborts nor redirects the lookup", async () => {
    const { fetchImpl } = renamedWorld(LEGACY_NODE, "alice-new");
    const wallet = await fetchPublishedGithubWallet(LEGACY_NODE, "alice", AT, {
      fetch: fetchImpl,
    });
    expect(wallet).toMatchObject({
      address: ADDRESS,
      sourceActorId: LEGACY_NODE,
    });
  });

  test("an identity that does not match the node id still fails closed", async () => {
    const fetchImpl = (async () =>
      json(200, {
        id: 123456,
        node_id: "U_kgDOZZZZZQ",
        login: "alice",
      })) as unknown as typeof fetch;
    await expect(
      fetchPublishedGithubWallet(NODE, "alice", AT, { fetch: fetchImpl }),
    ).rejects.toThrow("GitHub wallet actor identity changed");
  });
});
