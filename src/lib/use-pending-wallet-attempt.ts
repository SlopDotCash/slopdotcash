import { useLayoutEffect, useRef, useState } from "react";
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
  updatePendingRecord,
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
  useLayoutEffect(() => {
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
  /**
   * Sends one wallet request for `intent`. The record is saved just before
   * the wallet prompt; the returned hash replaces it with `submitted(hash)`.
   * A declined prompt removes the record, and an error after the prompt
   * keeps it, because the wallet may still have sent the transaction.
   * `notify` receives the warning when the hash itself could not be saved.
   */
  const submit = async (
    intent: P,
    send: (beforeSend: () => void) => Promise<string>,
    options: {
      submitted: (hash: string) => P;
      notify: (message: string) => void;
      onBeforeSend?: () => void;
      unclear: string;
    },
  ) => {
    let requested = false;
    try {
      const hash = await send(() => {
        if (!mounted.current)
          throw new Error("The wallet view was closed. Review before sending.");
        if (!remember(intent))
          throw new Error(
            "The saved request changed. Reload before continuing.",
          );
        options.onBeforeSend?.();
        requested = true;
      });
      const submitted = options.submitted(hash);
      try {
        if (!remember(submitted, intent) && mounted.current)
          options.notify(
            `Submitted ${hash}. Keep this hash; the saved request changed.`,
          );
      } catch {
        if (mounted.current) {
          setPending(submitted);
          options.notify(
            `Submitted ${hash}. Keep this hash; browser storage could not save it.`,
          );
        }
      }
      return hash;
    } catch (caught) {
      if ((caught as { code?: unknown } | null)?.code === 4001) {
        if (requested) {
          if (mounted.current) clear(intent);
          else clearPendingAttempt(key, intent);
        }
        throw new Error("You declined the wallet request. Nothing was sent.");
      }
      if (requested) throw new Error(options.unclear);
      throw caught;
    }
  };
  /**
   * Saves a hash the owner entered for the record `captured`. Returns false,
   * keeping the hash in this view only, when browser storage fails.
   */
  const recordRecoveryHash = (captured: P, candidate: P) => {
    let stored: boolean;
    try {
      stored = updatePendingRecord(key, captured, candidate);
    } catch {
      setPending(candidate);
      return false;
    }
    if (!stored)
      throw new Error("The saved request changed. Reload before continuing.");
    storedPending.current = candidate;
    setPending(candidate);
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
    submit,
    recordRecoveryHash,
    clearUnreadable,
  };
}
