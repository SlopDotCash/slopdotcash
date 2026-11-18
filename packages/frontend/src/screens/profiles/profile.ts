// spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import { githubUserIdFromNodeId } from "@repo/backend/nodeId";
import type { LeaderboardSnapshot, ProfileRecord, RepositoryRegistry } from "@repo/points/client";
import type { CycleContributor, CycleIndexEntry, DirectTransfer, PublicVaultPayment } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import type { Tier } from "../../platform/config.vibe";
import type { ProfileActor, ProfileActorSource } from "../../projections/profile.ts";
import { type ProjectCycleView, type ProjectTerms, projectCycleViews } from "../../projections/projectView.ts";
import { type GlobalStanding, globalStandings, openMonthScores } from "../../projections/standings.ts";
import type { RegistryBoot } from "../../reads/registry.vibe";

export interface MembershipFacts {
  readonly actor: ProfileActorSource;
  readonly welcome: number;
  readonly socialPoints: number;
}

export interface CycleShare {
  readonly contributor: CycleContributor;
  readonly cycle: CycleIndexEntry;
}

export interface MoneyParts {
  readonly tier: Tier;
  readonly cycles: ReadonlyArray<CycleShare> | undefined;
  readonly direct: ReadonlyArray<DirectTransfer> | undefined;
  readonly vault: ReadonlyArray<PublicVaultPayment> | undefined;
}

export type ProjectTermsOf = (boot: RegistryBoot) => ReadonlyArray<ProjectTerms>;

export interface SnapshotStandings {
  readonly views: ReadonlyArray<ProjectCycleView>;
  readonly global: ReadonlyArray<GlobalStanding>;
  readonly applied: ReadonlyMap<string, number>;
}

export const recentDays = 30;
export const activityDays = 35;
export const shownRecords = 5;

export const penaltyLabels: Readonly<Record<string, string>> = {
  spam: "Spam",
  scam: "Scam",
  busywork: "Rule violation",
  gaming: "Rule violation",
};

const avatarActor = /^https:\/\/avatars\.githubusercontent\.com\/u\/(\d+)(?:\?|$)/u;

/** Every actor the current snapshot names: leaders, user reviewers of excluded reviews, and each view's leaders and opportunities; the signed-in member first. @throws {never} */
export function currentActors(snapshot: LeaderboardSnapshot, views: ReadonlyArray<ProjectCycleView>, signedIn: ProfileActorSource | undefined): ReadonlyArray<ProfileActorSource> {
  return [
    ...(signedIn ? [signedIn] : []),
    ...snapshot.leaders.map((leader) => leader.actor),
    ...(snapshot.reviewExclusions ?? []).flatMap((exclusion) => (exclusion.reviewer?.kind === "User" ? [exclusion.reviewer] : [])),
    ...views.flatMap((view) => [...view.leaders.map((leader) => leader.actor), ...view.opportunities.map((opportunity) => opportunity.actor)]),
  ];
}

/** The decimal GitHub user id of an actor: its numeric id, its node id decoded, or the id in its avatar address. @throws {never} */
export function githubIdOf(actor: Pick<ProfileActor, "id" | "avatarUrl">): string | undefined {
  if (/^[1-9]\d*$/u.test(actor.id)) return actor.id;
  const decoded = githubUserIdFromNodeId(actor.id);
  if (decoded > 0n) return decoded.toString();
  return avatarActor.exec(actor.avatarUrl)?.[1];
}

/** The member's archived cycle rows, newest cycle first. @throws {never} */
export function cycleShares(cycles: ReadonlyArray<CycleIndexEntry>, actorId: string): ReadonlyArray<CycleShare> {
  return cycles
    .flatMap((cycle) => cycle.contributors.filter((contributor) => contributor.actor.id === actorId).map((contributor) => ({ contributor, cycle })))
    .sort((left, right) => right.cycle.cycleId.localeCompare(left.cycle.cycleId));
}

/** @throws {never} */
function minor(value: string): bigint {
  return parseBaseUnits(value) ?? 0n;
}

/** A six-decimal reference asset of the payment's network, whose base units are micro-dollars; testnet payments count only on staging. @throws {never} */
function usdMicro(payment: PublicVaultPayment, tier: Tier): boolean {
  if (!isNetworkKey(payment.network)) return false;
  const network = NETWORKS[payment.network];
  if (network.testnet && tier !== "staging") return false;
  const evm = payment.assetAddress.startsWith("0x");
  return payment.assetDecimals === 6 && network.assets.some((asset) => asset.decimals === 6 && (evm ? asset.address.toLowerCase() === payment.assetAddress.toLowerCase() : asset.address === payment.assetAddress));
}

/** Money received over all time in USDC micro-units: paid archived cycles, disclosed direct transfers and finalized vault payments in a USD reference stablecoin; unknown until every part has been read. @throws {never} */
export function moneyReceived({ tier, cycles, direct, vault }: MoneyParts): bigint | undefined {
  if (cycles === undefined || direct === undefined || vault === undefined) return undefined;
  const fromCycles = cycles.reduce((sum, { contributor }) => sum + (contributor.state === "paid" ? minor(contributor.paidMinor) : 0n), 0n);
  const fromDirect = direct.reduce((sum, payment) => sum + minor(payment.amountMicro), 0n);
  const fromVault = vault.reduce((sum, payment) => sum + (usdMicro(payment, tier) ? minor(payment.netBase) : 0n), 0n);
  return fromCycles + fromDirect + fromVault;
}

/** The census records of one actor, or of one login when no actor is known. @throws {never} */
export function censusMatches(people: ReadonlyArray<ProfileRecord>, login: string, actorId: string | undefined): ReadonlyArray<ProfileRecord> {
  return people.filter((person) => (actorId ? person.id === actorId : person.login.toLowerCase() === login.toLowerCase()));
}

/** @throws {never} */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Each project's current cycle view, the cross-project standings and the debit applied to each open-month penalty, or undefined when the snapshot contradicts the registry. @throws {never} */
export function snapshotStandings(snapshot: LeaderboardSnapshot, registry: RepositoryRegistry, projects: ReadonlyArray<ProjectTerms>, cycles: ReadonlyArray<CycleIndexEntry>): SnapshotStandings | undefined {
  try {
    const views = projectCycleViews({ snapshot, registry, projects });
    const request = { snapshot, registry, projects, views, cycles };
    return { views, global: globalStandings(request), applied: openMonthScores(request).deductions.byPenalty };
  } catch {
    return undefined;
  }
}
