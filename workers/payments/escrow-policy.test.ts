// Family and registry invariants for the escrow network registry. The
// registry is the only place a chain maps to an execution family; nothing
// downstream may infer "EVM" from the word "base".
import { describe, expect, test } from "bun:test";
import {
  assertEscrowPolicy,
  assertEscrowTransition,
  chainFamily,
  ESCROW_CHAINS,
  ESCROW_NETWORKS,
  EVM_CHAINS,
  isEscrowChain,
} from "../../src/lib/escrow-policy.mjs";

const evmDeployment = {
  network: "base-sepolia",
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  owner: "0x2000000000000000000000000000000000000002",
  identityAuthority: "0x3000000000000000000000000000000000000003",
  feeRecipient: "0x4000000000000000000000000000000000000004",
  deploymentTransaction: `0x${"ab".repeat(32)}`,
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "60",
  rotationDelaySeconds: null,
  factory: "0x5000000000000000000000000000000000000005",
  factoryCodeSha256: "cd".repeat(32),
  registrar: "0x6000000000000000000000000000000000000006",
};
const solanaDeployment = {
  network: "solana-devnet",
  vault: "So11111111111111111111111111111111111111112",
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  upgradeAuthority: null,
  projectPda: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  networkDomain: "cd".repeat(32),
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  owner: "11111111111111111111111111111111",
  identityAuthority: "SysvarRent111111111111111111111111111111111",
  feeRecipient: "SysvarC1ock11111111111111111111111111111111",
  rotationAuthority: "Vote111111111111111111111111111111111111111",
  deploymentTransaction: "1".repeat(64),
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "60",
  rotationDelaySeconds: "60",
  factory: null,
  factoryCodeSha256: null,
  registrar: null,
};
const robinhoodDeployment = {
  ...evmDeployment,
  network: "robinhood-testnet",
  asset: "0x7e955252e15c84f5768b83c41a71f9eba181802f",
};
const policy = (chain: string, deployment: object) => ({
  schemaVersion: "1",
  effectiveCycle: "2026-11",
  chain,
  feeBasisPoints: 200,
  withdrawalFeeBasisPoints: 200,
  feeMode: "deduct-from-gross",
  deployments: [deployment],
});

describe("escrow chain families", () => {
  test("each chain maps to exactly one family", () => {
    expect([...ESCROW_CHAINS]).toEqual([
      "base",
      "solana",
      "robinhood",
      "ethereum",
    ]);
    expect(chainFamily("base")).toBe("evm");
    expect(chainFamily("solana")).toBe("solana");
    expect(chainFamily("robinhood")).toBe("evm");
    expect(chainFamily("ethereum")).toBe("evm");
    expect([...EVM_CHAINS]).toEqual(["base", "robinhood", "ethereum"]);
  });
  test("an unknown chain is rejected, never defaulted to a family", () => {
    expect(isEscrowChain("evm")).toBe(false);
    expect(isEscrowChain("BASE")).toBe(false);
    expect(isEscrowChain(undefined)).toBe(false);
    expect(() => chainFamily("evm")).toThrow(TypeError);
    expect(() => chainFamily("BASE")).toThrow(TypeError);
  });
  test("EVM networks carry chain id, gas ceiling and scan page; Solana networks carry none", () => {
    for (const network of Object.values(ESCROW_NETWORKS)) {
      expect(chainFamily(network.chain)).toBe(network.family);
      expect(typeof network.assetSymbol).toBe("string");
      expect(network.assetSymbol.length).toBeGreaterThan(0);
      if (network.family === "evm") {
        expect(network.chainId).toMatch(/^[1-9][0-9]*$/);
        expect(network.gasCeiling).toMatch(/^[1-9][0-9]*$/);
        expect(network.scanPageBlocks).toMatch(/^[1-9][0-9]*$/);
      } else {
        expect(network.chainId).toBeUndefined();
        expect(network.gasCeiling).toBeUndefined();
        expect(network.scanPageBlocks).toBeUndefined();
      }
    }
  });
  test("Base keeps its executor and scanner limits", () => {
    for (const name of ["base-sepolia", "base-mainnet"] as const) {
      expect(ESCROW_NETWORKS[name].gasCeiling).toBe("500000");
      expect(ESCROW_NETWORKS[name].scanPageBlocks).toBe("2000");
      expect(ESCROW_NETWORKS[name].assetSymbol).toBe("USDC");
    }
    expect(ESCROW_NETWORKS["solana-testnet"].assetSymbol).toBe("TEST");
  });
  test("Robinhood Chain carries its own limits, chain ids and USDG", () => {
    const testnet = ESCROW_NETWORKS["robinhood-testnet"];
    const mainnet = ESCROW_NETWORKS["robinhood-mainnet"];
    expect(testnet).toEqual({
      chain: "robinhood",
      family: "evm",
      testnet: true,
      chainId: "46630",
      asset: "0x7e955252e15c84f5768b83c41a71f9eba181802f",
      assetSymbol: "USDG",
      assetDecimals: 6,
      assets: [
        {
          address: "0x7e955252e15c84f5768b83c41a71f9eba181802f",
          symbol: "USDG",
          decimals: 6,
          source: expect.stringMatching(/^https:\/\//),
        },
      ],
      gasCeiling: "2000000",
      scanPageBlocks: "9000",
    });
    expect(mainnet).toEqual({
      chain: "robinhood",
      family: "evm",
      testnet: false,
      chainId: "4663",
      asset: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      assetSymbol: "USDG",
      assetDecimals: 6,
      assets: [
        {
          address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
          symbol: "USDG",
          decimals: 6,
          source: expect.stringMatching(/^https:\/\//),
        },
      ],
      gasCeiling: "2000000",
      scanPageBlocks: "9000",
    });
    // Under the common 10,000-block eth_getLogs provider limit (spec section 4).
    expect(Number(mainnet.scanPageBlocks)).toBeLessThan(10_000);
  });
});

describe("assertEscrowPolicy after the family refactor", () => {
  test("accepts a reviewed Base deployment", () => {
    expect(() =>
      assertEscrowPolicy(policy("base", evmDeployment)),
    ).not.toThrow();
  });
  test("accepts a reviewed Solana deployment", () => {
    expect(() =>
      assertEscrowPolicy(policy("solana", solanaDeployment)),
    ).not.toThrow();
  });
  test("rejects a family name used as a chain", () => {
    expect(() => assertEscrowPolicy(policy("evm", evmDeployment))).toThrow(
      /Invalid escrow chain/,
    );
  });
  test("rejects Solana-only fields on an EVM deployment", () => {
    expect(() =>
      assertEscrowPolicy(
        policy("base", { ...evmDeployment, programId: evmDeployment.vault }),
      ),
    ).toThrow(/does not match the network/);
  });
  test("rejects an EVM transaction hash on a Solana deployment", () => {
    expect(() =>
      assertEscrowPolicy(
        policy("solana", {
          ...solanaDeployment,
          deploymentTransaction: `0x${"ab".repeat(32)}`,
        }),
      ),
    ).toThrow(/immutable source and transaction evidence/);
  });
  test("accepts a reviewed Robinhood Chain testnet deployment", () => {
    expect(() =>
      assertEscrowPolicy(policy("robinhood", robinhoodDeployment)),
    ).not.toThrow();
  });
  test("a Robinhood Chain deployment may name any token (escrow v2)", () => {
    // The default reference asset is not an allowlist: the vault reads its
    // token's decimals from chain.
    expect(() =>
      assertEscrowPolicy(
        policy("robinhood", {
          ...robinhoodDeployment,
          network: "robinhood-mainnet",
          bindingDelaySeconds: "172800",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertEscrowPolicy(
        policy("robinhood", {
          ...robinhoodDeployment,
          network: "robinhood-mainnet",
          bindingDelaySeconds: "172800",
          asset: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        }),
      ),
    ).not.toThrow();
  });
  test("a Base network cannot sit on a Robinhood Chain policy", () => {
    expect(() =>
      assertEscrowPolicy(policy("robinhood", evmDeployment)),
    ).toThrow(/one chain and one escrow per network/);
  });
  test("rejects an owner who is also the fee recipient", () => {
    // The dedicated platform fee key must not also hold a vault-owner role.
    expect(() =>
      assertEscrowPolicy(
        policy("base", { ...evmDeployment, feeRecipient: evmDeployment.owner }),
      ),
    ).toThrow(/separate roles/);
  });
  test("rejects an identity authority who is also the fee recipient", () => {
    expect(() =>
      assertEscrowPolicy(
        policy("base", {
          ...evmDeployment,
          feeRecipient: evmDeployment.identityAuthority,
        }),
      ),
    ).toThrow(/separate roles/);
  });
});
describe("escrow v2 network registry", () => {
  test("Ethereum mainnet and Sepolia carry Circle USDC with its source", () => {
    expect(ESCROW_NETWORKS.ethereum).toMatchObject({
      chain: "ethereum",
      family: "evm",
      testnet: false,
      chainId: "1",
      asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      assetSymbol: "USDC",
      assetDecimals: 6,
    });
    expect(ESCROW_NETWORKS["ethereum-sepolia"]).toMatchObject({
      chain: "ethereum",
      testnet: true,
      chainId: "11155111",
      asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    });
    for (const name of ["ethereum", "ethereum-sepolia"] as const)
      expect(ESCROW_NETWORKS[name].assets[0].source).toBe(
        "https://developers.circle.com/stablecoins/usdc-contract-addresses",
      );
  });
  test("every reference asset has whole decimals and the default repeats the first", () => {
    for (const network of Object.values(ESCROW_NETWORKS)) {
      for (const asset of network.assets)
        expect(Number.isInteger(asset.decimals) && asset.decimals >= 0).toBe(
          true,
        );
      expect(network.asset).toBe(network.assets[0]?.address ?? null);
      expect(network.assetDecimals).toBe(network.assets[0]?.decimals ?? null);
    }
  });
  test("the withdrawal fee equals the 2% payout fee and nothing else", () => {
    expect(() =>
      assertEscrowPolicy({
        ...policy("base", evmDeployment),
        withdrawalFeeBasisPoints: 1000,
      }),
    ).toThrow(/fee policy/);
    expect(() =>
      assertEscrowPolicy({
        ...policy("base", evmDeployment),
        withdrawalFeeBasisPoints: 500,
      }),
    ).toThrow(/fee policy/);
  });
});

describe("reviewed EVM upgrade history", () => {
  const review = (n: string) => ({
    authority: `0x${n.repeat(40)}`,
    vaultImplementation: `0x${"a".repeat(39)}${n}`,
    vaultImplementationCodeSha256: n.repeat(64),
    factoryImplementation: `0x${"b".repeat(39)}${n}`,
    factoryImplementationCodeSha256: `${"e".repeat(63)}${n}`,
  });
  const past = (n: string, block: number) => ({
    ...review(n),
    supersededAtBlock: String(block),
  });
  const upgraded = (evmUpgrade: object) =>
    assertEscrowPolicy(policy("base", { ...evmDeployment, evmUpgrade }));
  const first = upgraded(review("7"));
  const second = upgraded({ ...review("8"), history: [past("7", 100)] });
  test("accepts strict history and rejects malformed, unbounded or duplicate entries", () => {
    expect(second).toBeTruthy();
    for (const history of [
      [],
      [review("7")],
      [{ ...past("7", 100), vaultImplementation: "0x1234" }],
      [{ ...past("7", 100), factoryImplementationCodeSha256: "AB".repeat(32) }],
      [{ ...past("7", 100), extra: true }],
      [{ ...past("7", 100), authority: evmDeployment.feeRecipient }],
      [{ ...past("7", 100), supersededAtBlock: "0" }],
      [{ ...past("7", 100), supersededAtBlock: "01" }],
      [{ ...past("7", 100), supersededAtBlock: 100 }],
      [{ ...past("7", 100), supersededAtBlock: "18446744073709551616" }],
      [past("7", 100), past("7", 100)],
      [past("7", 200), past("9", 100)],
    ])
      expect(() => upgraded({ ...review("8"), history })).toThrow(
        /EVM upgrade|policy fields|supersession/,
      );
  });
  test("an upgrade must append exactly the outgoing review with a later bound", () => {
    expect(() => assertEscrowTransition(first, second)).not.toThrow();
    for (const next of [
      review("8"),
      { ...review("8"), history: [past("9", 100)] },
      { ...review("8"), history: [past("7", 100), past("9", 200)] },
    ])
      expect(() => assertEscrowTransition(first, upgraded(next))).toThrow(
        /append the outgoing/,
      );
    const third = upgraded({
      ...review("9"),
      history: [past("7", 100), past("8", 200)],
    });
    expect(() => assertEscrowTransition(second, third)).not.toThrow();
    expect(() =>
      assertEscrowTransition(
        second,
        upgraded({
          ...review("9"),
          history: [past("7", 100), past("8", 100)],
        }),
      ),
    ).toThrow(/supersession/);
    // A rollback to a superseded review records the outgoing one again; the
    // older entry keeps its bound, so it never covers the rolled-back period.
    const rollback = upgraded({
      ...review("7"),
      history: [past("7", 100), past("8", 200)],
    });
    expect(() => assertEscrowTransition(second, rollback)).not.toThrow();
    expect(() =>
      assertEscrowTransition(
        rollback,
        upgraded({
          ...review("8"),
          history: [past("7", 100), past("8", 200), past("7", 300)],
        }),
      ),
    ).not.toThrow();
    expect(() => assertEscrowTransition(second, second)).not.toThrow();
  });
  test("history cannot be removed or edited", () => {
    const third = upgraded({
      ...review("9"),
      history: [past("7", 100), past("8", 200)],
    });
    for (const history of [
      undefined,
      [past("8", 200)],
      [past("8", 100), past("7", 200)],
      [past("7", 150), past("8", 200)],
      [
        { ...past("7", 100), vaultImplementationCodeSha256: "f".repeat(64) },
        past("8", 200),
      ],
    ])
      expect(() =>
        assertEscrowTransition(
          third,
          upgraded(history ? { ...review("9"), history } : review("9")),
        ),
      ).toThrow(/append the outgoing/);
  });
  test("a deployment's first appearance cannot carry history", () => {
    const empty = assertEscrowPolicy(policy("base", evmDeployment));
    const withoutDeployments = { ...empty, deployments: [] };
    for (const previous of [undefined, withoutDeployments])
      expect(() => assertEscrowTransition(previous, second)).toThrow(
        /new escrow deployment/,
      );
    expect(() => assertEscrowTransition(undefined, first)).not.toThrow();
    expect(() =>
      assertEscrowTransition(withoutDeployments, first),
    ).not.toThrow();
  });
});
