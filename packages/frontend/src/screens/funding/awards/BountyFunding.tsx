// spec/settlement/escrow.md, "A vault starts empty with an immutable network, asset, purpose, owner and fee recipient"
import { Address, NetworkMark } from "@repo/ui";
import { networkLabel } from "../../../kernels/assetText.ts";
import { type BountyProject, bountyChainOf } from "./bounty.schema.ts";

export type BountyFundingProps = {
  /** A project whose security bounty has its own vault. */
  project: BountyProject;
};

/** The security bounty's own vault, separate from the contribution rewards: each registered vault's address. */
export function BountyFunding({ project }: BountyFundingProps) {
  const deployments = project.securityBounty.settlement?.deployments ?? [];
  if (deployments.length === 0) return null;
  const chain = bountyChainOf(project);
  return (
    <section id="funding" aria-label="Project bounty vault" className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
        Project vault {chain === "base" ? <NetworkMark network="Base" showName={false} /> : chain === "solana" ? <NetworkMark network="Solana" showName={false} /> : null}
      </h2>
      <ul className="flex flex-col gap-2">
        {deployments.map((deployment) => (
          <li key={`${deployment.network}:${deployment.vault}`}>
            <Address value={deployment.vault} label={`Vault on ${networkLabel(deployment.network)}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
