import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { type CycleIndex, loadCycleIndex } from "./cycle-index";
import { findProject } from "./projects.mjs";
import {
  assertPublishedStandings,
  MAX_STANDINGS_BYTES,
  type PublishedStandings,
} from "./standings";

const STANDINGS_RETRIES = 1;
const STANDINGS_CACHE_MS = 60_000;

/**
 * The contributor and project pages read the published standings record and
 * the cycle index. The record keeps the snapshot's own timestamp, so the
 * shared data notices show the same loading, error and stale states as the
 * complete snapshot does on the other pages.
 */
export type StandingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      snapshot: PublishedStandings;
      cycleIndex: CycleIndex;
      /** PRD section 9: a failed refresh keeps the last good record. */
      refreshError?: string;
    };

type ReadyStandings = Extract<StandingsState, { status: "ready" }>;
type StandingsRead = {
  controller: AbortController;
  promise: Promise<ReadyStandings>;
  consumers: number;
  settled: boolean;
};

let cached: { value: ReadyStandings; completedAt: number } | null = null;
let pending: StandingsRead | null = null;

function cachedStandings(): ReadyStandings | null {
  if (!cached) return null;
  const age = Date.now() - cached.completedAt;
  return age >= 0 && age < STANDINGS_CACHE_MS ? cached.value : null;
}

async function readStandings(
  query: string,
  signal: AbortSignal,
): Promise<PublishedStandings> {
  const response = await fetchWithDeadline(`/data/standings.json?${query}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`standings returned ${response.status}`);
  const value = await readBoundedJson(
    response,
    MAX_STANDINGS_BYTES,
    "standings",
  );
  assertPublishedStandings(value);
  // A page only builds views for projects in its own registry.
  return {
    ...value,
    projects: value.projects.filter((project) =>
      findProject(project.projectId),
    ),
  };
}

async function loadStandings(
  signal: AbortSignal,
  attempt: number,
): Promise<ReadyStandings> {
  for (let retry = 0; ; retry += 1) {
    signal.throwIfAborted();
    const requestController = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    try {
      const query = `attempt=${attempt}&retry=${retry}&at=${Date.now()}`;
      const [snapshot, cycleIndex] = await Promise.all([
        readStandings(query, requestSignal),
        loadCycleIndex(requestSignal, query),
      ]);
      return { status: "ready", snapshot, cycleIndex };
    } catch (error: unknown) {
      if (signal.aborted || retry >= STANDINGS_RETRIES) throw error;
    } finally {
      requestController.abort();
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
  }
}

function acquireStandings(attempt: number, force: boolean) {
  if (force) cached = null;
  const fresh = force ? null : cachedStandings();
  if (fresh) return { promise: Promise.resolve(fresh), release: () => {} };
  let read = force ? null : pending;
  if (!read || read.controller.signal.aborted) {
    const controller = new AbortController();
    const created: StandingsRead = {
      controller,
      promise: loadStandings(controller.signal, attempt),
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
          cached = { value, completedAt: Date.now() };
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

export function useStandings(enabled: boolean): [StandingsState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const previousAttempt = useRef(attempt);
  const [state, setState] = useState<StandingsState>(
    () => (enabled && cachedStandings()) || { status: "loading" },
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const force = attempt !== previousAttempt.current;
    previousAttempt.current = attempt;
    // A refresh keeps showing the last good record while it runs.
    setState((previous) =>
      previous.status === "ready" ? previous : { status: "loading" },
    );
    const request = acquireStandings(attempt, force);
    void request.promise
      .then((value) => {
        if (active) setState(value);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : "standings could not be read";
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
