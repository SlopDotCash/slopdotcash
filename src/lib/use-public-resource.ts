import { useCallback, useEffect, useState } from "react";

export type PublicResourceState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & T);

/** Retry and cancellation for independent public records; loaders keep their schemas. */
export function usePublicResource<T extends object>(
  enabled: boolean,
  load: (signal: AbortSignal, attempt: number) => Promise<T>,
  errorMessage: string,
  timeoutMs = 12_000,
): [PublicResourceState<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PublicResourceState<T>>({
    status: "loading",
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    const timeout = window.setTimeout(
      () => controller.abort(new Error("Request timed out")),
      timeoutMs,
    );
    void load(controller.signal, attempt)
      .then((value) => {
        if (active) setState({ status: "ready", ...value });
      })
      .catch((error: unknown) => {
        // error-policy:J1 Failed records stay visible, never become empty data.
        if (active)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : errorMessage,
          });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, load, errorMessage, timeoutMs, attempt]);
  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
