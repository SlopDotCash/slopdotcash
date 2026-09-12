import { useCallback, useEffect, useState } from "react";
import { readBoundedJson } from "./browser-json";
import { assertCycleIndex, type CycleIndex } from "./cycle-index";

export type CycleIndexState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; cycleIndex: CycleIndex };

/** Archive availability does not depend on the rolling leaderboard. */
export function useCycleIndex(enabled: boolean): [CycleIndexState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CycleIndexState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function load() {
      try {
        const response = await fetch(
          `/data/cycles/index.json?attempt=${attempt}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(`cycle index returned ${response.status}`);
        const value = await readBoundedJson(
          response,
          8 * 1024 * 1024,
          "cycle index",
        );
        assertCycleIndex(value);
        if (active) setState({ status: "ready", cycleIndex: value });
      } catch (error) {
        // error-policy:J1 Archive errors remain visible without inventing empty history.
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "cycle index could not be read",
          });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [enabled, attempt]);
  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
