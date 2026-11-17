// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/program.md, "Receipt terms come only from the open published revision"
import { Disclosure, ExternalLink } from "@repo/ui";
import { isFullAwardSplit } from "@repo/security/client";
import type { ReactNode } from "react";
import { programShares } from "./amounts.ts";
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

/** The published award: the offer, its split and the facts it is paid under. */
export function AwardTerms({ terms }: { terms: ProgramTerms }) {
  const shares = programShares(terms);
  const full = isFullAwardSplit(terms.split);
  return (
    <section id="security-terms" aria-labelledby="security-terms-heading" className={sectionClass}>
      <h2 id="security-terms-heading" className="text-xl font-semibold">
        Award terms
      </h2>
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
        <Fact term="Funding">{terms.funding.state === "pledged" ? "Pledged. Awards require owner approval." : `Verified available on ${utc(terms.funding.verifiedAt)}: ${terms.funding.evidence}`}</Fact>
        <Fact term="Capacity">
          {terms.capacity.awards === null
            ? "No fixed award count; each first qualifying finding is reviewed separately"
            : `${terms.capacity.awards} award${terms.capacity.awards === 1 ? "" : "s"} at the published amount`}
          {terms.capacity.closesAt ? `; closes ${utc(terms.capacity.closesAt)}` : ""}. {terms.capacity.exhaustionRule}
        </Fact>
        <Fact term="Other work">
          {terms.rewardMode === "bounty-only" ? "Bounty only. Other work, including fixes, earns no monthly pool cash." : "Contribution rewards are separate; one outcome is never paid twice."}
        </Fact>
      </dl>
      <p className="text-sm">
        Awards are discretionary. The owner decides whether to award; fixed after-approval awards use the amount published at receipt.{" "}
        {critical(terms) ? "Critical bugs and potential loss of funds are priorities, not an automatic payout." : "Findings must meet the published scope and acceptance criteria."} No other payout fee applies. The terms
        in force when Slop receives your report apply to your case.
      </p>
    </section>
  );
}

/** What a report may cover and how it may be shown safely. */
export function ScopeTerms({ terms }: { terms: ProgramTerms }) {
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
        <Fact term="Deployments">
          {scope.deployments.length === 0 ? (
            "None listed"
          ) : (
            <ul className="flex flex-col gap-1">
              {scope.deployments.map((deployment) => (
                <li key={`${deployment.network}:${deployment.address}`}>
                  {deployment.network}: <code className="font-mono break-all">{deployment.address}</code>
                  {deployment.codeIdentity ? ` (${deployment.codeIdentity})` : ""}
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact term="Included assets">{scope.includedAssets.join("; ")}</Fact>
        <Fact term="Excluded dependencies">{scope.excludedDependencies.length === 0 ? "None listed" : scope.excludedDependencies.join("; ")}</Fact>
        <Fact term="Testing permission">{scope.testingPermission}</Fact>
        <Fact term="Severity rubric">{scope.severityRubric}</Fact>
        <Fact term={critical(terms) ? "Loss of funds" : "Impact"}>{scope.lossDefinition}</Fact>
      </dl>
      <p className="text-sm">
        Do not exploit a production system, move another person's funds, reveal keys or cause damage. A local fork or isolated test can show potential {critical(terms) ? "loss" : "impact"}.
      </p>
    </section>
  );
}

/** Who decides findings, payments and disputes, and how disclosure works. */
export function TrustTerms({ terms }: { terms: ProgramTerms }) {
  return (
    <Disclosure summary="Response, disclosure and researcher terms">
      <section aria-labelledby="security-trust" className={sectionClass}>
        <h2 id="security-trust" className="text-xl font-semibold">
          Decisions, disputes and disclosure
        </h2>
        <dl className="flex flex-col gap-3 text-sm text-foreground">
          <Fact term="Findings and awards">{people(terms.approvers.technical)}</Fact>
          <Fact term="Payment">{people(terms.approvers.financial)}</Fact>
          <Fact term="Disputes">
            Contact {people(terms.approvers.dispute)}. {terms.dispute.process} A Slop moderator decides escalated appeals.
          </Fact>
          <Fact term="Response targets">
            Acknowledge within {terms.responseTargets.acknowledgeHours} hours; first triage within {terms.responseTargets.triageBusinessDays} business days; updates every {terms.responseTargets.updateIntervalDays}{" "}
            days. A missed target never publishes a report or approves an award.
          </Fact>
          <Fact term="Disclosure">{terms.disclosure}</Fact>
          <Fact term="Safe harbor">{terms.safeHarbor}</Fact>
        </dl>
        <p className="text-sm text-foreground">
          Slop never publishes cases; rejected, duplicate, disputed and paid reports stay private, and you decide separately whether your name is public. Repository administrators and security managers can read the
          advisory on GitHub. A public-chain payment shows its addresses, amount and time.
        </p>
      </section>
    </Disclosure>
  );
}
