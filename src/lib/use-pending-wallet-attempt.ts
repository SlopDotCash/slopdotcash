import { useEffect, useRef, useState } from "react";
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
} from "./pending-attempt";

/**
 * Same-tab state of one wallet request that awaits finalized evidence.
 * `parse` reads the saved record and throws when it cannot be trusted;
 * `unreadable` names that failure. The unreadable record stays in storage
 * until the owner checks wallet activity and clears it.
 */
export function usePendingWalletAttempt<P extends PendingAttempt>(
  key: string,
  parse: (raw: string) => P | null,
  unreadable: (error: unknown) => string,
) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [saved] = useState(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      if (raw === null) return { pending: null, error: "", raw };
      return { pending: parse(raw), error: "", raw };
    } catch (error) {
      return { pending: null, raw, error: unreadable(error) };
    }
  });
  const storedPending = useRef<P | null>(saved.pending);
  const [pending, setPending] = useState<P | null>(saved.pending);
  const [storageError, setStorageError] = useState(Boolean(saved.error));
  const remember = (value: P, previous?: P) => {
    const stored = previous
      ? updatePendingAttempt(key, previous, value)
      : createPendingAttempt(key, value);
    if (!stored) return false;
    storedPending.current = value;
    if (mounted.current) setPending(value);
    return true;
  };
  const clear = (value: P) => {
    if (!mounted.current) return false;
    if (!clearPendingAttempt(key, value))
      throw new Error("The saved request changed. Reload before continuing.");
    storedPending.current = null;
    setPending(null);
    return true;
  };
  /** Removes the unreadable record only if this tab did not change it. */
  const clearUnreadable = () => {
    if (!mounted.current) return;
    if (sessionStorage.getItem(key) !== saved.raw)
      throw new Error("The saved request changed. Reload before continuing.");
    sessionStorage.removeItem(key);
    setStorageError(false);
  };
  return {
    mounted,
    saved,
    storedPending,
    pending,
    setPending,
    storageError,
    remember,
    clear,
    clearUnreadable,
  };
}
