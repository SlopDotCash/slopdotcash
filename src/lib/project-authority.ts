/** Private activation and live-drift contracts; operator rows are never public. */

export type ProjectOperatorRole = "owner" | "editor" | "settler";

export interface PrivateProjectOperator {
  actorId: string;
  roles: ProjectOperatorRole[];
}

const SHA256 = /^[0-9a-f]{64}$/u;
const NUMERIC_ID = /^[1-9]\d*$/u;

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], path: string) {
  if (Object.keys(value).sort().join("\0") !== keys.sort().join("\0")) {
    throw new TypeError(`${path} has unexpected or missing fields`);
  }
}

/** Validates private control-plane rows without exposing them in a manifest. */
export function assertPrivateProjectOperators(
  value: unknown,
): PrivateProjectOperator[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new TypeError("projectOperators must contain 1 to 100 rows");
  }
  const actors = new Set<string>();
  const rows = value.map((entry, index) => {
    const row = object(entry, `projectOperators[${index}]`);
    exact(row, ["actorId", "roles"], `projectOperators[${index}]`);
    if (typeof row.actorId !== "string" || !NUMERIC_ID.test(row.actorId)) {
      throw new TypeError(`projectOperators[${index}].actorId is invalid`);
    }
    if (actors.has(row.actorId)) {
      throw new TypeError("projectOperators contains a duplicate actor");
    }
    actors.add(row.actorId);
    if (
      !Array.isArray(row.roles) ||
      row.roles.length === 0 ||
      new Set(row.roles).size !== row.roles.length ||
      row.roles.some(
        (role) => !["owner", "editor", "settler"].includes(String(role)),
      )
    ) {
      throw new TypeError(`projectOperators[${index}].roles is invalid`);
    }
    return row as unknown as PrivateProjectOperator;
  });
  if (!rows.some((row) => row.roles.includes("owner"))) {
    throw new TypeError("projectOperators requires an owner");
  }
  return rows;
}

export interface AuthorityObservation {
  repositoryId: string;
  repositoryFullName: string;
  integrationBranch: string;
  proofPresent: boolean;
  proofFileSha256: string | null;
  licenseSha256: string;
  inboundTermsSha256: string | null;
  prizeRulesSha256: string | null;
}

/** Returns fail-closed reasons that pause management and every new run. */
export function authorityDriftReasons(
  pinnedValue: unknown,
  observedValue: unknown,
): string[] {
  const pinned = validateObservation(pinnedValue, "pinned");
  const observed = validateObservation(observedValue, "observed");
  const reasons: string[] = [];
  if (
    pinned.repositoryId !== observed.repositoryId ||
    pinned.repositoryFullName.toLowerCase() !==
      observed.repositoryFullName.toLowerCase()
  ) {
    reasons.push("repository-transfer-or-rename");
  }
  if (pinned.integrationBranch !== observed.integrationBranch) {
    reasons.push("integration-branch-drift");
  }
  if (!observed.proofPresent) reasons.push("proof-removed");
  for (const [name, before, after] of [
    ["proof", pinned.proofFileSha256, observed.proofFileSha256],
    ["license", pinned.licenseSha256, observed.licenseSha256],
    ["inbound-terms", pinned.inboundTermsSha256, observed.inboundTermsSha256],
    ["prize-rules", pinned.prizeRulesSha256, observed.prizeRulesSha256],
  ] as const) {
    if (before !== after) reasons.push(`${name}-drift`);
  }
  return reasons;
}

function validateObservation(
  value: unknown,
  path: string,
): AuthorityObservation {
  const entry = object(value, path);
  exact(
    entry,
    [
      "inboundTermsSha256",
      "integrationBranch",
      "licenseSha256",
      "prizeRulesSha256",
      "proofFileSha256",
      "proofPresent",
      "repositoryFullName",
      "repositoryId",
    ],
    path,
  );
  if (
    typeof entry.repositoryId !== "string" ||
    !NUMERIC_ID.test(entry.repositoryId)
  ) {
    throw new TypeError(`${path}.repositoryId is invalid`);
  }
  if (
    typeof entry.repositoryFullName !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(entry.repositoryFullName) ||
    typeof entry.integrationBranch !== "string" ||
    entry.integrationBranch.length === 0 ||
    typeof entry.proofPresent !== "boolean"
  ) {
    throw new TypeError(`${path} repository observation is invalid`);
  }
  for (const name of [
    "proofFileSha256",
    "licenseSha256",
    "inboundTermsSha256",
    "prizeRulesSha256",
  ] as const) {
    if (
      entry[name] !== null &&
      (typeof entry[name] !== "string" || !SHA256.test(entry[name]))
    ) {
      throw new TypeError(`${path}.${name} is invalid`);
    }
  }
  if (entry.proofPresent !== (entry.proofFileSha256 !== null)) {
    throw new TypeError(`${path} proof presence is inconsistent`);
  }
  return entry as unknown as AuthorityObservation;
}
