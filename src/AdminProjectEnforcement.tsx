/**
 * Quarantine, Ban project and Request reinstatement for one project (PRD
 * ADM-06). Every action needs a reason and an evidence reference, shows the
 * server's exact project and revision preview, and asks for confirmation.
 * The API decides the moderator role and independent review on every call.
 * A confirmed malicious result waits for a moderator decision: ban the
 * project and its maintainer, or reinstate it (PRD sections 2 and 8).
 */

import { CircleAlert, ExternalLink, History, ShieldCheck } from "lucide-react";
import { type FormEvent, Fragment, useId, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  type AdminProject,
  type EnforcementAction,
  type EnforcementPreview,
  projectApiRequest,
} from "./lib/project-api";
import { formatDateTime, StatusBadge } from "./Presentation";

const ACTION_LABELS: Record<EnforcementAction, string> = {
  quarantine: "Quarantine",
  ban: "Ban project",
  request_reinstatement: "Request reinstatement",
  reinstate: "Reinstate after review",
  reinstate_accounts: "Reinstate selected accounts",
  deny_reinstatement: "Deny reinstatement",
};

const RESULT_LABELS: Record<EnforcementPreview["result"], string> = {
  revision_appended: "Appends the matching revision",
  revision_pending: "Revision pending",
  no_revision_needed: "No revision needed",
};

/** The decision on a confirmed malicious result also bans the maintainer. */
function actionLabel(action: EnforcementAction, decision: boolean): string {
  return action === "ban" && decision
    ? "Ban project and maintainer"
    : ACTION_LABELS[action];
}

function maintainerList(maintainers: { githubLogin: string }[]) {
  return maintainers.map((maintainer, index) => (
    <Fragment key={maintainer.githubLogin}>
      {index > 0 ? ", " : ""}
      <a
        href={`https://github.com/${encodeURIComponent(maintainer.githubLogin)}`}
        target="_blank"
        rel="noreferrer"
      >
        @{maintainer.githubLogin}
      </a>
    </Fragment>
  ));
}

function availableActions(
  enforcement: AdminProject["enforcement"],
): EnforcementAction[] {
  const projectAppeal = enforcement.projectAppeal === "requested";
  const accountActions: EnforcementAction[] =
    enforcement.bannedMaintainers.length > 0
      ? enforcement.appeal === "requested"
        ? ["reinstate_accounts"]
        : ["request_reinstatement"]
      : [];
  if (enforcement.state === "clear")
    return [...accountActions, "quarantine", "ban"];
  if (enforcement.decisionRequired)
    return projectAppeal
      ? ["ban", "reinstate"]
      : ["ban", "request_reinstatement"];
  const escalate: EnforcementAction[] =
    enforcement.state === "quarantined" ? ["ban"] : [];
  const projectActions: EnforcementAction[] = projectAppeal
    ? ["reinstate"]
    : ["request_reinstatement"];
  if (enforcement.appeal === "requested")
    projectActions.push("deny_reinstatement");
  return [...new Set([...accountActions, ...escalate, ...projectActions])];
}

function stateLabel(state: AdminProject["enforcement"]["state"]): string {
  return state === "clear"
    ? "No restriction"
    : state === "quarantined"
      ? "Quarantined"
      : "Banned";
}

export function ProjectEnforcementPanel({
  project,
  onDone,
}: {
  project: AdminProject;
  onDone: (note: string) => void;
}) {
  const enforcement = project.enforcement;
  const actions = availableActions(enforcement);
  const [action, setAction] = useState<EnforcementAction>(actions[0]);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [responsible, setResponsible] = useState("");
  const [preview, setPreview] = useState<EnforcementPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const request = () => ({
    action,
    reason: reason.trim(),
    evidenceReference: evidence.trim(),
    expectedRevision: project.revision,
    expectedSequence: enforcement.nextSequence,
    ...((action === "ban" && enforcement.decisionRequired) ||
    action === "reinstate_accounts"
      ? {
          responsibleAccounts:
            (action === "reinstate_accounts"
              ? preview?.accountReinstatements
              : preview?.maintainerBans) ??
            responsible
              .split(/[\s,]+/u)
              .filter(Boolean)
              .map((githubLogin) => ({ githubLogin })),
        }
      : {}),
  });
  const path = (mode: "enforcement" | "enforcement-preview") =>
    `admin/projects/${encodeURIComponent(project.id)}/${mode}`;
  const showPreview = (event: FormEvent) => {
    event.preventDefault();
    setBusy("preview");
    setError(null);
    projectApiRequest<{ preview: EnforcementPreview }>(
      "POST",
      path("enforcement-preview"),
      request(),
    ).then(
      (body) => {
        setBusy(null);
        setPreview(body.preview);
      },
      (caught: unknown) => {
        setBusy(null);
        setError(errorMessage(caught));
      },
    );
  };
  const confirm = () => {
    setBusy("apply");
    setError(null);
    projectApiRequest("POST", path("enforcement"), request()).then(
      () =>
        onDone(
          `${actionLabel(action, (preview?.maintainerBans.length ?? 0) > 0)} recorded for ${project.manifest.name}.`,
        ),
      (caught: unknown) => {
        setBusy(null);
        setPreview(null);
        setError(errorMessage(caught));
      },
    );
  };
  return (
    <section aria-labelledby={headingId} className="admin-enforcement">
      <header>
        <h4 id={headingId}>Enforcement</h4>
        <StatusBadge
          icon={
            enforcement.state === "clear" ? <ShieldCheck /> : <CircleAlert />
          }
          tone={
            enforcement.state === "clear"
              ? "success"
              : enforcement.state === "banned"
                ? "danger"
                : "warning"
          }
        >
          {stateLabel(enforcement.state)}
        </StatusBadge>
      </header>
      <dl className="admin-facts">
        {enforcement.appeal !== "none" ? (
          <div>
            <dt>Appeal</dt>
            <dd>
              {enforcement.appeal === "requested"
                ? "Reinstatement requested"
                : enforcement.appeal === "granted"
                  ? "Last appeal granted"
                  : "Last appeal denied"}
            </dd>
          </div>
        ) : null}
        {enforcement.since ? (
          <div>
            <dt>Restricted since</dt>
            <dd>{formatDateTime(enforcement.since)}</dd>
          </div>
        ) : null}
        {enforcement.bannedMaintainers.length > 0 ? (
          <div>
            <dt>Banned maintainers</dt>
            <dd>{maintainerList(enforcement.bannedMaintainers)}</dd>
          </div>
        ) : null}
        {enforcement.restrictedBy.length > 0 ? (
          <div>
            <dt>Restricted by · cannot decide appeal</dt>
            <dd>{maintainerList(enforcement.restrictedBy)}</dd>
          </div>
        ) : null}
      </dl>
      {enforcement.decisionRequired ? (
        <p className="form-error" role="status">
          <CircleAlert aria-hidden="true" /> Confirmed malicious result.
          Reinstatement requires the owner's appeal, a fresh clean scan and a
          moderator decision.
        </p>
      ) : null}
      {enforcement.revisionPending ? (
        <p className="form-error" role="status">
          <CircleAlert aria-hidden="true" /> Restriction active; revision{" "}
          {project.revision} is still {project.status} and{" "}
          {project.manifest.listingTier}. Delist to pause and retire it.
        </p>
      ) : null}
      {enforcement.records.length > 0 ? (
        <section className="admin-subsection">
          <h4 className="admin-subsection-heading">
            <History aria-hidden="true" /> Enforcement history ·{" "}
            {enforcement.records.length}
          </h4>
          <ol className="admin-enforcement-history">
            {enforcement.records.map((record) => (
              <li key={record.id}>
                <strong>
                  {actionLabel(record.action, Boolean(record.maintainerBans))}
                </strong>{" "}
                by{" "}
                {record.actor
                  ? `@${record.actor.githubLogin}`
                  : "the signed security vetting service"}{" "}
                ({record.actorRole}, {record.decisionSource}) on{" "}
                {formatDateTime(record.createdAt)}. Revision{" "}
                {record.beforeRevision}
                {record.afterRevision === null
                  ? ""
                  : ` → ${record.afterRevision}`}
                : {RESULT_LABELS[record.result]}.
                <br />
                Reason: {record.reason}
                <br />
                Evidence:{" "}
                {/^https?:\/\//iu.test(record.evidenceReference) ? (
                  <a
                    href={record.evidenceReference}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {record.evidenceReference}{" "}
                    <ExternalLink aria-hidden="true" />
                  </a>
                ) : (
                  record.evidenceReference
                )}
                {record.maintainerBans ? (
                  <>
                    <br />
                    Banned maintainers: {maintainerList(record.maintainerBans)}
                  </>
                ) : null}
                {record.accountReinstatements?.length ? (
                  <>
                    <br />
                    Reinstated accounts:{" "}
                    {maintainerList(record.accountReinstatements)}
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {enforcement.moderation === "unconfigured" ? (
        <p className="admin-status">Moderation unavailable.</p>
      ) : enforcement.moderation === "not-moderator" ? (
        <p className="admin-status">Moderator access required.</p>
      ) : (
        <form className="admin-actions" onSubmit={showPreview}>
          <label>
            Action
            <select
              disabled={preview !== null}
              onChange={(event) =>
                setAction(event.target.value as EnforcementAction)
              }
              value={action}
            >
              {actions.map((value) => (
                <option key={value} value={value}>
                  {actionLabel(value, enforcement.decisionRequired)}
                </option>
              ))}
            </select>
          </label>
          {(action === "ban" && enforcement.decisionRequired) ||
          action === "reinstate_accounts" ? (
            <label>
              {action === "reinstate_accounts"
                ? "Accounts to reinstate (comma-separated)"
                : "Responsible accounts (comma-separated, optional)"}
              <input
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
                readOnly={preview !== null}
              />
            </label>
          ) : null}
          <label>
            Reason
            <textarea
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              readOnly={preview !== null}
              required
              value={reason}
            />
          </label>
          <label>
            Evidence link or case ID
            <input
              maxLength={500}
              onChange={(event) => setEvidence(event.target.value)}
              readOnly={preview !== null}
              required
              spellCheck={false}
              value={evidence}
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              <CircleAlert aria-hidden="true" /> {error}
            </p>
          ) : null}
          {preview === null ? (
            <div>
              <button
                className="button secondary-button"
                disabled={
                  busy !== null ||
                  reason.trim() === "" ||
                  evidence.trim() === ""
                }
                type="submit"
              >
                {busy === "preview" ? "Preparing preview…" : "Preview action"}
              </button>
            </div>
          ) : (
            <fieldset className="admin-enforcement-preview">
              <legend>Preview</legend>
              <dl className="admin-facts">
                <div>
                  <dt>Project</dt>
                  <dd>
                    {preview.projectName} ({preview.projectId})
                  </dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>
                    {actionLabel(
                      preview.action,
                      preview.maintainerBans.length > 0,
                    )}{" "}
                    · record {preview.sequence}
                  </dd>
                </div>
                <div>
                  <dt>Restriction</dt>
                  <dd>
                    {stateLabel(preview.stateBefore)} →{" "}
                    {stateLabel(preview.stateAfter)}
                  </dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>
                    {preview.revision.after === null
                      ? `Stays at ${preview.revision.before}`
                      : `${preview.revision.before} → ${preview.revision.after}`}
                  </dd>
                </div>
                <div>
                  <dt>Status and listing</dt>
                  <dd>
                    {preview.revision.statusBefore},{" "}
                    {preview.revision.listingTierBefore} →{" "}
                    {preview.revision.statusAfter},{" "}
                    {preview.revision.listingTierAfter}
                  </dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>{RESULT_LABELS[preview.result]}</dd>
                </div>
                {preview.maintainerBans.length > 0 ? (
                  <div>
                    <dt>Maintainer accounts banned</dt>
                    <dd>{maintainerList(preview.maintainerBans)}</dd>
                  </div>
                ) : null}
                {preview.accountReinstatements?.length ? (
                  <div>
                    <dt>Accounts reinstated</dt>
                    <dd>
                      {maintainerList(preview.accountReinstatements)}. The
                      project restriction and other account bans stay in place.
                    </dd>
                  </div>
                ) : null}
              </dl>
              {preview.pendingReason ? (
                <p className="form-error" role="status">
                  <CircleAlert aria-hidden="true" /> Restriction applies now;
                  revision not appended yet: {preview.pendingReason}
                </p>
              ) : null}
              <div>
                <button
                  className={`button ${
                    preview.action === "quarantine" || preview.action === "ban"
                      ? "danger-button"
                      : "primary-button"
                  }`}
                  disabled={busy !== null}
                  onClick={confirm}
                  type="button"
                >
                  {busy === "apply"
                    ? "Recording…"
                    : `Confirm: ${actionLabel(
                        preview.action,
                        preview.maintainerBans.length > 0,
                      )}`}
                </button>
                <button
                  className="button ghost-button"
                  disabled={busy !== null}
                  onClick={() => setPreview(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
        </form>
      )}
    </section>
  );
}
