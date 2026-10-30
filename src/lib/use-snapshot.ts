import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedBytes } from "./browser-json";
import { type CycleIndex, loadCycleIndex } from "./cycle-index";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "./leaderboard";
import {
  MAX_LEADERBOARD_BYTES,
  MAX_LEADERBOARD_PART_BYTES,
  readLeaderboardBytes,
} from "./leaderboard-transport.mjs";
import {
  createProjectView,
  type ProjectView,
  projectCycleHasOpened,
} from "./project-view";
import { PROJECTS } from "./projects.mjs";

const SNAPSHOT_TIMEOUT_MS = 12_000;
const SNAPSHOT_RETRIES = 1;
const SNAPSHOT_CACHE_MS = 60_000;
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

type ReadySnapshot = Extract<DataState, { status: "ready" }>;
type SnapshotRead = {
  projects: typeof PROJECTS;
  controller: AbortController;
  promise: Promise<ReadySnapshot>;
  consumers: number;
  settled: boolean;
};

// Only complete, validated public records are reused. Identity, session and
// wallet reads are independent of this short-lived, page-memory cache.
let cached: {
  projects: typeof PROJECTS;
  value: ReadySnapshot;
  completedAt: number;
} | null = null;
let pending: SnapshotRead | null = null;

function cachedSnapshot(): ReadySnapshot | null {
  if (!cached || cached.projects !== PROJECTS) return null;
  const age = Date.now() - cached.completedAt;
  return age >= 0 && age < SNAPSHOT_CACHE_MS ? cached.value : null;
}

async function loadSnapshot(
  projects: typeof PROJECTS,
  signal: AbortSignal,
  attempt: number,
): Promise<ReadySnapshot> {
  for (let retry = 0; ; retry += 1) {
    signal.throwIfAborted();
    const requestController = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    const timeout = window.setTimeout(
      () => requestController.abort(new Error("snapshot request timed out")),
      SNAPSHOT_TIMEOUT_MS,
    );
    try {
      const query = `attempt=${attempt}&retry=${retry}&at=${Date.now()}`;
      const readSnapshot = async () => {
        const response = await fetchWithDeadline(
          `/data/leaderboard.json?${query}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: requestSignal,
          },
        );
        if (!response.ok)
          throw new Error(`snapshot returned ${response.status}`);
        const bytes = await readLeaderboardBytes(
          await readBoundedBytes(response, MAX_LEADERBOARD_BYTES, "snapshot"),
          async (path) => {
            const part = await fetchWithDeadline(path, {
              signal: requestSignal,
              cache: "no-store",
            });
            if (!part.ok)
              throw new Error(`snapshot part returned ${part.status}`);
            return readBoundedBytes(
              part,
              MAX_LEADERBOARD_PART_BYTES,
              "snapshot part",
            );
          },
        );
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      };
      const [value, cycleIndex]: [unknown, CycleIndex] = await Promise.all([
        readSnapshot(),
        loadCycleIndex(requestSignal, query),
      ]);
      assertLeaderboardSnapshot(value);
      // A project whose pool starts after this snapshot has no cycle to
      // show yet. Every other contract violation remains a data error.
      const views = projects
        .filter(
          (project) =>
            projectCycleHasOpened(value, project.id) &&
            project.repositories.every((repository) =>
              value.repositories.some(
                (collected) => collected.id === repository.id,
              ),
            ),
        )
        .map((project) => createProjectView(value, project.id));
      return { status: "ready", snapshot: value, views, cycleIndex };
    } catch (error: unknown) {
      if (signal.aborted || retry >= SNAPSHOT_RETRIES) throw error;
    } finally {
      requestController.abort();
      window.clearTimeout(timeout);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
  }
}

function acquireSnapshot(attempt: number, force: boolean) {
  if (force) cached = null;
  const fresh = force ? null : cachedSnapshot();
  if (fresh) return { promise: Promise.resolve(fresh), release: () => {} };
  let read = !force && pending?.projects === PROJECTS ? pending : null;
  if (!read || read.controller.signal.aborted) {
    const controller = new AbortController();
    const created: SnapshotRead = {
      projects: PROJECTS,
      controller,
      promise: loadSnapshot(PROJECTS, controller.signal, attempt),
      consumers: 0,
      settled: false,
    };
    pending = created;
    created.promise = created.promise
      .then((value) => {
        // An older request cannot replace an explicit newer refresh.
        if (
          pending === created &&
          created.consumers > 0 &&
          !controller.signal.aborted
        )
          cached = {
            projects: created.projects,
            value,
            completedAt: Date.now(),
          };
        return value;
      })
      .finally(() => {
        created.settled = true;
        if (pending === created) pending = null;
      });
    read = created;
  }
  const subscription = read;
  subscription.consumers += 1;
  let released = false;
  return {
    promise: subscription.promise,
    release: () => {
      if (released) return;
      released = true;
      subscription.consumers -= 1;
      // A replacement consumer in the same effect flush can join the read.
      queueMicrotask(() => {
        if (subscription.consumers === 0 && !subscription.settled) {
          subscription.controller.abort();
          if (pending === subscription) pending = null;
        }
      });
    },
  };
}

export function useSnapshot(enabled: boolean): [DataState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const previousAttempt = useRef(attempt);
  const [state, setState] = useState<DataState>(
    () => (enabled && cachedSnapshot()) || { status: "loading" },
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const force = attempt !== previousAttempt.current;
    previousAttempt.current = attempt;
    // A refresh keeps showing the last good snapshot while it runs.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    const request = acquireSnapshot(attempt, force);
    void request.promise
      .then((value) => {
        if (active) setState(value);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "snapshot could not be read";
        // error-policy:J1 Failed reads remain explicit; a prior good read stays visible.
        setState((previous) =>
          previous.status === "ready"
            ? { ...previous, refreshError: message }
            : { status: "error", message },
        );
      })
      .finally(request.release);
    return () => {
      active = false;
      request.release();
    };
  }, [attempt, enabled]);

  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}
