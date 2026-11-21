import { expect, test } from "bun:test";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { paymentStateLabel, paymentsOn, vaultStateLabel } from "./Presentation";

function project(networks: string[], kind = "monthly-pool"): ProjectDefinition {
  return {
    reward: { kind, paymentMode: "disabled" },
    escrow: { deployments: networks.map((network) => ({ network })) },
  } as unknown as ProjectDefinition;
}

test("a vault on a paying mainnet network shows payments enabled despite the legacy flag", () => {
  for (const network of [
    "base-mainnet",
    "robinhood-mainnet",
    "solana-mainnet",
  ]) {
    expect(paymentsOn(project([network]))).toBe(true);
    expect(paymentStateLabel(project([network]))).toBe("Enabled");
    expect(vaultStateLabel(project([network]))).toBe("Live");
  }
});

test("no vault, or a vault only on a switched-off network, shows payments disabled", () => {
  expect(paymentStateLabel(project([]))).toBe("Disabled");
  expect(vaultStateLabel(project([]))).toBe("Not set up");
  expect(paymentStateLabel(project(["ethereum"]))).toBe("Disabled");
  expect(vaultStateLabel(project(["ethereum"]))).toBe("Set up");
});

test("a test network vault is not held back by the mainnet switch", () => {
  expect(paymentsOn(project(["base-sepolia"]))).toBe(true);
});

test("external prize shares never show platform payments", () => {
  const prize = project(["base-mainnet"], "external-prize-share");
  expect(paymentStateLabel(prize)).toBe("Disabled");
  expect(vaultStateLabel(prize)).toBe("Not applicable");
});
