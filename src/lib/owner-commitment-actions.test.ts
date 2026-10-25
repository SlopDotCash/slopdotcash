import { describe, expect, test } from "bun:test";
import { requestOwnerCommitment } from "./owner-commitment-actions";

const DIGEST = "b".repeat(64);
const MANIFEST = "c".repeat(64);
const SNAPSHOT = "d".repeat(64);
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

function plan(network: string, gross: bigint) {
  const fee = (gross + 49n) / 50n;
  return {
    schemaVersion: "2",
    projectId: "p1",
    cycleId: "2026-10",
    manifestSha256: MANIFEST,
    snapshotSha256: SNAPSHOT,
    deployment: {
      network,
      vault: "0x0000000000000000000000000000000000000000",
      asset: "0x0000000000000000000000000000000000000000",
    },
    award: {
      githubUserId: "123",
      sourceDigest: DIGEST,
      gross: gross.toString(),
      fee: fee.toString(),
      net: (gross - fee).toString(),
    },
  };
}

async function attempt(network: string, gross: bigint) {
  const stubFetch = async () =>
    new Response(JSON.stringify(plan(network, gross)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  Object.defineProperty(globalThis, "fetch", {
    value: stubFetch,
    configurable: true,
  });
  return requestOwnerCommitment("p1", "2026-10", {
    network,
    githubUserId: "123",
    manifestSha256: MANIFEST,
    snapshotSha256: SNAPSHOT,
  });
}

describe("requestOwnerCommitment chain amount range", () => {
  test("accepts an EVM award above u64 and within uint128", async () => {
    const plan = await attempt("base-mainnet", 20000000000000000000n);
    expect(plan.award.gross).toBe("20000000000000000000");
    const max = await attempt("base-mainnet", U128_MAX);
    expect(max.award.gross).toBe(U128_MAX.toString());
  });

  test("rejects an EVM award above uint128", async () => {
    await expect(attempt("base-mainnet", U128_MAX + 1n)).rejects.toThrow(
      "The prepared award amounts are invalid.",
    );
  });

  test("keeps the Solana u64 cap", async () => {
    const max = await attempt("solana-mainnet", U64_MAX);
    expect(max.award.gross).toBe(U64_MAX.toString());
    await expect(attempt("solana-mainnet", U64_MAX + 1n)).rejects.toThrow(
      "The prepared award amounts are invalid.",
    );
  });

  test("rejects an unknown deployment network", async () => {
    await expect(attempt("no-such-network", 1000n)).rejects.toThrow(
      "The prepared award amounts are invalid.",
    );
  });
});
