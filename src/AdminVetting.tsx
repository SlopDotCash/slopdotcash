import "./owner-review.css";
import { errorMessage as message } from "./lib/errors";
import { CopyIdentifier } from "./Operations";
import { StatusBadge, formatNullableUtc as time } from "./Presentation";
/**
 * The admin view of community project security vetting (PRD VET-01 to
 * VET-08). It shows each project's admission clearance, the restricted
 * scan results and quarantine records, active contributor flags, and queues a
 * scan of the current revision. Admission and flag-recovery scans queue automatically; the
 * scanner service is external, and when it is not configured the view says
 * so and offers no scan control.
 */

import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  History,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { projectApiRequest } from "./lib/project-api";
import type {
  AdmissionExemption,
  AssessmentState,
  AssessmentSummary,
  VettingClearance as Clearance,
} from "./lib/vetting-contracts";

type AdminAssessment = AssessmentSummary & {
  projectId: string;
  requestedBy: { githubLogin: string };
  requestReason: string;
  /** A historical secure-VM result (v1) or a bounded scan result (v2). */
  result: {
    schemaVersion: string;
    environment?: { runId: string };
    telemetry?: { visibilityGaps: string[]; tamperDetected: boolean };
    scan?: { runId: string };
    reusedAssessmentId?: string | null;
    coverage?: Record<string, { state: string; items: number }>;
    checks?: Record<string, string>;
    visibilityGaps?: string[];
    artifacts: {
      sha256: string;
      path: string;
      type: string;
      state: string;
      analysis: string;
    }[];
    findings: { severity: string; category: string; summary: string }[];
    confirmation: { basis: string; rule: string } | null;
  } | null;
};

type Overview = {
  service: { queueRegistrationAvailable: boolean } & (
    | { state: "available" }
    | { state: "unavailable"; reason: string }
  );
  projects: {
    id: string;
    name: string;
    status: string;
    revision: number;
    clearance: Clearance;
  }[];
  assessments: AdminAssessment[];
  exemptions?: AdmissionExemption[];
  /** Active contributor flags; they count without moderator approval. */
  flags?: {
    id: string;
    projectId: string;
    reporter: { githubLogin: string };
    category: string;
    evidence: string;
    evidenceUrl: string | null;
    createdAt: string;
  }[];
};

const LABELS: Record<Clearance["state"], string> = {
  unscanned: "Unscanned",
  unverified: "Unverified",
  stale: "Stale",
  queued: "Queued",
  quarantined: "Quarantined",
  cleared: "Cleared",
  banned: "Banned",
};

/** PRD section 8: the existing-project exemption is never a passed scan. */
function clearanceLabel(clearance: Clearance): string {
  return clearance.state === "cleared" && clearance.assessment === null
    ? "exemption" in clearance
      ? "Owner-approved exemption"
      : "Existing-project exemption"
    : clearance.state === "cleared" && clearance.basis === "admission"
      ? "Admitted"
      : LABELS[clearance.state];
}

const scanLabel = (value: string) => {
  const text = value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const STATE_TEXT: Record<AssessmentState, string> = {
  pending: "Queued",
  incomplete: "Incomplete",
  clean: "Clean",
  malicious: "Confirmed malicious",
};

function AdmissionExemptionForm({
  project,
  exemption,
  onSaved,
}: {
  project: Overview["projects"][number];
  exemption?: AdmissionExemption;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = exemption !== undefined;
  const save = async () => {
    if (!confirmed || reason.trim().length < 8 || !decisionReference.trim()) {
      setError("Record the reason, owner decision reference and confirmation.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await projectApiRequest(
        "POST",
        revoke
          ? `admin/vetting/exemptions/${encodeURIComponent(exemption.id)}/revoke`
          : "admin/vetting/exemptions",
        {
          ...(revoke
            ? {}
            : { projectId: project.id, revision: project.revision }),
          reason: reason.trim(),
          decisionReference: decisionReference.trim(),
          confirmation: true,
        },
      );
      onSaved();
    } catch (caught) {
      setError(message(caught));
      setBusy(false);
    }
  };
  return (
    <section className="admin-subsection">
      <h4 className="admin-subsection-heading">
        <ShieldCheck aria-hidden="true" /> Owner-approved exemption
      </h4>
      <form
        className="admin-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          {revoke ? "Reason for revocation" : "Reason for the exemption"}
          <textarea
            minLength={8}
            maxLength={1000}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label>
          Owner decision reference
          <input
            type="text"
            maxLength={500}
            required
            value={decisionReference}
            onChange={(event) => setDecisionReference(event.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {revoke
            ? "I confirm the human owner authorized this revocation."
            : "I confirm the human owner explicitly authorized this exemption for this repository."}
        </label>
        {error ? (
          <p className="form-error" role="alert">
            <CircleAlert aria-hidden="true" /> {error}
          </p>
        ) : null}
        <button
          className="button secondary-button"
          type="submit"
          disabled={
            busy ||
            !confirmed ||
            reason.trim().length < 8 ||
            !decisionReference.trim()
          }
        >
          {revoke ? (
            <ShieldOff aria-hidden="true" />
          ) : (
            <ShieldCheck aria-hidden="true" />
          )}
          {busy ? "Saving…" : revoke ? "Revoke exemption" : "Record exemption"}
        </button>
      </form>
    </section>
  );
}

function AdmissionExemptionHistory({
  exemptions,
}: {
  exemptions: AdmissionExemption[];
}) {
  if (exemptions.length === 0) return null;
  return (
    <section className="admin-subsection">
      <h4 className="admin-subsection-heading">
        <History aria-hidden="true" /> Exemption history
      </h4>
      {exemptions.map((exemption) => (
        <dl className="admin-facts" key={exemption.id}>
          <div>
            <dt>Grant</dt>
            <dd>
              Revision {exemption.revision} · @{exemption.grantedBy.githubLogin}{" "}
              · {time(exemption.grantedAt)} ·{" "}
              {exemption.revokedAt ? "Revoked" : "Active"}
            </dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{exemption.reason}</dd>
          </div>
          <div>
            <dt>Owner decision</dt>
            <dd>
              {/^https?:\/\//iu.test(exemption.decisionReference) ? (
                <a
                  href={exemption.decisionReference}
                  rel="noreferrer"
                  target="_blank"
                >
                  {exemption.decisionReference}{" "}
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : (
                exemption.decisionReference
              )}
            </dd>
          </div>
          <div>
            <dt>Repository identity</dt>
            <dd>
              <CopyIdentifier
                label="GitHub repository ID"
                value={exemption.repositoryId}
              />
              <CopyIdentifier
                label="GitHub repository node ID"
                value={exemption.repositoryNodeId}
              />
            </dd>
          </div>
          <div>
            <dt>Approved manifest</dt>
            <dd>
              <CopyIdentifier
                label="approved manifest digest"
                value={exemption.manifestSha256}
              />
            </dd>
          </div>
          {exemption.revokedAt ? (
            <div>
              <dt>Revocation</dt>
              <dd>
                @{exemption.revokedBy?.githubLogin ?? "unknown"} ·{" "}
                {time(exemption.revokedAt)} · {exemption.revocationReason}
                {exemption.revocationDecisionReference
                  ? ` · ${exemption.revocationDecisionReference}`
                  : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      ))}
    </section>
  );
}

function QueueScan({
  project,
  onQueued,
}: {
  project: Overview["projects"][number];
  onQueued: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = () => {
    if (reason.trim() === "") {
      setError("Write a reason for the scan.");
      return;
    }
    setBusy(true);
    setError(null);
    projectApiRequest("POST", "admin/vetting/assessments", {
      projectId: project.id,
      revision: project.revision,
      reason: reason.trim(),
    }).then(onQueued, (caught: unknown) => {
      setBusy(false);
      setError(message(caught));
    });
  };
  return (
    <section className="admin-subsection">
      <h4 className="admin-subsection-heading">
        <ScanSearch aria-hidden="true" /> Scan revision {project.revision}
      </h4>
      <form
        className="admin-actions"
        onSubmit={(event) => {
          event.preventDefault();
          queue();
        }}
      >
        <label>
          Reason for the scan
          <textarea
            maxLength={1000}
            required
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            <CircleAlert aria-hidden="true" /> {error}
          </p>
        ) : null}
        <div>
          <button
            className="button secondary-button"
            disabled={busy}
            type="submit"
          >
            <ScanSearch aria-hidden="true" />
            {busy ? "Queuing…" : `Queue scan of revision ${project.revision}`}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Where a result's retained evidence lives; a reused scan points at its original. */
function evidenceRun(assessment: AdminAssessment) {
  const result = assessment.result;
  if (result?.scan)
    return {
      assessmentId: result.reusedAssessmentId ?? assessment.id,
      runId: result.scan.runId,
    };
  if (result?.environment)
    return { assessmentId: assessment.id, runId: result.environment.runId };
  return null;
}

function AssessmentDetails({ assessment }: { assessment: AdminAssessment }) {
  const result = assessment.result;
  const run = evidenceRun(assessment);
  const gaps =
    result?.telemetry?.visibilityGaps ?? result?.visibilityGaps ?? [];
  return (
    <section className="admin-subsection assessment-details">
      <header className="admin-subsection-heading">
        <h4>Revision {assessment.revision}</h4>
        <StatusBadge
          icon={
            assessment.state === "clean" ? <CircleCheck /> : <CircleAlert />
          }
          tone={
            assessment.state === "clean"
              ? "success"
              : assessment.state === "malicious"
                ? "danger"
                : "warning"
          }
        >
          {STATE_TEXT[assessment.state]}
        </StatusBadge>
        <time dateTime={assessment.completedAt ?? assessment.requestedAt}>
          {time(assessment.completedAt ?? assessment.requestedAt)}
        </time>
      </header>
      <dl className="admin-facts">
        <div>
          <dt>Queued by</dt>
          <dd>
            <a
              href={`https://github.com/${encodeURIComponent(assessment.requestedBy.githubLogin)}`}
              rel="noreferrer"
              target="_blank"
            >
              @{assessment.requestedBy.githubLogin}
            </a>{" "}
            — {assessment.requestReason}
          </dd>
        </div>
        <div>
          <dt>Assigned commit</dt>
          <dd>
            <CopyIdentifier
              label="assigned commit"
              value={assessment.commitSha}
            />
          </dd>
        </div>
        <div>
          <dt>Skill template</dt>
          <dd>
            <CopyIdentifier
              label="skill template digest"
              value={assessment.templateSha256}
            />
          </dd>
        </div>
        <div>
          <dt>Policy version</dt>
          <dd>{assessment.policyVersion ?? "—"}</dd>
        </div>
        <div>
          <dt>Model reviews</dt>
          <dd>
            {assessment.modelRuns.length === 0
              ? "—"
              : assessment.modelRuns
                  .map((run) => `${run.reviewer}: ${run.provider}/${run.model}`)
                  .join(", ")}
          </dd>
        </div>
        {run ? (
          <div>
            <dt>Retained evidence</dt>
            <dd>
              <a
                href={`/vetting-evidence?assessmentId=${encodeURIComponent(run.assessmentId)}&runId=${encodeURIComponent(run.runId)}`}
              >
                <ExternalLink aria-hidden="true" /> Evidence
              </a>
            </dd>
          </div>
        ) : null}
        {result?.coverage && result.checks ? (
          <div className="assessment-coverage">
            <dt>Scan coverage</dt>
            <dd>
              <div className="scan-coverage-grid">
                <section
                  className="scan-coverage-table"
                  aria-label="Scanned surfaces table"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll all scan columns.
                  tabIndex={0}
                >
                  <table aria-label="Scanned surfaces">
                    <caption>Surfaces</caption>
                    <thead>
                      <tr>
                        <th scope="col">Surface</th>
                        <th scope="col">Coverage</th>
                        <th scope="col">Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.coverage)
                        .sort(
                          (a, b) =>
                            Number(a[1].state === "complete") -
                            Number(b[1].state === "complete"),
                        )
                        .map(([surface, entry]) => (
                          <tr key={surface}>
                            <th scope="row">{scanLabel(surface)}</th>
                            <td>
                              <StatusBadge
                                tone={
                                  entry.state === "complete"
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {scanLabel(entry.state)}
                              </StatusBadge>
                            </td>
                            <td>{entry.items}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </section>
                <section
                  className="scan-coverage-table"
                  aria-label="Scan checks table"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll all scan columns.
                  tabIndex={0}
                >
                  <table aria-label="Scan checks">
                    <caption>Threat checks</caption>
                    <thead>
                      <tr>
                        <th scope="col">Check</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.checks)
                        .sort(
                          (a, b) =>
                            Number(a[1] === "passed") -
                            Number(b[1] === "passed"),
                        )
                        .map(([threat, check]) => (
                          <tr key={threat}>
                            <th scope="row">{scanLabel(threat)}</th>
                            <td>
                              <StatusBadge
                                tone={
                                  check === "passed" || check === "not-found"
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {scanLabel(check)}
                              </StatusBadge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </section>
              </div>
              {result.reusedAssessmentId
                ? ` · Reused clean scan ${result.reusedAssessmentId} (identical content)`
                : ""}
            </dd>
          </div>
        ) : null}
        {result ? (
          <div>
            <dt>Visibility</dt>
            <dd>
              {result.telemetry?.tamperDetected ? "Tampering detected. " : ""}
              {gaps.length === 0 ? "No visibility gaps" : gaps.join("; ")}
            </dd>
          </div>
        ) : null}
        {result?.confirmation ? (
          <div>
            <dt>Confirmation</dt>
            <dd>
              {result.confirmation.basis} under {result.confirmation.rule}
            </dd>
          </div>
        ) : null}
      </dl>
      {result && result.findings.length > 0 ? (
        <>
          <h4>Findings</h4>
          <ul className="operations-findings">
            {result.findings.map((finding) => (
              <li key={`${finding.category}-${finding.summary}`}>
                <StatusBadge
                  tone={
                    finding.severity === "critical" ||
                    finding.severity === "high"
                      ? "danger"
                      : "warning"
                  }
                >
                  {finding.severity}
                </StatusBadge>
                <span>
                  <strong>{finding.category}</strong> — {finding.summary}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {result && result.artifacts.length > 0 ? (
        <>
          <h4>Artifact quarantine</h4>
          <ul className="operations-artifact-list">
            {result.artifacts.map((artifact) => (
              <li key={`${artifact.sha256}-${artifact.path}`}>
                <div className="operations-card-heading">
                  <strong>{artifact.path}</strong>
                  <StatusBadge>{artifact.state}</StatusBadge>
                </div>
                <p className="operations-muted">
                  {artifact.type} · {artifact.analysis}
                </p>
                <CopyIdentifier
                  label={`${artifact.path} digest`}
                  value={artifact.sha256}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function VettingSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; value: Overview }
  >({ status: "loading" });
  const [note, setNote] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    setState({ status: "loading" });
    projectApiRequest<Overview>("GET", "admin/vetting").then(
      (value) => {
        if (generation.current === current)
          setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (generation.current === current)
          setState({ status: "error", message: message(error) });
      },
    );
  }, []);
  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  return (
    <section aria-labelledby="admin-vetting" className="admin-section">
      <div className="admin-section-heading">
        <h2 id="admin-vetting">Security vetting</h2>
      </div>
      {note ? (
        <p className="admin-status" role="status">
          {note}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p aria-live="polite" className="admin-status">
          Loading security vetting…
        </p>
      ) : state.status === "error" ? (
        <div className="form-error" role="alert">
          <CircleAlert aria-hidden="true" /> {state.message}
          <button className="text-button" onClick={load} type="button">
            <RotateCcw aria-hidden="true" /> Retry
          </button>
        </div>
      ) : (
        <>
          {state.value.service.state === "unavailable" ? (
            <p className="form-error" role="alert">
              <CircleAlert aria-hidden="true" /> Vetting service unavailable.{" "}
              {state.value.service.reason}
            </p>
          ) : null}
          {!state.value.projects.some((project) => project.id === projectId) ? (
            <p className="admin-status">No vetting record yet.</p>
          ) : (
            state.value.projects
              .filter((project) => project.id === projectId)
              .map((project) => {
                const clearance = project.clearance;
                const history = state.value.assessments.filter(
                  (assessment) => assessment.projectId === project.id,
                );
                // The API returns newest first. Superseded pending requests
                // remain in history but no longer occupy the project queue.
                const queued =
                  history[0]?.state === "pending" &&
                  history[0].revision === project.revision;
                const exemptions = (state.value.exemptions ?? []).filter(
                  (exemption) => exemption.projectId === project.id,
                );
                const activeExemption = exemptions.find(
                  (exemption) => exemption.revokedAt === null,
                );
                return (
                  <article
                    aria-label={`Security vetting for ${project.id}`}
                    className="admin-card"
                    key={project.id}
                  >
                    <header>
                      <span>Current clearance</span>
                      <StatusBadge
                        className="admin-badge"
                        icon={
                          clearance.state === "cleared" ? (
                            <ShieldCheck />
                          ) : (
                            <CircleAlert />
                          )
                        }
                        tone={
                          clearance.state === "cleared"
                            ? "success"
                            : clearance.state === "banned" ||
                                clearance.state === "quarantined"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {clearanceLabel(clearance)}
                      </StatusBadge>
                    </header>
                    <dl className="admin-facts">
                      <div>
                        <dt>Current revision</dt>
                        <dd>
                          {project.id} · revision {project.revision} ·{" "}
                          {project.status}
                        </dd>
                      </div>
                      <div>
                        <dt>Decided by</dt>
                        <dd>
                          {clearance.state === "unscanned"
                            ? "Awaiting admission scan"
                            : clearance.state === "unverified"
                              ? clearance.reason
                              : clearance.assessment === null
                                ? "exemption" in clearance
                                  ? "Owner-approved exemption"
                                  : "Existing-project exemption"
                                : clearance.state === "stale"
                                  ? `Live head ${clearance.live.commitSha} (template ${clearance.live.templateSha256}) is not scanned. Last scan: ${clearance.assessment.commitSha}.`
                                  : `${clearance.state === "cleared" && clearance.basis === "admission" ? "Admission scan" : "Scan"} of revision ${clearance.assessment.revision} · ${STATE_TEXT[clearance.assessment.state]}`}
                        </dd>
                      </div>
                      {"assessment" in clearance &&
                      clearance.assessment !== null ? (
                        <div>
                          <dt>Held artifacts</dt>
                          <dd>
                            {clearance.assessment.heldArtifacts} of{" "}
                            {clearance.assessment.artifacts}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {clearance.state === "banned" ? (
                      <p className="form-error">
                        <CircleAlert aria-hidden="true" /> Confirmed malicious.
                        A new scan cannot lift the ban.
                      </p>
                    ) : null}
                    {(state.value.flags ?? []).some(
                      (flag) => flag.projectId === project.id,
                    ) ? (
                      <section className="admin-subsection">
                        <h4 className="admin-subsection-heading">
                          <CircleAlert aria-hidden="true" /> Active contributor
                          flags ·{" "}
                          {
                            (state.value.flags ?? []).filter(
                              (flag) => flag.projectId === project.id,
                            ).length
                          }
                        </h4>
                        <ul className="operations-findings">
                          {(state.value.flags ?? [])
                            .filter((flag) => flag.projectId === project.id)
                            .map((flag) => (
                              <li key={flag.id}>
                                @{flag.reporter.githubLogin} · {flag.category} ·{" "}
                                {time(flag.createdAt)}: {flag.evidence}
                                {flag.evidenceUrl ? (
                                  <>
                                    {" "}
                                    <a
                                      href={flag.evidenceUrl}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      <ExternalLink aria-hidden="true" />{" "}
                                      Evidence
                                    </a>
                                  </>
                                ) : null}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ) : null}
                    <div className="admin-action-grid">
                      {state.value.service.queueRegistrationAvailable &&
                      !queued ? (
                        <QueueScan
                          onQueued={() => {
                            setNote(
                              `Queued a scan of ${project.id} revision ${project.revision}.`,
                            );
                            load();
                          }}
                          project={project}
                        />
                      ) : null}
                      <AdmissionExemptionForm
                        key={`${project.revision}:${activeExemption?.id ?? "grant"}`}
                        project={project}
                        exemption={activeExemption}
                        onSaved={() => {
                          setNote(
                            activeExemption
                              ? `Revoked the owner-approved exemption for ${project.id}.`
                              : `Recorded the owner-approved exemption for ${project.id}.`,
                          );
                          load();
                        }}
                      />
                    </div>
                    {history.length > 0 ? (
                      <>
                        <h4 className="admin-subsection-heading">
                          <History aria-hidden="true" /> Scan history
                        </h4>
                        {history.map((assessment) => (
                          <AssessmentDetails
                            assessment={assessment}
                            key={assessment.id}
                          />
                        ))}
                      </>
                    ) : null}
                    <AdmissionExemptionHistory exemptions={exemptions} />
                  </article>
                );
              })
          )}
        </>
      )}
    </section>
  );
}

/** The same revision-bound clearance used by the full security review panel. */
export function ActivationClearance({
  projectId,
  revision,
}: {
  projectId: string;
  revision: number;
}) {
  const [clearance, setClearance] = useState<string>(
    "Checking security clearance…",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    projectApiRequest<Overview>("GET", `admin/vetting?refresh=${attempt}`).then(
      (body) => {
        if (!active) return;
        const project = body.projects.find((entry) => entry.id === projectId);
        setClearance(
          !project || project.revision !== revision
            ? "Revision changed. Reload the page."
            : `Revision ${revision}: ${clearanceLabel(project.clearance)}.`,
        );
      },
      (error) => {
        if (active) setClearance(message(error));
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, revision, attempt]);
  return (
    <div className="admin-action-bar">
      <p role="status">{clearance}</p>
      <button
        type="button"
        className="text-button"
        aria-label="Refresh clearance"
        title="Refresh clearance"
        onClick={() => setAttempt((value) => value + 1)}
      >
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
  );
}
