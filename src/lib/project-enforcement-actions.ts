/**
 * The enforcement actions the admin panel offers for one project row (PRD
 * ADM-06). Quarantine and ban act on the project itself; every other action
 * decides the restriction in force. A restriction recorded on another
 * project that claims the same repository is inherited: its appeal and
 * reinstatement decisions belong to that project, so this row offers only
 * the actions on the project itself — and none at all when the inherited
 * restriction leaves no such action.
 */

import type {
  EnforcementAction,
  ProjectEnforcementState,
} from "./project-contracts";

/** Actions that decide the restriction in force, not the project itself. */
const RESTRICTION_ACTIONS: readonly EnforcementAction[] = [
  "request_reinstatement",
  "reinstate",
  "reinstate_accounts",
  "deny_reinstatement",
];

export function availableActions(
  projectId: string,
  enforcement: ProjectEnforcementState,
): EnforcementAction[] {
  const projectAppeal = enforcement.projectAppeal === "requested";
  const accountActions: EnforcementAction[] =
    enforcement.bannedMaintainers.length > 0
      ? enforcement.appeal === "requested"
        ? ["reinstate_accounts"]
        : ["request_reinstatement"]
      : [];
  let actions: EnforcementAction[];
  if (enforcement.state === "clear")
    actions = [...accountActions, "quarantine", "ban"];
  else if (enforcement.decisionRequired)
    actions = projectAppeal
      ? ["ban", "reinstate"]
      : ["ban", "request_reinstatement"];
  else {
    const escalate: EnforcementAction[] =
      enforcement.state === "quarantined" ? ["ban"] : [];
    const projectActions: EnforcementAction[] = projectAppeal
      ? ["reinstate"]
      : ["request_reinstatement"];
    if (enforcement.appeal === "requested")
      projectActions.push("deny_reinstatement");
    actions = [...new Set([...accountActions, ...escalate, ...projectActions])];
  }
  // The restriction in force is recorded on another project: withhold the
  // actions that would post against this row's own records and fail there.
  if (
    enforcement.sourceProjectId !== undefined &&
    enforcement.sourceProjectId !== projectId
  )
    return actions.filter((action) => !RESTRICTION_ACTIONS.includes(action));
  return actions;
}
