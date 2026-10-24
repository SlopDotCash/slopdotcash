import { describe, expect, test } from "bun:test";
import { encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import {
  buildSetMonthlyCommitmentCalldata,
  EVM_ESCROW_EVENT_TOPICS,
} from "../../contracts/evm/adapter";
import {
  solanaBase58,
  solanaVaultAddress,
} from "../../contracts/solana/adapter";
import { solanaMonthlyCommitmentMessage } from "../../contracts/solana/monthly-commitment";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import {
  monthlyTarget,
  type SolanaMonthlyPlan,
  vaultMonthlyCap,
  verifySolanaMonthlyPlan,
} from "./monthly-commitment-actions";
import type { ProjectDefinition } from "./projects.mjs";

const abi = parseAbi([
  "function setMonthlyCommitment(uint128 cap, bool enabled)",
  "event MonthlyCommitmentSet(uint128 cap, bool enabled)",
]);

describe("EVM setMonthlyCommitment calldata", () => {
  test("matches the ABI encoding for on, off and the uint128 bound", () => {
    for (const [cap, enabled] of [
      [2_500_000_000n, true],
      [1_000_000n, false],
      [0n, false],
      [(1n << 128n) - 1n, true],
    ] as const)
      expect(buildSetMonthlyCommitmentCalldata(cap.toString(), enabled)).toBe(
        encodeFunctionData({
          abi,
          functionName: "setMonthlyCommitment",
          args: [cap, enabled],
        }),
      );
    expect(EVM_ESCROW_EVENT_TOPICS.MonthlyCommitmentSet).toBe(
      encodeEventTopics({ abi, eventName: "MonthlyCommitmentSet" })[0],
    );
  });

  test("rejects a zero cap when on, overflow and non-canonical amounts", () => {
    expect(() => buildSetMonthlyCommitmentCalldata("0", true)).toThrow(
      "positive cap",
    );
    expect(() =>
      buildSetMonthlyCommitmentCalldata((1n << 128n).toString(), true),
    ).toThrow("uint128");
    for (const cap of ["-1", "1.5", "01", ""])
      expect(() => buildSetMonthlyCommitmentCalldata(cap, false)).toThrow(
        "uint128",
      );
  });
});

const monthly = (
  monthlyCapMinor: string,
  rewardAsset?: ProjectDefinition["rewardAsset"],
) =>
  ({
    reward: { kind: "monthly-pool", chain: "base", monthlyCapMinor },
    ...(rewardAsset ? { rewardAsset } : {}),
  }) as Pick<ProjectDefinition, "reward" | "rewardAsset">;
const stablecoinVault = {
  network: "base-mainnet",
  asset: ESCROW_NETWORKS["base-mainnet"].asset,
} as Pick<EscrowDeployment, "network" | "asset">;

describe("the owner's monthly cap in vault base units", () => {
  test("uses stablecoin micro-units only for a 6-decimal vault token", () => {
    expect(vaultMonthlyCap(monthly("2500000000"), stablecoinVault, 6)).toBe(
      2_500_000_000n,
    );
    expect(() =>
      vaultMonthlyCap(monthly("2500000000"), stablecoinVault, 18),
    ).toThrow("decimals differ");
  });

  test("uses a token amount only at the token's recorded decimals", () => {
    const token = {
      kind: "token",
      network: "base",
      address: "0x1111111111111111111111111111111111111111",
      decimals: 18,
    } as ProjectDefinition["rewardAsset"];
    const vault = { ...stablecoinVault, asset: token?.address as string };
    expect(
      vaultMonthlyCap(monthly("5000000000000000000", token), vault, 18),
    ).toBe(5_000_000_000_000_000_000n);
    expect(() => vaultMonthlyCap(monthly("5", token), vault, 6)).toThrow(
      "decimals differ",
    );
    expect(() =>
      vaultMonthlyCap(
        monthly("5000000000000000000", token),
        stablecoinVault,
        18,
      ),
    ).toThrow("vault token differs");
  });

  test("refuses a project without a monthly pool", () => {
    expect(() =>
      vaultMonthlyCap(
        {
          reward: { kind: "external-prize-share", monthlyCapMinor: "0" },
        } as Pick<ProjectDefinition, "reward">,
        stablecoinVault,
        6,
      ),
    ).toThrow("no monthly amount");
  });

  test("turns on at the project cap and turns off keeping the vault's cap", () => {
    const current = { cap: "900", enabled: true };
    expect(monthlyTarget(true, 1_000n, current)).toEqual({
      cap: "1000",
      enabled: true,
    });
    expect(monthlyTarget(false, 0n, current)).toEqual({
      cap: "900",
      enabled: false,
    });
    expect(() => monthlyTarget(true, 0n, { cap: "0", enabled: false })).toThrow(
      "Set a monthly amount",
    );
  });
});

describe("prepared Solana monthly setting", () => {
  const program = "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ";
  const project = solanaBase58(new Uint8Array(32).fill(7));
  const owner = solanaBase58(new Uint8Array(32).fill(3));
  const blockhash = solanaBase58(new Uint8Array(32).fill(5));
  const deployment = {
    network: "solana-devnet",
    programId: program,
    projectPda: project,
    vault: solanaVaultAddress(program, project),
    asset: solanaBase58(new Uint8Array(32).fill(9)),
    owner,
  } as EscrowDeployment;
  const target = { cap: "1000000", enabled: true };
  const wire = (cap: string) => {
    const msg = solanaMonthlyCommitmentMessage(
      { ...deployment, mint: deployment.asset } as never,
      { wallet: owner, cap, enabled: true, blockhash },
    );
    const bytes = new Uint8Array(65 + msg.length);
    bytes[0] = 1;
    bytes.set(msg, 65);
    return btoa(String.fromCharCode(...bytes));
  };
  const plan = (transaction: string): SolanaMonthlyPlan => ({
    wallet: owner,
    cap: target.cap,
    enabled: true,
    decimals: 6,
    current: { cap: "0", enabled: false },
    transaction: {
      blockhash,
      lastValidBlockHeight: 10,
      transaction,
      networkFeeLamports: "5000",
    },
  });

  test("accepts wire bytes that rebuild the reviewed instruction", () => {
    expect(
      verifySolanaMonthlyPlan(deployment, plan(wire("1000000")), owner, target),
    ).toBeInstanceOf(Uint8Array);
  });

  test("refuses a prepared transaction for another cap or wallet", () => {
    expect(() =>
      verifySolanaMonthlyPlan(deployment, plan(wire("2000000")), owner, target),
    ).toThrow("differs from the reviewed setting");
    expect(() =>
      verifySolanaMonthlyPlan(
        deployment,
        plan(wire("1000000")),
        solanaBase58(new Uint8Array(32).fill(4)),
        target,
      ),
    ).toThrow("differs from the reviewed setting");
    expect(() =>
      verifySolanaMonthlyPlan(deployment, plan(wire("1000000")), owner, {
        ...target,
        enabled: false,
      }),
    ).toThrow("differs from the reviewed setting");
  });
});
