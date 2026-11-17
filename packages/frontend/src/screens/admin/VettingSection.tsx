// spec/security/enforcement.md, "Assessments are queued by setup, owner rescan, administrator investigation or flag recovery"; spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/security/enforcement.md, "Clearance and restrictions are separate dimensions with their own records"
import { Alert, Button, ExternalLink, Field, Select, Status, Textarea } from "@repo/ui";
import { CircleAlert, History, ScanSearch } from "lucide-react";
import { useRef, useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { queueScan } from "../../flows/projects/vetting.vibe";
import { scanClearanceView } from "../../projections/clearance.ts";
import { isAdminActionAccessLoss } from "../../session/adminAccess.vibe";
import { useRun } from "../setup/proposal/run.ts";
import { ScanClearance } from "../setup/status/ScanClearance.tsx";
import { adminReadMessages, vettingRead } from "./actions.vibe";
import { AdmissionExemptions } from "./AdmissionExemptions.tsx";
import { AssessmentDetails } from "./AssessmentDetails.tsx";
import { ExemptionHistory } from "./ExemptionHistory.tsx";
import { act, Fact, Facts, LoadFailure, Notice, Subsection, Waiting } from "./parts.tsx";
import { clearancePresentation, decidedBy, type Flag, type ProjectVetting, projectVetting, type VettedProject } from "./vetting.ts";

function Flags({ flags }: { flags: ReadonlyArray<Flag> }) {
  if (flags.length === 0) return null;
  return (
    <Subsection icon={<CircleAlert aria-hidden />} title={`Active contributor flags · ${flags.length}`}>
      <ul className="flex flex-col gap-2 text-sm">
        {flags.map((flag) => (
          <li key={flag.id}>
            @{flag.reporter.githubLogin} · {flag.category} · {formatDateTime(flag.createdAt)}: {flag.evidence}
            {flag.evidenceUrl ? (
              <>
                {" "}
                <ExternalLink href={flag.evidenceUrl}>Evidence</ExternalLink>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Subsection>
  );
}

type QueueScanProps = {
  runtime: PageRuntime;
  actorId: string;
  project: VettedProject;
  onQueued: () => void;
  onAccessLost: () => void;
};

/** An administrator investigation: a scan of the current revision, queued with its reason. */
function QueueScan({ runtime, actorId, project, onQueued, onAccessLost }: QueueScanProps) {
  const [reason, setReason] = useState("");
  const [repository, setRepository] = useState(project.repositories?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const queue = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const acted = await act(runtime, queueScan(actorId, { projectId: project.id, revision: project.revision, reason, ...(project.repositories ? { repository } : {}) }), (failure) => failure._tag !== "VettingIncomplete" && isAdminActionAccessLoss(failure), "The scan could not be queued.");
    inFlight.current = false;
    setBusy(false);
    if (acted.ok) return onQueued();
    setError(acted.message);
    if (acted.accessLost) onAccessLost();
  };
  return (
    <Subsection icon={<ScanSearch aria-hidden />} title={`Scan revision ${project.revision}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void queue();
        }}
      >
        {project.repositories ? (
          <Field label="Repository">
            <Select value={repository} onChange={(event) => setRepository(event.target.value)}>
              {project.repositories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Reason for the scan">
          <Textarea maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button type="submit" variant="secondary" className="self-start" loading={busy} disabled={busy}>
          <ScanSearch aria-hidden />
          {busy ? "Queuing…" : `Queue scan of revision ${project.revision}`}
        </Button>
      </form>
    </Subsection>
  );
}

type VettingCardProps = {
  runtime: PageRuntime;
  actorId: string;
  vetting: ProjectVetting;
  queueAvailable: boolean;
  onChanged: (note: string) => void;
  onAccessLost: () => void;
};

function VettingCard({ runtime, actorId, vetting, queueAvailable, onChanged, onAccessLost }: VettingCardProps) {
  const { project, history, queued, exemptions, flags } = vetting;
  const clearance = project.clearance;
  const latest = history.find((assessment) => assessment.state !== "pending");
  const quarantinedView = clearance?.state === "quarantined" && latest ? scanClearanceView(latest) : null;
  return (
    <article aria-label={`Security vetting for ${project.id}`} className="flex flex-col gap-5 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Current clearance</span>
        <Status presentation={clearancePresentation(clearance)} />
      </header>
      <Facts>
        <Fact term="Current revision">
          {project.id} · revision {project.revision} · {project.status}
        </Fact>
        <Fact term="Decided by">
          {clearance === null ? (
            "Awaiting admission scan"
          ) : (
            <ul className="flex flex-col gap-1">
              {decidedBy(project).map((entry) => (
                <li key={`${entry.repository ?? project.id}`}>{entry.repository ? `${entry.repository}: ${entry.text}` : entry.text}</li>
              ))}
            </ul>
          )}
        </Fact>
        {latest ? (
          <Fact term="Held artifacts">
            {latest.heldArtifacts} of {latest.artifacts}
          </Fact>
        ) : null}
        {quarantinedView ? (
          <Fact term="Owner sees">
            <ScanClearance view={quarantinedView} />
          </Fact>
        ) : null}
      </Facts>
      {clearance?.state === "banned" ? <Alert variant="destructive">Confirmed malicious. A new scan cannot lift the ban.</Alert> : null}
      <Flags flags={flags} />
      <div className="grid gap-6 lg:grid-cols-2">
        {queueAvailable && !queued ? <QueueScan runtime={runtime} actorId={actorId} project={project} onAccessLost={onAccessLost} onQueued={() => onChanged(`Queued a scan of ${project.id} revision ${project.revision}.`)} /> : null}
        <AdmissionExemptions
          runtime={runtime}
          actorId={actorId}
          project={project}
          exemptions={exemptions}
          onAccessLost={onAccessLost}
          onSaved={(revoked) => onChanged(revoked ? `Revoked the owner-approved exemption for ${project.id}.` : `Recorded the owner-approved exemption for ${project.id}.`)}
        />
      </div>
      {history.length > 0 ? (
        <Subsection icon={<History aria-hidden />} title="Scan history">
          {history.map((assessment) => (
            <AssessmentDetails key={assessment.id} assessment={assessment} />
          ))}
        </Subsection>
      ) : null}
      <ExemptionHistory exemptions={exemptions} />
    </article>
  );
}

export type VettingSectionProps = {
  runtime: PageRuntime;
  actorId: string;
  projectId: string;
  onAccessLost: () => void;
};

/** One project's security vetting: its clearance and what decided it, active flags, a scan an administrator queues, owner-approved exemptions and the scan history. */
export function VettingSection({ runtime, actorId, projectId, onAccessLost }: VettingSectionProps) {
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const read = useRun(runtime, `vetting:${actorId}:${projectId}:${attempt}`, () => vettingRead(actorId), adminReadMessages.vetting, {
    settle: (value) => {
      if (value.kind !== "lost") return;
      setNote(null);
      onAccessLost();
    },
  });
  const reload = () => setAttempt((count) => count + 1);
  const changed = (message: string) => {
    setNote(message);
    reload();
  };
  const body = () => {
    if (read === undefined || read.status === "running") return <Waiting>Loading security vetting…</Waiting>;
    if (read.status === "failed") return <LoadFailure message={read.message} onRetry={reload} />;
    if (read.value.kind === "lost") return <LoadFailure message={read.value.message} onRetry={reload} />;
    const { overview } = read.value;
    const vetting = projectVetting(overview, projectId);
    return (
      <>
        {overview.service.state === "unavailable" ? <Alert variant="destructive">Vetting service unavailable. {overview.service.reason}</Alert> : null}
        {vetting === undefined ? (
          <p className="text-sm text-muted-foreground">No vetting record yet.</p>
        ) : (
          <VettingCard runtime={runtime} actorId={actorId} vetting={vetting} queueAvailable={overview.service.queueRegistrationAvailable} onChanged={changed} onAccessLost={onAccessLost} />
        )}
      </>
    );
  };
  return (
    <section aria-labelledby="admin-vetting" className="flex flex-col gap-4">
      <h2 id="admin-vetting" className="text-lg font-semibold text-foreground">
        Security vetting
      </h2>
      {note ? <Notice>{note}</Notice> : null}
      {body()}
    </section>
  );
}
