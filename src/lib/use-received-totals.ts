import { useCallback, useEffect, useState } from "react";
import { browserDeployment } from "./browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isReceivedTotals, type ReceivedTotals } from "./received-totals";

export type ReceivedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      received: ReceivedTotals;
      /** Set when this is the last good copy because a refresh failed. */
      refreshError?: string;
    };

const STORAGE_KEY = "slop:received-totals:v1";
async function loadReceived(): Promise<ReceivedTotals> {
  // The payments API answers only the deployed product origins. The local dev
  // server proxies this public read (vite.config.ts).
  if (
    !import.meta.env.DEV &&
    !browserDeployment.browserOrigins.has(window.location.origin)
  )
    throw new Error("Payment records unavailable");
  const response = await fetchWithDeadline("/api/v1/payments/received", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Payment records unavailable");
  const value = await readBoundedJson(response, 2_097_152, "money received");
  if (!isReceivedTotals(value))
    throw new Error("Payment records could not be verified");
  return value;
}

function lastGood(): ReceivedTotals | null {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    return isReceivedTotals(value) ? value : null;
  } catch {
    // error-policy:J3 unavailable storage only means no last good copy.
    return null;
  }
}

/** The server's edge cache lifetime; an older copy is read again on mount. */
const FRESH_MS = 60_000;
// Every standings table on a page shares one read and its last result.
let cached: { received: ReceivedTotals; at: number } | null = null;
let inflight: Promise<ReceivedTotals> | null = null;

function refresh(): Promise<ReceivedTotals> {
  if (!inflight) {
    const read = loadReceived()
      .then((received) => {
        cached = { received, at: Date.now() };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(received));
        } catch {
          // error-policy:J3 the read still succeeded without a stored copy.
        }
        return received;
      })
      .finally(() => {
        if (inflight === read) inflight = null;
      });
    inflight = read;
  }
  return inflight;
}

/**
 * All-time money received, from one edge-cached D1 aggregate. A copy older
 * than the edge cache is shown while it is read again. A failed read keeps
 * the last good copy, labelled stale; without one it stays an error, never an
 * empty or zero total.
 */
export function useReceivedTotals(): [ReceivedState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReceivedState>(() =>
    cached
      ? { status: "ready", received: cached.received }
      : { status: "loading" },
  );
  useEffect(() => {
    let active = true;
    const current = cached;
    if (current && attempt === 0 && Date.now() - current.at < FRESH_MS) {
      setState({ status: "ready", received: current.received });
      return;
    }
    refresh()
      .then((received) => {
        if (active) setState({ status: "ready", received });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : "Payment records unavailable";
        const previous = cached?.received ?? lastGood();
        // error-policy:J1 a failed read never becomes a zero total.
        setState(
          previous
            ? { status: "ready", received: previous, refreshError: message }
            : { status: "error", message },
        );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [state, retry];
}
