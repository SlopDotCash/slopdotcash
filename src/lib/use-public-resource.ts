import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errors";
import { ProjectApiError } from "./project-api";

export type PublicResourceState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready"; refreshError?: string } & T);

/**
 * Whether a failed read may keep the record it was refreshing. Only a
 * request that never received an authoritative answer is transient: a
 * network failure (ProjectApiError status 0, or a status-less fetch
 * failure) or a 5xx. An authorization failure (401/403) — like every
 * other HTTP status — is an answer the caller must see in full, so the
 * retained record is dropped and the read becomes an error. Callers may
 * enable retention only when their loader reports HTTP failures with
 * their status (ProjectApiError); a status-less error cannot be told
 * apart from a network failure.
 */
function isTransientFailure(error: unknown): boolean {
  if (error instanceof ProjectApiError)
    return error.status === 0 || error.status >= 500;
  return true;
}

/** Retry and cancellation for independent public records; loaders keep their schemas. */
export function usePublicResource<T extends object>(
  enabled: boolean,
  load: (signal: AbortSignal, attempt: number) => Promise<T>,
  fallbackMessage: string,
  timeoutMs = 12_000,
  options?: { retainOnTransientFailure?: boolean },
): [PublicResourceState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PublicResourceState<T>>({
    status: "loading",
  });
  const retain = options?.retainOnTransientFailure === true;
  const retained = useRef<{ load: typeof load; value: T } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    // An opted-in refresh of the same loader keeps its record on screen;
    // a first read and a new loader start from loading as before.
    const kept =
      retain && retained.current?.load === load ? retained.current.value : null;
    if (kept === null) {
      retained.current = null;
      setState({ status: "loading" });
    }
    const timeout = window.setTimeout(
      () => controller.abort(new Error("Request timed out")),
      timeoutMs,
    );
    void load(controller.signal, attempt)
      .then((value) => {
        if (!active) return;
        if (retain) retained.current = { load, value };
        setState({ status: "ready", ...value });
      })
      .catch((error: unknown) => {
        // error-policy:J1 Failed records stay visible, never become empty data.
        if (!active) return;
        if (kept !== null && isTransientFailure(error)) {
          setState({
            status: "ready",
            ...kept,
            refreshError: errorMessage(error, fallbackMessage),
          });
          return;
        }
        // Access loss drops the retained record with the visible state,
        // so private data and its controls leave the screen together.
        retained.current = null;
        setState({
          status: "error",
          message: errorMessage(error, fallbackMessage),
        });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, load, fallbackMessage, timeoutMs, attempt, retain]);
  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
