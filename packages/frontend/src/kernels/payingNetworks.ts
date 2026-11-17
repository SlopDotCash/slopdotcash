// spec/settlement/signer.md, "A signer stack signs only for its own networks, and production signs only enabled mainnets as the attester"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { mainnet, mainnetExecution, reviewedActivation } from "../../gen/settlement__signer.ts";

/** Whether payments run on a registry network: a test network always pays, a mainnet only under the reviewed activation, an unknown network never. @throws {never} */
export function networkPays(network: string): boolean {
  if (!isNetworkKey(network)) return false;
  const service = NETWORKS[network].service;
  return !mainnet(service) || mainnetExecution(reviewedActivation, service);
}
