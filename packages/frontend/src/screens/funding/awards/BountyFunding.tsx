// spec/settlement/escrow.md, "A vault starts empty with an immutable network, asset, purpose, owner and fee recipient"; spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"
import { Address, NetworkMark } from "@repo/ui";
import { networkLabel } from "../../../kernels/assetText.ts";
import { type BountyProject, bountyChainOf } from "./bounty.schema.ts";
import { BountyFunds } from "./BountyFunds.tsx";

export type BountyFundsManager = {
  /** The signed-in account's GitHub id as a number. */
  account: number;
  /** The signed-in account's GitHub id. */
  githubId: string;
};

export type BountyFundingProps = {
  /** A project whose security bounty has its own vault. */
  project: BountyProject;
  /** The viewer manages the project, so the private funds and the vault's deposit are shown in place of the address list. */
  manager?: BountyFundsManager;
};

/** The security bounty's own vault, separate from the contribution rewards: the private funds for its manager, each registered vault's address for everyone else. */
export function BountyFunding({ project, manager }: BountyFundingProps) {
  const deployments = project.securityBounty.settlement?.deployments ?? [];
  if (deployments.length === 0) return null;
  const chain = bountyChainOf(project);
  return (
    <section id="funding" aria-label="Project bounty vault" className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
        Project vault {chain === "base" ? <NetworkMark network="Base" showName={false} /> : chain === "solana" ? <NetworkMark network="Solana" showName={false} /> : null}
      </h2>
      {manager ? (
        <BountyFunds project={project} account={manager.account} githubId={manager.githubId} />
      ) : (
        <ul className="flex flex-col gap-2">
          {deployments.map((deployment) => (
            <li key={`${deployment.network}:${deployment.vault}`}>
              <Address value={deployment.vault} label={`Vault on ${networkLabel(deployment.network)}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
