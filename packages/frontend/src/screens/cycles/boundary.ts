// spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted"; spec/frontend/views.md, "A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap"
import type { ManagedRuntime } from "effect";
import { useState } from "react";
import { snapshotStaleAfterMs } from "../../../gen/frontend__snapshotCache.ts";
import { untilTime } from "../../platform/clock.vibe";
import { useOnce } from "../security/program/hooks.ts";

const dayMillis = 86_400_000;

/** The soonest instant after `nowMs` among `candidates`, or the next UTC midnight when it is sooner. @throws {never} */
export function nextBoundary(nowMs: number, candidates: ReadonlyArray<number | undefined>): number {
  const midnight = (Math.floor(nowMs / dayMillis) + 1) * dayMillis;
  return candidates.reduce<number>((soonest, at) => (at !== undefined && at > nowMs && at < soonest ? at : soonest), midnight);
}

/** The first instant at which a record generated at `generatedAt` reads as stale. @throws {never} */
export function staleFrom(generatedAt: string): number {
  return Date.parse(generatedAt) + snapshotStaleAfterMs + 1;
}

export function useBoundaryTime<R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, candidates: ReadonlyArray<number | undefined>): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const at = nextBoundary(nowMs, candidates);
  const reached = useOnce(runtime, `boundary:${at}`, () => untilTime(at));
  if (reached.status === "done" && nowMs < at) {
    setNowMs(at);
    return at;
  }
  return nowMs;
}
