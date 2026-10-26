/**
 * ADM-06 project enforcement rules. A Quarantine or a Ban takes effect
 * through an append-only record at once; the matching paused, retired
 * revision is appended in the same write when the manifest allows it, and is
 * shown as pending when it does not. A restriction can only restrict: it never
 * creates a project, grants featuring, or enables money. Reinstatement needs
 * an appeal and a moderator who did not place the restriction or file the
 * appeal (ELG-02, PRD section 10). The
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
  GithubActor,
  ProjectEnforcement,
  ProjectRecord,
  RestrictionState,
} from "../../src/lib/project-contracts";
import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";

export const ENFORCEMENT_ACTIONS: readonly EnforcementAction[] = [
  "quarantine",
  "ban",
  "request_reinstatement",
  "reinstate",
  "reinstate_accounts",
  "deny_reinstatement",
];

export class EnforcementRefusal extends Error {
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

/** Folds one project's records, oldest first, into its current restriction. */
export function projectRestriction(
  projectId: string,
  all: ProjectEnforcement[],
): ProjectRestriction {
  const records = all
    .filter((record) => record.projectId === projectId)
    .sort((left, right) => left.sequence - right.sequence);
  const restriction: ProjectRestriction = {
    projectId,
    sourceProjectId: projectId,
    state: "clear",
    appeal: "none",
    since: null,
    restrictedBy: [],
    openedAtRevision: null,
    bannedMaintainers: [],
    repositoryGithubId: null,
    repositoryKeys: [],
    nextSequence: records.length + 1,
    records,
  };
  for (const record of records) {
    if (
      (record.action === "quarantine" || record.action === "ban") &&
      restriction.state === "clear"
    ) {
      restriction.since = record.createdAt;
      restriction.restrictedBy = [];
      restriction.openedAtRevision = record.beforeRevision;
    }
    if (record.action === "quarantine" || record.action === "ban") {
      if (
        record.actor &&
        !restriction.restrictedBy.some(
          (actor) => actor.githubId === record.actor?.githubId,
        )
      )
        restriction.restrictedBy.push(record.actor);
    }
    for (const maintainer of record.maintainerBans ?? [])
      if (
        !restriction.bannedMaintainers.some(
          (banned) => banned.githubId === maintainer.githubId,
        )
      )
        restriction.bannedMaintainers.push(maintainer);
    restriction.state = record.stateAfter;
    restriction.appeal = record.appealAfter;
    restriction.repositoryGithubId = record.repositoryGithubId;
    restriction.repositoryKeys = record.repositoryKeys;
    if (record.stateAfter === "clear") {
      restriction.since = null;
      restriction.restrictedBy = [];
      restriction.openedAtRevision = null;
      restriction.bannedMaintainers = [];
    }
  }
  restriction.bannedMaintainers = activeAccountBans(records).map(
    ({ account }) => account,
  );
  if (
    restriction.appeal !== "requested" &&
    (projectAppealState(restriction) === "requested" ||
      restriction.bannedMaintainers.some(
        (account) =>
          accountAppealState(restriction, account.githubId) === "requested",
      ))
  )
    restriction.appeal = "requested";
  return restriction;
}

/** An account-only appeal does not open or pre-empt the project's appeal. */
export function projectAppealState(
  restriction: ProjectRestriction,
): AppealState {
  if (restriction.state === "clear") return "none";
  return projectAppealOpen(restriction.records) ? "requested" : "none";
}

/** The undecided project appeal, or undefined when none is open. */
function openProjectAppeal(
  records: ProjectEnforcement[],
): ProjectEnforcement | undefined {
  const newestFirst = [...records].reverse();
  const boundary =
    newestFirst.find(
      (record) =>
        // An ordinary ban can retain the pending project appeal. A new
        // malicious result or a decision that closes it starts a new boundary.
        (record.action === "ban" &&
          (record.actorRole === "vetting-service" ||
            record.appealAfter !== "requested")) ||
        ["quarantine", "reinstate", "deny_reinstatement"].includes(
          record.action,
        ),
    )?.sequence ?? 0;
  return newestFirst.find(
    (record) =>
      record.action === "request_reinstatement" &&
      record.actorRole !== "banned-account" &&
      record.sequence > boundary,
  );
}

/** True when records, oldest first, end with an undecided project appeal. */
function projectAppealOpen(records: ProjectEnforcement[]): boolean {
  return openProjectAppeal(records) !== undefined;
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
  const newestFirst = [...restriction.records].reverse();
  const boundary =
    newestFirst.find(
      (record) =>
        (record.action === "ban" &&
          (record.maintainerBans ?? []).some(
            (account) => account.githubId === githubId,
          )) ||
        // A denial decides the open project appeal when there is one, and
        // the account appeals only when there is not (PRD section 8).
        (record.action === "deny_reinstatement" &&
          !projectAppealOpen(
            restriction.records.filter(
              (earlier) => earlier.sequence < record.sequence,
            ),
          )) ||
        (record.action === "reinstate_accounts" &&
          (record.accountReinstatements ?? []).some(
            (account) => account.githubId === githubId,
          )),
    )?.sequence ?? 0;
  const request = newestFirst.find(
    (record) =>
      record.action === "request_reinstatement" &&
      record.actor?.githubId === githubId &&
      record.sequence > boundary,
  );
  return request ? "requested" : "none";
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
  const released = new Set(
    records.flatMap((record) =>
      (record.accountReinstatements ?? []).map(
        (account) => `${account.banEnforcementId}:${account.githubId}`,
      ),
    ),
  );
  return records.flatMap((record) =>
    (record.maintainerBans ?? [])
      .filter((account) => !released.has(`${record.id}:${account.githubId}`))
      .map((account) => ({ account, record })),
  );
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

export type EnforcementPlan = {
  stateAfter: RestrictionState;
  appealAfter: AppealState;
  /** The manifest the matching revision appends, or null when none is due. */
  manifest: ProjectDefinition | null;
  /** Why a due revision cannot be appended yet. */
  pendingReason: string | null;
  /** The action bans the project's maintainer accounts with the project. */
  bansMaintainer: boolean;
};

function refuse(code: string, message: string): never {
  throw new EnforcementRefusal(409, code, message);
}

function requireIndependentModerator(
  restriction: ProjectRestriction,
  actor: GithubActor,
  granting = false,
): void {
  const appellant = granting
    ? openProjectAppeal(restriction.records)?.actor
    : undefined;
  if (
    restriction.restrictedBy.some(
      (placed) => placed.githubId === actor.githubId,
    ) ||
    appellant?.githubId === actor.githubId
  )
    throw new EnforcementRefusal(
      403,
      "independent_review_required",
      "A moderator who did not place this restriction must decide the appeal",
    );
}

/**
 * A decision on account appeals needs a moderator who did not ban any of the
 * accounts it decides and is not one of them (ELG-02). Releases, denials and
 * malicious-result bans use this one rule; the 0072 trigger repeats the ban
 * half for each release.
 */
function requireIndependentAccountModerator(
  restriction: ProjectRestriction,
  actor: GithubActor,
  accountGithubIds: ReadonlySet<string>,
): void {
  if (
    accountGithubIds.has(actor.githubId) ||
    activeAccountBans(restriction.records).some(
      ({ account, record }) =>
        accountGithubIds.has(account.githubId) &&
        record.actor?.githubId === actor.githubId,
    )
  )
    throw new EnforcementRefusal(
      403,
      "independent_review_required",
      "A moderator who did not ban this account must decide its appeal.",
    );
}

/** Accounts among `accounts` whose own appeal is open. */
function openAccountAppeals(
  restriction: ProjectRestriction,
  accounts: readonly GithubActor[],
): Set<string> {
  return new Set(
    accounts
      .filter(
        (account) =>
          accountAppealState(restriction, account.githubId) === "requested",
      )
      .map((account) => account.githubId),
  );
}

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
  project: ProjectRecord;
  restriction: ProjectRestriction;
  listedBefore: boolean;
  responsibleAccounts?: GithubActor[];
}): EnforcementPlan {
  const { action, actor, project, restriction } = input;
  const manifest = project.manifest;
  const deciding = awaitsMaliciousDecision(restriction);
  switch (action) {
    case "quarantine":
    case "ban": {
      if (action === "quarantine" && restriction.state !== "clear")
        refuse(
          "already_restricted",
          `The project is already ${restriction.state}`,
        );
      if (action === "ban" && restriction.state === "banned" && !deciding)
        refuse("already_restricted", "The project is already banned");
      // Deciding a confirmed malicious result bans the maintainer too. It
      // closes the open project appeal, or the appeal that the result kept
      // when no account appeal is open, and the open appeal of each account
      // it bans again. Each appeal it closes needs its own independence.
      const closesProjectAppeal =
        deciding &&
        restriction.appeal === "requested" &&
        (projectAppealState(restriction) === "requested" ||
          openAccountAppeals(restriction, restriction.bannedMaintainers)
            .size === 0);
      const reBanned = deciding
        ? openAccountAppeals(restriction, input.responsibleAccounts ?? [])
        : new Set<string>();
      if (closesProjectAppeal) requireIndependentModerator(restriction, actor);
      requireIndependentAccountModerator(restriction, actor, reBanned);
      return {
        stateAfter: action === "ban" ? "banned" : "quarantined",
        // An escalation, or a decision that closes no appeal, keeps the open
        // account appeals open for independent review.
        appealAfter:
          restriction.appeal !== "requested"
            ? "none"
            : closesProjectAppeal || reBanned.size > 0
              ? "denied"
              : "requested",
        bansMaintainer: deciding,
        ...revisionTo(manifest, {
          ...manifest,
          status: "paused",
          listingTier: "retired",
        }),
      };
    }
    case "request_reinstatement": {
      const isBannedActor = restriction.bannedMaintainers.some(
        (account) => account.githubId === actor.githubId,
      );
      if (restriction.state === "clear" && !isBannedActor)
        refuse("not_restricted", "The project has no restriction to appeal");
      if (
        isBannedActor
          ? accountAppealState(restriction, actor.githubId) === "requested"
          : projectAppealState(restriction) === "requested"
      )
        refuse("appeal_open", "A reinstatement request is already open");
      return {
        stateAfter: restriction.state,
        appealAfter: "requested",
        manifest: null,
        pendingReason: null,
        bansMaintainer: false,
      };
    }
    case "reinstate_accounts": {
      if (
        restriction.appeal !== "requested" ||
        restriction.bannedMaintainers.length === 0
      )
        refuse(
          "no_open_appeal",
          "Record an appeal before reinstating an account",
        );
      const selected = input.responsibleAccounts ?? [];
      if (
        projectAppealState(restriction) !== "requested" &&
        selected.some(
          (account) =>
            restriction.bannedMaintainers.some(
              (banned) => banned.githubId === account.githubId,
            ) &&
            accountAppealState(restriction, account.githubId) !== "requested",
        )
      )
        refuse(
          "no_open_appeal",
          "Record an appeal before reinstating an account",
        );
      const releasedIds = new Set(selected.map((account) => account.githubId));
      requireIndependentAccountModerator(restriction, actor, releasedIds);
      const appealStillOpen =
        projectAppealState(restriction) === "requested" ||
        restriction.bannedMaintainers.some(
          (account) =>
            !releasedIds.has(account.githubId) &&
            accountAppealState(restriction, account.githubId) === "requested",
        );
      return {
        stateAfter: restriction.state,
        appealAfter: appealStillOpen ? "requested" : "granted",
        manifest: null,
        pendingReason: null,
        bansMaintainer: false,
      };
    }
    case "reinstate":
    case "deny_reinstatement": {
      // An account-only appeal cannot authorize project reinstatement.
      const projectAppeal = projectAppealState(restriction);
      const appeal =
        action === "reinstate" ? projectAppeal : restriction.appeal;
      if (restriction.state === "clear" || appeal !== "requested")
        refuse(
          "no_open_appeal",
          "Record a reinstatement request before a decision",
        );
      // A denial with no open project appeal decides the open account
      // appeals, so it needs independence from those account bans instead.
      if (action === "reinstate" || projectAppeal === "requested")
        requireIndependentModerator(restriction, actor, action === "reinstate");
      else
        requireIndependentAccountModerator(
          restriction,
          actor,
          openAccountAppeals(restriction, restriction.bannedMaintainers),
        );
      if (action === "deny_reinstatement") {
        if (deciding)
          refuse(
            "malicious_decision_required",
            "A confirmed malicious result needs a decision: ban the project and its maintainer, or reinstate it",
          );
        return {
          stateAfter: restriction.state,
          appealAfter: "denied",
          manifest: null,
          pendingReason: null,
          bansMaintainer: false,
        };
      }
      // A restriction whose paused, retired revision is still pending must
      // not clear: clearing it would restore the listed or active manifest.
      if (!enforcedManifest(manifest))
        refuse(
          "revision_pending",
          "Append the paused, retired revision of this restriction before reinstatement",
        );
      // Reinstatement lists the project again only if the restriction found
      // it listed, never above the community tier, and always paused.
      return {
        stateAfter: "clear",
        appealAfter: "granted",
        bansMaintainer: false,
        ...(input.listedBefore && manifest.listingTier === "retired"
          ? revisionTo(manifest, {
              ...manifest,
              status: "paused",
              listingTier: "community",
            })
          : { manifest: null, pendingReason: null }),
      };
    }
  }
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
  if (restriction.state !== "quarantined") return false;
  for (let index = restriction.records.length - 1; index >= 0; index -= 1) {
    const record = restriction.records[index];
    if (record.action === "quarantine" || record.action === "ban")
      return record.actorRole === "contributor-flags";
  }
  return false;
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
  if (!pausedByFlagsOnly(restriction) || restriction.since === null)
    return null;
  // A scan queued before the pause cannot speak to what the flags reported,
  // and a scan of other content does not describe the project now. The
  // pause request itself queues its scan, at or after the pause time.
  if (
    scan.requestedAt < restriction.since ||
    scan.contentSha256 !== input.currentContentSha256
  )
    return null;
  const identity = repositoryIdentity(project.manifest);
  return {
    id: `enf_${scan.assessmentId}_reinstate`,
    projectId: project.id,
    sequence: restriction.nextSequence,
    action: "reinstate",
    stateAfter: "clear",
    appealAfter: restriction.appeal === "requested" ? "granted" : "none",
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
