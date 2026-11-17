// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/ui/status.md, "Setup checks never look ready unless they are"; spec/backend/projectComposition.md, "The setup status names one next state from the same checks"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import { Alert, Button, Checklist, NetworkMark, StatusIcon, TokenAmount } from "@repo/ui";
import { isChain } from "@repo/settlement/kernels/networks";
import { ExternalLink } from "lucide-react";
import { CHAIN_NAMES } from "../../../kernels/assetText.ts";
import { NetworkName } from "../../funding/vault/index.ts";
import type { SetupView } from "./check.vibe";
import { authorityReadiness, checksAgain, fundingAmount, installationReadiness, scanFinding, scanReadiness, setupHeadings } from "./checks.ts";
import { type SetupFunding, setupFundingOf } from "./funding.schema.ts";

export type SetupSummaryProps = {
  projectId: string;
  view: SetupView;
  /** Checks again; `requestScan` also asks for a new security scan. */
  onCheck: (requestScan: boolean) => void;
  showProjectLink?: boolean;
};

function Network({ network }: { network: string }) {
  return isChain(network) ? <NetworkMark network={CHAIN_NAMES[network]} size="sm" /> : <NetworkName network={network} />;
}

function Funding({ funding, slug }: { funding: SetupFunding | undefined; slug: string }) {
  if (funding === undefined) return <p className="text-sm text-muted-foreground">Funding is unavailable.</p>;
  if (funding.mode === "none")
    return (
      <p className="text-sm text-muted-foreground">
        Contribution funding <span className="text-xs">Optional</span> · Points only
      </p>
    );
  const bounty = funding.mode === "bounty";
  const minor = bounty ? funding.awardAmountMinor : funding.monthlyAmountMinor;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="font-medium text-foreground">{bounty ? "Private bounty" : "Contribution funding"}</span>
      <TokenAmount value={`${fundingAmount(minor, funding.decimals, funding.symbol, funding.network)} / ${bounty ? "accepted finding" : "month"}`} label={bounty ? "Award per accepted finding" : "Monthly amount"} />
      {funding.network ? <Network network={funding.network} /> : null}
      {bounty ? (
        <span className="text-muted-foreground">{funding.state === "pledged" ? "Pledged" : "Funding verified"}</span>
      ) : (
        <a href={`/projects/${slug}/manage#project-vault`} className="text-primary underline underline-offset-4">
          Vault funding
        </a>
      )}
    </div>
  );
}

/** One project's setup result: the next action, each check on its own, and funding apart from activation. */
export function SetupSummary({ projectId, view: { setup, busy, error }, onCheck, showProjectLink = true }: SetupSummaryProps) {
  const headingId = `setup-${projectId}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Setup status{setup ? `: ${setupHeadings[setup.state]}` : ""}
      </h2>
      {setup === null ? (
        error ? null : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusIcon icon="Spinner" />
            Checking setup…
          </p>
        )
      ) : (
        <>
          {setup.state !== "ready" ? (
            <p role="status" className="text-sm text-foreground">
              {setup.nextAction.message}
            </p>
          ) : showProjectLink ? (
            <a href={`/projects/${setup.slug}`} className="text-sm text-primary underline underline-offset-4">
              View project
            </a>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {setup.nextAction.kind === "install_slopbot" && setup.nextAction.href ? (
              <Button asChild>
                <a href={setup.nextAction.href} target="_blank" rel="noreferrer">
                  Install Slopbot
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              </Button>
            ) : null}
            {setup.nextAction.kind === "request_scan" ? (
              <Button loading={busy} onClick={() => onCheck(true)}>
                {busy ? "Requesting…" : "Request a new scan"}
              </Button>
            ) : null}
            {checksAgain(setup.nextAction) ? (
              <Button variant="outline" loading={busy} onClick={() => onCheck(false)}>
                {busy ? "Checking…" : "Check again"}
              </Button>
            ) : null}
          </div>
          <Checklist
            items={[
              { id: "authority", label: "GitHub access", status: authorityReadiness(setup.checks.authority), value: setup.checks.authority.message },
              { id: "installation", label: "Slopbot", status: installationReadiness(setup.checks.installation), value: setup.checks.installation.message },
              { id: "scan", label: "Security scan", status: scanReadiness(setup.checks.scan), value: scanFinding(setup.checks.scan) },
            ]}
          />
          <Funding funding={setupFundingOf(setup.funding)} slug={setup.slug} />
        </>
      )}
      {error ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onCheck(false)}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
    </section>
  );
}
