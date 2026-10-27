import { FileSearch, LockKeyhole } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { sha256Hex } from "./lib/async-sha256.mjs";
import { fetchWithDeadline } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { projectApiRequest, useProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
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
  const [assessment, setAssessment] = useState(initial.assessment);
  const [runId, setRunId] = useState(initial.runId);
  const [lookup, setLookup] = useState(
    initial.assessment && initial.runId ? initial : null,
  );
  const [lookupOpen, setLookupOpen] = useState(!lookup);
  const [data, setData] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useProjectSession();
  useEffect(() => {
    if (!lookup || session.status !== "signed-in") return;
    let active = true;
    setData(null);
    setSelected(null);
    setBusy(true);
    setError(null);
    void projectApiRequest<Overview>(
      "GET",
      `operator/vetting-evidence?assessmentId=${encodeURIComponent(lookup.assessment)}&runId=${encodeURIComponent(lookup.runId)}`,
    ).then(
      (value) => {
        if (!active) return;
        setData(value);
        setBusy(false);
      },
      (cause) => {
        if (!active) return;
        setError(errorMessage(cause, "Evidence could not be loaded"));
        setBusy(false);
      },
    );
    return () => {
      active = false;
    };
  }, [lookup, session.status]);
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
      <RoutePageHeader icon={<FileSearch />} title="Private vetting evidence" />
      <p className="operations-caution">
        <LockKeyhole aria-hidden="true" />
        <span>
          Private operator access. Evidence may contain hostile code or private
          data.
        </span>
      </p>
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
            >
              {busy ? "Loading evidence…" : "Inspect evidence inventory"}
            </button>
          </form>
        </details>
      ) : null}
      {session.status === "signed-in" && busy ? (
        <p role="status">Loading evidence inventory…</p>
      ) : null}
      {session.status === "signed-in" && error ? (
        <p role="alert">
          {error} Check the IDs or{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => lookup && setLookup({ ...lookup })}
          >
            retry inventory
          </button>
          .
        </p>
      ) : null}
      {session.status === "signed-in" && data ? (
        <>
          <p className="operations-retention">{data.retentionBoundary}</p>
          {data.runs.map((run) => (
            <section
              className="admin-card evidence-run"
              key={`${run.assessmentId}/${run.runId}`}
            >
              <header className="operations-card-heading">
                <h2>Evidence inventory</h2>
                <StatusBadge icon={<LockKeyhole />}>Private</StatusBadge>
              </header>
              <details className="security-reference operations-disclosure">
                <summary>Run details and retention</summary>
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
                    <dt>Storage inventory SHA-256</dt>
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
                  {run.permanentAdmissionEvidence
                    ? "Admission evidence is retained permanently. Each read requires a short-lived operator grant."
                    : run.expiresAt === null
                      ? "Case open. Evidence is retained until 90 days after closure."
                      : `Access expires: ${run.expiresAt}.`}
                </p>
              </details>
              {run.assembly ? (
                <p className="operations-caution">
                  <span>
                    <StatusBadge
                      tone={run.assembly.retained ? "info" : "warning"}
                    >
                      Evidence assembly:{" "}
                      {run.assembly.retained ? "Retained" : "Not verified"}
                    </StatusBadge>{" "}
                    {run.assembly.reason} Clean admission is unavailable.
                  </span>
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
                            <StatusBadge
                              tone={
                                object.state === "stored-unverified"
                                  ? "neutral"
                                  : "warning"
                              }
                            >
                              {object.state}
                            </StatusBadge>
                            <code>{object.sha256.slice(0, 12)}</code>
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
                  <EvidenceItem key={key} run={run} object={object} />
                ) : null;
              })}
            </section>
          ))}
        </>
      ) : null}
    </main>
  );
}
function EvidenceItem({ run, object }: { run: Run; object: EvidenceObject }) {
  const [reason, setReason] = useState(""),
    [content, setContent] = useState<string | null>(null),
    [status, setStatus] = useState("");
  const { busy, error, run: act } = useAction();
  function inspect(event: FormEvent) {
    event.preventDefault();
    setContent(null);
    setStatus("");
    void act(
      async () => {
        const base = `operator/vetting-evidence/${encodeURIComponent(run.assessmentId)}/${encodeURIComponent(run.runId)}/${object.sha256}`;
        if (object.streamed) {
          await projectApiRequest("POST", `${base}/download-grant`, { reason });
          const link = document.createElement("a");
          link.href = `/api/v1/${base}/download`;
          link.download = `${object.sha256}.bin`;
          link.click();
          setStatus(
            "Download requested. Do not execute the file. A failed transfer needs a new grant.",
          );
          return;
        }
        const granted = await projectApiRequest<{ grant: string }>(
          "POST",
          `${base}/grant`,
          { reason },
        );
        const response = await fetchWithDeadline(`/api/v1/${base}/body`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "x-vetting-read-grant": granted.grant },
        });
        if (!response.ok)
          throw new Error(
            `Evidence read failed (${response.status}). Request a new grant.`,
          );
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== object.sizeBytes)
          throw new Error(
            "Evidence length differs from the immutable inventory.",
          );
        const digest = await sha256Hex(new Uint8Array(bytes));
        if (digest !== object.sha256)
          throw new Error(
            "Evidence digest differs from the immutable inventory.",
          );
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
            ? "Exact bytes verified. Download requested; do not execute the file."
            : "Complete bytes verified. Text is displayed without execution.",
        );
      },
      (e) => errorMessage(e, "Evidence read failed"),
    );
  }
  return (
    <article className="evidence-object operations-detail-panel">
      <header className="operations-card-heading">
        <h3>{object.label}</h3>
        <StatusBadge tone="warning">{object.state}</StatusBadge>
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
          Reason to inspect {object.label}
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
        >
          {busy
            ? "Verifying evidence…"
            : object.streamed ||
                object.contentType === "application/octet-stream"
              ? `Download ${object.label}`
              : `Read ${object.label}`}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}
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
