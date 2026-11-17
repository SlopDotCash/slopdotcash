// spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"

/** Resolves when the address's fragment or history entry changes; never resolves without `window`. @throws {never} */
export function nextAddressChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return;
    const stop = () => {
      window.removeEventListener("hashchange", settle);
      window.removeEventListener("popstate", settle);
      signal.removeEventListener("abort", stop);
    };
    function settle() {
      stop();
      resolve();
    }
    window.addEventListener("hashchange", settle);
    window.addEventListener("popstate", settle);
    signal.addEventListener("abort", stop, { once: true });
  });
}

const privateQuery = ["case", "submission", "intake", "points", "pointsDispute"] as const;

/** The search string without the parameters that name one account's private records. @throws {never} */
export function withoutPrivateQuery(search: string): string {
  const query = new URLSearchParams(search);
  for (const key of privateQuery) query.delete(key);
  const rest = query.toString();
  return rest === "" ? "" : `?${rest}`;
}
