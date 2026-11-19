// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
import { bounty, pledged, pointsOnly, pool, prize, withdrawn } from "../home/fixtures.ts";
import type { ListedProject } from "../home/listing.ts";
import { vectors } from "../../kernels/vectors.ts";
import { type NetworkPays, sponsorPoolLabel, vaultStateLabel } from "./funding.ts";

const reviewed: NetworkPays = (network) => network === "base";
const unreviewed: NetworkPays = () => false;

export const sponsorsSeeAVaultAmountOnlyWhenThePoolIsFunded = vectors<ListedProject, string>([
  [pool, "5,000 USDC monthly · in the vault"],
  [{ ...pool, funding: withdrawn(5_000_000_000n) }, "points only"],
  [{ ...pool, funding: pointsOnly }, "points only"],
  [{ ...pool, funding: pledged(5_000_000_000n) }, "5,000 USDC monthly · in the vault"],
  [bounty, "points only"],
  [prize, "external prize share · Agent Cup"],
], sponsorPoolLabel);

export const vaultAndPaymentsAreSeparateFacts = vectors<readonly [ListedProject, NetworkPays], string>([
  [[pool, reviewed], "Live"],
  [[pool, unreviewed], "Set up"],
  [[bounty, reviewed], "Not set up"],
  [[prize, reviewed], "Not applicable"],
], ([project, networkPays]) => vaultStateLabel(project, networkPays));
