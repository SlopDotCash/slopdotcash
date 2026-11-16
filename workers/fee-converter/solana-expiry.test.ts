import { expect, test } from "bun:test";
import {
  proveSolanaExpiry,
  type RecoveryRpc,
  recoveryOperator,
} from "./solana-expiry";

test("recognizes the public Solana Vibe Station endpoint exactly", () => {
  expect(recoveryOperator("https://public.rpc.solanavibestation.com")).toBe(
    "solana-vibe-station",
  );
  expect(
    recoveryOperator("https://public.rpc.solanavibestation.com/historical"),
  ).toBe("solana-vibe-station");
  for (const endpoint of [
    "http://public.rpc.solanavibestation.com",
    "https://solanavibestation.com",
    "https://other.rpc.solanavibestation.com",
    "https://public.rpc.solanavibestation.com.evil.example",
  ]) {
    expect(recoveryOperator(endpoint)).toBeNull();
  }
});

function history(
  firstAvailableSlot: number,
  signatures: string[] = [],
  signatureContextSlot = 301,
) {
  const rpc: RecoveryRpc = async <T>(method: string, params: unknown[]) => {
    const values: Record<string, unknown> = {
      getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      getFirstAvailableBlock: firstAvailableSlot,
      isBlockhashValid: { context: { slot: 300 }, value: false },
      getSignatureStatuses: {
        context: { slot: signatureContextSlot },
        value: [null],
      },
      getTransaction: null,
      getBlock:
        params[0] === 100
          ? {
              blockhash: "anchor",
              previousBlockhash: "earlier",
              parentSlot: 99,
              signatures: [],
            }
          : {
              blockhash: "tip",
              previousBlockhash: "anchor",
              parentSlot: 100,
              signatures,
            },
    };
    return values[method] as T;
  };
  return rpc;
}

test("public recovery retains independent operators and anchored full history", async () => {
  const primaryOperator = recoveryOperator(
    "https://api.mainnet-beta.solana.com",
  );
  const secondaryOperator = recoveryOperator(
    "https://public.rpc.solanavibestation.com",
  );
  if (!primaryOperator || !secondaryOperator)
    throw new Error("Expected recognized independent providers");
  const primary = {
    operator: primaryOperator,
    rpc: history(0),
  };
  const secondary = {
    operator: secondaryOperator,
    rpc: history(100),
  };
  const proof = await proveSolanaExpiry("missing", "anchor", 100, [
    primary,
    secondary,
  ]);
  expect(proof?.providers.map((provider) => provider.operator)).toEqual([
    "solana-public",
    "solana-vibe-station",
  ]);
  expect(proof?.providers[1].coverage?.complete).toBe(true);
  expect(proof?.providers[1].firstAvailableSlot).toBe(100);
  expect(
    await proveSolanaExpiry("missing", "anchor", 100, [secondary, secondary]),
  ).toBeNull();
  expect(
    await proveSolanaExpiry("missing", "anchor", 100, [
      primary,
      { ...secondary, rpc: history(101) },
    ]),
  ).toBeNull();
  expect(
    await proveSolanaExpiry("missing", "anchor", 100, [
      primary,
      { ...secondary, rpc: history(100, ["missing"]) },
    ]),
  ).toBeNull();
  expect(
    await proveSolanaExpiry("missing", "anchor", 100, [
      primary,
      { ...secondary, rpc: history(100, [], 0) },
    ]),
  ).toBeNull();
});
