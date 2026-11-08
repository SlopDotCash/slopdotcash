export type SetupText = { kind: "other" } | { kind: "text"; value: string };
export type SetupId = { kind: "invalid" } | { kind: "id"; value: number };
export type SetupRole =
  | { kind: "invalid" }
  | { kind: "none" }
  | { kind: "role"; value: string };

export type AccessHeader =
  | { kind: "bad-id" }
  | { kind: "malformed" }
  | { kind: "missing" }
  | { kind: "suspended"; id: number }
  | { kind: "installed"; id: number; permission: string; role: SetupRole };

/** Exact header classification after native object, integer and role-syntax reads. */
//@ verify
//@ requires id.kind == "invalid" || (1 <= id.value && id.value <= 9007199254740991)
//@ ensures \result == AccessHeaderValue(keys, installation, id, permission, role)
//@ ensures (\result.kind == "missing") <==> MissingHeader(keys, installation)
//@ ensures (\result.kind == "bad-id") <==> !MissingHeader(keys, installation) && id.kind == "invalid"
//@ ensures (\result.kind == "suspended") <==> !MissingHeader(keys, installation) && id.kind == "id" && SuspendedHeader(keys, installation)
//@ ensures (\result.kind == "installed") <==> !MissingHeader(keys, installation) && id.kind == "id" && !SuspendedHeader(keys, installation) && InstalledHeader(keys, installation, permission, role)
//@ ensures (\result.kind == "malformed") <==> !MissingHeader(keys, installation) && id.kind == "id" && !SuspendedHeader(keys, installation) && !InstalledHeader(keys, installation, permission, role)
//@ ensures \result.kind == "installed" ==> (\result.permission == "admin" || \result.permission == "write" || \result.permission == "read" || \result.permission == "none") && \result.role.kind != "invalid"
//@ ensures (\result.kind == "installed" || \result.kind == "suspended") ==> 1 <= \result.id && \result.id <= 9007199254740991
export function classifyAccessHeader(
  keys: string,
  installation: SetupText,
  id: SetupId,
  permission: SetupText,
  role: SetupRole,
): AccessHeader {
  if (
    installation.kind === "text" &&
    installation.value === "missing" &&
    keys === "installation"
  )
    return { kind: "missing" };
  if (id.kind === "invalid") return { kind: "bad-id" };
  if (
    installation.kind === "text" &&
    installation.value === "suspended" &&
    keys === "installation,installationId"
  )
    return { kind: "suspended", id: id.value };
  if (
    installation.kind === "text" &&
    installation.value === "installed" &&
    (keys === "installation,installationId,permission,roleName" ||
      keys === "installation,installationId,permission,repository,roleName") &&
    permission.kind === "text" &&
    (permission.value === "admin" ||
      permission.value === "write" ||
      permission.value === "read" ||
      permission.value === "none") &&
    role.kind !== "invalid"
  )
    return {
      kind: "installed",
      id: id.value,
      permission: permission.value,
      role,
    };
  return { kind: "malformed" };
}

export type AuthorityAccess =
  | { kind: "retry"; message: string }
  | { kind: "read"; installation: string; permission: string; role: SetupRole };
export type AuthorityDecision =
  | { state: "verified"; message: string }
  | { state: "denied"; message: string }
  | { state: "retry"; message: string };

/** Complete setup/flagger decision and displayed result, from actual access fields. */
//@ verify
//@ ensures \result == AuthorityValue(access, actorLogin, repository, installationMessage, flagger)
//@ ensures (\result.state == "verified") <==> AuthorityVerified(access)
//@ ensures (\result.state == "retry") <==> AuthorityRetry(access, flagger)
//@ ensures (\result.state == "denied") <==> !AuthorityVerified(access) && !AuthorityRetry(access, flagger)
export function decideSetupAuthority(
  access: AuthorityAccess,
  actorLogin: string,
  repository: string,
  installationMessage: string,
  flagger: boolean,
): AuthorityDecision {
  if (access.kind === "retry")
    return { state: "retry", message: access.message };
  if (access.installation !== "installed") {
    if (flagger)
      return {
        state: "retry",
        message:
          "Slopbot must be available to check current repository permission.",
      };
    return { state: "denied", message: installationMessage };
  }
  if (access.permission === "admin" || access.permission === "write") {
    const role =
      access.role.kind === "role" ? access.role.value : access.permission;
    return {
      state: "verified",
      message: `@${actorLogin} has ${role} access to ${repository}.`,
    };
  }
  return {
    state: "denied",
    message: `@${actorLogin} has ${access.permission} access to ${repository}. Write, maintain or admin access is required. Ask a maintainer with that access to finish setup.`,
  };
}
