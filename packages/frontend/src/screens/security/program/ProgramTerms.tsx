// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/routineDecisions.md, "Story: Decide routine reports with an audit record and leave the rest to the owner"; spec/security/program.md, "Receipt terms come only from the open published revision"
import { CopyButton, cn, ExternalLink, focusRing, Status, target } from "@repo/ui";
import { SECURITY_ROUTINE_DECISION_NOTICE, isFullAwardSplit } from "@repo/security/client";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { NetworkName } from "../../funding/vault/index.ts";
import { programShares } from "./amounts.ts";
import { ProgramExclusions } from "./ProgramExclusions.tsx";
import { SecurityOffer } from "./SecurityOffer.tsx";
import { utc } from "./summary.ts";
import type { ProgramTerms } from "./terms.schema.ts";

const sectionClass = "flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground";

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function people(list: ProgramTerms["approvers"]["technical"]): string {
  return list.map((entry) => `@${entry.githubLogin}`).join(", ");
}

function critical(terms: ProgramTerms): boolean {
  return terms.eligibility === "critical-loss-of-funds";
}

/** A closed section a person opens by click, keyboard or a link to its summary's fragment. */
function TermsDetails({ id, summary, children }: { id: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => location.hash === `#${id}`);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group flex flex-col gap-2">
      <summary id={id} className={cn(focusRing, target, "inline-flex cursor-pointer list-none items-center gap-1 self-start rounded-sm text-lg font-semibold text-foreground hover:text-primary [&::-webkit-details-marker]:hidden")}>
        <ChevronDown aria-hidden className="size-4 -rotate-90 group-open:rotate-0 motion-safe:transition-transform motion-safe:duration-fast" />
        {summary}
      </summary>
      <section aria-labelledby={id} className={cn(sectionClass, "mt-2")}>
        {children}
      </section>
    </details>
  );
}

/** `#security-terms`: the published award, its split and the facts it is paid under. */
export function AwardTerms({ terms }: { terms: ProgramTerms }) {
  const shares = programShares(terms);
  const full = isFullAwardSplit(terms.split);
  return (
    <TermsDetails id="security-terms" summary="Terms">
      <SecurityOffer terms={terms} />
      {shares ? (
        <dl aria-label="Award split" className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 rounded-md border border-border p-4">
            <dt className="text-sm text-muted-foreground">Researcher · {full ? "100%" : "75%"}</dt>
            <dd className="text-lg font-semibold tabular-nums">{shares.researcher}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-border p-4">
            <dt className="text-sm text-muted-foreground">Slop · {full ? "0%" : "25%"}</dt>
            <dd className="text-lg font-semibold tabular-nums">{shares.slop}</dd>
          </div>
        </dl>
      ) : null}
      <dl className="flex flex-col gap-3 text-sm">
        <Fact term="Currency">
          {terms.amount.currency}
          {terms.amount.network ? ` on ${terms.amount.network}` : ""}
        </Fact>
        <Fact term="Funding">
          {terms.funding.state === "pledged" ? (
            <Status presentation={{ tone: "Caution", icon: "Clock", label: "Pledged" }} />
          ) : (
            <>
              <Status presentation={{ tone: "Positive", icon: "Check", label: `Verified ${utc(terms.funding.verifiedAt)}` }} /> {terms.funding.evidence}
            </>
          )}
        </Fact>
        <Fact term="Awards">
          {terms.capacity.awards === null ? "No fixed count · owner decides" : terms.capacity.awards}
          {terms.capacity.closesAt ? ` · closes ${utc(terms.capacity.closesAt)}` : ""}
        </Fact>
        <Fact term="When funds run out">{terms.capacity.exhaustionRule}</Fact>
        {terms.rewardMode === "bounty-only" ? (
          <Fact term="Other work">
            <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Bounty only" }} />
          </Fact>
        ) : null}
      </dl>
      <p className="text-sm">Owner decides awards. Terms at receipt apply. No other payout fee.</p>
    </TermsDetails>
  );
}

/** What a report may cover, what never qualifies, and how it may be shown safely. */
export function ScopeTerms({ terms, onCopy }: { terms: ProgramTerms; onCopy?: (text: string) => Promise<void> }) {
  const { scope } = terms;
  return (
    <section id="security-scope" aria-labelledby="security-scope-heading" className={sectionClass}>
      <h2 id="security-scope-heading" className="text-xl font-semibold">
        Scope
      </h2>
      <dl className="flex flex-col gap-3 text-sm">
        <Fact term="Covered source">
          <ul className="flex flex-col gap-1">
            {scope.sourceRevisions.map((source) => (
              <li key={`${source.repository}@${source.commit}`}>
                <ExternalLink href={`https://github.com/${source.repository}/tree/${source.commit}`}>
                  {source.repository}@{source.commit.slice(0, 12)}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </Fact>
        {scope.deployments.length === 0 ? null : (
          <Fact term="Deployments">
            <ul className="flex flex-col gap-1">
              {scope.deployments.map((deployment) => (
                <li key={`${deployment.network}:${deployment.address}`} className="flex flex-wrap items-center gap-2">
                  <NetworkName network={deployment.network} />
                  <code className="font-mono break-all">{deployment.address}</code>
                  <CopyButton label={`${deployment.network} deployment address`} text={deployment.address} onCopy={onCopy} />
                  {deployment.codeIdentity ? ` (${deployment.codeIdentity})` : ""}
                </li>
              ))}
            </ul>
          </Fact>
        )}
        <Fact term="Included assets">{scope.includedAssets.join("; ")}</Fact>
        {scope.excludedDependencies.length === 0 ? null : <Fact term="Excluded dependencies">{scope.excludedDependencies.join("; ")}</Fact>}
      </dl>
      <ProgramExclusions scope={scope} />
      <dl className="flex flex-col gap-3 text-sm">
        <Fact term="Testing">{scope.testingPermission}</Fact>
        <Fact term="Severity">{scope.severityRubric}</Fact>
        <Fact term={critical(terms) ? "Loss" : "Impact"}>{scope.lossDefinition}</Fact>
      </dl>
      <p className="text-sm">{SECURITY_ROUTINE_DECISION_NOTICE}</p>
      <p className="text-sm">
        Do not exploit a production system, move another person's funds, reveal keys or cause damage. A local fork or isolated test can show potential {critical(terms) ? "loss" : "impact"}.
      </p>
    </section>
  );
}

/** `#security-trust`: who decides findings, payments and disputes, the response targets and how disclosure works. */
export function TrustTerms({ terms }: { terms: ProgramTerms }) {
  const targets = terms.responseTargets;
  return (
    <TermsDetails id="security-trust" summary="Process">
      <dl className="flex flex-col gap-3 text-sm text-foreground">
        <Fact term="Reviewers">{people(terms.approvers.technical)}</Fact>
        <Fact term="Payment">{people(terms.approvers.financial)}</Fact>
        <Fact term="Disputes">
          {people(terms.approvers.dispute)} {terms.dispute.process}
        </Fact>
        <Fact term="Response targets">
          <span className="flex flex-wrap gap-3">
            <Status presentation={{ tone: "Neutral", icon: "Clock", label: `${targets.acknowledgeHours}h ack` }} />
            <Status presentation={{ tone: "Neutral", icon: "Clock", label: `${targets.triageBusinessDays} business days triage` }} />
            <Status presentation={{ tone: "Neutral", icon: "Clock", label: `${targets.updateIntervalDays}d updates` }} />
          </span>
        </Fact>
      </dl>
      <p className="text-sm text-foreground">{terms.disclosure}</p>
      <p className="text-sm text-foreground">{terms.safeHarbor}</p>
      <p>
        <Status presentation={{ tone: "Neutral", icon: "Lock", label: "Cases stay private" }} />
      </p>
    </TermsDetails>
  );
}
