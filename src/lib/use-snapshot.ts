import { useCallback, useEffect, useState } from "react";
import { readBoundedJson } from "./browser-json";
import { assertCycleIndex, type CycleIndex } from "./cycle-index";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "./leaderboard";
import {
  createProjectView,
  type ProjectView,
  projectCycleHasOpened,
} from "./project-view";
import { PROJECTS } from "./projects.mjs";

const SNAPSHOT_TIMEOUT_MS = 12_000;
const SNAPSHOT_RETRIES = 1;
const MAX_LEADERBOARD_BYTES = 32 * 1024 * 1024;
const MAX_CYCLE_INDEX_BYTES = 8 * 1024 * 1024;
export type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      snapshot: LeaderboardSnapshot;
      views: ProjectView[];
      cycleIndex: CycleIndex;
    };

export function useSnapshot(enabled: boolean): [DataState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DataState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    if (!enabled) return;
    let controller: AbortController | null = null;
    let retryTimer: number | null = null;
    setState({ status: "loading" });

    const load = async (retry: number): Promise<void> => {
      const requestController = new AbortController();
      controller = requestController;
      const timeout = window.setTimeout(
        () => requestController.abort(new Error("snapshot request timed out")),
        SNAPSHOT_TIMEOUT_MS,
      );
      try {
        const request = {
          cache: "no-store" as const,
          headers: { Accept: "application/json" },
          signal: requestController.signal,
        };
        const [response, cycleResponse] = await Promise.all([
          fetch(
            `/data/leaderboard.json?attempt=${attempt}&retry=${retry}`,
            request,
          ),
          fetch(
            `/data/cycles/index.json?attempt=${attempt}&retry=${retry}`,
            request,
          ),
        ]);
        if (!response.ok)
          throw new Error(`snapshot returned ${response.status}`);
        if (!cycleResponse.ok) {
          throw new Error(`cycle index returned ${cycleResponse.status}`);
        }
        const [value, cycleValue]: [unknown, unknown] = await Promise.all([
          readBoundedJson(response, MAX_LEADERBOARD_BYTES, "snapshot"),
          readBoundedJson(cycleResponse, MAX_CYCLE_INDEX_BYTES, "cycle index"),
        ]);
        assertLeaderboardSnapshot(value);
        assertCycleIndex(cycleValue);
        // A project whose pool starts after this snapshot has no cycle to
        // show yet. Skipping it keeps one future-dated registry entry from
        // failing the whole page; every other contract violation still
        // surfaces as a data error rather than being silently swallowed.
        const views = PROJECTS.filter((project) =>
          projectCycleHasOpened(value, project.id),
        ).map((project) => createProjectView(value, project.id));
        if (active) {
          setState({
            status: "ready",
            snapshot: value,
            views,
            cycleIndex: cycleValue,
          });
        }
      } catch (error: unknown) {
        if (!active) return;
        if (retry < SNAPSHOT_RETRIES) {
          retryTimer = window.setTimeout(() => void load(retry + 1), 400);
        } else {
          // error-policy:J1 The browser boundary renders invalid or unavailable public data explicitly.
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "snapshot could not be read",
          });
        }
      } finally {
        requestController.abort();
        window.clearTimeout(timeout);
      }
    };
    void load(0);
    return () => {
      active = false;
      controller?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [attempt, enabled]);

  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
