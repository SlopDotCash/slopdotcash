// spec/backend/identity.md, "At most one poll receives the flow's identity"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"

export type SignInWindow = { readonly kind: "popup"; readonly window: Window } | { readonly kind: "sameTab" } | { readonly kind: "blocked" };

/** @throws {never} */
export function openSignInWindow(local: boolean): SignInWindow {
  const opened = typeof window === "undefined" ? null : window.open("about:blank", "_blank", "popup,width=600,height=720");
  if (opened === null) return local ? { kind: "sameTab" } : { kind: "blocked" };
  opened.opener = null;
  return { kind: "popup", window: opened };
}

/** @throws {never} */
export function showAuthorization(target: SignInWindow, url: string): void {
  if (target.kind === "popup") target.window.location.replace(url);
  else if (target.kind === "sameTab") location.assign(url);
}

/** @throws {never} */
export function closeSignInWindow(target: SignInWindow): void {
  if (target.kind === "popup") target.window.close();
}

/** @throws {never} */
export function leaveFor(path: string): void {
  if (typeof location !== "undefined") location.replace(path);
}
