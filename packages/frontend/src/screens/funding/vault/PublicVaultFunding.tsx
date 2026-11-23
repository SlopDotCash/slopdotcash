// spec/frontend/projections.md, "The public page offers only a deposit, after the no-refund disclosure"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"
import { Button, Spinner } from "@repo/ui";
import { lazy, Suspense, useState } from "react";
import { noRefundDisclosure } from "../../../../gen/frontend__projections.ts";
import { networkLabel } from "../../../kernels/assetText.ts";
import { savedRequestHeld } from "./funding.vibe";
import type { FundingDeployment, FundingProject } from "./project.schema.ts";

const VaultActions = lazy(() => import("./VaultActions.tsx").then((module) => ({ default: module.VaultActions })));

export type PublicVaultFundingProps = {
  /** The project whose vault this is. */
  project: FundingProject;
  /** The registered vault on one network, whose counters are on record. */
  deployment: FundingDeployment;
  /** The UTC month, `YYYY-MM`, whose saved requests belong to this page. */
  period: string;
  /** The signed-in account's GitHub id as a number, or 0 when signed out: any connected wallet deposits either way. */
  account: number;
  /** Names the vault's network, for a project with more than one fundable vault. */
  showNetwork: boolean;
  /** Called once a deposit is verified on the finalized chain. */
  onFinalized: () => void;
};

/** The public project page's deposit control: the no-refund disclosure first, and the wallet form only once someone asks to fund or this tab holds a saved request. */
export function PublicVaultFunding({ project, deployment, period, account, showNetwork, onFinalized }: PublicVaultFundingProps) {
  const [open, setOpen] = useState(() => savedRequestHeld(project, deployment, period));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">{noRefundDisclosure}</p>
      {open ? (
        <Suspense fallback={<Spinner size="sm" label="Loading the funding form" />}>
          <VaultActions depositOnly project={project} deployment={deployment} period={period} account={account} onFinalized={onFinalized} />
        </Suspense>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          Fund this project{showNetwork ? ` · ${networkLabel(deployment.network)}` : ""}
        </Button>
      )}
    </div>
  );
}
