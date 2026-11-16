/**
 * The slopbot:ready label settings (operator decision, 16 November 2026;
 * PRD section 5). A project owner turns the label on in project settings and
 * may require more approvals, set a smaller or larger size cap within the
 * bounds below, and add protected paths. The default protected set in
 * `workers/slopbot/ready-label.ts` always applies and cannot be shrunk.
 * Absent settings mean the label is off.
 */

export const READY_LABEL_LIMITS = Object.freeze({
  minApprovals: 1,
  maxApprovals: 10,
  minChangedLines: 1,
  maxChangedLines: 5000,
  minChangedFiles: 1,
  maxChangedFiles: 300,
  maxProtectedPaths: 50,
  maxProtectedPathLength: 200,
});

export const READY_LABEL_DEFAULTS = Object.freeze({
  approvals: 1,
  maxChangedLines: 400,
  maxChangedFiles: 20,
});

/** A repository-relative glob: letters, digits, `._-/*@+`, no `..` segment. */
const PATTERN = /^[A-Za-z0-9._\-/*@+]+$/u;

/** The reason a protected-path pattern is unusable, or null when it is valid. */
export function protectedPathProblem(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0)
    return "Enter a path.";
  if (pattern.length > READY_LABEL_LIMITS.maxProtectedPathLength)
    return `Use at most ${READY_LABEL_LIMITS.maxProtectedPathLength} characters.`;
  if (!PATTERN.test(pattern))
    return "Use letters, digits, '.', '_', '-', '/', '*', '@' or '+' only.";
  if (pattern.startsWith("/") || pattern.includes("//"))
    return "Write the path relative to the repository root.";
  if (pattern.split("/").some((segment) => segment === ".." || segment === "."))
    return "Do not use '.' or '..' segments.";
  if (/\*{3,}/u.test(pattern)) return "Use '*' or '**' only.";
  return null;
}

function integer(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(
      `${field} must be a whole number from ${min} to ${max}`,
    );
}

/** Validates `project.slopbot.readyLabel`; every field is required. */
export function assertReadyLabelSettings(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !== "approvals,enabled,maxChangedFiles,maxChangedLines,protectedPaths"
  )
    throw new TypeError(`${field} has unexpected or missing fields`);
  if (typeof value.enabled !== "boolean")
    throw new TypeError(`${field}.enabled must be a boolean`);
  const limits = READY_LABEL_LIMITS;
  integer(
    value.approvals,
    `${field}.approvals`,
    limits.minApprovals,
    limits.maxApprovals,
  );
  integer(
    value.maxChangedLines,
    `${field}.maxChangedLines`,
    limits.minChangedLines,
    limits.maxChangedLines,
  );
  integer(
    value.maxChangedFiles,
    `${field}.maxChangedFiles`,
    limits.minChangedFiles,
    limits.maxChangedFiles,
  );
  if (
    !Array.isArray(value.protectedPaths) ||
    value.protectedPaths.length > limits.maxProtectedPaths
  )
    throw new TypeError(
      `${field}.protectedPaths must list at most ${limits.maxProtectedPaths} paths`,
    );
  const seen = new Set();
  for (const pattern of value.protectedPaths) {
    const problem = protectedPathProblem(pattern);
    if (problem !== null)
      throw new TypeError(
        `${field}.protectedPaths entry is invalid: ${problem}`,
      );
    if (seen.has(pattern))
      throw new TypeError(`${field}.protectedPaths repeats ${pattern}`);
    seen.add(pattern);
  }
}

/** The effective settings of a project manifest; null means the label is off. */
export function readyLabelSettings(project) {
  const settings = project?.slopbot?.readyLabel;
  return settings?.enabled === true ? settings : null;
}
