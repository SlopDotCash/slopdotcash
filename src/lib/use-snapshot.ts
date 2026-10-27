import { useCallback, useEffect, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { type CycleIndex, loadCycleIndex } from "./cycle-index";
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
export type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      snapshot: LeaderboardSnapshot;
      views: ProjectView[];
      cycleIndex: CycleIndex;
      /**
       * PRD section 9: a refresh that fails keeps the last good snapshot and
       * reports why, instead of replacing published data with an outage.
       */
      refreshError?: string;
    };

export function useSnapshot(enabled: boolean): [DataState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DataState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    if (!enabled) return;
    let controller: AbortController | null = null;
    let retryTimer: number | null = null;
    // A refresh keeps showing the last good snapshot while it runs.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );

    const load = async (retry: number): Promise<void> => {
      const requestController = new AbortController();
      controller = requestController;
      const timeout = window.setTimeout(
        () => requestController.abort(new Error("snapshot request timed out")),
        SNAPSHOT_TIMEOUT_MS,
      );
      try {
        const query = `attempt=${attempt}&retry=${retry}`;
        const readSnapshot = async () => {
          const response = await fetchWithDeadline(
            `/data/leaderboard.json?${query}`,
            {
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: requestController.signal,
            },
          );
          if (!response.ok)
            throw new Error(`snapshot returned ${response.status}`);
          return readBoundedJson(response, MAX_LEADERBOARD_BYTES, "snapshot");
        };
        const [value, cycleValue]: [unknown, CycleIndex] = await Promise.all([
          readSnapshot(),
          loadCycleIndex(requestController.signal, query),
        ]);
        assertLeaderboardSnapshot(value);
        // A project whose pool starts after this snapshot has no cycle to
        // show yet. Skipping it keeps one future-dated registry entry from
        // failing the whole page; every other contract violation still
        // surfaces as a data error rather than being silently swallowed.
        const views = PROJECTS.filter(
          (project) =>
            projectCycleHasOpened(value, project.id) &&
            project.repositories.every((repository) =>
              value.repositories.some(
                (collected) => collected.id === repository.id,
              ),
            ),
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
          const message =
            error instanceof Error
              ? error.message
              : "snapshot could not be read";
          // error-policy:J1 The browser boundary renders invalid or unavailable public data explicitly.
          // Without a prior good snapshot this stays an error; nothing is
          // fabricated. With one, the last good data stays, marked stale.
          setState((previous) =>
            previous.status === "ready"
              ? { ...previous, refreshError: message }
              : { status: "error", message },
          );
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
