import { type FormEvent, useState } from "react";
import { sha256Hex } from "./lib/async-sha256.mjs";
import { loginHref } from "./lib/browser-deployment";
import { fetchWithDeadline } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { projectApiRequest, useProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";

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
  const query = new URLSearchParams(window.location.search);
  const [assessment, setAssessment] = useState(query.get("assessmentId") ?? "");
  const [runId, setRunId] = useState(query.get("runId") ?? "");
  const [data, setData] = useState<Overview | null>(null);
  const { busy, error, run } = useAction();
  const session = useProjectSession();
  function load(event: FormEvent) {
    event.preventDefault();
    setData(null);
    void run(
      async () =>
        setData(
          await projectApiRequest<Overview>(
            "GET",
            `operator/vetting-evidence?assessmentId=${encodeURIComponent(assessment)}&runId=${encodeURIComponent(runId)}`,
          ),
        ),
      (e) => errorMessage(e, "Evidence could not be loaded"),
    );
  }
  return (
    <main
      className="shell route-main admin-page"
      style={{ overflowWrap: "anywhere" }}
    >
      <h1>Private vetting evidence</h1>
      <p>
        Designated vetting operators only. Evidence may contain hostile code and
        private data.
      </p>
      {session.status === "signed-out" ? (
        <p>
          {/* Keep the assessment and run IDs through sign-in. */}
          <a
            href={loginHref(
              `${window.location.pathname}${window.location.search}`,
            )}
          >
            Sign in with GitHub
          </a>
        </p>
      ) : null}
      <form className="admin-card" onSubmit={load}>
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
        <button className="button primary-button" type="submit" disabled={busy}>
          {busy ? "Loading evidence…" : "Inspect evidence inventory"}
        </button>
      </form>
      {error ? <p role="alert">{error} Check the IDs and retry.</p> : null}
      {data ? (
        <>
          <p>{data.retentionBoundary}</p>
          {data.runs.map((run) => (
            <section
              className="admin-card"
              style={{ overflowWrap: "anywhere" }}
              key={`${run.assessmentId}/${run.runId}`}
            >
              <h2>{run.runId}</h2>
              <details className="security-reference">
                <summary>Run identifiers and retention</summary>
                <p>Assessment: {run.assessmentId}</p>
                <p>Storage inventory SHA-256: {run.manifestSha256}</p>
                <p>
                  {run.expiresAt === null
                    ? "Case open. Evidence remains available until 90 days after closure."
                    : `Access expires: ${run.expiresAt}.`}{" "}
                  Policy: {run.policy.version}.
                </p>
              </details>
              {run.assembly ? (
                <p>
                  Evidence assembly:{" "}
                  {run.assembly.retained ? "Retained" : "Not verified"}.{" "}
                  {run.assembly.reason} Clean admission is unavailable.
                </p>
              ) : null}
              {run.objects.map((object) => (
                <EvidenceItem key={object.sha256} run={run} object={object} />
              ))}
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
    <article className="admin-card" style={{ overflowWrap: "anywhere" }}>
      <h3>{object.label}</h3>
      <p>
        {object.kind} · {object.sizeBytes} bytes · {object.state}
      </p>
      <details className="evidence-access">
        <summary>
          {object.streamed || object.contentType === "application/octet-stream"
            ? "Download evidence"
            : "Read evidence"}
        </summary>
        <p>SHA-256: {object.sha256}</p>
        <form className="admin-section" onSubmit={inspect}>
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
            className="admin-code"
            aria-label={`${object.label} verified content`}
            readOnly
            value={content}
          />
        ) : null}
      </details>
    </article>
  );
}
