/** The payments Worker serves only the networks its deployment tier allows:
 * a production Worker never indexes a testnet vault, however PAYMENT_NETWORKS
 * is configured. Real migrations and registry tables; no chain reads. */

import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { createMonthlyAllocationFixture } from "../../tests/monthly-allocation-fixture";
import { parsePaymentNetworks } from "./deployments";
import { registryDeployments } from "./index";

const deployment = {
  network: "base-sepolia",
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  owner: "0x2000000000000000000000000000000000000002",
  identityAuthority: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
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

describe("parsePaymentNetworks tier gate", () => {
  test("production refuses a testnet network", () => {
    expect(() =>
      parsePaymentNetworks('["base-sepolia"]', "production"),
    ).toThrow(/base-sepolia.*testnet|testnet.*base-sepolia/);
    expect(() =>
      parsePaymentNetworks('["base-mainnet","base-sepolia"]', "production"),
    ).toThrow(/base-sepolia/);
  });
  test("production serves a mainnet network", () => {
    expect(parsePaymentNetworks('["base-mainnet"]', "production")).toEqual([
      "base-mainnet",
    ]);
  });
  test("staging serves a testnet network", () => {
    expect(parsePaymentNetworks('["base-sepolia"]', "staging")).toEqual([
      "base-sepolia",
    ]);
  });
  test("an unknown tier stops the Worker instead of guessing", () => {
    expect(() =>
      parsePaymentNetworks('["base-mainnet"]', "qa" as never),
    ).toThrow(/tier/i);
  });
});

describe("registryDeployments tier gate", () => {
  let sqlite: Database;
  afterEach(() => sqlite.close());

  test("a production Worker refuses to serve a testnet vault", async () => {
    const fixture = await createMonthlyAllocationFixture({ deployment });
    sqlite = fixture.sqlite;
    expect(fixture.project.manifest.escrow?.deployments[0]?.network).toBe(
      "base-sepolia",
    );
    // The gate throws synchronously at worker start, before any vault read.
    expect(() =>
      registryDeployments({
        REGISTRY_DB: fixture.db,
        PAYMENTS_DB: fixture.db,
        PAYMENT_NETWORKS: '["base-sepolia"]',
        PAYMENT_RPC_URLS: "{}",
      }),
    ).toThrow(/testnet.*base-sepolia/);
  });

  test("a staging Worker serves the same testnet vault", async () => {
    const fixture = await createMonthlyAllocationFixture({ deployment });
    sqlite = fixture.sqlite;
    const { deployments, failures } = await registryDeployments({
      REGISTRY_DB: fixture.db,
      PAYMENTS_DB: fixture.db,
      PAYMENT_NETWORKS: '["base-sepolia"]',
      PAYMENT_RPC_URLS: "{}",
      SLOP_ENVIRONMENT: "staging",
    });
    expect(failures).toEqual([]);
    expect(deployments.map((entry) => entry.network)).toEqual(["base-sepolia"]);
  });
});
