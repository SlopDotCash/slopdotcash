import { paymentDeployments } from "../../scripts/prepare-payment-deployments.ts";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { paymentStack } from "./configure.mjs";
import { MAINNET_EXECUTION } from "./mainnet-execution.mjs";

// This list names service capabilities, never projects or deployment pins.
// Enabled networks come only from the reviewed execution policy.
const bindings = {
  "base-mainnet": [
    ["BINDING_RECOVERY", "BindingRecovery"],
    ["MONTHLY_RELEASE_BASE", "MonthlyReserveRelease"],
  ],
  ethereum: [
    ["BINDING_RECOVERY_ETHEREUM", "BindingRecovery"],
    ["MONTHLY_RELEASE_ETHEREUM", "MonthlyReserveRelease"],
  ],
  "robinhood-mainnet": [
    ["BINDING_RECOVERY_ROBINHOOD", "BindingRecovery"],
    ["MONTHLY_RELEASE_ROBINHOOD", "MonthlyReserveRelease"],
  ],
  "solana-mainnet": [
    ["SOLANA_IDENTITY_ATTESTER", "SolanaBinding"],
    ["SECURITY_SOLANA_IDENTITY_ATTESTER", "SolanaBinding"],
    ["MONTHLY_RELEASE_SOLANA", "MonthlyReserveRelease"],
  ],
};

/** Pure preparation: no provider requests, credentials, signing or deployment. */
export function mainnetReleasePlan({
  registry,
  registryDatabase,
  monthlySchedule,
  execution = MAINNET_EXECUTION,
}) {
  const result = [];
  for (const [network, enabled] of Object.entries(execution)) {
    if (!Object.hasOwn(bindings, network) || typeof enabled !== "boolean")
      throw new Error("Unknown mainnet release policy");
    const { configs, secret } = paymentStack({
      stack: "production",
      network,
      deployments: paymentDeployments(registry, "mainnet", network),
      registry,
      registryDatabase,
      monthlySchedule,
    });
    const config = configs.attester;
    const ordinary = JSON.parse(config.vars.PAYMENT_DEPLOYMENTS);
    const privatePins = JSON.parse(
      config.vars.SECURITY_PAYMENT_DEPLOYMENTS ?? "[]",
    );
    const pins = [...ordinary, ...privatePins];
    // A disabled network with retained obligations still needs the reviewed
    // stop code deployed to its existing service. Never provision one merely
    // because a disabled network is present in the policy.
    if (!enabled && !pins.length) continue;
    if (!enabled) config.triggers.crons = [];
    const policy = ESCROW_NETWORKS[network];
    if (
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      config.routes.length !== 0 ||
      config.services !== undefined ||
      config.vars.SIGNER_STACK !== "production" ||
      config.vars.SIGNER_ROLE !== "attester" ||
      config.vars.CHAIN_FAMILY !== policy.family ||
      !pins.every((pin) => pin.network === network) ||
      JSON.stringify(config.triggers.crons) !==
        JSON.stringify(enabled && pins.length ? ["*/5 * * * *"] : [])
    )
      throw new Error("Mainnet attester boundary drifted");
    result.push({
      network,
      enabled,
      config,
      pinCount: pins.length,
      secrets: ["PAYMENT_RPC_URLS", secret].sort(),
      bindings: bindings[network].map(([binding, entrypoint]) => ({
        binding,
        service: config.name,
        entrypoint,
      })),
    });
  }
  return result;
}
