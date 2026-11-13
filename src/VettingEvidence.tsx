import {
  CircleCheck,
  Clock,
  Download,
  Eye,
  Infinity as InfinityIcon,
  Info,
  LoaderCircle,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { sha256Hex } from "./lib/async-sha256.mjs";
import { fetchWithDeadline } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import {
  currentProjectSession,
  ProjectApiError,
  projectApiRequest,
  useProjectSession,
} from "./lib/project-api";
import { CopyIdentifier } from "./Operations";
import { RoutePageHeader, SignInPanel, StatusBadge } from "./Presentation";
import "./operations-design.css";

type EvidenceObject = {
  sha256: string;
  sizeBytes: number;
  kind: string;
  label: string;
  contentType: string;
  state: string;
  streamed?: boolean;
};
type Run = {
  assessmentId: string;
  runId: string;
  manifestSha256: string;
  expiresAt: string | null;
  permanentAdmissionEvidence?: boolean;
  assembly?: {
    retained: boolean;
    state: string;
    scanReady: false;
    reason: string;
  };
  objects: EvidenceObject[];
  policy: { version: string };
};
type Overview = { runs: Run[]; retentionBoundary: string };
export default function VettingEvidencePage() {
  const [initial] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return {
      assessment: query.get("assessmentId") ?? "",
      runId: query.get("runId") ?? "",
    };
  });
  const assessmentInput = useRef<HTMLInputElement>(null);
  const [assessment, setAssessment] = useState(initial.assessment);
  const [runId, setRunId] = useState(initial.runId);
  const [lookup, setLookup] = useState(
    initial.assessment && initial.runId ? initial : null,
  );
  const [lookupOpen, setLookupOpen] = useState(!lookup);
  const [loaded, setLoaded] = useState<
    (Overview & { actorId: string; lookupKey: string }) | null
  >(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);
  const session = useProjectSession(sessionRevision);
  const actorId =
    session.status === "signed-in" ? session.session.githubId : null;
  const lookupKey = lookup
    ? JSON.stringify([lookup.assessment, lookup.runId])
    : null;
  const data =
    loaded && loaded.actorId === actorId && loaded.lookupKey === lookupKey
      ? loaded
      : null;
  const invalidateSession = useCallback(() => {
    setLoaded(null);
    setSelected(null);
    setSessionRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!lookup || actorId === null) return;
    let active = true;
    setLoaded(null);
    setSelected(null);
    setBusy(true);
    setError(null);
    const load = async () => {
      const value = await projectApiRequest<Overview>(
        "GET",
        `operator/vetting-evidence?assessmentId=${encodeURIComponent(lookup.assessment)}&runId=${encodeURIComponent(lookup.runId)}`,
        undefined,
        { expectedActorGithubId: actorId },
      );
      const current = await currentProjectSession();
      if (!active) return;
      if (current?.githubId !== actorId) {
        invalidateSession();
        return;
      }
      setLoaded({
        ...value,
        actorId,
        lookupKey: JSON.stringify([lookup.assessment, lookup.runId]),
      });
      setBusy(false);
    };
    void load().catch((cause) => {
      if (!active) return;
      setError(errorMessage(cause, "Evidence could not be loaded"));
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [lookup, actorId, invalidateSession]);
  function load(event: FormEvent) {
    event.preventDefault();
    const next = { assessment: assessment.trim(), runId: runId.trim() };
    const url = new URL(window.location.href);
    url.searchParams.set("assessmentId", next.assessment);
    url.searchParams.set("runId", next.runId);
    window.history.replaceState(window.history.state, "", url);
    setLookup(next);
    setLookupOpen(false);
  }
  return (
    <main className="shell route-main admin-page operations-page evidence-page">
      <RoutePageHeader
        icon={<LockKeyhole />}
        title="Vetting evidence"
        titleAction={
          <StatusBadge icon={<TriangleAlert />} tone="warning">
            Hostile content
          </StatusBadge>
        }
      />
      {session.status !== "signed-in" ? (
        <SignInPanel
          state={session}
          next={`${window.location.pathname}${window.location.search}`}
        />
      ) : null}
      {session.status === "signed-in" ? (
        <details
          className="admin-card"
          open={lookupOpen}
          onToggle={(event) => setLookupOpen(event.currentTarget.open)}
        >
          <summary>Find evidence</summary>
          <form className="evidence-lookup" onSubmit={load}>
            <label className="form-field">
              Assessment ID
              <input
                required
                ref={assessmentInput}
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
              />
            </label>
            <label className="form-field">
              Run ID
              <input
                required
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              />
            </label>
            <button
              className="button primary-button"
              type="submit"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="wallet-spin" />
              ) : null}
              Load
            </button>
          </form>
        </details>
      ) : null}
      {session.status === "signed-in" && busy ? (
        <p role="status">
          <span aria-label="Loading" role="img" title="Loading">
            <LoaderCircle aria-hidden="true" className="wallet-spin" />
          </span>
        </p>
      ) : null}
      {session.status === "signed-in" && error ? (
        <p role="alert">
          {error}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setLookupOpen(true);
              requestAnimationFrame(() => assessmentInput.current?.focus());
            }}
          >
            Edit
          </button>{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => lookup && setLookup({ ...lookup })}
          >
            Retry
          </button>
        </p>
      ) : null}
      {session.status === "signed-in" && data
        ? data.runs.map((run) => (
            <section
              className="admin-card evidence-run"
              key={`${run.assessmentId}/${run.runId}`}
            >
              <header className="operations-card-heading">
                <h2>Evidence inventory</h2>
              </header>
              <details className="security-reference operations-disclosure">
                <summary>Details</summary>
                <dl className="operations-facts">
                  <div>
                    <dt>Run</dt>
                    <dd>
                      <CopyIdentifier label="run ID" value={run.runId} />
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment</dt>
                    <dd>
                      <CopyIdentifier
                        label="assessment ID"
                        value={run.assessmentId}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Inventory hash</dt>
                    <dd>
                      <CopyIdentifier
                        label="storage inventory digest"
                        value={run.manifestSha256}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Policy</dt>
                    <dd>{run.policy.version}</dd>
                  </div>
                </dl>
                <p className="operations-retention">
                  {run.permanentAdmissionEvidence ? (
                    <StatusBadge
                      icon={<InfinityIcon />}
                      title="Retained permanently; each read needs a grant"
                    >
                      Permanent
                    </StatusBadge>
                  ) : run.expiresAt === null ? (
                    <StatusBadge
                      icon={<Clock />}
                      title="Retained until 90 days after closure"
                    >
                      Open · +90d after close
                    </StatusBadge>
                  ) : (
                    <StatusBadge icon={<Clock />} title="Access expiry">
                      Expires {run.expiresAt}
                    </StatusBadge>
                  )}{" "}
                  <span
                    aria-label="Backups, deletion and legal holds are separate"
                    role="img"
                    title={data.retentionBoundary}
                  >
                    <Info aria-hidden="true" size={14} />
                  </span>
                </p>
              </details>
              {run.assembly ? (
                <p>
                  <StatusBadge
                    title={run.assembly.reason}
                    tone={run.assembly.retained ? "info" : "warning"}
                  >
                    {run.assembly.retained
                      ? "Assembly retained"
                      : "Assembly unverified"}
                  </StatusBadge>
                </p>
              ) : null}

              {run.objects.length === 0 ? (
                <p>No retained objects.</p>
              ) : (
                <ul
                  className="evidence-object-list"
                  aria-label="Retained objects"
                >
                  {run.objects.map((object) => {
                    const key = `${run.assessmentId}/${run.runId}/${object.sha256}`;
                    return (
                      <li key={object.sha256}>
                        <button
                          className="evidence-object-choice"
                          type="button"
                          aria-label={`Select ${object.label}, ${object.sha256.slice(0, 12)}`}
                          aria-pressed={selected === key}
                          onClick={() => setSelected(key)}
                        >
                          <span className="evidence-object-main">
                            <strong>{object.label}</strong>
                            <span className="evidence-object-meta">
                              {object.kind} ·{" "}
                              {object.sizeBytes.toLocaleString()} bytes
                            </span>
                          </span>
                          <span className="evidence-object-status">
                            {object.state !== "stored-unverified" && (
                              <StatusBadge tone="warning">
                                {evidenceState(object.state)}
                              </StatusBadge>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {run.objects.map((object) => {
                const key = `${run.assessmentId}/${run.runId}/${object.sha256}`;
                return selected === key ? (
                  <EvidenceItem
                    key={`${data.actorId}:${key}`}
                    run={run}
                    object={object}
                    actorId={data.actorId}
                    onIdentityChange={invalidateSession}
                  />
                ) : null;
              })}
            </section>
          ))
        : null}
    </main>
  );
}
function evidenceState(state: string) {
  return state === "stored-unverified"
    ? "Unverified"
    : state.replaceAll("-", " ");
}

function EvidenceItem({
  run,
  object,
  actorId,
  onIdentityChange,
}: {
  run: Run;
  object: EvidenceObject;
  actorId: string;
  onIdentityChange: () => void;
}) {
  const [reason, setReason] = useState(""),
    [content, setContent] = useState<string | null>(null),
    [status, setStatus] = useState<
      "" | "downloading" | "verified-download" | "verified-text"
    >("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const attempt = useRef(0);
  const inFlight = useRef<number | null>(null);
  const bodyRead = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current += 1;
      inFlight.current = null;
      bodyRead.current?.abort();
    };
  }, []);
  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!mounted.current || inFlight.current !== null) return;
    const currentAttempt = ++attempt.current;
    inFlight.current = currentAttempt;
    bodyRead.current?.abort();
    const controller = new AbortController();
    bodyRead.current = controller;
    const current = () =>
      mounted.current &&
      attempt.current === currentAttempt &&
      inFlight.current === currentAttempt;
    let invalidated = false;
    const requireActor = async () => {
      if (!current()) return false;
      const session = await currentProjectSession().catch((cause) => {
        if (current()) {
          invalidated = true;
          onIdentityChange();
        }
        throw cause;
      });
      if (!current()) return false;
      if (session?.githubId !== actorId) {
        invalidated = true;
        onIdentityChange();
        throw new Error("Your account changed. Reload the evidence inventory.");
      }
      return true;
    };
    setContent(null);
    setStatus("");
    setBusy(true);
    setError(null);
    const perform = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (cause) {
        if (current()) setError(errorMessage(cause, "Evidence read failed"));
      } finally {
        if (current()) {
          inFlight.current = null;
          setBusy(false);
        }
      }
    };
    void perform(async () => {
      try {
        if (!(await requireActor()) || !current()) return;
        const base = `operator/vetting-evidence/${encodeURIComponent(run.assessmentId)}/${encodeURIComponent(run.runId)}/${object.sha256}`;
        if (object.streamed) {
          await projectApiRequest(
            "POST",
            `${base}/download-grant`,
            { reason },
            { expectedActorGithubId: actorId },
          );
          if (!(await requireActor()) || !current()) return;
          const link = document.createElement("a");
          link.href = `/api/v1/${base}/download`;
          link.download = `${object.sha256}.bin`;
          link.click();
          setStatus("downloading");
          return;
        }
        const granted = await projectApiRequest<{ grant: string }>(
          "POST",
          `${base}/grant`,
          { reason },
          { expectedActorGithubId: actorId },
        );
        if (!(await requireActor()) || !current()) return;
        const response = await fetchWithDeadline(`/api/v1/${base}/body`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "x-vetting-read-grant": granted.grant,
            "x-slop-expected-github-id": actorId,
          },
          signal: controller.signal,
        });
        if (!current()) return;
        if (!response.ok)
          throw new ProjectApiError(
            response.status,
            "evidence_read_failed",
            `Evidence read failed (${response.status}). Request a new grant.`,
          );
        const bytes = await response.arrayBuffer();
        if (!current()) return;
        if (bytes.byteLength !== object.sizeBytes)
          throw new Error(
            "Evidence length differs from the immutable inventory.",
          );
        const digest = await sha256Hex(new Uint8Array(bytes));
        if (!current()) return;
        if (digest !== object.sha256)
          throw new Error(
            "Evidence digest differs from the immutable inventory.",
          );
        if (!(await requireActor()) || !current()) return;
        if (object.contentType !== "application/octet-stream")
          setContent(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        else {
          const url = URL.createObjectURL(
            new Blob([bytes], { type: "application/octet-stream" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = `${object.sha256}.bin`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setStatus(
          object.contentType === "application/octet-stream"
            ? "verified-download"
            : "verified-text",
        );
      } catch (cause) {
        if (!current()) return;
        if (invalidated) throw cause;
        if (
          cause instanceof ProjectApiError &&
          [401, 403, 404, 410].includes(cause.status)
        ) {
          invalidated = true;
          onIdentityChange();
          throw cause;
        }
        // A failure can also complete after the account silently changes.
        // Keep its error only after another current-actor observation.
        if (!(await requireActor()) || !current()) return;
        throw cause;
      }
    });
  }
  const downloads =
    object.streamed || object.contentType === "application/octet-stream";
  return (
    <article className="evidence-object operations-detail-panel">
      <header className="operations-card-heading">
        <h3>{object.label}</h3>
        <StatusBadge tone="warning">{evidenceState(object.state)}</StatusBadge>
      </header>
      <dl className="operations-facts">
        <div>
          <dt>Type</dt>
          <dd>
            {object.kind} · {object.contentType}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{object.sizeBytes.toLocaleString()} bytes</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>
            <CopyIdentifier
              label={`${object.label} digest`}
              value={object.sha256}
            />
          </dd>
        </div>
      </dl>
      <form className="evidence-inspection" onSubmit={inspect}>
        <label className="form-field">
          Reason
          <input
            required
            minLength={8}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          className="button secondary-button"
          type="submit"
          disabled={busy || object.state !== "stored-unverified"}
          aria-busy={busy}
          aria-label={`${downloads ? "Download" : "Read"} ${object.label}`}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="wallet-spin" />
          ) : downloads ? (
            <Download aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
          )}
          {downloads ? "Download" : "Read"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {status ? (
        <p role="status">
          {status === "downloading" ? (
            "Downloading. Do not execute."
          ) : (
            <>
              <StatusBadge icon={<CircleCheck />} tone="success">
                Verified
              </StatusBadge>
              {status === "verified-download" ? " Do not execute" : null}
            </>
          )}
        </p>
      ) : null}
      {content !== null ? (
        <textarea
          className="admin-code evidence-content"
          aria-label={`${object.label} verified content`}
          readOnly
          rows={12}
          value={content}
        />
      ) : null}
    </article>
  );
}
