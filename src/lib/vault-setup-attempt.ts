import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
} from "./pending-attempt";

type SavedRequest = PendingAttempt & { hash: string | null };

/**
 * Storage steps of one vault-creation wallet request. Every write names its
 * own attempt, so a wallet result that outlives its view cannot recreate a
 * cleared request or erase a newer one. Each step reports whether it applied.
 */
export function vaultSetupAttempt<T extends SavedRequest>(
  key: string,
  ready: T,
) {
  return {
    /** Saves the request before the wallet prompt; refuses an occupied slot. */
    begin: () => createPendingAttempt(key, ready),
    /** True while this attempt still owns the slot. */
    stillCurrent: () => updatePendingAttempt(key, ready, ready),
    /** Records the returned hash only on this attempt's own record. */
    submitted: (hash: string) =>
      updatePendingAttempt(key, ready, { ...ready, hash }),
    /** A declined prompt removes only this attempt's unchanged record. */
    declined: () => clearPendingAttempt(key, ready),
  };
}
