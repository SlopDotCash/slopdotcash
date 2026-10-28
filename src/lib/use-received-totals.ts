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

// Every standings table on a page shares one read.
let shared: Promise<ReceivedTotals> | null = null;

/**
 * All-time money received, from one edge-cached D1 aggregate. A failed read
 * keeps this browser's last good copy, labelled stale; without one it stays an
 * error, never an empty or zero total.
 */
export function useReceivedTotals(): [ReceivedState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReceivedState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    if (!shared) {
      const read = loadReceived();
      shared = read;
      // A failed shared read is retried by the next mount or retry.
      read.catch(() => {
        if (shared === read) shared = null;
      });
    }
    void attempt;
    shared
      .then((received) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(received));
        } catch {
          // error-policy:J3 the read still succeeded without a stored copy.
        }
        if (active) setState({ status: "ready", received });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error
            ? error.message
            : "Payment records unavailable";
        const previous = lastGood();
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
  const retry = useCallback(() => {
    shared = null;
    setAttempt((value) => value + 1);
  }, []);
  return [state, retry];
}
