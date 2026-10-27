import { expect, test } from "bun:test";
import { paymentStack } from "../workers/payment-executor/configure.mjs";
import { mainnetReleasePlan } from "../workers/payment-executor/release-plan.mjs";

const input = {
  registry: [],
  registryDatabase: {
    database_name: "slop-private",
    database_id: "11111111-1111-1111-1111-111111111111",
  },
  monthlySchedule:
    '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}',
};

test("current policy preserves the complete Base configuration and omits disabled networks", () => {
  const plan = mainnetReleasePlan(input);
  expect(plan.map((item) => item.network)).toEqual(["base-mainnet"]);
  const prior = paymentStack({
    ...input,
    stack: "production",
    network: "base-mainnet",
    deployments: [],
  });
  expect(prior.configs.attester).toEqual(plan[0].config);
  expect(plan[0].pinCount).toBe(0);
  expect(plan[0].config.triggers.crons).toEqual([]);
  expect(plan[0].secrets).toEqual(["PAYMENT_RPC_URLS", "SIGNER_PRIVATE_KEY"]);
});

test("hypothetical Solana activation prepares its own capabilities without modifying actual policy", () => {
  const plan = mainnetReleasePlan({
    ...input,
    execution: {
      "base-mainnet": true,
      "solana-mainnet": true,
      ethereum: false,
      "robinhood-mainnet": false,
    },
  });
  const solana = plan[1];
  expect(solana.config.vars.CHAIN_FAMILY).toBe("solana");
  expect(solana.secrets).toEqual(["PAYMENT_RPC_URLS", "SOLANA_SIGNER_SEED"]);
  expect(solana.bindings).toEqual([
    {
      binding: "SOLANA_IDENTITY_ATTESTER",
      service: solana.config.name,
      entrypoint: "SolanaBinding",
    },
    {
      binding: "SECURITY_SOLANA_IDENTITY_ATTESTER",
      service: solana.config.name,
      entrypoint: "SolanaBinding",
    },
    {
      binding: "MONTHLY_RELEASE_SOLANA",
      service: solana.config.name,
      entrypoint: "MonthlyReserveRelease",
    },
  ]);
  expect(mainnetReleasePlan(input).map((item) => item.network)).toEqual([
    "base-mainnet",
  ]);
});
