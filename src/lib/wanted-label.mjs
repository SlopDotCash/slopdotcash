/**
 * Wanted issues (operator decision, 21 November 2026; PRD section 5). One
 * standard GitHub label, `slop-wanted`, marks the issues a project's
 * maintainers most want done, so contributors and their agents start there
 * instead of guessing what the codebase needs. Every project uses the same
 * name, so every contributor skill knows it without configuration.
 *
 * A project owner turns it on in project settings (`slopbot.wantedIssues`).
 * Then Slopbot creates the label on each listed repository and the project
 * page lists the labelled open issues from the scheduled read. The generated
 * contributor skill works labelled issues first on any repository. The label
 * is a pointer only: nobody claims or is assigned an issue, and Points, value
 * assessment, scoring and payment never read it.
 */

/** The standard label name. */
export const WANTED_LABEL = "slop-wanted";

/** The most wanted issues the project page lists. */
export const WANTED_ISSUES_SHOWN = 10;

/** Validates `project.slopbot.wantedIssues`. */
export function assertWantedIssues(value, field) {
  if (typeof value !== "boolean")
    throw new TypeError(`${field} must be a boolean`);
}

/** The label to read for a project, or null when the owner has not turned it on. */
export function wantedLabel(project) {
  return project?.slopbot?.wantedIssues === true ? WANTED_LABEL : null;
}
