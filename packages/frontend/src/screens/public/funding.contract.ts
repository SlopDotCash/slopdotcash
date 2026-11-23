// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { bounty, pool, prize } from "../home/fixtures.ts";
import type { ListedProject } from "../home/listing.ts";
import { vectors } from "../../kernels/vectors.ts";
import { type NetworkPays, vaultStateLabel } from "./funding.ts";

const reviewed: NetworkPays = (network) => network === "base";
const unreviewed: NetworkPays = () => false;

export const vaultAndPaymentsAreSeparateFacts = vectors<readonly [ListedProject, NetworkPays], string>([
  [[pool, reviewed], "Live"],
  [[pool, unreviewed], "Set up"],
  [[bounty, reviewed], "Not set up"],
  [[prize, reviewed], "Not applicable"],
], ([project, networkPays]) => vaultStateLabel(project, networkPays));
