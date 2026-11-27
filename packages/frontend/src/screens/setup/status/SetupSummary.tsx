// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"; spec/ui/status.md, "Setup checks never look ready unless they are"; spec/backend/projectComposition.md, "The setup status names one next state from the same checks"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/frontend/projections.md, "An exemption is never displayed as a passed scan"
import { Alert, Button, Checklist, Disclosure, NetworkMark, Status, StatusIcon, TokenAmount } from "@repo/ui";
import { isChain } from "@repo/settlement/kernels/networks";
import { ExternalLink, RefreshCw } from "lucide-react";
import { CHAIN_NAMES } from "../../../kernels/assetText.ts";
import { NetworkName } from "../../funding/vault/index.ts";
import type { SetupView } from "./check.vibe";
import { authorityReadiness, checksAgain, fundingAmount, installationReadiness, scanExemption, scanReadiness, setupStates } from "./checks.ts";
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

function FundingValue({ funding, slug }: { funding: SetupFunding | undefined; slug: string }) {
  if (funding === undefined) return <Status presentation={{ tone: "Neutral", icon: "Slash", label: "Unavailable" }} />;
  if (funding.mode === "none") return <span className="text-muted-foreground">Points only</span>;
  const bounty = funding.mode === "bounty";
  const minor = bounty ? funding.awardAmountMinor : funding.monthlyAmountMinor;
  return (
    <>
      <TokenAmount value={`${fundingAmount(minor, funding.decimals, funding.symbol, funding.network)} / ${bounty ? "finding" : "month"}`} label={bounty ? "Award per finding" : "Monthly amount"} />
      {funding.network ? <Network network={funding.network} /> : null}
      {bounty ? (
        <Status presentation={funding.state === "pledged" ? { tone: "Caution", icon: "Dot", label: "Pledged" } : { tone: "Positive", icon: "Check", label: "Funded" }} />
      ) : (
        <a href={`/projects/${slug}/manage#project-vault`} className="text-primary underline underline-offset-4">
          Fund vault
        </a>
      )}
    </>
  );
}

/** One project's setup result: its state, the next action, each check on its own, and funding apart from activation. */
export function SetupSummary({ projectId, view: { setup, busy, error }, onCheck, showProjectLink = true }: SetupSummaryProps) {
  const headingId = `setup-${projectId}`;
  const checkLabel = busy ? "Checking…" : "Check again";
  const funding = setup ? setupFundingOf(setup.funding) : undefined;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h2 id={headingId} className="flex flex-wrap items-center gap-3 text-lg font-semibold text-foreground">
        Setup
        {setup ? <Status presentation={setupStates[setup.state]} /> : null}
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
            setup.nextAction.message ? (
              <p role="status" className="text-sm text-foreground">
                {setup.nextAction.message}
              </p>
            ) : null
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
            {setup.nextAction.kind === "request_scan" || setup.nextAction.kind === "retry_scan" ? (
              <Button loading={busy} onClick={() => onCheck(true)}>
                {busy ? "Requesting…" : "Rescan"}
              </Button>
            ) : null}
            {checksAgain(setup.nextAction) ? (
              <Button variant="outline" size="icon" aria-label={checkLabel} title={checkLabel} disabled={busy} onClick={() => onCheck(false)}>
                <RefreshCw aria-hidden />
              </Button>
            ) : null}
          </div>
          <Checklist
            items={[
              { id: "authority", label: "GitHub access", status: authorityReadiness(setup.checks.authority) },
              { id: "installation", label: "Slopbot", status: installationReadiness(setup.checks.installation) },
              { id: "scan", label: "Security scan", status: scanReadiness(setup.checks.scan), value: scanExemption(setup.checks.scan) },
            ]}
          />
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium text-foreground">{funding?.mode === "bounty" ? "Private bounty" : "Funding"}</dt>
            <dd className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FundingValue funding={funding} slug={setup.slug} />
            </dd>
          </dl>
          <Disclosure summary="Check details">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
              <dt className="text-muted-foreground">GitHub access</dt>
              <dd>{setup.checks.authority.message}</dd>
              <dt className="text-muted-foreground">Slopbot</dt>
              <dd>{setup.checks.installation.message}</dd>
              <dt className="text-muted-foreground">Security scan</dt>
              <dd>{setup.checks.scan.message}</dd>
            </dl>
          </Disclosure>
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
