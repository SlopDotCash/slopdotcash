/**
 * Self-service project setup (PRD section 4, owner decisions of 22 and 24
 * October 2026). A project starts without routine admin approval once
 * Slopbot is installed on the repository, the installation reads write,
 * maintain or admin access for its owner, and a security scan of the exact
 * revision is clean. This module derives the one
 * setup status an owner sees, and the checks behind it. Funding is reported
 * separately because a project works without it.
 */
import type {
  GithubActor,
  ProjectRecord,
  ProjectSetupStatus,
  RepositoryAccess,
  SetupAuthority,
  SetupNextAction,
} from "../../src/lib/project-contracts";
import {
  parseRepositoryIdentity,
  SLOPBOT_INSTALL_URL,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import type { ProjectRestriction } from "./enforcement";

/**
 * Reads the Slopbot installation and the account's repository permission
 * through the Slopbot GitHub App. Throws when the answer is unavailable.
 */
export type RepositoryAccessReader = (
  repository: { path: string; githubId: string },
  actor: GithubActor,
) => Promise<RepositoryAccess>;

export type ScanRequest =
  | { state: "queued" | "already_queued" }
  | { state: "unavailable"; message: string };

/** Queues a malicious-code scan of the project's current revision. */
export type ScanRequester = (
  project: ProjectRecord,
  actor: GithubActor,
  reason: string,
) => Promise<ScanRequest>;

export type AccessCheck =
  | { state: "read"; access: RepositoryAccess }
  | { state: "retry"; message: string };

const GITHUB_PERMISSIONS = new Set(["admin", "write", "read", "none"]);

/** Strictly parses the Slopbot repository-access answer. */
export function parseRepositoryAccess(value: unknown): RepositoryAccess {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Repository access is not an object");
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort().join(",");
  if (body.installation === "missing" && keys === "installation")
    return { installation: "missing" };
  const installationId = body.installationId;
  if (
    typeof installationId !== "number" ||
    !Number.isSafeInteger(installationId) ||
    installationId < 1
  )
    throw new TypeError("Repository access has no installation id");
  if (
    body.installation === "suspended" &&
    keys === "installation,installationId"
  )
    return { installation: "suspended", installationId };
  if (
    body.installation === "installed" &&
    (keys === "installation,installationId,permission,roleName" ||
      keys === "installation,installationId,permission,repository,roleName") &&
    typeof body.permission === "string" &&
    GITHUB_PERMISSIONS.has(body.permission) &&
    (body.roleName === null ||
      (typeof body.roleName === "string" &&
        /^[A-Za-z0-9 _-]{1,64}$/u.test(body.roleName)))
  )
    return {
      installation: "installed",
      installationId,
      permission: body.permission as "admin" | "write" | "read" | "none",
      roleName: body.roleName as string | null,
      ...(body.repository === undefined
        ? {}
        : { repository: parseRepositoryIdentity(body.repository) }),
    };
  throw new TypeError("Repository access is malformed");
}

/** Reads repository access; an unavailable reader means retry, never denial. */
export async function readRepositoryAccess(
  reader: RepositoryAccessReader | undefined,
  manifest: ProjectDefinition,
  actor: GithubActor,
): Promise<AccessCheck> {
  if (reader === undefined)
    return {
      state: "retry",
      message:
        "Slop cannot reach Slopbot to check the installation right now. Try again later.",
    };
  try {
    return {
      state: "read",
      access: await reader(
        {
          path: manifest.repositories[0].id,
          githubId: manifest.authority.repositoryId,
        },
        actor,
      ),
    };
  } catch {
    return {
      state: "retry",
      message:
        "GitHub or Slopbot did not answer the installation check. Try again.",
    };
  }
}

/** GitHub maps maintain to write; admin includes it. */
function writes(access: RepositoryAccess): boolean {
  return (
    access.installation === "installed" &&
    (access.permission === "admin" || access.permission === "write")
  );
}

/**
 * Current authority of `actor` over the project's repository. The Slopbot
 * installation read is the one authority path (owner decision D11 of 24
 * October 2026): it reads the exact repository permission, and write,
 * maintain or admin access is required. Without an installation, authority
 * cannot be read, so the account cannot create, edit or activate a project.
 */
export function setupAuthority(
  access: AccessCheck,
  actor: GithubActor,
  repository: string,
): SetupAuthority {
  if (access.state === "retry")
    return { state: "retry", message: access.message };
  if (access.access.installation !== "installed")
    return {
      state: "denied",
      message: `Slop reads your access to ${repository} through Slopbot. Install Slopbot on ${repository}, then try again.`,
    };
  if (writes(access.access))
    return {
      state: "verified",
      message: `@${actor.githubLogin} has ${access.access.roleName ?? access.access.permission} access to ${repository}.`,
    };
  return {
    state: "denied",
    message: `@${actor.githubLogin} has ${access.access.permission} access to ${repository}. Write, maintain or admin access is required. Ask a maintainer with that access to finish setup.`,
  };
}

/** An unavailable installation cannot prove that a flagger is not a maintainer. */
export function flaggerAuthority(
  access: AccessCheck,
  actor: GithubActor,
  repository: string,
): SetupAuthority {
  if (access.state === "read" && access.access.installation !== "installed")
    return {
      state: "retry",
      message:
        "Slopbot must be available to check current repository permission.",
    };
  return setupAuthority(access, actor, repository);
}

/** The funding summary, separate from readiness. */
export function setupFunding(
  manifest: ProjectDefinition,
): ProjectSetupStatus["funding"] {
  const reward = manifest.reward;
  if (reward.kind !== "monthly-pool" || BigInt(reward.monthlyCapMinor) === 0n)
    return { mode: "none" };
  return {
    mode: "monthly",
    network: String(reward.chain),
    symbol: String(reward.currency),
    monthlyAmountMinor: reward.monthlyCapMinor,
    // Without a reward asset the pool is a reviewed 6-decimal stablecoin.
    decimals: manifest.rewardAsset?.decimals ?? 6,
    state: reward.fundingState === "committed" ? "committed" : "pledged",
    payments: reward.paymentMode,
  };
}

type ScanState = ProjectSetupStatus["checks"]["scan"];

function scanCheck(
  clearance: VettingClearance | { state: "unavailable"; message: string },
): ScanState {
  switch (clearance.state) {
    case "cleared":
      return clearance.assessment === null
        ? {
            state: "cleared",
            exempt: true,
            message:
              "Existing project, permanently exempt from scan clearance.",
          }
        : {
            state: "cleared",
            message: "The security scan of this revision is clean.",
          };
    case "queued":
      return {
        state: "queued",
        message: "The security scan is queued. Nothing is needed from you.",
      };
    case "unscanned":
      return {
        state: "unscanned",
        message: "This revision has not been scanned yet.",
      };
    case "stale":
      return {
        state: "stale",
        message:
          "The integration branch or the skill template changed after the last scan, so a new scan is needed.",
      };
    case "quarantined":
      return {
        state: "quarantined",
        message:
          "The last scan could not finish, so it did not clear the project.",
      };
    case "banned":
      return {
        state: "banned",
        message: "A confirmed malicious finding blocks this project.",
      };
    case "unverified":
      return { state: "unverified", message: clearance.reason };
    case "unavailable":
      return { state: "unavailable", message: clearance.message };
  }
}

/**
 * Builds the one status an owner sees. The next action is the first unmet
 * check in setup order: Slopbot installation, authority, then the scan.
 */
export function projectSetupStatus(input: {
  project: ProjectRecord;
  restriction: ProjectRestriction;
  authority: SetupAuthority;
  access: AccessCheck;
  clearance: VettingClearance | { state: "unavailable"; message: string };
  scanRequest: ScanRequest | null;
  activatedRevision: number | null;
  checkedAt: string;
}): ProjectSetupStatus {
  const { project, restriction, authority, access } = input;
  const manifest = project.manifest;
  const repository = manifest.repositories[0].id;
  const installation: ProjectSetupStatus["checks"]["installation"] =
    access.state === "retry"
      ? { state: "retry", message: access.message }
      : access.access.installation === "installed"
        ? {
            state: "installed",
            message: `Slopbot is installed on ${repository}.`,
          }
        : access.access.installation === "suspended"
          ? {
              state: "suspended",
              message: `The Slopbot installation for ${repository} is suspended on GitHub.`,
            }
          : {
              state: "missing",
              message: `Slopbot is not installed on ${repository}.`,
            };
  let scan = scanCheck(input.clearance);
  const queuedNow =
    input.scanRequest?.state === "queued" ||
    input.scanRequest?.state === "already_queued";
  if (queuedNow && scan.state !== "cleared" && scan.state !== "banned")
    scan = {
      state: "queued",
      message: "The security scan is queued. Nothing is needed from you.",
    };
  else if (input.scanRequest?.state === "unavailable")
    scan = { state: "unavailable", message: input.scanRequest.message };
  const action = (
    kind: SetupNextAction,
    message: string,
    href: string | null = null,
  ) => ({ kind, message, href });
  let state: ProjectSetupStatus["state"];
  let nextAction: ProjectSetupStatus["nextAction"];
  if (
    restriction.state !== "clear" ||
    scan.state === "banned" ||
    manifest.listingTier === "retired"
  ) {
    state = "restricted";
    nextAction = action(
      "restricted",
      restriction.state !== "clear" || scan.state === "banned"
        ? `This project is ${restriction.state === "clear" ? "banned" : restriction.state}. Contributor work is closed. The steward or the account that created the project may request reinstatement.`
        : "This project is delisted. Its history stays public.",
    );
  } else if (installation.state === "retry") {
    state = "retry";
    nextAction = action("retry_installation", installation.message);
  } else if (installation.state !== "installed") {
    state = "action_required";
    nextAction = action(
      "install_slopbot",
      `${installation.message} Install it on this repository; Slopbot is free, and Slop reads your access through it.`,
      SLOPBOT_INSTALL_URL,
    );
  } else if (authority.state === "retry") {
    state = "retry";
    nextAction = action("retry_authority", authority.message);
  } else if (authority.state === "denied") {
    state = "action_required";
    nextAction = action("ask_maintainer", authority.message);
  } else if (scan.state === "cleared" && project.status === "active") {
    state = "ready";
    nextAction = action(
      "none",
      "Ready. Contributors can find this project and its skills.",
    );
  } else if (scan.state === "queued") {
    state = "waiting";
    nextAction = action("wait_for_scan", scan.message);
  } else if (scan.state === "quarantined") {
    state = "action_required";
    nextAction = action(
      "request_scan",
      `${scan.message} Fix the cause if you know it, then request a new scan.`,
    );
  } else {
    state = "retry";
    nextAction = action(
      "retry_scan",
      scan.state === "unavailable" || scan.state === "unverified"
        ? scan.message
        : `${scan.message} Check again to queue it.`,
    );
  }
  return {
    projectId: project.id,
    name: manifest.name,
    slug: manifest.slug,
    revision: project.revision,
    status: project.status,
    state,
    nextAction,
    checks: { authority, installation, scan },
    funding: setupFunding(manifest),
    activatedRevision: input.activatedRevision,
    checkedAt: input.checkedAt,
  };
}
