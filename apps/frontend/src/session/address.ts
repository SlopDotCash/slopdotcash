// spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"; spec/backend/local.md, "A handoff binds one actor, exact loopback origin and environment"

export interface Address {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** @throws {never} */
export function currentAddress(): Address {
  if (typeof location === "undefined") return { pathname: "/", search: "", hash: "" };
  return { pathname: location.pathname, search: location.search, hash: location.hash };
}

/** @throws {never} */
export function replaceAddress(path: string, keepState: boolean): void {
  if (typeof history === "undefined") return;
  try {
    history.replaceState(keepState ? history.state : null, "", path);
  } catch {
    return;
  }
}
