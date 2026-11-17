// spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/security/enforcement.md, "The steward, the listing account, a banned account or a moderator files one open project appeal"
import type { StatusProps } from "@repo/ui";
import type { Enforcement } from "./projects.ts";

type Presentation = StatusProps["presentation"];

export type EnforcementAction = "quarantine" | "ban" | "request_reinstatement" | "reinstate" | "reinstate_accounts" | "deny_reinstatement";

const actionLabels: Readonly<Record<EnforcementAction, string>> = {
  quarantine: "Quarantine",
  ban: "Ban project",
  request_reinstatement: "Request reinstatement",
  reinstate: "Reinstate after review",
  reinstate_accounts: "Reinstate selected accounts",
  deny_reinstatement: "Deny reinstatement",
};

const resultLabels: Readonly<Record<string, string>> = {
  revision_appended: "Appends the matching revision",
  revision_pending: "Revision pending",
  no_revision_needed: "No revision needed",
};

const appealLabels: Readonly<Record<string, string>> = {
  requested: "Reinstatement requested",
  granted: "Last appeal granted",
  denied: "Last appeal denied",
};

/** @throws {never} */
export function isEnforcementAction(value: string): value is EnforcementAction {
  return Object.hasOwn(actionLabels, value);
}

/** The decision on a confirmed malicious result also bans the maintainer. @throws {never} */
export function actionLabel(action: string, decision: boolean): string {
  if (!isEnforcementAction(action)) return action;
  return action === "ban" && decision ? "Ban project and maintainer" : actionLabels[action];
}

/** @throws {never} */
export function resultLabel(result: string): string {
  return resultLabels[result] ?? result;
}

/** @throws {never} */
export function appealLabel(appeal: string): string {
  return appealLabels[appeal] ?? appeal;
}

/** @throws {never} */
export function stateLabel(state: string): string {
  return state === "clear" ? "No restriction" : state === "quarantined" ? "Quarantined" : "Banned";
}

/** @throws {never} */
export function restrictionPresentation(state: string): Presentation {
  return state === "clear" ? { tone: "Positive", icon: "Check", label: stateLabel(state) } : { tone: state === "banned" ? "Negative" : "Caution", icon: state === "banned" ? "Ban" : "Alert", label: stateLabel(state) };
}

/** The actions a moderator may preview for this restriction; the server decides each one. @throws {never} */
export function availableActions(enforcement: Enforcement): ReadonlyArray<EnforcementAction> {
  const projectAppeal = enforcement.projectAppeal === "requested";
  const accountActions: ReadonlyArray<EnforcementAction> = enforcement.bannedMaintainers.length > 0 ? (enforcement.appeal === "requested" ? ["reinstate_accounts"] : ["request_reinstatement"]) : [];
  if (enforcement.state === "clear") return [...accountActions, "quarantine", "ban"];
  if (enforcement.decisionRequired) return projectAppeal ? ["ban", "reinstate"] : ["ban", "request_reinstatement"];
  const escalate: ReadonlyArray<EnforcementAction> = enforcement.state === "quarantined" ? ["ban"] : [];
  const projectActions: ReadonlyArray<EnforcementAction> = [projectAppeal ? "reinstate" : "request_reinstatement", ...(enforcement.appeal === "requested" ? (["deny_reinstatement"] as const) : [])];
  return [...new Set([...accountActions, ...escalate, ...projectActions])];
}

/** Whether the action names the accounts it bans or reinstates. @throws {never} */
export function namesAccounts(action: EnforcementAction, decisionRequired: boolean): boolean {
  return (action === "ban" && decisionRequired) || action === "reinstate_accounts";
}

/** @throws {never} */
export function isWebLink(reference: string): boolean {
  return /^https?:\/\//iu.test(reference);
}
