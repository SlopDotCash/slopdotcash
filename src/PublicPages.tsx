import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  ChevronRight,
  Cpu,
  GitPullRequest,
  HandCoins,
  ListChecks,
  ReceiptText,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { PENALTY_TABLE } from "../workers/slopbot/penalties";
import chatgptMark from "./agent-logos/chatgpt.svg";
import claudeMark from "./agent-logos/claude.svg";
import grokMark from "./agent-logos/grok.svg";
import metaMark from "./agent-logos/meta-ai.svg";
import { Link } from "./Link";
import { browserDeployment } from "./lib/browser-deployment";
import { modelIdentityKey, summarizeModelOutcomes } from "./lib/model-outcomes";
import { PROJECTS, type ProjectDefinition } from "./lib/projects.mjs";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import {
  MAX_CREDITED_REVIEWERS,
  VALUE_SCORING_POLICY_EFFECTIVE_AT,
} from "./lib/scoring-policy";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import type { DataState } from "./lib/use-snapshot";
import {
  summarizeWhoBuilds,
  WHO_BUILDS_CROSS_REFERENCE,
  WHO_BUILDS_SNAPSHOT,
  whoBuildsDateLabel,
} from "./lib/who-builds";
import {
  DataNotice,
  EmptyState,
  EvidenceNav,
  ExternalLinkAnchor,
  formatDate,
  formatPointsFromThirds,
  monthlyPoolLabel,
  NetworkName,
  Pager,
  PaymentLifecycle,
  paymentStateLabel,
  RoutePageHeader,
  reviewBudgetLabel,
  StatusBadge,
  vaultStateLabel,
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
                Find an active <Link href="/#projects">project</Link>, read its
                skill and choose unblocked work.
              </p>
            </li>
            <li>
              <GitPullRequest className="route-step-icon" aria-hidden="true" />
              <strong>2. Submit a PR</strong>
              <p>
                Use any agent. Test the result and disclose the exact provider,
                model and client.
              </p>
            </li>
            <li>
              <ShieldCheck className="route-step-icon" aria-hidden="true" />
              <strong>3. Maintainer review</strong>
              <p>
                Maintainers accept the work. Accepted work and useful reviews
                earn Points.
              </p>
            </li>
            <li>
              <Wallet className="route-step-icon" aria-hidden="true" />
              <strong>4. Points and payout</strong>
              <p>
                Funded projects pay monthly by accepted-work Points share when
                payments are enabled.
              </p>
            </li>
          </ol>
        </section>
        <section aria-labelledby="maintainer-path">
          <h2 id="maintainer-path">For maintainers</h2>
          <ol className="mechanism-flow">
            <li>
              <GitPullRequest className="route-step-icon" aria-hidden="true" />
              <strong>1. Add a project</strong>
              <p>
                <Link href="/projects/new">
                  Add your repository and contribution rules
                </Link>
                . Install free Slopbot and complete the security checks.
              </p>
            </li>
            <li>
              <Wallet className="route-step-icon" aria-hidden="true" />
              <strong>2. Fund the pool</strong>
              <p>
                Only funds in the project vault pay awards. Unused funds roll
                over. <Link href="/sponsors">Funding options</Link>
              </p>
            </li>
            <li>
              <ListChecks className="route-step-icon" aria-hidden="true" />
              <strong>3. Adjust awards</strong>
              <p>
                Change proposed amounts within the cap before the monthly
                cutoff.
              </p>
            </li>
            <li>
              <CalendarCheck className="route-step-icon" aria-hidden="true" />
              <strong>4. Automatic payment</strong>
              <p>
                When payments are enabled, funded awards pay automatically 72
                hours after the month ends, unless you turn this off.
              </p>
            </li>
          </ol>
        </section>
      </div>
      <section className="worked-example score-contract" id="points">
        <div>
          <h2>Points</h2>
          <p>
            Slopbot sizes each accepted pull request with the tiers in this
            table and awards points. Every accepted merge earns at least 10
            points. Only accepted-work points count toward payouts. Joining and
            connecting X earn no points.
          </p>
          <details>
            <summary>Points rules and evidence</summary>
            <p>Related or split pull requests count as one work unit.</p>
            <p>
              A useful review can find a correction or validate the change. A
              request for changes is not required. Review bands are triage 10,
              standard 30, deep 90 and specialist 240 points. The first{" "}
              {MAX_CREDITED_REVIEWERS} distinct qualifying reviewers share one
              review pool per pull request: the sum of their highest bands,
              capped at the pull request's own size and never less than 10
              points. Self-review, review after merge, repeated or empty review,
              and bot activity do not earn points.
            </p>
            <p>
              Slopbot debits a closed pull request once, from its published
              penalty table: spam{" "}
              {formatPointsFromThirds(PENALTY_TABLE.spam.debitThirds)}, scam or
              malicious {formatPointsFromThirds(PENALTY_TABLE.scam.debitThirds)}
              , a clear violation of a quoted project rule{" "}
              {formatPointsFromThirds(PENALTY_TABLE.gaming.debitThirds)}. A
              debit lowers only that project and UTC month, never below zero,
              and never changes an approved, scheduled or paid award. An upheld
              appeal or a maintainer reopen removes it.
            </p>
            <p>
              Owners, funded employees and related parties may be excluded from
              payouts. They keep their points, but their weight leaves the pool,
              so it does not reduce other contributors' shares.
            </p>
            <p>
              These rules apply to work accepted from{" "}
              {formatDate(VALUE_SCORING_POLICY_EFFECTIVE_AT)} UTC. Earlier work
              keeps its recorded terms. Signed receipts and private traces are
              optional. Token use, cost, lines and commits never change points
              or payment.
            </p>
          </details>
        </div>
        <section
          className="plain-table-wrap score-tier-wrap"
          aria-label="Contribution point tiers"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
          tabIndex={0}
        >
          <table className="plain-table score-tier-table">
            <caption>Contribution tiers</caption>
            <thead>
              <tr>
                <th scope="col">Tier</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Micro</th>
                <td>10</td>
              </tr>
              <tr>
                <th scope="row">Small</th>
                <td>30</td>
              </tr>
              <tr>
                <th scope="row">Medium</th>
                <td>90</td>
              </tr>
              <tr>
                <th scope="row">Large</th>
                <td>240</td>
              </tr>
              <tr>
                <th scope="row">XL</th>
                <td>450</td>
              </tr>
              <tr>
                <th scope="row">Exceptional</th>
                <td>750</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example">
        <div>
          <h2>Example allocation</h2>
          <p>
            Your points ÷ project points × funded pool = projected allocation.
          </p>
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
        <h2>Payment stages</h2>
        <PaymentLifecycle />
      </section>
      <section
        className="custody-proof faq"
        id="faq"
        aria-labelledby="faq-title"
      >
        <h2 id="faq-title">Questions</h2>
        <details>
          <summary>What work can I contribute?</summary>
          <p>
            Choose unblocked work in an active{" "}
            <Link href="/#projects">project</Link> and follow its contribution
            rules. You do not need to claim an issue.
          </p>
          <p>
            Non-code work counts on projects that opt in. The{" "}
            <Link href="/projects/slopdotcash">Slop project</Link> does: a
            tutorial, explainer, video, or support answer about Slop can receive
            a reviewed award of 1 to 8 points.
          </p>
          <p>
            Only your newest three awards on a project count. To submit work,
            post the link and tag @SlopCash.
          </p>
        </details>
        <details>
          <summary>When will my work show up?</summary>
          <p>
            Merged pull requests and their qualifying reviews appear at the next
            site update. There is no waiting period or minimum account age.
          </p>
        </details>
        <details>
          <summary>Does the model I use matter?</summary>
          <p>
            Not to your points. Disclose the provider, exact model, and client;
            the declaration adds no points. From November 2026, monthly and
            external-prize reward shares use accepted-work Points only. Optional
            traces add no payment weight. Older calculations and funded awards
            stay unchanged; unpaid September–October work stays subject to the
            reviewed historical reconciliation.
          </p>
        </details>
        <details>
          <summary>How and when do I get paid?</summary>
          <p>
            Add a wallet for your award's network (Base, Solana, Robinhood Chain
            or Ethereum) in <Link href="/account#wallets">Account wallets</Link>
            . Wallet confirmation requires your signature. Awards wait for your
            wallet.
          </p>
          <p>
            Monthly. After a UTC month ends, the owner has 72 hours to adjust
            awards. Then, if payments are enabled, the vault pays funded awards
            automatically unless the owner turned that off. Slop publishes final
            awards and payment evidence, not the owner's changes.
          </p>
        </details>
        <details>
          <summary>What does projected mean? Is the pool funded?</summary>
          <p>
            A live estimate at the project&apos;s cap. It is not a balance or a
            guarantee: a cap is a target, and only funds in the vault can be
            allocated. Funds added after a month freezes count toward later
            months.
          </p>
        </details>
      </section>
    </main>
  );
}

function sponsorPoolLabel(reward: ProjectDefinition["reward"]): string {
  if (reward.kind === "external-prize-share" && reward.externalOpportunity) {
    return `external prize share · ${reward.externalOpportunity.name}`;
  }
  return monthlyPoolLabel(reward);
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
      : massCount === 1
        ? ", one mass pull-request account excluded"
        : `, ${massCount === 2 ? "two" : count.format(massCount)} mass pull-request accounts excluded`;
  const footprint =
    state.status === "ready" ? summarizeWhoBuilds(state.snapshot) : null;
  const models =
    state.status === "ready" ? summarizeModelOutcomes(state.snapshot) : null;
  return (
    <section
      aria-labelledby="who-builds-heading"
      className="model-outcomes-section who-builds"
    >
      <h2 id="who-builds-heading">Who builds on Slop.</h2>
      <p>
        What the {count.format(all.size)} contributors on the leaderboard as of{" "}
        {dateLabel} did elsewhere on GitHub in 2026.
      </p>
      <div className="money-summary model-outcomes-summary">
        <span>
          <strong>{percent(all.aiPrimary, all.classifiable)}</strong> build AI
          agents or LLM tooling as their primary focus (
          {count.format(all.aiPrimary)} of the {count.format(all.classifiable)}{" "}
          with classifiable public work)
        </span>
        <span>
          <strong>{percent(all.aiExternalPr, all.size)}</strong> merged into an
          outside AI repository this year ({count.format(all.aiExternalPr)} of{" "}
          {count.format(all.size)})
        </span>
        <span>
          <strong>{count.format(outside.externalPrsExMass)}</strong> merged pull
          requests across {count.format(outside.externalReposExMass)} outside
          repositories since 1 January 2026
        </span>
        <span>
          <strong>{count.format(outside.aiRepoMedianStars)}</strong> stars is
          the median outside AI repository they work in;{" "}
          {percentOfRatio(outside.aiRepoShareUnder10)} have fewer than ten
        </span>
      </div>
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
          <h3 id="who-builds-known-heading">
            Well-known repositories they merged into this year
          </h3>
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
      <DataNotice retry={retry} state={state} />
      {footprint && models && footprint.scoredEvents > 0 ? (
        <p className="model-outcomes-note">
          Inside Slop, live: {count.format(footprint.contributors)} contributors
          scored in the last {footprint.windowDays} days, and{" "}
          {percent(
            models.totals.mergedPullRequestsWithModel,
            models.totals.mergedPullRequests,
          )}{" "}
          of merged pull requests name the model that did the work (
          {count.format(models.totals.mergedPullRequestsWithModel)} of{" "}
          {count.format(models.totals.mergedPullRequests)}).
        </p>
      ) : null}
      <p className="who-builds-sources">
        Public GitHub data since 1 January 2026{massNote}.{" "}
        <ExternalLinkAnchor href={pinnedFile(pin.snapshotPath)}>
          Snapshot JSON, {pin.date}
        </ExternalLinkAnchor>
        {" · "}
        <ExternalLinkAnchor href={pinnedFile(pin.methodPath)}>
          Method and caveats
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
  const hasReviewBudget = PROJECTS.some(
    (project) => project.reward.reviewBudget,
  );
  const hasExternalPrize = PROJECTS.some(
    (project) => project.reward.kind === "external-prize-share",
  );
  return (
    <main className="shell evidence-page route-sponsors">
      <RoutePageHeader
        title="Fund a project"
        icon={<HandCoins />}
        lead="Deposit into a project’s vault. Funded awards pay monthly when payments are enabled."
      />
      <section className="custody-proof sponsor-pools">
        <h2>Projects</h2>
        <ul className="route-sponsor-grid" aria-label="Project funding pools">
          {PROJECTS.map((project) => {
            return (
              <li className="route-sponsor-card" key={project.id}>
                <Link
                  className="route-sponsor-link"
                  href={`/projects/${project.slug}/funding`}
                >
                  <strong>{project.name}</strong>
                  <ArrowRight aria-hidden="true" />
                </Link>
                <p>{sponsorPoolLabel(project.reward)}</p>
                {project.reward.chain ? (
                  <NetworkName chain={project.reward.chain}>
                    {NETWORK_NAMES[project.reward.chain]}
                  </NetworkName>
                ) : null}
                <div className="route-sponsor-status">
                  <StatusBadge
                    tone={
                      project.escrow?.deployments.length ? "info" : "neutral"
                    }
                  >
                    Vault: {vaultStateLabel(project)}
                  </StatusBadge>
                  <StatusBadge
                    tone={
                      project.reward.paymentMode === "enabled"
                        ? "success"
                        : "neutral"
                    }
                  >
                    Payments: {paymentStateLabel(project)}
                  </StatusBadge>
                </div>
                {hasReviewBudget ? (
                  project.reward.reviewBudget ? (
                    <small>
                      {reviewBudgetLabel(project.reward.reviewBudget)}
                    </small>
                  ) : null
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="worked-example sponsor-fee">
        <div>
          <h2>Fees</h2>
          <p>
            Payouts deduct a 2% fee: a 100 USDC award pays 98 USDC to the
            contributor and 2 USDC in fees.
          </p>
          {hasExternalPrize ? (
            <p>
              External prize shares use the terms published for that project.
              The prize sponsor controls eligibility and payment.
            </p>
          ) : null}
        </div>
        <dl
          className="equation-card"
          aria-label="Example: $5,000 in gross escrow awards"
        >
          <div>
            <dt>Example gross awards</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Slop fee, deducted</dt>
            <dd>$100</dd>
          </div>
          <div>
            <dt>Contributors receive</dt>
            <dd>$4,900</dd>
          </div>
        </dl>
      </section>
      <section className="worked-example sponsor-start">
        <div>
          <h2>Add your own project.</h2>
        </div>
        <ul>
          <li>
            <Link href="/projects/new">Add a project</Link>
          </li>
        </ul>
      </section>
      <details className="sponsor-details">
        <summary>Funding rules</summary>
        <section className="worked-example sponsor-controls">
          <div>
            <h2>What you decide</h2>
            <ul>
              <li>The monthly cap.</li>
              <li>
                Award changes before the monthly cutoff, and whether automatic
                payment runs.
              </li>
            </ul>
            <p>
              <Link href="/how-it-works">Payment stages</Link>
            </p>
          </div>
        </section>
        <section className="custody-proof">
          <h2>Custody and keys</h2>
          <ul>
            <li>
              Funds are held by the project vault contract. Private bounties use
              a separate vault.
            </li>
            <li>
              The owner can withdraw free funds with the 2% fee. Reserved awards
              cannot be withdrawn.
            </li>
            <li>
              Slop’s fee key can only claim and convert fees. A compromised
              identity attester key can redirect unpaid awards, and Slop’s
              upgrade keys can change the contracts. Read the{" "}
              <ExternalLinkAnchor
                href={`${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}
              >
                authority and key risks
              </ExternalLinkAnchor>
              .
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
            <Link href="/receipts">Public receipts</Link>
          </li>
          <li>
            <Link href="/cycles">Cycle archive</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

const RECEIPTS_PAGE_SIZE = 25;

function ModelMark({ model }: { model: string }) {
  const key = model.toLowerCase();
  const mark = key.startsWith("claude")
    ? claudeMark
    : key.startsWith("gpt") || key.startsWith("o1") || key.startsWith("o3")
      ? chatgptMark
      : key.startsWith("grok")
        ? grokMark
        : key.startsWith("muse") || key.startsWith("llama")
          ? metaMark
          : null;
  return mark ? (
    <img className="route-model-mark" src={mark} alt="" aria-hidden="true" />
  ) : (
    <Cpu className="route-model-mark" aria-hidden="true" />
  );
}

export function ReceiptsPage({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const [page, setPage] = useState(0);
  const search = query.trim().toLowerCase();
  const receipts =
    state.status === "ready"
      ? state.snapshot.attributions
          .filter(
            (
              entry,
            ): entry is typeof entry & { run: NonNullable<typeof entry.run> } =>
              entry.run !== null,
          )
          .sort((left, right) =>
            right.run.completedAt.localeCompare(left.run.completedAt),
          )
      : [];
  const matching = receipts.filter((entry) =>
    [
      entry.actor?.login,
      entry.sourceUrl,
      entry.run.runId,
      entry.run.repositoryId,
      entry.identifier,
      modelIdentityKey(entry.provider, entry.model).key,
      entry.client,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  // One page of receipts keeps the page short and its links large enough.
  const pages = Math.max(1, Math.ceil(matching.length / RECEIPTS_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = matching.slice(
    current * RECEIPTS_PAGE_SIZE,
    (current + 1) * RECEIPTS_PAGE_SIZE,
  );
  return (
    <main className="shell evidence-page receipt-page route-receipts">
      <RoutePageHeader
        title="Run receipts"
        icon={<ReceiptText />}
        lead="Model and usage are self-reported, not provider-verified."
      >
        <EvidenceNav current="receipts" />
        <DataNotice retry={retry} state={state} />
      </RoutePageHeader>
      <EvidenceNav current="receipts" />
      {state.status === "ready" && receipts.length > 0 ? (
        <label className="receipt-search">
          Find a receipt
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Contributor, model, client or run ID"
            disabled={state.status !== "ready"}
          />
        </label>
      ) : null}
      {state.status === "ready" && receipts.length > 0 ? (
        <p className="receipt-count" role="status">
          {matching.length} of {receipts.length} receipts
        </p>
      ) : null}
      {state.status === "ready" && matching.length === 0 ? (
        <EmptyState
          text={
            receipts.length === 0
              ? "No receipts published yet."
              : "No receipts match this search."
          }
        />
      ) : null}
      {state.status === "ready" && receipts.length === 0 ? (
        <Link href="/#projects">Browse projects</Link>
      ) : null}
      <div className="receipt-list">
        {shown.map((entry) => {
          const run = entry.run;
          const workLabel = new URL(entry.sourceUrl).pathname
            .slice(1)
            .replace(/\/(?:pull|issues)\//u, " #");
          return (
            <article className="receipt-record" key={run.runId}>
              <div className="receipt-links">
                <strong>
                  {entry.actor ? (
                    <Link
                      href={`/contributors/${encodeURIComponent(entry.actor.login)}`}
                    >
                      {entry.actor.login}
                    </Link>
                  ) : (
                    "Unknown contributor"
                  )}
                </strong>
                <ExternalLinkAnchor href={entry.sourceUrl}>
                  {workLabel}
                </ExternalLinkAnchor>
              </div>
              <details>
                <summary>
                  <span>
                    <ModelMark model={run.model} />
                    {run.provider}/{run.model}
                  </span>
                  <time dateTime={run.completedAt}>
                    {formatDate(run.completedAt)}
                  </time>
                  <ChevronRight aria-hidden="true" />
                </summary>
                <div className="receipt-details">
                  <dl>
                    <div>
                      <dt>Run ID</dt>
                      <dd>
                        <code>{run.runId}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Project</dt>
                      <dd>{run.projectId}</dd>
                    </div>
                    <div>
                      <dt>Client</dt>
                      <dd>{run.client}</dd>
                    </div>
                    <div>
                      <dt>Tokens</dt>
                      <dd>
                        {run.usage.confidence === "unavailable"
                          ? "Unavailable"
                          : new Intl.NumberFormat("en-US").format(
                              run.usage.totalTokens,
                            )}
                      </dd>
                    </div>
                    <div>
                      <dt>Skill revision</dt>
                      <dd>
                        <code>{run.skillRevision}</code>
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>
            </article>
          );
        })}
      </div>
      {pages > 1 ? (
        <Pager onPage={setPage} page={current} pages={pages} />
      ) : null}
    </main>
  );
}
