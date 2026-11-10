/** paymentStack must declare the tier its generated dispatcher runs in:
 * a test-stack dispatcher serves one registry test network, so its vars
 * must carry SLOP_ENVIRONMENT=staging — otherwise the payments Worker's
 * tier gate classifies it as production and refuses the testnet on every
 * tick. Synthetic registry manifest; no chain reads, no deployment. */

import { describe, expect, test } from "bun:test";
import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import {
  type PaymentsWorkerEnvironment,
  servedPaymentNetworks,
} from "../payments/index";
import { paymentStack } from "./configure.mjs";

const deployment = {
  network: "base-sepolia" as const,
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

const fixture = fixtureProject("eliza");
const manifest = assertProjectDefinition({
  ...fixture,
  reward: {
    ...fixture.reward,
    chain: "base",
    currency: "USDC",
    feeBasisPoints: 200,
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [deployment],
  },
});

const registryDatabase = {
  database_name: "slop-private",
  database_id: "1b453124-2709-45af-8389-151a8105c461",
};
const record = paymentDeploymentRecord("eliza", deployment);

describe("paymentStack dispatcher tier", () => {
  test("an isolated test-stack dispatcher declares staging and serves its testnet", () => {
    const stack = paymentStack({
      stack: "test",
      environment: "isolated",
      topology: "relayer",
      network: "base-sepolia",
      databaseId: "00000000-0000-4000-8000-000000000001",
      databaseName: "slop-payments-base-sepolia",
      deployments: [record],
      registry: [manifest],
      registryDatabase,
    });
    expect(stack.configs.dispatcher.vars.SLOP_ENVIRONMENT).toBe("staging");
    expect(stack.configs.dispatcher.vars.PAYMENT_NETWORKS).toBe(
      '["base-sepolia"]',
    );
    expect(
      // The gate reads only PAYMENT_NETWORKS and SLOP_ENVIRONMENT from the
      // Worker env; the generated dispatcher vars are exactly that subset.
      servedPaymentNetworks(
        stack.configs.dispatcher.vars as unknown as PaymentsWorkerEnvironment,
      ),
    ).toEqual(["base-sepolia"]);
  });

  test("a staging test-stack dispatcher declares staging and serves its testnet", () => {
    const stack = paymentStack({
      stack: "test",
      environment: "staging",
      topology: "relayer",
      network: "base-sepolia",
      registry: [manifest],
      registryDatabase: {
        database_name: "slop-staging",
        database_id: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(stack.configs.dispatcher.vars.SLOP_ENVIRONMENT).toBe("staging");
    expect(
      // The gate reads only PAYMENT_NETWORKS and SLOP_ENVIRONMENT from the
      // Worker env; the generated dispatcher vars are exactly that subset.
      servedPaymentNetworks(
        stack.configs.dispatcher.vars as unknown as PaymentsWorkerEnvironment,
      ),
    ).toEqual(["base-sepolia"]);
  });

  test("a production stack generates no dispatcher at all", () => {
    const mainnetDeployment = {
      ...deployment,
      network: "base-mainnet" as const,
      bindingDelaySeconds: "172800",
    };
    const mainnetManifest = assertProjectDefinition({
      ...manifest,
      escrow: { ...manifest.escrow, deployments: [mainnetDeployment] },
    });
    const stack = paymentStack({
      stack: "production",
      network: "base-mainnet",
      deployments: [paymentDeploymentRecord("eliza", mainnetDeployment)],
      registry: [mainnetManifest],
      registryDatabase,
    });
    expect(Object.keys(stack.configs)).toEqual(["attester"]);
    expect(
      (stack.configs as { dispatcher?: unknown }).dispatcher,
    ).toBeUndefined();
  });
});
