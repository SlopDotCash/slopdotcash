// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import type { PageRuntime } from "../../app/runtime.vibe";
import { OwnerAwards } from "../funding/awards/index.ts";
import { EscrowFunding, fundingProjectOf } from "../funding/vault/index.ts";
import type { NetworkPays } from "../public/funding.ts";
import type { ShownProject } from "./project.schema.ts";

export type FundsAndAwardsProps = {
  /** The page's runtime, which knows the signed-in account. */
  runtime: PageRuntime;
  /** The project as the registry lists it. */
  project: Pick<ShownProject, "reward" | "record">;
  /** The months the public cycle index lists for the project's award review. */
  awardMonths: ReadonlyArray<string>;
  /** Whether payments run on a network. */
  networkPays: NetworkPays;
};

/** The vault's finalized totals and the owner's monthly awards, beside the reward summary; an external prize shows neither. */
export function FundsAndAwards({ runtime, project, awardMonths, networkPays }: FundsAndAwardsProps) {
  const funding = project.reward.kind === "external-prize-share" ? undefined : fundingProjectOf(project.record);
  if (funding?.escrow === undefined) return null;
  return (
    <section id="funding" aria-label="Funds and awards" className="flex flex-col gap-8">
      <EscrowFunding readOnly runtime={runtime} project={funding} />
      <OwnerAwards runtime={runtime} project={funding} awardMonths={awardMonths} networkPays={networkPays} />
    </section>
  );
}
