import {
  ChevronRight,
  CircleAlert,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { DonorFundingProfile, useFundingIndex } from "./FundingRecords";
import { Link } from "./Link";
import { browserDeployment } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { isFundingAddress } from "./lib/funding";
import { createGlobalLeaders } from "./lib/global-leaderboard";
import {
  type GitHubActor,
  PROFILE_OPPORTUNITY_LIMIT,
  type ScoreOpportunity,
} from "./lib/leaderboard";
import { findProject, type ProjectDefinition } from "./lib/projects.mjs";
import { formatThirds } from "./lib/reviewer-leaders";
import { useFundingReviews } from "./lib/use-funding-reviews";
import type { DataState } from "./lib/use-snapshot";
import { ProfilePoints } from "./Points";
import {
  ContributorIdentity,
  DataNotice,
  EmptyState,
  ExternalLinkAnchor,
  formatCompact,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  formatScore,
  monthlyPoolUnfunded,
} from "./Presentation";
import { RewardValue } from "./ProjectLeaderboard";

export function ProfilePage({
  login,
  state,
  retry,
}: {
  login: string;
  state: DataState;
  retry: () => void;
}) {
  const [funding, retryFunding] = useFundingIndex();
  const [fundingReviews] = useFundingReviews(true);
  const currentWallet = useCurrentWallet(state, login);
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
        <ProfilePoints
          key={login.toLowerCase()}
          login={login}
          recordsLoading={state.status === "loading"}
          showIdentity
        />
        <DataNotice state={state} retry={retry} />
      </main>
    );
  const matches = state.views.flatMap((view) =>
    view.leaders
      .filter(
        (leader) => leader.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((leader) => ({ leader, view })),
  );
  const history = state.cycleIndex.cycles.flatMap((cycle) =>
    cycle.contributors
      .filter(
        (contributor) =>
          contributor.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((contributor) => ({ contributor, cycle })),
  );
  const loginOpportunities = state.views.flatMap((view) =>
    view.opportunities
      .filter(
        (opportunity) =>
          opportunity.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((opportunity) => ({ opportunity, project: view.project })),
  );
  const globalLeaders = createGlobalLeaders(
    state.snapshot,
    state.views,
    state.cycleIndex,
  );
  const globalRank = globalLeaders.findIndex(
    (leader) => leader.actor.login.toLowerCase() === login.toLowerCase(),
  );
  const globalLeader =
    globalRank === -1 ? undefined : globalLeaders[globalRank];
  // A frozen month with no cycle directory still records the contributor.
  const preparations =
    fundingReviews.status === "ready"
      ? fundingReviews.index.reviews
          .filter(
            (review) =>
              !state.cycleIndex.cycles.some(
                (cycle) =>
                  cycle.projectId === review.projectId &&
                  cycle.cycleId === review.cycleId,
              ),
          )
          .flatMap((review) =>
            review.contributors
              .filter(
                (contributor) =>
                  contributor.actor.login.toLowerCase() === login.toLowerCase(),
              )
              .map((contributor) => ({ contributor, review })),
          )
          .sort(
            (left, right) =>
              right.review.cycleId.localeCompare(left.review.cycleId) ||
              left.review.projectId.localeCompare(right.review.projectId),
          )
      : [];
  if (
    matches.length === 0 &&
    history.length === 0 &&
    !globalLeader &&
    loginOpportunities.length === 0 &&
    preparations.length === 0
  ) {
    if (fundingReviews.status === "loading")
      return (
        <main className="shell route-main" aria-busy="true">
          <ContributorIdentity
            actor={{
              login,
              avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
              url: `https://github.com/${encodeURIComponent(login)}`,
            }}
          />
          <p className="data-notice" role="status">
            Checking frozen months…
          </p>
        </main>
      );
    return (
      <main className="shell route-main">
        <ProfilePoints
          key={login.toLowerCase()}
          login={login}
          cycles={state.cycleIndex}
          showIdentity
        />
      </main>
    );
  }
  const historicalActor =
    history[0]?.contributor.actor ?? preparations[0]?.contributor.actor;
  const opportunityActor = loginOpportunities[0]?.opportunity.actor;
  const actor: GitHubActor = globalLeader?.actor ??
    matches[0]?.leader.actor ??
    opportunityActor ?? {
      id: historicalActor?.id ?? `historical:${login.toLowerCase()}`,
      login: historicalActor?.login ?? login,
      avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
      url: `https://github.com/${encodeURIComponent(login)}`,
      kind: "User",
    };
  const events = state.snapshot.ledger.filter(
    (event) => event.actor.id === actor.id,
  );
  const opportunities = loginOpportunities
    .filter(({ opportunity }) => opportunity.actor.id === actor.id)
    .sort(
      (left, right) =>
        Date.parse(right.opportunity.occurredAt) -
          Date.parse(left.opportunity.occurredAt) ||
        left.opportunity.source.number - right.opportunity.source.number ||
        left.opportunity.id.localeCompare(right.opportunity.id),
    )
    .slice(0, PROFILE_OPPORTUNITY_LIMIT);
  // Outside the rolling window the frozen months are the only scored record.
  const score = globalLeader
    ? formatScore(globalLeader.score)
    : formatThirds(
        preparations.reduce(
          (total, { contributor }) => total + Number(contributor.scoreThirds),
          0,
        ),
      );
  // Closed cycles replace their overlapping ledger events in this cumulative score.
  const scoreLabel = globalLeader ? "recorded score" : "score, frozen months";
  const acceptedOutcomes = matches.reduce(
    (total, match) => total + match.leader.acceptedOutcomeCount,
    0,
  );
  const simulated = matches.reduce(
    (total, match) => total + BigInt(match.leader.simulatedMinor ?? "0"),
    0n,
  );
  // Keep the cap-based estimate separate from funding and approved awards.
  const cycleId = (matches[0]?.view ?? state.views[0])?.cycle.id;
  const monthlyPools = (
    matches.length > 0 ? matches.map(({ view }) => view) : state.views
  ).filter((view) => view.project.reward.kind === "monthly-pool");
  const simulatedUnfunded =
    monthlyPools.length > 0 &&
    monthlyPools.every((view) => monthlyPoolUnfunded(view.project.reward));
  const simulatedLabel = `${
    cycleId ? formatCycleMonth(cycleId) : "monthly"
  } simulated estimate${simulatedUnfunded ? ", unfunded" : ""}`;
  const historicalWallet = history.find(({ contributor }) => contributor.wallet)
    ?.contributor.wallet;
  return (
    <main className="shell route-main profile-page">
      <DataNotice state={state} retry={retry} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/points">Contributors</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{actor.login}</span>
      </nav>
      <ContributorIdentity actor={actor}>
        <details className="profile-wallet-details">
          <summary>Payout wallet</summary>
          {currentWallet.status === "ready" ? (
            <ExternalLinkAnchor href={currentWallet.sourceUrl}>
              Current payout wallet · {currentWallet.address}{" "}
              <ExternalLink aria-hidden="true" size={15} />
            </ExternalLinkAnchor>
          ) : historicalWallet ? (
            <ExternalLinkAnchor href={historicalWallet.sourceUrl}>
              Historical payout wallet · {historicalWallet.address}{" "}
              <ExternalLink aria-hidden="true" size={15} />
            </ExternalLinkAnchor>
          ) : currentWallet.status === "loading" ? (
            <span>Checking current payout wallet…</span>
          ) : currentWallet.status === "error" ? (
            <span>Current payout wallet status unavailable</span>
          ) : (
            <span>No current payout wallet registered</span>
          )}
          <Link href="/account#wallets">Register or update your wallet</Link>
        </details>
      </ContributorIdentity>
      <ProfilePoints
        key={login.toLowerCase()}
        actorId={actor.id}
        work={events}
        login={login}
        cycles={state.cycleIndex}
        summary={
          <>
            {globalRank >= 0 ? (
              <div>
                <strong>#{globalRank + 1}</strong>
                <span>overall rank</span>
              </div>
            ) : null}
            <div>
              <strong title="Closed cycles and ledger events outside those cycles">
                {score}
              </strong>
              <span>{scoreLabel}</span>
            </div>
            <div>
              <strong>{formatCompact(acceptedOutcomes)}</strong>
              <span>accepted this month</span>
            </div>
            <div>
              <strong>{formatMicroUsdc(simulated.toString())}</strong>
              <span>{simulatedLabel}</span>
            </div>
          </>
        }
      />
      <p className="profile-estimate-note">
        This estimate uses project budget targets. It is not an approved payout.
        The 14-day review applies to monthly proposals, not this estimate.
      </p>
      <section className="section profile-section">
        <div className="profile-section-heading">
          <h2>Projects</h2>
        </div>
        <div className="profile-projects">
          {matches.length === 0 ? (
            <EmptyState text="No accepted project score in the current cycles yet." />
          ) : (
            matches.map(({ leader, view }) => {
              return (
                <div className="profile-project-block" key={view.project.id}>
                  <Link href={`/projects/${view.project.slug}`}>
                    <span className="profile-project-name">
                      <strong>{view.project.name}</strong>
                      <small>{view.cycle.id}</small>
                    </span>
                    <span className="profile-project-stat">
                      <strong title={`Exact score ${leader.scoreThirds}/3`}>
                        {formatThirds(leader.scoreThirds)} score
                      </strong>
                      <small>
                        {leader.acceptedOutcomeCount} accepted outcome
                        {leader.acceptedOutcomeCount === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span className="profile-project-stat">
                      <RewardValue leader={leader} view={view} />
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </section>
      {opportunities.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Open work</h2>
            <span>{opportunities.length} available</span>
          </div>
          <OpportunityList opportunities={opportunities} />
        </section>
      ) : null}
      {history.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Past cycles</h2>
          </div>
          <div className="profile-projects">
            {history.map(({ contributor, cycle }) => (
              <Link
                href={`/cycles/${cycle.projectId}/${cycle.cycleId}`}
                key={`${cycle.projectId}:${cycle.cycleId}`}
              >
                <span>
                  <strong>
                    {findProject(cycle.projectId)?.name ?? cycle.projectId}
                  </strong>
                  <small>
                    {cycle.cycleId} · {cycle.state.replaceAll("-", " ")}
                  </small>
                </span>
                <span>
                  <strong>{contributor.score} score</strong>
                  <small>{contributor.state.replaceAll("-", " ")}</small>
                </span>
                <span>
                  <strong>{formatMicroUsdc(contributor.paidMinor)}</strong>
                  <small>paid</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {preparations.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Frozen months</h2>
            <span>scored, not approved</span>
          </div>
          <div className="profile-projects">
            {preparations.map(({ contributor, review }) => {
              const project = findProject(review.projectId);
              return (
                <Link
                  href={`/projects/${project?.slug ?? review.projectId}/funding`}
                  key={`${review.projectId}:${review.cycleId}`}
                >
                  <span>
                    <strong>{project?.name ?? review.projectId}</strong>
                    <small>{review.cycleId} · preparation</small>
                  </span>
                  <span>
                    <strong title={`Exact score ${contributor.scoreThirds}/3`}>
                      {formatThirds(Number(contributor.scoreThirds))} score
                    </strong>
                    <small>
                      {contributor.eventCount} scored event
                      {contributor.eventCount === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {contributor.simulatedMinor === null
                        ? "External prize share"
                        : formatMicroUsdc(contributor.simulatedMinor)}
                    </strong>
                    <small>
                      {contributor.wallet
                        ? "simulated · wallet on file at freeze"
                        : "simulated · unclaimed, no wallet at freeze"}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : fundingReviews.status === "error" ? (
        <section className="section profile-section">
          <div className="data-notice data-error" role="alert">
            <CircleAlert aria-hidden="true" size={18} /> Frozen month records
            unavailable: {fundingReviews.message}
          </div>
        </section>
      ) : null}
      {funding.status === "error" ? (
        <section className="section profile-section">
          <div className="data-notice data-error" role="alert">
            <CircleAlert aria-hidden="true" size={18} />
            <span>Public donor records unavailable: {funding.message}</span>
            <button onClick={retryFunding} type="button">
              <RotateCcw aria-hidden="true" size={15} /> Retry
            </button>
          </div>
        </section>
      ) : funding.status === "ready" ? (
        <DonorFundingProfile actor={actor} records={funding.index.records} />
      ) : null}
    </main>
  );
}

function useCurrentWallet(state: DataState, login: string): CurrentWalletState {
  const [wallet, setWallet] = useState<CurrentWalletState>({
    status: "loading",
  });
  useEffect(() => {
    if (state.status !== "ready") return;
    const normalizedLogin = login.toLowerCase();
    setWallet({ status: "loading" });
    const actors: Array<{ id: string; login: string; avatarUrl?: string }> = [
      ...state.views.flatMap((view) => [
        ...view.leaders.map((leader) => leader.actor),
        ...view.opportunities.map((opportunity) => opportunity.actor),
      ]),
      ...state.cycleIndex.cycles.flatMap((cycle) =>
        cycle.contributors.map((contributor) => contributor.actor),
      ),
    ];
    const actor = actors.find(
      (candidate) => candidate.login.toLowerCase() === normalizedLogin,
    );
    const avatarActorId = actor?.avatarUrl
      ? /^https:\/\/avatars\.githubusercontent\.com\/u\/(\d+)(?:\?|$)/u.exec(
          actor.avatarUrl,
        )?.[1]
      : undefined;
    const githubActorId =
      actor && /^\d+$/u.test(actor.id) ? actor.id : avatarActorId;
    if (!githubActorId) {
      setWallet({ status: "none", login: normalizedLogin });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new Error("wallet claim request timed out")),
      WALLET_CLAIM_TIMEOUT_MS,
    );
    void fetch(
      `${browserDeployment.api}/api/v1/wallet-claims/actors/${githubActorId}/current`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return readBoundedJson(
          response,
          MAX_WALLET_CLAIM_BYTES,
          "Wallet claim",
        );
      })
      .then((value) => {
        if (!active) return;
        if (value === null) {
          setWallet({ status: "none", login: normalizedLogin });
          return;
        }
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          throw new TypeError("Wallet claim must be an object");
        }
        const claim = value as Record<string, unknown>;
        if (
          typeof claim.claimId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(claim.claimId) ||
          claim.githubActorId !== githubActorId ||
          typeof claim.address !== "string" ||
          !isFundingAddress("solana", claim.address)
        ) {
          throw new TypeError("Wallet claim has invalid actor-bound metadata");
        }
        setWallet({
          status: "ready",
          address: claim.address,
          login: normalizedLogin,
          sourceUrl: `${browserDeployment.api}/api/v1/wallet-claims/${claim.claimId}`,
        });
      })
      .catch(() => {
        if (active) setWallet({ status: "error", login: normalizedLogin });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [state, login]);
  if (wallet.status !== "loading" && wallet.login !== login.toLowerCase()) {
    return { status: "loading" };
  }
  return wallet;
}

type CurrentWalletState =
  | { status: "loading" }
  | { status: "none"; login: string }
  | { status: "error"; login: string }
  | { status: "ready"; address: string; login: string; sourceUrl: string };

const WALLET_CLAIM_TIMEOUT_MS = 12_000;

const MAX_WALLET_CLAIM_BYTES = 16 * 1024;

function OpportunityList({
  opportunities,
}: {
  opportunities: Array<{
    opportunity: ScoreOpportunity;
    project: ProjectDefinition;
  }>;
}) {
  return (
    <div className="event-list opportunity-list">
      {opportunities.map(({ opportunity, project }) => (
        <ExternalLinkAnchor href={opportunity.source.url} key={opportunity.id}>
          <span className="event-points">
            {opportunityPointsLabel(opportunity)}
          </span>
          <span>
            <strong>{opportunity.hint}</strong>
            <small>
              {opportunity.source.title} · {project.name} ·{" "}
              {formatDate(opportunity.occurredAt)}
            </small>
          </span>
          <ExternalLink aria-hidden="true" size={16} />
        </ExternalLinkAnchor>
      ))}
    </div>
  );
}

function opportunityPointsLabel(opportunity: ScoreOpportunity): string {
  if (
    opportunity.kind === "missing-evidence" ||
    opportunity.kind === "partial-evidence"
  ) {
    return "Evidence guidance";
  }
  return opportunity.kind === "expand-review"
    ? "Review guidance"
    : "Test guidance";
}
