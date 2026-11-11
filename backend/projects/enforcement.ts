/**
 * ADM-06 project enforcement rules. A Quarantine or a Ban takes effect
 * through an append-only record at once; the matching paused, retired
 * revision is appended in the same write when the manifest allows it, and is
 * shown as pending when it does not. A restriction can only restrict: it never
 * creates a project, grants featuring, or enables money. Reinstatement needs
 * an appeal and a moderator who did not place the restriction (ELG-02). The
 * project steward or the applicant who listed the project may file the
 * appeal; only a moderator decides it. Two standing rules act without a
 * moderator: two distinct contributor flags quarantine a project, and a
 * clean fresh scan lifts a quarantine that flags alone placed. A signed
 * confirmed malicious result bans the project at once, and a moderator then
 * decides it (PRD sections 2 and 8): ban the project and its maintainer, or
 * reinstate it on the owner's appeal after a fresh clean scan.
 */

import type {
  AppealState,
  EnforcementAction,
  EnforcementActorRole,
  GithubActor,
  ProjectEnforcement,
  ProjectRecord,
  RestrictionState,
} from "../../src/lib/project-contracts";
import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { ProjectPersistence } from "./contracts";
import {
  type EnforcementHistoryRow,
  foldEnforcementStatus,
  openAccountAppealSource,
  planEnforcementAction,
  planFlagScanReinstatement,
  selectActiveBanIndices,
  selectProjectAppeals,
  pausedByFlagsOnly as verifiedPausedByFlagsOnly,
} from "./verified-enforcement";

export const ENFORCEMENT_ACTIONS: readonly EnforcementAction[] = [
  "quarantine",
  "ban",
  "request_reinstatement",
  "reinstate",
  "reinstate_accounts",
  "deny_reinstatement",
];

class EnforcementRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ProjectRestriction = {
  projectId: string;
  /**
   * Project whose records hold the restriction, and so the project an appeal
   * names: another project's when the restriction binds a repository this
   * project claims.
   */
  sourceProjectId: string;
  state: RestrictionState;
  appeal: AppealState;
  /** When the restriction in force began; null when the project is clear. */
  since: string | null;
  /** Moderators who placed the restriction in force. */
  restrictedBy: GithubActor[];
  /** Revision the restriction in force started from. */
  openedAtRevision: number | null;
  /** Maintainer accounts a moderator banned with the restriction in force. */
  bannedMaintainers: GithubActor[];
  repositoryGithubId: string | null;
  repositoryKeys: string[];
  /** The next record's sequence number. */
  nextSequence: number;
  records: ProjectEnforcement[];
};

function restrictionHistory(
  records: readonly ProjectEnforcement[],
): EnforcementHistoryRow[] {
  return records.map((record) => ({
    action: record.action,
    stateAfter: record.stateAfter,
    appealAfter: record.appealAfter,
    actor: record.actor
      ? { kind: "actor", id: record.actor.githubId }
      : { kind: "none" },
    actorRole: record.actorRole,
    sequence: record.sequence,
    bannedAccounts: (record.maintainerBans ?? []).map(
      (account) => account.githubId,
    ),
    reinstatedAccounts: (record.accountReinstatements ?? []).map(
      (account) => account.githubId,
    ),
  }));
}

/** Folds one project's records, oldest first, into its current restriction. */
export function projectRestriction(
  projectId: string,
  all: ProjectEnforcement[],
): ProjectRestriction {
  const records = all
    .filter((record) => record.projectId === projectId)
    .sort((left, right) => left.sequence - right.sequence);
  const bannedMaintainers = activeAccountBans(records).map(
    ({ account }) => account,
  );
  const episode = foldEnforcementStatus(
    restrictionHistory(records),
    bannedMaintainers.map((account) => account.githubId),
  );
  const opening = episode.opening < 0 ? null : records[episode.opening];
  const latest = episode.last < 0 ? null : records[episode.last];
  const restriction: ProjectRestriction = {
    projectId,
    sourceProjectId: projectId,
    state: episode.state as RestrictionState,
    appeal: episode.appeal as AppealState,
    since: opening ? opening.createdAt : null,
    restrictedBy: episode.actorSources.map(
      (index) => records[index].actor as GithubActor,
    ),
    openedAtRevision: opening ? opening.beforeRevision : null,
    bannedMaintainers,
    repositoryGithubId: latest ? latest.repositoryGithubId : null,
    repositoryKeys: latest ? latest.repositoryKeys : [],
    nextSequence: records.length + 1,
    records,
  };
  return restriction;
}

/** An account-only appeal does not open or pre-empt the project's appeal. */
export function projectAppealState(
  restriction: ProjectRestriction,
): AppealState {
  if (restriction.state === "clear") return "none";
  return projectAppealOpen(restriction.records) ? "requested" : "none";
}

/**
 * The undecided project appeals in records (newest first) after the last
 * record that closed one; the next decision closes all of them. With `kept`,
 * an appeal that confirmed malicious Bans kept also counts: the moderator
 * decision on those Bans closes it.
 */
function openProjectAppeals(
  records: ProjectEnforcement[],
  kept = false,
): ProjectEnforcement[] {
  return selectProjectAppeals(restrictionHistory(records), kept, {
    kind: "all",
  }).indices.map((index) => records[index]);
}

function projectAppealOpen(
  records: ProjectEnforcement[],
  kept = false,
): boolean {
  return openProjectAppeals(records, kept).length > 0;
}

/** A shared project appeal must not claim that another account filed evidence. */
export function accountAppealState(
  restriction: ProjectRestriction,
  githubId: string,
): AppealState {
  if (
    !restriction.bannedMaintainers.some(
      (account) => account.githubId === githubId,
    )
  )
    return "none";
  return openAccountAppealSource(
    restrictionHistory(restriction.records),
    githubId,
  ) >= 0
    ? "requested"
    : "none";
}

/**
 * True when the latest restrictive record is a signed confirmed malicious
 * Ban that no moderator has decided yet (PRD sections 2 and 8). The
 * moderator queue lists these projects until a moderator bans the project
 * and its maintainer, or reinstates it.
 */
export function awaitsMaliciousDecision(
  restriction: ProjectRestriction,
): boolean {
  if (restriction.state !== "banned") return false;
  for (let index = restriction.records.length - 1; index >= 0; index -= 1) {
    const record = restriction.records[index];
    if (record.action === "quarantine" || record.action === "ban")
      return record.action === "ban" && record.actorRole === "vetting-service";
  }
  return false;
}

/**
 * Account bans remain active until an explicit decision releases that exact ban.
 * Project reinstatement alone does not establish an account's innocence.
 */
export function activeAccountBans(records: ProjectEnforcement[]) {
  const keys = new Map<string, number>();
  const indexOf = (key: string) => {
    const existing = keys.get(key);
    if (existing !== undefined) return existing;
    const index = keys.size;
    keys.set(key, index);
    return index;
  };
  const releases = records.flatMap((record) =>
    (record.accountReinstatements ?? []).map((account) =>
      indexOf(`${account.banEnforcementId}:${account.githubId}`),
    ),
  );
  const bans = records.flatMap((record) =>
    (record.maintainerBans ?? []).map((account) => ({
      account,
      record,
      key: indexOf(`${record.id}:${account.githubId}`),
    })),
  );
  return selectActiveBanIndices(
    keys.size,
    bans.map((ban) => ban.key),
    releases,
  ).map((index) => ({
    account: bans[index].account,
    record: bans[index].record,
  }));
}

export function bannedMaintainerIds(
  records: ProjectEnforcement[],
): Set<string> {
  return new Set(
    activeAccountBans(records).map(({ account }) => account.githubId),
  );
}

/** Current restrictions of every project that is not clear. */
export function activeRestrictions(
  records: ProjectEnforcement[],
): ProjectRestriction[] {
  return [...new Set(records.map((record) => record.projectId))]
    .map((projectId) => projectRestriction(projectId, records))
    .filter((restriction) => restriction.state !== "clear");
}

/** Repository identities a manifest claims: the GitHub id and every path. */
export function repositoryIdentity(manifest: ProjectDefinition): {
  githubId: string;
  keys: string[];
} {
  return {
    githubId: String(manifest.authority.repositoryId),
    keys: [
      ...new Set(
        manifest.repositories.flatMap((repository) =>
          [repository.id, ...(repository.aliases ?? [])].map((path) =>
            path.toLowerCase(),
          ),
        ),
      ),
    ],
  };
}

/** True when both manifests claim the same GitHub id and repository paths. */
export function sameRepositoryIdentity(
  left: ProjectDefinition,
  right: ProjectDefinition,
): boolean {
  const a = repositoryIdentity(left);
  const b = repositoryIdentity(right);
  return (
    a.githubId === b.githubId &&
    a.keys.length === b.keys.length &&
    a.keys.every((key) => b.keys.includes(key))
  );
}

/** The restriction in force on any repository this manifest claims. */
export function restrictionForRepository(
  manifest: ProjectDefinition,
  records: ProjectEnforcement[],
): ProjectRestriction | null {
  const identity = repositoryIdentity(manifest);
  return (
    activeRestrictions(records).find(
      (restriction) =>
        restriction.repositoryGithubId === identity.githubId ||
        restriction.repositoryKeys.some((key) => identity.keys.includes(key)),
    ) ?? null
  );
}

/**
 * The restriction a project's public routes obey: its own, else one in force
 * on a repository it claims. A restriction binds the repository, so another
 * project listed for it earlier closes with it (PRD ADM-06).
 */
export function publicRestrictionOf(
  project: { id: string; manifest: ProjectDefinition },
  records: ProjectEnforcement[],
): ProjectRestriction {
  const own = projectRestriction(project.id, records);
  if (own.state !== "clear") return own;
  const shared = restrictionForRepository(project.manifest, records);
  return shared === null ? own : { ...shared, projectId: project.id };
}

/** A restricted project must stay paused and out of every listing. */
export function enforcedManifest(manifest: ProjectDefinition): boolean {
  return manifest.status === "paused" && manifest.listingTier === "retired";
}

/**
 * A moderator quarantine or ban applies a paused, retired revision. The
 * project stays registered, so what a restriction keeps (existing private
 * cases, Slopbot's security-only review) still applies to it. New private
 * reports stay closed (#1360). The retained before and after revisions must
 * prove that enforcement caused retirement; an owner's earlier retirement or
 * an unapplied restriction cannot. Null means the retained revision evidence
 * is missing.
 */
export async function retiredByRestriction(
  persistence: Pick<ProjectPersistence, "listEnforcements" | "getRevisionText">,
  projectId: string,
): Promise<boolean | null> {
  const restriction = projectRestriction(
    projectId,
    await persistence.listEnforcements(),
  );
  if (restriction.state === "clear") return false;
  for (const record of [...restriction.records].reverse()) {
    if (record.stateAfter === "clear") break;
    if (
      (record.action !== "quarantine" && record.action !== "ban") ||
      record.result !== "revision_appended" ||
      record.afterRevision === null
    )
      continue;
    const [before, after] = await Promise.all([
      persistence.getRevisionText(projectId, record.beforeRevision),
      persistence.getRevisionText(projectId, record.afterRevision),
    ]);
    if (
      before === null ||
      after === null ||
      before.manifestSha256 !== record.beforeManifestSha256 ||
      after.manifestSha256 !== record.afterManifestSha256
    )
      return null;
    const previous = JSON.parse(before.manifestText) as ProjectDefinition;
    const applied = JSON.parse(after.manifestText) as ProjectDefinition;
    if (previous.listingTier !== "retired" && enforcedManifest(applied))
      return true;
  }
  return false;
}

type EnforcementPlan = {
  stateAfter: RestrictionState;
  appealAfter: AppealState;
  /** The manifest the matching revision appends, or null when none is due. */
  manifest: ProjectDefinition | null;
  /** Why a due revision cannot be appended yet. */
  pendingReason: string | null;
  /** The action bans the project's maintainer accounts with the project. */
  bansMaintainer: boolean;
};

function revisionTo(
  current: ProjectDefinition,
  next: ProjectDefinition,
): Pick<EnforcementPlan, "manifest" | "pendingReason"> {
  if (
    current.status === next.status &&
    current.listingTier === next.listingTier
  )
    return { manifest: null, pendingReason: null };
  try {
    assertProjectPolicyTransition(current, next);
  } catch (error) {
    return {
      manifest: null,
      pendingReason:
        error instanceof Error
          ? error.message
          : "The current manifest does not pass validation",
    };
  }
  return { manifest: next, pendingReason: null };
}

/**
 * Validates one action against the current restriction and plans the
 * matching revision. `listedBefore` is the listing tier of the revision the
 * restriction started from; reinstatement never restores more than the
 * community tier.
 */
export function planEnforcement(input: {
  action: EnforcementAction;
  actor: GithubActor;
  actorRole?: EnforcementActorRole;
  project: ProjectRecord;
  restriction: ProjectRestriction;
  listedBefore: boolean;
  responsibleAccounts?: GithubActor[];
}): EnforcementPlan {
  const { actor, project, restriction } = input;
  const manifest = project.manifest;
  const decision = planEnforcementAction({
    action: input.action,
    actorId: actor.githubId,
    actorRole: input.actorRole ?? "",
    hasActorRole: input.actorRole !== undefined,
    state: restriction.state,
    appeal: restriction.appeal,
    records: restrictionHistory(restriction.records),
    restrictedBy: restriction.restrictedBy.map((entry) => entry.githubId),
    bannedAccounts: restriction.bannedMaintainers.map(
      (entry) => entry.githubId,
    ),
    activeBans: activeAccountBans(restriction.records).map(
      ({ account, record }) => ({
        accountId: account.githubId,
        moderator: record.actor
          ? { kind: "actor" as const, id: record.actor.githubId }
          : { kind: "none" as const },
      }),
    ),
    responsibleAccounts: (input.responsibleAccounts ?? []).map(
      (entry) => entry.githubId,
    ),
    manifestStatus: manifest.status,
    manifestTier: manifest.listingTier,
    listedBefore: input.listedBefore,
  });
  if (decision.kind === "refused")
    throw new EnforcementRefusal(
      decision.status,
      decision.code,
      decision.message,
    );
  const revision =
    decision.revision === "retired"
      ? revisionTo(manifest, {
          ...manifest,
          status: "paused",
          listingTier: "retired",
        })
      : decision.revision === "community"
        ? revisionTo(manifest, {
            ...manifest,
            status: "paused",
            listingTier: "community",
          })
        : { manifest: null, pendingReason: null };
  return {
    stateAfter: decision.stateAfter as RestrictionState,
    appealAfter: decision.appealAfter as AppealState,
    bansMaintainer: decision.bansMaintainer,
    ...revision,
  };
}

/** The public reason text of the revision an action appends. */
export function enforcementRevisionReason(
  action: EnforcementAction,
  recordId: string,
): string {
  const label =
    action === "reinstate"
      ? "Reinstated after independent review"
      : action === "ban"
        ? "Banned by a project moderator"
        : "Quarantined by a project moderator";
  return `${label} (${recordId})`;
}

/**
 * Distinct active contributor flags that pause a project (PRD sections 4 and
 * 8). The pause is a standing rule; no moderator approves a flag first.
 */
export const FLAG_PAUSE_THRESHOLD = 2;

/** The rule a signed clean scan cites when it lifts a flag-only pause. */
const SCAN_REINSTATEMENT_RULE = "clean-fresh-scan-after-flags";

/**
 * True when the restriction in force is a quarantine that two contributor
 * flags placed and that no moderator or vetting ban has since escalated.
 * Only such a pause reinstates on a clean fresh scan; a moderator decides
 * every other restriction.
 */
export function pausedByFlagsOnly(restriction: ProjectRestriction): boolean {
  return verifiedPausedByFlagsOnly(
    restrictionHistory(restriction.records),
    restriction.state,
  );
}

/**
 * The signed vetting-service record that lifts a flag-only pause after a
 * clean scan requested after the pause (PRD section 8). It appends no
 * revision: the pause never changed the manifest, so clearing the record
 * restores the project as it was. Returns null when the scan does not
 * qualify, so the caller records only the scan.
 */
export function planScanReinstatement(input: {
  project: ProjectRecord;
  restriction: ProjectRestriction;
  scan: {
    assessmentId: string;
    requestedAt: string;
    contentSha256: string;
    keySha256: string;
    policyVersion: string;
  };
  /** Content digest of the project's current manifest. */
  currentContentSha256: string;
  at: string;
}): ProjectEnforcement | null {
  const { project, restriction, scan } = input;
  const decision = planFlagScanReinstatement(
    restrictionHistory(restriction.records),
    restriction.state,
    restriction.appeal,
    restriction.since === null
      ? { kind: "absent" }
      : { kind: "at", value: restriction.since },
    scan.requestedAt,
    scan.contentSha256,
    input.currentContentSha256,
  );
  if (decision.kind === "unchanged") return null;
  const identity = repositoryIdentity(project.manifest);
  return {
    id: `enf_${scan.assessmentId}_reinstate`,
    projectId: project.id,
    sequence: restriction.nextSequence,
    action: "reinstate",
    stateAfter: decision.stateAfter as RestrictionState,
    appealAfter: decision.appealAfter as AppealState,
    reason:
      "A clean fresh security scan lifted a pause that contributor flags alone placed",
    evidenceReference: scan.assessmentId,
    repositoryGithubId: restriction.repositoryGithubId ?? identity.githubId,
    repositoryKeys: [
      ...new Set([...restriction.repositoryKeys, ...identity.keys]),
    ],
    actor: null,
    actorRole: "vetting-service",
    decisionSource: "standing-rule",
    systemIssuer: {
      kind: "vetting-service",
      keySha256: scan.keySha256,
      assessmentId: scan.assessmentId,
      policyVersion: scan.policyVersion,
      rule: SCAN_REINSTATEMENT_RULE,
    },
    beforeRevision: project.revision,
    beforeManifestSha256: project.manifestSha256,
    afterRevision: null,
    afterManifestSha256: null,
    result: "no_revision_needed",
    createdAt: input.at,
  };
}
