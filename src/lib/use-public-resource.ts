import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errors";

export type PublicResourceState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready"; refreshError?: string } & T);

/** Retry and cancellation for independent public records; loaders keep their schemas. */
export function usePublicResource<T extends object>(
  enabled: boolean,
  load: (signal: AbortSignal, attempt: number) => Promise<T>,
  fallbackMessage: string,
  timeoutMs = 12_000,
): [PublicResourceState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PublicResourceState<T>>({
    status: "loading",
  });
  // The last record the current loader produced. A retry of the same loader
  // refreshes that record in place; a different loader starts over, so a
  // record is never carried across resources.
  const retained = useRef<{ load: typeof load; value: T } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    const refresh =
      retained.current?.load === load ? retained.current.value : null;
    if (refresh === null) {
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
        retained.current = { load, value };
        setState({ status: "ready", ...value });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = errorMessage(error, fallbackMessage);
        // error-policy:J1 Failed records stay visible, never become empty
        // data. A first read becomes an error; a failed refresh of a loaded
        // record keeps that record and reports why (PRD section 9), like
        // useSnapshot and useSecurityData already do.
        if (refresh !== null)
          setState({ status: "ready", ...refresh, refreshError: message });
        else setState({ status: "error", message });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, load, fallbackMessage, timeoutMs, attempt]);
  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
