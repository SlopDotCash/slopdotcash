/**
 * Local development only. A browser that cannot open the sign-in window, such
 * as the desktop app's preview pane, signs in in the same tab instead. The
 * flow waits in session storage while GitHub has the tab, and the sign-in page
 * finishes it when the identity page sends the browser back. Nothing here runs
 * unless a local backend is in use (see `localBackendOrigin`).
 */
const KEY = "slop-local-signin";

export type SavedFlow = { flow: unknown; reopen: boolean; search: string };

export function saveLocalFlow(flow: unknown, reopen: boolean): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ flow, reopen, search: window.location.search }),
    );
  } catch {
    // The flow then fails to resume; the person starts sign-in again.
  }
}

export function clearLocalFlow(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}

/** The saved flow, or null when none is saved or it has expired. */
export function readLocalFlow(now = Date.now()): SavedFlow | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      flow?: { expiresAt?: unknown };
      reopen?: unknown;
      search?: unknown;
    } | null;
    const expires = Date.parse(String(saved?.flow?.expiresAt));
    if (
      !saved ||
      typeof saved.search !== "string" ||
      !(expires > now) ||
      !(saved.search === "" || saved.search.startsWith("?"))
    ) {
      clearLocalFlow();
      return null;
    }
    return {
      flow: saved.flow,
      reopen: saved.reopen === true,
      search: saved.search,
    };
  } catch {
    clearLocalFlow();
    return null;
  }
}
