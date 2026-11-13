/** Payment deployment records shared by the payments worker, its scanners and the executor. */
import type { PaymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import type { PayoutPolicy } from "../../src/lib/payments/contracts";

/** One reviewed registry deployment; the private bounty Worker adds its payout policy. */
export type PaymentDeployment = PaymentDeploymentRecord & {
  payoutPolicy?: PayoutPolicy;
};

/** The fields one chain step reads. Local integration chains (Anvil, fixtures)
 * use network names outside the registry. */
export type DeploymentView<
  Fields extends keyof PaymentDeployment,
  OptionalFields extends keyof PaymentDeployment = never,
> = Pick<PaymentDeployment, Exclude<Fields, "network">> &
  Partial<Pick<PaymentDeployment, OptionalFields>> & { network: string };
