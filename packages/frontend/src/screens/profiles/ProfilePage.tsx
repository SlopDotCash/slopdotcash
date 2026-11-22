// spec/frontend/views.md, "Story: Read a contributor's profile"; spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login"; spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"; spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/points/penalties.md, "Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order"
import type { PublicMember } from "@repo/backend/client";
import type { LeaderboardSnapshot } from "@repo/points/client";
import { Button, DataState, Disclosure, ExternalLink, NotFound, Spinner, Status } from "@repo/ui";
import { Clock, Info, Wallet as WalletIcon } from "lucide-react";
import type { Effect } from "effect";
import { useMemo, useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { formatDateTime } from "../../app/format.ts";
import type { PageProps } from "../../app/pages.ts";
import { type ProfileActor, resolveProfileActor } from "../../projections/profile.ts";
import { findHistoricalProject, findProjectByRepositoryId, type RegistryBoot } from "../../reads/registry.vibe";
import type { Tier } from "../../platform/config.vibe";
import type { MemberLookup } from "../../reads/points.vibe";
import type { Shown } from "../home/listing.ts";
import { useShownRead } from "../projects/hooks.ts";
import { formatMonth, projectName } from "../projects/index.ts";
import { loadWork, type ProjectRuntime, projectReads, projectRuntime, type RepositoryRegistryOf, type Work } from "../projects/reads.vibe";
import { type Settled, useMounted, useOnce } from "../security/program/hooks.ts";
import { nextBoundary, useBoundary } from "../cycles/boundary.ts";
import { pointsText } from "../cycles/labels.ts";
import { useStandingHistory } from "../points/hooks.ts";
import { type ContributorRuntime, contributorReads, contributorRuntime, origin, registryBoot } from "../points/reads.vibe";
import type { StandingHistory } from "../points/standings.ts";
import { ContributorIdentity } from "./ContributorIdentity.tsx";
import { ProfilePayments } from "./ProfilePayments.tsx";
import { type JoinStatus, ProfilePoints } from "./ProfilePoints.tsx";
import { currentActors, cycleShares, githubIdOf, type MembershipFacts, penaltyLabels, type ProjectTermsOf, shortAddress, type SnapshotStandings, snapshotStandings } from "./profile.ts";

export type ProfilePageProps = PageProps & {
  /** The repository registry the public snapshot is checked against, from the project registry. */
  repositoryRegistry: RepositoryRegistryOf;
  /** Every registered project's reward terms, from the project registry. */
  projectTerms: ProjectTermsOf;
};

type ProjectSection = Effect.Success<ReturnType<typeof projectReads>>;
type ContributorSection = Effect.Success<ReturnType<typeof contributorReads>>;

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-10 px-4 py-12";
const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";
const failed: ReadonlySet<ReadStatus> = new Set(["Failed", "Invalid", "Unavailable", "Denied", "Cancelled"]);
const pending: ReadonlySet<ReadStatus> = new Set(["Idle", "Loading"]);

function Unverified({ login, status, onRetry }: { login: string; status: ReadStatus; onRetry?: () => void }) {
  return (
    <main className={pageClass}>
      <ContributorIdentity actor={{ login }} />
      <DataState status={status} onRetry={onRetry} />
    </main>
  );
}

function UnknownContributor({ login }: { login: string }) {
  return (
    <NotFound title={`@${login} not found`}>
      <p>
        <a href="/points" className={linkClass}>
          Find a contributor
        </a>
      </p>
    </NotFound>
  );
}

/** @throws {never} */
function facts(member: Pick<PublicMember, "actor">): MembershipFacts {
  return { actor: member.actor };
}

/** @throws {never} */
function joinStatusOf(member: Shown<MemberLookup>): JoinStatus {
  if (pending.has(member.status)) return "loading";
  if (member.status === "Empty" || member.value?.kind === "absent") return "absent";
  return member.value?.kind === "member" ? "ready" : "unavailable";
}

type Board = {
  login: string;
  boot: RegistryBoot;
  snapshot: LeaderboardSnapshot;
  standings: SnapshotStandings | undefined;
  section: ProjectSection;
  reads: ContributorSection;
  product: boolean;
  tier: Tier;
  nowMs: number;
};

function CurrentWallet({ reads, githubId, past }: Pick<Board, "reads"> & { githubId: string; past: WalletProof | undefined }) {
  const wallet = useShownRead(reads.wallet, githubId);
  const shown = (wallet.status === "Current" ? wallet.value : undefined) ?? past;
  return shown ? <WalletLink proof={shown} past={shown === past} /> : null;
}

function WalletLink({ proof, past }: { proof: WalletProof; past: boolean }) {
  const short = shortAddress(proof.address);
  return (
    <ExternalLink href={proof.sourceUrl} className={`${linkClass} inline-flex items-center gap-1`} label={`${past ? "Past wallet" : "Wallet"} · ${short}`}>
      {past ? (
        <span title="Past wallet">
          <Clock aria-hidden className="size-3.5" />
        </span>
      ) : (
        <WalletIcon aria-hidden className="size-3.5" />
      )}
      {short}
    </ExternalLink>
  );
}

type WalletProof = { readonly address: string; readonly sourceUrl: string };

function Wallet({ reads, actor, shares }: Pick<Board, "reads"> & { actor: ProfileActor; shares: ReturnType<typeof cycleShares> }) {
  const githubId = githubIdOf(actor);
  const past = shares.find(({ contributor }) => contributor.wallet)?.contributor.wallet ?? undefined;
  if (githubId !== undefined) return <CurrentWallet reads={reads} githubId={githubId} past={past} />;
  return past ? <WalletLink proof={past} past /> : null;
}

const unread: Shown<never> = { status: "Idle", value: undefined };

function Payments({ board, githubId, shares, cycles }: { board: Board; githubId: string; shares: ReturnType<typeof cycleShares>; cycles: boolean }) {
  const scope = `actor:${githubId}`;
  const direct = useShownRead(board.section.direct, scope);
  const vault = useShownRead(board.reads.vault, scope);
  return <ProfilePayments cycles={cycles ? shares : undefined} githubId={githubId} direct={direct} vault={vault} nameOf={(id) => projectName(board.boot, id)} nowMs={board.nowMs} tier={board.tier} />;
}

function Projects({ boot, standings, actor }: Pick<Board, "boot" | "standings"> & { actor: ProfileActor }) {
  const views = (standings?.views ?? []).filter((view) => view.leaders.some((leader) => leader.actor.id === actor.id));
  const first = views[0];
  if (first === undefined) return null;
  const named = views.map((view) => {
    const record = findHistoricalProject(boot, view.project.id);
    return { id: view.project.id, name: projectName(boot, view.project.id) ?? view.project.id, slug: typeof record?.slug === "string" ? record.slug : view.project.id };
  });
  return (
    <section aria-label="Projects" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-foreground">Projects</h2>
        <span className="text-sm text-muted-foreground">{formatMonth(first.cycle.id)}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {named
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((project) => (
            <li key={project.id}>
              <a href={`/projects/${project.slug}`} className={linkClass}>
                <strong>{project.name}</strong>
              </a>
            </li>
          ))}
      </ul>
    </section>
  );
}

function Penalties({ boot, snapshot, standings, actor }: Pick<Board, "boot" | "snapshot" | "standings"> & { actor: ProfileActor }) {
  const penalties = (snapshot.penalties ?? []).filter((penalty) => penalty.actor.id === actor.id);
  if (penalties.length === 0) return null;
  return (
    <Disclosure summary={`Penalty history · ${penalties.length}`}>
      <div className="flex flex-col gap-3">
        <a href="/how-it-works#penalties" className={`${linkClass} self-start`} aria-label="How penalties work" title="How penalties work">
          <Info aria-hidden className="size-4" />
        </a>
        <ul className="flex flex-col gap-2">
          {penalties.map((penalty) => {
            const project = findProjectByRepositoryId(boot, penalty.repository);
            return (
              <li key={penalty.id}>
                <ExternalLink href={penalty.source.url} className={linkClass}>
                  {typeof project?.name === "string" ? project.name : penalty.repository} #{penalty.source.number}
                </ExternalLink>{" "}
                <Status presentation={{ tone: penalty.category === "spam" ? "Caution" : "Negative", icon: "Alert", label: penaltyLabels[penalty.category] ?? penalty.category }} />{" "}
                <span>
                  {formatMonth(penalty.occurredAt.slice(0, 7))} −{pointsText(penalty.debitThirds)} pts · {standings ? `${pointsText(standings.applied.get(penalty.id) ?? 0)} applied` : "applied debit unavailable"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Disclosure>
  );
}

function Recorded({ board, actor, history, census, own, joined, joinStatus }: { board: Board; actor: ProfileActor; history: Shown<StandingHistory> } & Pick<Parameters<typeof ProfilePoints>[0], "census" | "own" | "joined" | "joinStatus">) {
  const { login, boot, snapshot, standings, section, reads, product, tier, nowMs } = board;
  const cycles = useShownRead(section.cycles, "index");
  const githubId = githubIdOf(actor);
  const x = useShownRead(reads.x, actor.id);
  const shares = cycleShares(cycles.value?.cycles ?? [], actor.id);
  const global = standings?.global.find((leader) => leader.actor.id === actor.id);
  const matched = (standings?.views ?? []).some((view) => view.leaders.some((leader) => leader.actor.id === actor.id));
  const payments =
    githubId === undefined ? (
      <ProfilePayments cycles={cycles.value === undefined ? undefined : shares} githubId={undefined} direct={unread} vault={unread} nameOf={(id) => projectName(boot, id)} nowMs={nowMs} tier={tier} />
    ) : (
      <Payments board={board} githubId={githubId} shares={shares} cycles={cycles.value !== undefined} />
    );
  const shared = { login, actorId: actor.id, census, history, own, joined, joinStatus, x: product ? x : undefined, payments };
  if (!matched && shares.length === 0 && global === undefined) {
    return (
      <main className={pageClass}>
        <ProfilePoints key={login.toLowerCase()} {...shared} showIdentity notFoundWhenUnrecorded />
      </main>
    );
  }
  return (
    <main className={pageClass}>
      <ContributorIdentity actor={actor}>
        <Wallet reads={reads} actor={actor} shares={shares} />
      </ContributorIdentity>
      <ProfilePoints key={login.toLowerCase()} {...shared}>
        <Projects boot={boot} standings={standings} actor={actor} />
      </ProfilePoints>
      <Penalties boot={boot} snapshot={snapshot} standings={standings} actor={actor} />
    </main>
  );
}

function Resolve({ board }: { board: Board }) {
  const { login, snapshot, standings, reads } = board;
  const census = useShownRead(reads.profiles, "all");
  const me = useShownRead(reads.me, "me");
  const member = useShownRead(reads.member, login.toLowerCase());
  const journal = useShownRead(reads.journal, "all");
  const history = useStandingHistory(journal);
  const wanted = login.toLowerCase();
  const own = me.value && me.value.actor.login.toLowerCase() === wanted ? facts(me.value) : undefined;
  const joined = member.value?.kind === "member" ? facts(member.value.member) : undefined;
  const joinStatus = joinStatusOf(member);
  const meLoading = pending.has(me.status);
  const deciding = census.value === undefined || meLoading || (!own && joinStatus === "loading");
  const actor = useMemo(
    () =>
      deciding
        ? undefined
        : resolveProfileActor({
            login,
            actors: currentActors(snapshot, standings?.views ?? [], me.value?.actor),
            people: census.value?.people ?? [],
            member: (own ?? joined)?.actor ?? null,
            journal: history.value === undefined ? null : history.value.members.map((entry) => entry.actor),
          }),
    [deciding, login, snapshot, standings, me.value, census.value, own, joined, history.value],
  );
  if (actor) return <Recorded board={board} actor={actor} history={history} census={census} own={own} joined={joined} joinStatus={joinStatus} />;
  const checking = pending.has(census.status) || joinStatus === "loading" || meLoading || pending.has(history.status);
  const unavailable = failed.has(census.status) || joinStatus === "unavailable" || failed.has(me.status) || failed.has(history.status);
  if (!checking && !unavailable) return <UnknownContributor login={login} />;
  const retry = () => {
    census.onRetry?.();
    member.onRetry?.();
    me.onRetry?.();
    journal.onRetry?.();
  };
  return (
    <main className={pageClass}>
      <ContributorIdentity actor={{ login }} />
      {checking ? (
        <Spinner label="Checking contributor" />
      ) : (
        <>
          <p role="status">Profile unavailable</p>
          <Button variant="outline" size="sm" className="self-start" aria-label="Retry profile" onClick={retry}>
            Retry
          </Button>
        </>
      )}
    </main>
  );
}

function boardStatus(read: Settled<Work>): ReadStatus {
  if (read.status === "running") return "Loading";
  if (read.status === "failed") return "Failed";
  return read.value.stale || read.value.refreshFailed ? "Stale" : "Current";
}

function Snapshot({ props, section, sectionReads, reads, boot, product, tier, force, onRetry }: { props: ProfilePageProps; section: ProjectRuntime; sectionReads: ProjectSection; reads: ContributorSection; boot: RegistryBoot; product: boolean; tier: Tier; force: boolean; onRetry: () => void }) {
  const { route, repositoryRegistry, projectTerms } = props;
  const work = useMounted(section, () => loadWork(boot, repositoryRegistry, force));
  const cycles = useShownRead(sectionReads.cycles, "index");
  const snapshot = work.status === "done" ? work.value.board.snapshot : undefined;
  const standings = useMemo(
    () => (snapshot === undefined ? undefined : snapshotStandings(snapshot, repositoryRegistry(boot), projectTerms(boot), cycles.value?.cycles ?? [])),
    [snapshot, repositoryRegistry, projectTerms, boot, cycles.value],
  );
  const nowMs = Date.now();
  useBoundary(section, nextBoundary(nowMs, (cycles.value?.cycles ?? []).map((cycle) => (cycle.state === "review" && cycle.reviewEndsAt ? Date.parse(cycle.reviewEndsAt) : undefined))));
  if (snapshot === undefined) return <Unverified login={route.login} status={boardStatus(work)} onRetry={onRetry} />;
  const status = boardStatus(work);
  const board: Board = { login: route.login, boot, snapshot, standings, section: sectionReads, reads, product, tier, nowMs };
  return (
    <>
      {status === "Stale" ? (
        <DataState
          status="Stale"
          onRetry={onRetry}
          updatedAt={<time dateTime={snapshot.generatedAt}>{formatDateTime(snapshot.generatedAt)}</time>}
          className="mx-auto w-full max-w-(--breakpoint-lg) px-4 pt-6"
        />
      ) : null}
      {standings === undefined ? <DataState status="Invalid" onRetry={onRetry} className="mx-auto w-full max-w-(--breakpoint-lg) px-4 pt-6" /> : null}
      <Resolve board={board} />
    </>
  );
}

function Sections({ props, section, contributor }: { props: ProfilePageProps; section: ProjectRuntime; contributor: ContributorRuntime }) {
  const [attempt, setAttempt] = useState(0);
  const registry = useOnce(section, "registry", () => registryBoot());
  const sectionReads = useOnce(section, "reads", () => projectReads());
  const reads = useOnce(contributor, "reads", () => contributorReads());
  const site = useOnce(contributor, "origin", () => origin());
  const login = props.route.login;
  if (registry.status === "running" || sectionReads.status === "running" || reads.status === "running" || site.status === "running") return <Unverified login={login} status="Loading" />;
  if (registry.status === "failed" || sectionReads.status === "failed" || reads.status === "failed" || site.status === "failed" || registry.value.error !== undefined) {
    return <Unverified login={login} status="Failed" onRetry={() => location.reload()} />;
  }
  return (
    <Snapshot
      key={attempt}
      props={props}
      section={section}
      sectionReads={sectionReads.value}
      reads={reads.value}
      boot={registry.value}
      product={site.value.product}
      tier={site.value.tier}
      force={attempt > 0}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

/** `/contributors/:login`: the contributor once a current record confirms the login, their projects by name, pull requests, payments and penalties. */
export function ProfilePage(props: ProfilePageProps) {
  return <Sections key={props.route.login.toLowerCase()} props={props} section={projectRuntime(props.runtime)} contributor={contributorRuntime(props.runtime)} />;
}
