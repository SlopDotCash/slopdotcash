//@ backend dafny
// spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"

export type SetupText = { kind: "other" } | { kind: "text"; value: string };
export type SetupId = { kind: "invalid" } | { kind: "id"; value: number };
export type SetupRole = { kind: "invalid" } | { kind: "none" } | { kind: "role"; value: string };

export type AccessHeader =
  | { kind: "bad-id" }
  | { kind: "malformed" }
  | { kind: "missing" }
  | { kind: "suspended"; id: number }
  | { kind: "installed"; id: number; permission: string; role: SetupRole };

export type AuthorityAccess =
  | { kind: "retry"; message: string }
  | { kind: "read"; installation: string; permission: string; role: SetupRole };

export type AuthorityDecision =
  | { state: "verified"; message: string }
  | { state: "denied"; message: string }
  | { state: "retry"; message: string };

/** @throws {never} */
export function knownPermission(permission: string): boolean {
  //@ ensures \result === (permission === "admin" || permission === "write" || permission === "read" || permission === "none")
  return permission === "admin" || permission === "write" || permission === "read" || permission === "none";
}

/** @throws {never} */
export function classifyAccessHeader(keys: string, installation: SetupText, id: SetupId, permission: SetupText, role: SetupRole): AccessHeader {
  //@ ensures (\result.kind === "missing") === (installation.kind === "text" && installation.value === "missing" && keys === "installation")
  //@ ensures \result.kind === "installed" ==> knownPermission(\result.permission) && \result.role.kind !== "invalid"
  //@ ensures \result.kind === "installed" ==> id.kind === "id" && \result.id === id.value
  //@ ensures \result.kind === "suspended" ==> id.kind === "id" && \result.id === id.value
  if (installation.kind === "text" && installation.value === "missing" && keys === "installation") return { kind: "missing" };
  if (id.kind === "invalid") return { kind: "bad-id" };
  if (installation.kind === "text" && installation.value === "suspended" && keys === "installation,installationId") return { kind: "suspended", id: id.value };
  if (
    installation.kind === "text" &&
    installation.value === "installed" &&
    (keys === "installation,installationId,permission,roleName" || keys === "installation,installationId,permission,repository,roleName") &&
    permission.kind === "text" &&
    knownPermission(permission.value) &&
    role.kind !== "invalid"
  )
    return { kind: "installed", id: id.value, permission: permission.value, role };
  return { kind: "malformed" };
}

/** @throws {never} */
export function grantsAuthority(access: AuthorityAccess): boolean {
  //@ ensures \result === (access.kind === "read" && access.installation === "installed" && (access.permission === "admin" || access.permission === "write"))
  return access.kind === "read" && access.installation === "installed" && (access.permission === "admin" || access.permission === "write");
}

/** @throws {never} */
export function decideSetupAuthority(access: AuthorityAccess, actorLogin: string, repository: string, installationMessage: string, flagger: boolean): AuthorityDecision {
  //@ ensures (\result.state === "verified") === grantsAuthority(access)
  //@ ensures (\result.state === "retry") === (access.kind === "retry" || (flagger && access.kind === "read" && access.installation !== "installed"))
  if (access.kind === "retry") return { state: "retry", message: access.message };
  if (access.installation !== "installed") {
    if (flagger) return { state: "retry", message: "Slopbot must be available to check current repository permission." };
    return { state: "denied", message: installationMessage };
  }
  if (access.permission === "admin" || access.permission === "write") {
    const role = access.role.kind === "role" ? access.role.value : access.permission;
    return { state: "verified", message: "@" + actorLogin + " has " + role + " access to " + repository + "." };
  }
  return {
    state: "denied",
    message: "@" + actorLogin + " has " + access.permission + " access to " + repository + ". Write, maintain or admin access is required. Ask a maintainer with that access to finish setup.",
  };
}
