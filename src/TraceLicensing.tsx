/**
 * Trace licensing on the account settings page (private trace contract
 * versions 2 and 3). The member turns the setting on or
 * off and opts earlier traces in. Every server answer is checked before it is
 * shown; an unexpected shape becomes the error state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import {
  isTraceTermsVersion,
  TRACE_LICENCES_API,
  TRACE_LICENSING_API,
  TRACES_ME_API,
  type TraceTermsVersion,
} from "./lib/trace-licensing";
import { useAction } from "./lib/use-action";
import { EmptyState, formatDate, Spinner } from "./Presentation";

type Setting = {
  enabled: boolean;
  since: string | null;
  confirmedTermsVersion: TraceTermsVersion | null;
};
type Licence = "none" | "licensed" | "withdrawn";
type Trace = {
  runId: string;
  finalizedAt: string;
  projectId: string;
  provider: string;
  model: string;
  termsVersion: TraceTermsVersion;
  licence: Licence;
};
type Listing = {
  setting: Setting;
  totals: { traces: number; licensed: number; eligible: number };
  traces: Trace[];
  nextCursor: string | null;
};
type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listing: Listing };

const INVALID = "Trace licensing returned an invalid answer.";
const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const LICENCES: readonly string[] = ["none", "licensed", "withdrawn"];
const COUNT = new Intl.NumberFormat("en-US");

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(INVALID);
  return value as number;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(INVALID);
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300)
    throw new Error(INVALID);
  return value;
}

function setting(value: unknown): Setting {
  const v = record(value);
  if (
    typeof v.enabled !== "boolean" ||
    typeof v.providerTermsConfirmed !== "boolean"
  )
    throw new Error(INVALID);
  if (!v.enabled && v.since !== null) throw new Error(INVALID);
  const confirmed = v.confirmedTermsVersion;
  if (confirmed !== null && !isTraceTermsVersion(confirmed))
    throw new Error(INVALID);
  return {
    enabled: v.enabled,
    since: v.enabled ? date(v.since) : null,
    confirmedTermsVersion: confirmed,
  };
}

function trace(value: unknown): Trace {
  const v = record(value);
  if (
    typeof v.runId !== "string" ||
    !RUN_ID.test(v.runId) ||
    !isTraceTermsVersion(v.termsVersion) ||
    typeof v.licence !== "string" ||
    !LICENCES.includes(v.licence) ||
    (v.pullRequestUrl !== null && typeof v.pullRequestUrl !== "string")
  )
    throw new Error(INVALID);
  text(v.repository);
  text(v.client);
  return {
    runId: v.runId,
    finalizedAt: date(v.finalizedAt),
    projectId: text(v.projectId),
    provider: text(v.provider),
    model: text(v.model),
    termsVersion: v.termsVersion,
    licence: v.licence as Licence,
  };
}

function listing(value: unknown): Listing {
  const v = record(value);
  const totals = record(v.totals);
  const traces = count(totals.traces);
  const licensed = count(totals.licensed);
  const eligible = count(totals.eligible);
  if (
    licensed + eligible !== traces ||
    !Array.isArray(v.traces) ||
    (v.nextCursor !== null &&
      (typeof v.nextCursor !== "string" || v.nextCursor.length > 300))
  )
    throw new Error(INVALID);
  return {
    setting: setting(v.setting),
    totals: { traces, licensed, eligible },
    traces: v.traces.map(trace),
    nextCursor: v.nextCursor as string | null,
  };
}

class TraceLicensingError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function request(
  url: string,
  githubId: string | null,
  signal: AbortSignal,
  body?: { method: "PUT" | "POST"; json: unknown },
): Promise<unknown> {
  const response = await fetchWithDeadline(url, {
    method: body?.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(githubId === null ? {} : { "x-slop-expected-github-id": githubId }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body.json) }),
    signal,
  });
  const answer = await readBoundedJson(
    response,
    1024 * 1024,
    "Trace licensing",
  );
  if (!response.ok) {
    const error =
      typeof answer === "object" && answer !== null
        ? (answer as { error?: unknown; message?: unknown })
        : {};
    throw new TraceLicensingError(
      response.status < 500 && typeof error.message === "string"
        ? error.message
        : "Trace licensing is unavailable. Retry later.",
      typeof error.error === "string" ? error.error : null,
    );
  }
  return answer;
}

function traces(n: number): string {
  return n === 1 ? "trace" : "traces";
}

const TERMS_LABELS: Record<TraceTermsVersion, string> = {
  "private-trace-v1": "v1",
  "private-trace-v2": "v2",
  "private-trace-v3": "v3",
};

const LICENCE_LABELS: Record<Licence, string> = {
  none: "not licensed",
  licensed: "licensed",
  withdrawn: "withdrawn",
};

/** Keyed by the account, so an account change remounts it and drops a request in flight. */
export function TraceLicensing({ githubId }: { githubId: string | null }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [ticked, setTicked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A reload that failed after the list was shown: the list stays.
  const [reloadError, setReloadError] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();
  const controller = useRef<AbortController | null>(null);
  const loads = useRef(0);
  const shown = useRef<Listing | null>(null);
  const show = useCallback((next: Listing) => {
    shown.current = next;
    setView({ status: "ready", listing: next });
  }, []);
  const load = useCallback(async () => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    const attempt = ++loads.current;
    try {
      const loaded = listing(await request(TRACES_ME_API, githubId, signal));
      if (!signal.aborted && attempt === loads.current) {
        show(loaded);
        setReloadError(null);
      }
    } catch (caught) {
      if (signal.aborted || attempt !== loads.current) return;
      const message =
        caught instanceof Error ? caught.message : "Trace licensing failed.";
      if (shown.current === null) setView({ status: "error", message });
      else setReloadError(message);
    }
  }, [githubId, show]);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    void load();
    return () => current.abort();
  }, [load]);

  /** Runs one write; `reload` reads the list again after it succeeds. */
  const act = (
    action: (signal: AbortSignal) => Promise<void>,
    reload = true,
  ) => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    setNotice(null);
    void run(async () => {
      try {
        await action(signal);
      } catch (caught) {
        // The eligible set moved: show the new list with the refusal.
        if (
          caught instanceof TraceLicensingError &&
          caught.code === "count_changed"
        )
          await load();
        throw caught;
      }
      if (reload) await load();
    });
  };
  const retry = () => {
    setReloadError(null);
    if (shown.current === null) setView({ status: "loading" });
    void run(load);
  };
  const retryButton = (
    <div className="handoff-actions">
      <button
        className="button secondary-button button-small"
        disabled={busy}
        type="button"
        onClick={retry}
      >
        Retry
      </button>
    </div>
  );

  if (view.status === "loading") return <Spinner label="Loading your traces" />;
  const lead = (
    <p>
      Let Slop license your traces to AI model builders for pay. You get 50% of
      each sale. <a href="/protocol/private-trace-v3.md">Terms</a>
    </p>
  );
  if (view.status === "error")
    return (
      <div className="email-enrollment">
        {lead}
        <p role="alert">{view.message}</p>
        {retryButton}
      </div>
    );
  const { setting: current, totals, nextCursor } = view.listing;
  // On under an earlier version: v3 uploads need their own confirmation.
  const needsV3 =
    current.enabled && current.confirmedTermsVersion !== "private-trace-v3";
  const confirmBox = (
    <fieldset disabled={busy}>
      <label>
        <input
          type="checkbox"
          checked={ticked}
          onChange={(event) => {
            setTicked(event.target.checked);
            setError(null);
          }}
        />
        My model provider's terms let me license these runs' output, including
        the code they contain.
      </label>
    </fieldset>
  );
  const turnOn = () =>
    act(async (signal) => {
      const next = setting(
        record(
          await request(TRACE_LICENSING_API, githubId, signal, {
            method: "PUT",
            json: { enabled: true, providerTermsConfirmed: true },
          }),
        ).setting,
      );
      setTicked(false);
      if (shown.current) show({ ...shown.current, setting: next });
    });
  const turnOff = () =>
    act(async (signal) => {
      const answer = record(
        await request(TRACE_LICENSING_API, githubId, signal, {
          method: "PUT",
          json: { enabled: false },
        }),
      );
      const next = setting(answer.setting);
      const withdrawn = count(answer.withdrawn);
      const before = shown.current;
      if (before)
        show({
          ...before,
          setting: next,
          totals: {
            traces: before.totals.traces,
            licensed: 0,
            eligible: before.totals.traces,
          },
          traces: before.traces.map((row) =>
            row.licence === "licensed" ? { ...row, licence: "withdrawn" } : row,
          ),
        });
      setNotice(
        `Turned off. ${COUNT.format(withdrawn)} ${traces(withdrawn)} withdrawn.`,
      );
    });
  const license = (json: unknown) =>
    act(async (signal) => {
      count(
        record(
          await request(TRACE_LICENCES_API, githubId, signal, {
            method: "POST",
            json,
          }),
        ).licensed,
      );
    });
  /** Licenses one row and updates that row where it is, keeping the pages read. */
  const licenseRow = (runId: string) =>
    act(async (signal) => {
      const licensed = count(
        record(
          await request(TRACE_LICENCES_API, githubId, signal, {
            method: "POST",
            json: { runIds: [runId] },
          }),
        ).licensed,
      );
      const before = shown.current;
      if (!before) return;
      // Zero means the server already held it licensed: only the row was stale.
      const moved = Math.min(licensed, before.totals.eligible);
      show({
        ...before,
        totals: {
          traces: before.totals.traces,
          licensed: before.totals.licensed + moved,
          eligible: before.totals.eligible - moved,
        },
        traces: before.traces.map((row) =>
          row.runId === runId ? { ...row, licence: "licensed" } : row,
        ),
      });
    }, false);
  const licenseAll = () => {
    const eligible = totals.eligible;
    if (
      !window.confirm(
        `License ${COUNT.format(eligible)} ${traces(eligible)}? You can turn this off any time.`,
      )
    )
      return;
    license({ all: true, expectedCount: eligible });
  };
  const more = () => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || nextCursor === null) return;
    setNotice(null);
    void run(async () => {
      const attempt = loads.current;
      const page = listing(
        await request(
          `${TRACES_ME_API}?cursor=${encodeURIComponent(nextCursor)}`,
          githubId,
          signal,
        ),
      );
      if (signal.aborted || attempt !== loads.current || !shown.current) return;
      show({
        ...page,
        traces: [...shown.current.traces, ...page.traces],
      });
    });
  };

  return (
    <div className="email-enrollment">
      {lead}
      {current.enabled && current.since !== null ? (
        <>
          <p>On since {formatDate(current.since)}</p>
          {needsV3 ? (
            <>
              <p>
                Sessions uploaded under v3 include your project's code. Confirm
                again to license them.
              </p>
              {confirmBox}
              <div className="handoff-actions">
                <button
                  className="button secondary-button"
                  disabled={busy || !ticked}
                  type="button"
                  onClick={turnOn}
                >
                  Confirm for v3
                </button>
              </div>
            </>
          ) : null}
          <div className="handoff-actions">
            <button
              className="button secondary-button"
              disabled={busy}
              type="button"
              onClick={turnOff}
            >
              Turn off
            </button>
          </div>
        </>
      ) : (
        <>
          {confirmBox}
          <div className="handoff-actions">
            <button
              className="button secondary-button"
              disabled={busy || !ticked}
              type="button"
              onClick={turnOn}
            >
              Turn on
            </button>
          </div>
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {reloadError ? (
        <>
          <p role="alert">{reloadError}</p>
          {retryButton}
        </>
      ) : null}
      {totals.traces === 0 ? (
        <EmptyState text="No traces yet" />
      ) : (
        <>
          <p>
            Your traces ({COUNT.format(totals.traces)}) · licensed{" "}
            {COUNT.format(totals.licensed)}
          </p>
          {current.enabled && !needsV3 && totals.eligible > 0 ? (
            <div className="handoff-actions">
              <button
                className="button secondary-button"
                disabled={busy}
                type="button"
                onClick={licenseAll}
              >
                License all {COUNT.format(totals.eligible)} earlier{" "}
                {traces(totals.eligible)}
              </button>
            </div>
          ) : null}
          <ul>
            {view.listing.traces.map((row) => (
              <li key={row.runId}>
                {formatDate(row.finalizedAt)} · {row.projectId} · {row.provider}
                /{row.model} · {TERMS_LABELS[row.termsVersion]} ·{" "}
                {LICENCE_LABELS[row.licence]}
                {current.enabled &&
                row.licence !== "licensed" &&
                !(needsV3 && row.termsVersion === "private-trace-v3") ? (
                  <>
                    {" "}
                    <button
                      aria-label={`License trace of ${formatDate(row.finalizedAt)}, ${row.projectId}`}
                      className="button secondary-button button-small"
                      disabled={busy}
                      type="button"
                      onClick={() => licenseRow(row.runId)}
                    >
                      License
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {nextCursor !== null ? (
            <div className="handoff-actions">
              <button
                className="button secondary-button"
                disabled={busy}
                type="button"
                onClick={more}
              >
                More
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
