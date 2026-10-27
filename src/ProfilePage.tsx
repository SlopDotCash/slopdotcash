import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "./Link";
import { browserDeployment } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { isFundingAddress } from "./lib/funding-address.mjs";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import { createGlobalLeaders, openMonthScores } from "./lib/global-leaderboard";
import { type GitHubActor, penaltyProjectOf } from "./lib/leaderboard";
import { findProject } from "./lib/projects.mjs";
import type { DataState } from "./lib/use-snapshot";
import { ProfilePoints, useProfileMembership } from "./Points";
import {
  ContributorIdentity,
  cycleContributorStateLabel,
  cycleLifecycleLabel,
  DataNotice,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatMicroUsdc,
  formatPointsFromThirds,
} from "./Presentation";
import { useProfiles } from "./Profiles";

/** The categories of the published penalty table (PRD section 7). */
const PENALTY_CATEGORY_LABELS: Record<string, string> = {
  spam: "Spam",
  scam: "Scam or malicious",
  busywork: "Clear violation of a quoted project rule",
  gaming: "Clear violation of a quoted project rule",
};

export function ProfilePage({
  login,
  state,
  retry,
}: {
  login: string;
  state: DataState;
  retry: () => void;
}) {
  const profiles = useProfiles();
  const membership = useProfileMembership(login);
  const actor = currentProfileActor(state, login, profiles.state, membership);
  const currentWallet = useCurrentWallet(actor, login);
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
        <ContributorIdentity
          actor={{
            login,
            avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
            url: `https://github.com/${encodeURIComponent(login)}`,
          }}
        />
        <DataNotice state={state} retry={retry} />
      </main>
    );
  if (!actor)
    return (
      <main className="shell route-main">
        <ContributorIdentity
          actor={{
            login,
            avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
            url: `https://github.com/${encodeURIComponent(login)}`,
          }}
        />
        <p className="data-notice" role="status">
          {profiles.state.status === "loading" ||
          membership.joinStatus === "loading" ||
          membership.sessionStatus === "loading"
            ? "Checking contributor…"
            : profiles.state.status === "error"
              ? "Contributor records are unavailable."
              : "This contributor could not be verified."}
        </p>
        {profiles.state.status === "error" ? (
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={profiles.retry}
          >
            Retry profile
          </button>
        ) : null}
      </main>
    );
  const globalLeaders = createGlobalLeaders(
    state.snapshot,
    state.views,
    state.cycleIndex,
  );
  const globalLeader = globalLeaders.find(
    (leader) => leader.actor.id === actor.id,
  );
  const matches = state.views.flatMap((view) =>
    view.leaders
      .filter((leader) => leader.actor.id === actor.id)
      .map((leader) => ({ leader, view })),
  );
  const history = state.cycleIndex.cycles.flatMap((cycle) =>
    cycle.contributors
      .filter((contributor) => contributor.actor.id === actor.id)
      .map((contributor) => ({ contributor, cycle })),
  );
  if (matches.length === 0 && history.length === 0 && !globalLeader) {
    return (
      <main className="shell route-main">
        <DataNotice state={state} retry={retry} />
        <ProfilePoints
          key={login.toLowerCase()}
          login={login}
          actorId={actor.id}
          profileCensus={profiles}
          profileMembership={membership}
          cycles={state.cycleIndex}
          showIdentity
          notFoundWhenUnrecorded
        />
      </main>
    );
  }
  const penalties = (state.snapshot.penalties ?? []).filter(
    (penalty) => penalty.actor.id === actor.id,
  );
  // The same open-month deductions as the accepted-work credits.
  const appliedPenalties = openMonthScores(state.snapshot, state.cycleIndex)
    .deductions.byPenalty;
  const historicalWallet = history.find(({ contributor }) => contributor.wallet)
    ?.contributor.wallet;
  const wallet =
    currentWallet.status === "ready" ? currentWallet : historicalWallet;
  return (
    <main className="shell route-main profile-page">
      <DataNotice state={state} retry={retry} />
      <ContributorIdentity actor={actor}>
        {wallet ? (
          <ExternalLinkAnchor
            className="profile-wallet"
            href={wallet.sourceUrl}
          >
            {currentWallet.status === "ready" ? "Wallet" : "Past wallet"} ·{" "}
            {shortAddress(wallet.address)}
          </ExternalLinkAnchor>
        ) : currentWallet.status === "loading" ? (
          <span>Checking wallet…</span>
        ) : membership.own ? (
          <Link href="/account#wallets">Add a payout wallet</Link>
        ) : null}
      </ContributorIdentity>
      <ProfilePoints
        key={login.toLowerCase()}
        profileCensus={profiles}
        profileMembership={membership}
        actorId={actor.id}
        login={login}
        cycles={state.cycleIndex}
      >
        {matches.length > 0 ? (
          <section className="profile-card" aria-label="Projects">
            <div className="profile-card-heading">
              <h2>Projects</h2>
              <span>{formatCycleMonth(matches[0].view.cycle.id)}</span>
            </div>
            <ul className="project-bars">
              {matches
                .slice()
                .sort((left, right) => right.leader.score - left.leader.score)
                .map(({ leader, view }) => {
                  const totalWeight = view.leaders.reduce(
                    (total, entry) => total + entry.adjustedWeight,
                    0,
                  );
                  const share =
                    totalWeight > 0 ? leader.adjustedWeight / totalWeight : 0;
                  return (
                    <li key={view.project.id}>
                      <Link href={`/projects/${view.project.slug}`}>
                        <span className="project-bar-label">
                          <strong>{view.project.name}</strong>
                          <small title="Accepted-work points">
                            {formatPointsFromThirds(leader.scoreThirds)} points
                          </small>
                        </span>
                        <span className="project-bar-track" aria-hidden="true">
                          <span
                            style={{ width: `${Math.max(2, share * 100)}%` }}
                          />
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}
      </ProfilePoints>
      {penalties.length > 0 ? (
        <section
          className="section profile-section"
          aria-labelledby="profile-penalties"
        >
          <div className="profile-section-heading">
            <h2 id="profile-penalties">Penalties</h2>
            <span>{penalties.length} recorded</span>
          </div>
          <p>
            <Link href="/how-it-works#points">How penalties work</Link>
          </p>
          <ul className="profile-penalties">
            {penalties.map((penalty) => (
              <li key={penalty.id}>
                <ExternalLinkAnchor href={penalty.source.url}>
                  {findProject(penaltyProjectOf(penalty.repository))?.name ??
                    penalty.repository}{" "}
                  #{penalty.source.number}
                </ExternalLinkAnchor>{" "}
                <span>
                  {PENALTY_CATEGORY_LABELS[penalty.category] ??
                    penalty.category}{" "}
                  · {formatCycleMonth(penalty.occurredAt.slice(0, 7))} · −
                  {formatPointsFromThirds(penalty.debitThirds)} point debit ·{" "}
                  {formatPointsFromThirds(
                    appliedPenalties.get(penalty.id) ?? 0,
                  )}{" "}
                  applied
                </span>
              </li>
            ))}
          </ul>
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
                  <small>{formatCycleMonth(cycle.cycleId)}</small>
                </span>
                <span>
                  <strong>
                    {formatPointsFromThirds(
                      contributor.scoreThirds ?? contributor.score * 3,
                    )}{" "}
                    points
                  </strong>
                  <small>
                    <span
                      className={`payout-state payout-state-${contributor.state}`}
                    >
                      {contributor.state === "paid"
                        ? "Paid"
                        : cycleLifecycleLabel(cycle)}
                    </span>
                  </small>
                </span>
                <span>
                  <strong>
                    {formatMicroUsdc(
                      contributor.state === "paid"
                        ? contributor.paidMinor
                        : contributor.approvedMinor !== "0"
                          ? contributor.approvedMinor
                          : contributor.suggestedMinor,
                    )}
                  </strong>
                  <small>{cycleContributorStateLabel(contributor.state)}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

/** Historical aliases do not prove who currently owns a profile URL. */
function currentProfileActor(
  state: DataState,
  login: string,
  profiles: ReturnType<typeof useProfiles>["state"],
  membership: ReturnType<typeof useProfileMembership>,
): GitHubActor | undefined {
  if (state.status !== "ready") return;
  const normalizedLogin = login.toLowerCase();
  const matchesLogin = (actor: { login: string }) =>
    actor.login.toLowerCase() === normalizedLogin;
  const asActor = (actor: {
    id: string;
    login: string;
    avatarUrl?: string;
  }): GitHubActor => ({
    id: actor.id,
    login: actor.login,
    avatarUrl:
      actor.avatarUrl ??
      `https://avatars.githubusercontent.com/${encodeURIComponent(actor.login)}?size=160`,
    url: `https://github.com/${encodeURIComponent(actor.login)}`,
    kind: "User",
  });
  const actors: Array<{ id: string; login: string; avatarUrl?: string }> = [
    ...(membership.signedInActor ? [membership.signedInActor] : []),
    ...state.snapshot.leaders.map((leader) => leader.actor),
    ...(state.snapshot.reviewExclusions ?? []).flatMap((exclusion) =>
      exclusion.reviewer?.kind === "User" ? [exclusion.reviewer] : [],
    ),
    ...state.views.flatMap((view) => [
      ...view.leaders.map((leader) => leader.actor),
      ...view.opportunities.map((opportunity) => opportunity.actor),
    ]),
  ];
  const conflictsWith = (candidate: { id: string }) =>
    actors.some((actor) =>
      actor.id === candidate.id ? !matchesLogin(actor) : matchesLogin(actor),
    );
  // Every identity source can veto a stale login. Wait for the session,
  // membership and directory before selecting the actor for wallet/history reads.
  if (
    profiles.status !== "ready" ||
    membership.sessionStatus === "loading" ||
    (!membership.own && membership.joinStatus === "loading")
  )
    return;
  const directoryConflict = (candidate: { id: string }) =>
    profiles.index.people.some((person) =>
      person.id === candidate.id ? !matchesLogin(person) : matchesLogin(person),
    );
  const member = membership.own ?? membership.joined;
  if (member)
    return matchesLogin(member.actor) &&
      !conflictsWith(member.actor) &&
      !directoryConflict(member.actor)
      ? asActor(member.actor)
      : undefined;
  const current = actors.find(matchesLogin);
  if (current) {
    if (conflictsWith(current) || directoryConflict(current)) return;
    return asActor(current);
  }
  // The directory can resolve an inactive actor, but cannot override a known rename.
  const candidates = profiles.index.people.filter(
    (person) =>
      matchesLogin(person) &&
      !actors.some((actor) => actor.id === person.id && !matchesLogin(actor)),
  );
  if (candidates.length !== 1) return;
  return asActor(candidates[0]);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function useCurrentWallet(
  actor: GitHubActor | undefined,
  login: string,
): CurrentWalletState {
  const [wallet, setWallet] = useState<CurrentWalletState>({
    status: "loading",
  });
  const normalizedLogin = login.toLowerCase();
  const lookupKey = `${normalizedLogin}\0${actor?.id ?? ""}`;
  const avatarActorId = actor?.avatarUrl
    ? /^https:\/\/avatars\.githubusercontent\.com\/u\/(\d+)(?:\?|$)/u.exec(
        actor.avatarUrl,
      )?.[1]
    : undefined;
  const githubActorId = actor
    ? /^\d+$/u.test(actor.id)
      ? actor.id
      : (githubUserIdFromNodeId(actor.id) ?? avatarActorId ?? "")
    : "";
  const lookupStatus = !actor ? "none" : githubActorId ? "actor" : "error";
  useEffect(() => {
    if (lookupStatus === "error") {
      setWallet({ status: "error", key: lookupKey });
      return;
    }
    if (lookupStatus === "none") {
      setWallet({ status: "none", key: lookupKey });
      return;
    }
    setWallet({ status: "loading" });
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
          setWallet({ status: "none", key: lookupKey });
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
          key: lookupKey,
          sourceUrl: `${browserDeployment.api}/api/v1/wallet-claims/${claim.claimId}`,
        });
      })
      .catch(() => {
        if (active) setWallet({ status: "error", key: lookupKey });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [lookupStatus, githubActorId, lookupKey]);
  if (wallet.status !== "loading" && wallet.key !== lookupKey) {
    return { status: "loading" };
  }
  return wallet;
}

type CurrentWalletState =
  | { status: "loading" }
  | { status: "none"; key: string }
  | { status: "error"; key: string }
  | { status: "ready"; address: string; key: string; sourceUrl: string };

const WALLET_CLAIM_TIMEOUT_MS = 12_000;

const MAX_WALLET_CLAIM_BYTES = 16 * 1024;
