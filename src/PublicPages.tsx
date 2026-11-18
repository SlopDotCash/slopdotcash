import {
  ArrowRight,
  Ban,
  BookOpen,
  CalendarCheck,
  CircleSlash,
  FolderPlus,
  GitPullRequest,
  HandCoins,
  ListChecks,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { FundingStatus } from "./FundingStatus";
import { Link } from "./Link";
import { ContributionPointTiers, PenaltyPointTable } from "./PointsRules";
import "./public-records.css";
import { browserDeployment } from "./lib/browser-deployment";
import { intakePaused } from "./lib/intake-cap.mjs";
import { maintainerShareCardLine } from "./lib/maintainer-share.mjs";
import { loadMergeActivity, mergeActivityCardLine } from "./lib/merge-activity";
import { summarizeModelOutcomes } from "./lib/model-outcomes";
import { POINTS_NOTICE } from "./lib/points";
import {
  asShown,
  listedThisMonth,
  loadPoolFunding,
  type PoolFundingIndex,
} from "./lib/pool-funding";
import { PROJECTS, type ProjectDefinition } from "./lib/projects.mjs";
import { formatRewardCapDisplay } from "./lib/reward-amount";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import { usePublicResource } from "./lib/use-public-resource";
import type { DataState } from "./lib/use-snapshot";
import {
  summarizeWhoBuilds,
  WHO_BUILDS_CROSS_REFERENCE,
  WHO_BUILDS_SNAPSHOT,
  whoBuildsDateLabel,
} from "./lib/who-builds";
import {
  DataNotice,
  ExternalLinkAnchor,
  MetricGrid,
  MetricTile,
  NetworkName,
  PaymentLifecycle,
  ReviewBudget,
  RoutePageHeader,
  StatusBadge,
} from "./Presentation";

export function HowItWorksPage() {
  return (
    <main className="shell evidence-page how-it-works route-guide">
      <RoutePageHeader title="How Slop works" icon={<BookOpen />} />
      <div className="how-paths">
        <section aria-labelledby="contributor-path">
          <h2 id="contributor-path">For contributors</h2>
          <ol className="mechanism-flow">
            <li>
              <Search className="route-step-icon" aria-hidden="true" />
              <strong>1. Choose work</strong>
              <p>
                <Link href="/">Use the contributor skill</Link> to find
                unblocked work.
              </p>
            </li>
            <li>
              <GitPullRequest className="route-step-icon" aria-hidden="true" />
              <strong>2. Submit a PR</strong>
            </li>
            <li>
              <ShieldCheck className="route-step-icon" aria-hidden="true" />
              <strong>3. Maintainer review</strong>
            </li>
            <li>
              <Wallet className="route-step-icon" aria-hidden="true" />
              <strong>
                <Link href="/earnings">4. Points and payout</Link>
              </strong>
            </li>
          </ol>
        </section>
        <section aria-labelledby="maintainer-path">
          <h2 id="maintainer-path">For maintainers</h2>
          <ol className="mechanism-flow">
            <li>
              <FolderPlus className="route-step-icon" aria-hidden="true" />
              <strong>1. Add or resume</strong>
              <p>
                <Link href="/?audience=maintainer">
                  Use the maintainer skill
                </Link>
                .
              </p>
            </li>
            <li>
              <ShieldCheck className="route-step-icon" aria-hidden="true" />
              <strong>2. Get ready</strong>
              <p>GitHub access. Free Slopbot. Admission.</p>
            </li>
            <li>
              <ListChecks className="route-step-icon" aria-hidden="true" />
              <strong>3. Maintain your project</strong>
              <p>PRs, CI, rules and private reports.</p>
            </li>
            <li>
              <Wallet className="route-step-icon" aria-hidden="true" />
              <strong>4. Manage rewards</strong>
              <p>
                Funding is optional. Adjust allocations before the{" "}
                <a href="#payments">monthly cutoff</a>.
              </p>
            </li>
          </ol>
        </section>
      </div>
      <section className="worked-example score-contract" id="points">
        <div>
          <h2>Points</h2>
          <p>Min 10 points per accepted merge.</p>
        </div>
        <ContributionPointTiers />
      </section>
      <section className="worked-example score-contract" id="penalties">
        <div>
          <h2>Penalties</h2>
        </div>
        <PenaltyPointTable />
      </section>
      <section className="worked-example">
        <div>
          <h2>Example allocation</h2>
        </div>
        <dl className="equation-card" aria-label="Example projected allocation">
          <div>
            <dt>Accepted share</dt>
            <dd>270 ÷ 900 = 30%</dd>
          </div>
          <div>
            <dt>Funded pool</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Projected allocation</dt>
            <dd>30% × $5,000 = $1,500</dd>
          </div>
        </dl>
      </section>
      <section className="custody-proof money-states">
        <h2 id="payments">Payment stages</h2>
        <p>
          Funded awards pay automatically 72 h after month end unless the owner
          turned this off. Awards without a wallet stay reserved. A cut needs a
          public reason and 24 h notice.
        </p>
        <PaymentLifecycle />
      </section>
      <section
        className="custody-proof faq"
        id="faq"
        aria-labelledby="faq-title"
      >
        <h2 id="faq-title">Questions</h2>
        <div className="faq-answers">
          <article className="faq-answer">
            <h3>What work can I contribute?</h3>
            <div>
              <p>
                Any unblocked work in an active{" "}
                <Link href="/#projects">project</Link>. No claim needed.
              </p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>When will my work show up?</h3>
            <div>
              <p>At the next site update.</p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>How do points work?</h3>
            <div>
              <p className="points-formula">
                <b>Your points</b>
                <span>÷</span>
                <b>Project points</b>
                <span>×</span>
                <b>Funded pool</b>
                <span>=</span>
                <b className="points-formula-result">Your share</b>
              </p>
              <ul className="faq-facts">
                <li>
                  <CalendarCheck aria-hidden="true" />
                  Counts in its own UTC month
                </li>
                <li>
                  <Ban aria-hidden="true" />
                  No carryover into a later pool
                </li>
                <li>
                  <HandCoins aria-hidden="true" />
                  <span>
                    Owner decides funding ·{" "}
                    <Link href="/earnings">Payouts</Link>
                  </span>
                </li>
                <li>
                  <CircleSlash aria-hidden="true" />
                  {POINTS_NOTICE}
                </li>
              </ul>
            </div>
          </article>
          <article className="faq-answer">
            <h3>When are payouts sent?</h3>
            <div>
              <ol
                className="payment-stages faq-timeline"
                aria-label="Monthly payout timeline"
              >
                <li>
                  <strong>Month ends</strong>
                  <span>UTC</span>
                </li>
                <li>
                  <strong>72h review</strong>
                  <span>Owner adjusts</span>
                </li>
                <li>
                  <strong>Locks</strong>
                  <span>Automatically</span>
                </li>
                <li>
                  <strong>Paid</strong>
                  <span>On chain · 2% fee</span>
                </li>
              </ol>
            </div>
          </article>
          <article className="faq-answer">
            <h3>GitHub flagged my account. What happens to my work?</h3>
            <div>
              <p>
                Appeal to GitHub (
                <ExternalLinkAnchor href="https://support.github.com/contact/flagged">
                  flagged account form
                </ExternalLinkAnchor>
                ). Keep the same account.
              </p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>How do I receive an award?</h3>
            <div>
              <p>
                Add a wallet in <Link href="/account#wallets">Settings</Link>.
                Track it in <Link href="/earnings">Payouts</Link>.
              </p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>What does projected mean? Is the pool funded?</h3>
            <div>
              <p>An estimate at the cap, not a balance.</p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>Can the owner take this month&apos;s pool back?</h3>
            <div>
              <p>
                When an owner locks a month in the project vault, that
                month&apos;s pool is locked in the vault until it is paid out:
                the vault contract refuses to withdraw it, and it can be paid
                even if the owner turns automatic payment off. The owner can
                still lower an individual contributor&apos;s amount before the
                cutoff, with a public reason. A locked month that is never
                reserved for payout can be released back to the owner&apos;s
                free funds from the 4th of the second month after it, by a
                transaction anyone can send; the project&apos;s manage page
                offers it. Without a lock, Slop&apos;s pages refuse that
                withdrawal but the contract does not. Slop&apos;s upgrade key
                can still change the vault contract.
              </p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>Is there a referral program?</h3>
            <div>
              <p>
                Yes. You can refer a project today: sign in on slop.cash once,
                then send its maintainer <code>slop.cash/r/</code> followed by
                your GitHub login. The referral is recorded when the project
                lists. A referrer receives SLOP only after a project they
                brought in has paid its contributors.{" "}
                <ExternalLinkAnchor href="https://record.slop.cash/referrals">
                  Referral terms
                </ExternalLinkAnchor>
              </p>
            </div>
          </article>
          <article className="faq-answer">
            <h3>Does Slop buy back SLOP?</h3>
            <div>
              <p>
                The buyback is configured live since 12 November 2026. Half of
                eligible fee income funds SLOP purchases on Robinhood Chain once
                minimum order sizes are met. Half of the SLOP acquired is
                allocated to burning. The first verified bridge fill, purchase
                and burn are still pending. Funding comes from fees, not the
                treasury, and nothing is guaranteed.{" "}
                <ExternalLinkAnchor href="https://record.slop.cash/buyback">
                  How the buyback works
                </ExternalLinkAnchor>
              </p>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}

/** Only money in a vault is shown (operator decision, 15 November 2026). */
function sponsorPoolLabel(
  registered: ProjectDefinition,
  index: PoolFundingIndex | null,
): ReactNode {
  const { reward } = registered;
  if (reward.kind === "external-prize-share" && reward.externalOpportunity) {
    return (
      <StatusBadge title={reward.externalOpportunity.name}>
        External
      </StatusBadge>
    );
  }
  const project = asShown(registered, index, new Date());
  if (project.reward.monthlyCapMinor === "0") return "points only";
  return `${formatRewardCapDisplay(project.reward.monthlyCapDisplay, project.rewardAsset)} monthly · in the vault`;
}

function WhoBuildsOnSlop({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const count = new Intl.NumberFormat("en-US");
  const compact = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 0,
  });
  const percentOfRatio = (ratio: number) => {
    if (ratio <= 0) return "0%";
    const rounded = Math.round(100 * ratio);
    return rounded === 0 ? "under 1%" : `${rounded}%`;
  };
  const percent = (part: number, whole: number) =>
    whole <= 0 ? "0%" : percentOfRatio(part / whole);
  const pin = WHO_BUILDS_CROSS_REFERENCE;
  const outside = WHO_BUILDS_SNAPSHOT;
  const all = outside.cohorts[0];
  const focusAreas = outside.focus.filter(
    (area) => area.primaryContributors > 0,
  );
  const knownRepositories = outside.recognizable.slice(0, 10);
  const dateLabel = whoBuildsDateLabel(outside.generatedAt);
  const pinnedFile = (path: string) =>
    `${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/${path}`;
  const repositoryUrl = (repo: string) => `https://github.com/${repo}`;
  const massCount = outside.massAccounts.length;
  const massNote =
    massCount === 0
      ? ""
      : ` · ${count.format(massCount)} mass ${massCount === 1 ? "account" : "accounts"} excluded`;
  const footprint =
    state.status === "ready" ? summarizeWhoBuilds(state.snapshot) : null;
  const models =
    state.status === "ready" ? summarizeModelOutcomes(state.snapshot) : null;
  return (
    <section
      aria-labelledby="who-builds-heading"
      className="model-outcomes-section who-builds"
    >
      <h2 id="who-builds-heading">Who builds on Slop</h2>
      <p>
        {count.format(all.size)} contributors · {dateLabel}
      </p>
      <DataNotice retry={retry} state={state} />
      <MetricGrid>
        <MetricTile
          label="build AI tooling"
          value={percent(all.aiPrimary, all.classifiable)}
          detail={`${count.format(all.aiPrimary)} of ${count.format(all.classifiable)} classifiable`}
        />
        <MetricTile
          label="merged into AI repos"
          value={percent(all.aiExternalPr, all.size)}
          detail={`${count.format(all.aiExternalPr)} of ${count.format(all.size)}`}
        />
      </MetricGrid>
      <details className="audience-data">
        <summary>Research details</summary>
        <MetricGrid>
          <MetricTile
            label={`outside PRs · ${count.format(outside.externalReposExMass)} repos`}
            value={count.format(outside.externalPrsExMass)}
            detail={`since 1 Jan 2026${massNote}`}
          />
          <MetricTile
            label="median AI repo"
            value={`${count.format(outside.aiRepoMedianStars)}★`}
            detail={`${percentOfRatio(outside.aiRepoShareUnder10)} under 10 stars`}
          />
        </MetricGrid>
        <div className="who-builds-grid">
          <section
            className="who-builds-block"
            aria-labelledby="who-builds-focus-heading"
          >
            <h3 id="who-builds-focus-heading">What they build elsewhere</h3>
            <section
              className="plain-table-wrap"
              aria-label="Focus areas outside Slop"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
              tabIndex={0}
            >
              <table className="plain-table who-builds-table">
                <thead>
                  <tr>
                    <th scope="col">Primary focus</th>
                    <th scope="col" className="who-builds-number">
                      People
                    </th>
                    <th scope="col" className="who-builds-number">
                      Repos
                    </th>
                    <th scope="col" className="who-builds-number">
                      Merged PRs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {focusAreas.map((area) => (
                    <tr key={area.area}>
                      <th scope="row">{area.area}</th>
                      <td className="who-builds-number">
                        {count.format(area.primaryContributors)}
                      </td>
                      <td className="who-builds-number">
                        {count.format(area.repos)}
                      </td>
                      <td className="who-builds-number">
                        {count.format(area.prs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
          <section
            className="who-builds-block"
            aria-labelledby="who-builds-known-heading"
          >
            <h3 id="who-builds-known-heading">Notable repos</h3>
            <section
              className="plain-table-wrap"
              aria-label="Well-known repositories outside Slop"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
              tabIndex={0}
            >
              <table className="plain-table who-builds-table">
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col" className="who-builds-number">
                      Stars
                    </th>
                    <th scope="col" className="who-builds-number">
                      Merged PRs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {knownRepositories.map((row) => (
                    <tr key={row.repo}>
                      <th scope="row">
                        <ExternalLinkAnchor href={repositoryUrl(row.repo)}>
                          {row.repo}
                        </ExternalLinkAnchor>
                      </th>
                      <td className="who-builds-number">
                        {compact.format(row.stars)}
                      </td>
                      <td className="who-builds-number">
                        {count.format(row.prs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        </div>
        {footprint && models && footprint.scoredEvents > 0 ? (
          <MetricGrid>
            <MetricTile
              label={`active · ${footprint.windowDays}d`}
              value={count.format(footprint.contributors)}
            />
            <MetricTile
              label="PRs name model"
              value={percent(
                models.totals.mergedPullRequestsWithModel,
                models.totals.mergedPullRequests,
              )}
              detail={`${count.format(models.totals.mergedPullRequestsWithModel)} of ${count.format(models.totals.mergedPullRequests)}`}
            />
          </MetricGrid>
        ) : null}
      </details>
      <p className="who-builds-sources">
        <ExternalLinkAnchor href={pinnedFile(pin.snapshotPath)}>
          Snapshot
        </ExternalLinkAnchor>
        {" · "}
        <ExternalLinkAnchor href={pinnedFile(pin.methodPath)}>
          Method
        </ExternalLinkAnchor>
      </p>
    </section>
  );
}

export function SponsorsPage({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const [funding] = usePublicResource(
    true,
    loadPoolFunding,
    "Pool funding unavailable",
  );
  const fundingIndex = funding.status === "ready" ? funding.index : null;
  // One shared read of the daily merge activity (#1993) for every card.
  const [merge] = usePublicResource(
    true,
    loadMergeActivity,
    "Merge activity unavailable",
  );
  const now = new Date();
  return (
    <main className="shell evidence-page route-sponsors">
      <RoutePageHeader title="Fund a project" icon={<HandCoins />} />
      <section className="custody-proof sponsor-pools">
        <div className="section-heading">
          <h2>Projects</h2>
          <Link className="text-button" href="/projects/new">
            Add a project
          </Link>
        </div>
        <ul className="route-sponsor-grid" aria-label="Project funding pools">
          {PROJECTS.filter(
            (project) =>
              listedThisMonth(project, fundingIndex, now) &&
              // A project over its owner's intake cap has paused new
              // contributors; a failed or pending read pauses nothing.
              !intakePaused(
                project,
                merge.status === "ready"
                  ? merge.index.get(project.id)
                  : undefined,
                now,
              ),
          ).map((project) => {
            return (
              <li className="route-sponsor-card" key={project.id}>
                <Link
                  className="route-sponsor-link"
                  href={`/projects/${project.slug}/funding`}
                >
                  <strong>{project.name}</strong>
                  <ArrowRight aria-hidden="true" />
                </Link>
                <p>{sponsorPoolLabel(project, fundingIndex)}</p>
                {project.reward.chain ? (
                  <NetworkName chain={project.reward.chain}>
                    {NETWORK_NAMES[project.reward.chain]}
                  </NetworkName>
                ) : null}
                <FundingStatus
                  project={project}
                  className="route-sponsor-status"
                />
                {project.status === "active" && merge.status === "ready"
                  ? (() => {
                      const line = mergeActivityCardLine(
                        merge.index.get(project.id),
                        now,
                      );
                      return line ? (
                        <small className="project-merge-activity">{line}</small>
                      ) : null;
                    })()
                  : null}
                {project.reward.reviewBudget?.fundingState === "committed" ? (
                  <small>
                    <ReviewBudget reviewBudget={project.reward.reviewBudget} />
                  </small>
                ) : null}
                {(() => {
                  const share = maintainerShareCardLine(project, now);
                  return share ? <small>{share}</small> : null;
                })()}
              </li>
            );
          })}
        </ul>
      </section>
      <details className="sponsor-details">
        <summary>Fees &amp; rules</summary>
        <section className="worked-example sponsor-fee">
          <div>
            <h2>Fees</h2>
            <p>
              <StatusBadge>2% fee</StatusBadge>
            </p>
          </div>
          <dl
            className="equation-card"
            aria-label="Example: $5,000 in gross escrow awards"
          >
            <div>
              <dt>Awards</dt>
              <dd>$5,000</dd>
            </div>
            <div>
              <dt>Fee 2%</dt>
              <dd>$100</dd>
            </div>
            <div>
              <dt>Paid out</dt>
              <dd>$4,900</dd>
            </div>
          </dl>
        </section>
        <section className="custody-proof">
          <h2>Custody and keys</h2>
          <ul>
            <li>Held in the project vault contract.</li>
            <li>Owner withdrawals: 2% fee. Reserved awards locked.</li>
            <li>
              <ExternalLinkAnchor
                href={`${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}
              >
                Key risks
              </ExternalLinkAnchor>
            </li>
          </ul>
        </section>
      </details>
      <details className="sponsor-details">
        <summary>
          Audience report ·{" "}
          {whoBuildsDateLabel(WHO_BUILDS_SNAPSHOT.generatedAt)}
        </summary>
        <WhoBuildsOnSlop retry={retry} state={state} />
      </details>
      <section className="custody-proof mechanism-sources">
        <h2>Public records</h2>
        <ul>
          <li>
            <Link href="/#leaderboard">Live leaderboard</Link>
          </li>
          <li>
            <Link href="/cycles">Cycle archive</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
