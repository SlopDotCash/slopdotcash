// spec/security/cases.md, "A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim"; spec/security/forwarding.md, "A separate exact advisory read links one verified receipt to the saved case"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"; spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"; spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"
import { Alert, Button, Checkbox, Disclosure, Field, Input, Label, Select } from "@repo/ui";
import { GitBranch } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import type { SubmissionView } from "@repo/security/client";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { type RecordRequest, importAdvisories, recordAdvisory } from "../../../flows/security/cases.vibe";
import type { DetailHeadings } from "../../../flows/security/details.vibe";
import { type ReportRead, type SubmissionsRead, closeSubmissionReport, loadSubmissions, openSubmissionReport, refusalMessage, verifyDirect } from "../../../flows/security/intake.vibe";
import { ClaimForm, type ProgramChoice } from "../program/ClaimForm.tsx";
import { DepositNotice } from "../program/DepositNotice.tsx";
import { type Settled, run, useMounted } from "../program/hooks.ts";
import { type DetailRead, ReportDetail } from "../program/ReportDetail.tsx";
import { type ProgramRuntime, type SubmissionRequest, actOnSubmission, programRuntime } from "../program/runtime.vibe";
import { SubmissionEntry } from "../program/SubmissionCard.tsx";
import { type SubmissionList, SubmissionsPanel } from "../program/SubmissionsPanel.tsx";
import { type CaseSummary, knownCaseIds, needsLinkFallback } from "../program/summary.ts";
import type { Sent } from "./ActionForm.tsx";
import type { CaseList, SecurityCase } from "./case.schema.ts";
import { type ReportFilter, awardShort, matchesReport } from "./labels.ts";
import { type CasesRuntime, programChoices } from "./runtime.vibe";

export type Verified = Sent & { readonly unavailable: boolean };

export type ImportNote = { readonly note: string | null; readonly error: string | null };

export const importMessages = { unavailable: "GitHub read failed. Retry.", none: "Up to date" } as const;

const ghsa = "GHSA-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}-[2-9cfghjmpqrvwx]{4}";

function ProjectField({ projects, value, onChange }: { projects: ReadonlyArray<ProgramChoice>; value: string; onChange: (projectId: string) => void }) {
  return (
    <Field label="Project">
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function FormError({ message }: { message: string | null }) {
  return message === null ? null : <Alert variant="destructive">{message}</Alert>;
}

function DirectVerifyForm({ projects, onVerify, onUnavailable }: { projects: ReadonlyArray<ProgramChoice>; onVerify: LinkReportsViewProps["onVerify"]; onUnavailable: () => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [advisory, setAdvisory] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (projects.length === 0) return <p className="text-muted-foreground">No programs yet</p>;
  const chosen = projects.find((project) => project.id === projectId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void onVerify(projectId, advisory, key).then((sent) => {
      setKey(sent.key);
      if (sent.error === null) return;
      setBusy(false);
      setError(sent.error);
      if (sent.unavailable) onUnavailable();
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
      {chosen === undefined ? null : <DepositNotice project={chosen} />}
      <Field label="GitHub advisory ID">
        <Input autoComplete="off" pattern={ghsa} placeholder="GHSA-xxxx-xxxx-xxxx" required spellCheck={false} value={advisory} onChange={(event) => setAdvisory(event.target.value)} />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="self-start" loading={busy}>
        <GitBranch aria-hidden className="size-4" /> {busy ? "Opening…" : "Verify"}
      </Button>
    </form>
  );
}

const blankRecord = (projectId: string): RecordRequest => ({ projectId, advisory: "", reporterGithubId: "", reporterGithubLogin: "", receivedAt: "", confirmation: false });

function RecordForm({ projects, onRecord }: { projects: ReadonlyArray<ProgramChoice>; onRecord: LinkReportsViewProps["onRecord"] }) {
  const [request, setRequest] = useState(() => blankRecord(projects[0]?.id ?? ""));
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();
  const set = (patch: Partial<RecordRequest>) => setRequest({ ...request, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void onRecord(request, key).then((sent) => {
      setBusy(false);
      setKey(sent.key);
      setError(sent.error);
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <ProjectField projects={projects} value={request.projectId} onChange={(projectId) => set({ projectId })} />
      <Field label="GitHub advisory ID">
        <Input autoComplete="off" required spellCheck={false} value={request.advisory} onChange={(event) => set({ advisory: event.target.value })} />
      </Field>
      <Field label="Reporter ID">
        <Input inputMode="numeric" required value={request.reporterGithubId} onChange={(event) => set({ reporterGithubId: event.target.value })} />
      </Field>
      <Field label="Reporter login">
        <Input required value={request.reporterGithubLogin} onChange={(event) => set({ reporterGithubLogin: event.target.value })} />
      </Field>
      <Field label="Received (UTC)">
        <Input required type="datetime-local" value={request.receivedAt} onChange={(event) => set({ receivedAt: event.target.value })} />
      </Field>
      <div className="flex items-start gap-3">
        <Checkbox id={confirmId} checked={request.confirmation} onCheckedChange={(checked) => set({ confirmation: checked === true })} />
        <Label htmlFor={confirmId}>Verified on GitHub</Label>
      </div>
      <FormError message={error} />
      <Button type="submit" className="self-start" loading={busy}>
        {busy ? "Recording…" : "Record"}
      </Button>
    </form>
  );
}

function ImportReports({ projects, onImport }: { projects: ReadonlyArray<ProgramChoice>; onImport: LinkReportsViewProps["onImport"] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ImportNote>({ note: null, error: null });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setShown({ note: null, error: null });
    void onImport(projectId).then((done) => {
      setBusy(false);
      setShown(done);
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {projects.length > 1 ? <ProjectField projects={projects} value={projectId} onChange={setProjectId} /> : null}
      {shown.note === null ? null : <p role="status">{shown.note}</p>}
      <FormError message={shown.error} />
      <Button type="submit" variant="secondary" className="self-start" loading={busy}>
        {busy ? "Importing…" : "Import from GitHub"}
      </Button>
    </form>
  );
}

export type LinkReportsViewProps = {
  /** Every listed project a reporter may link a report to. */
  projects: ReadonlyArray<ProgramChoice>;
  /** The projects whose security maintainer the viewer is. */
  maintained: ReadonlyArray<ProgramChoice>;
  /** Whether GitHub verifies reports automatically; null until the report list answers. */
  automatic: boolean | null;
  /** Whether a report failed in a way GitHub cannot verify. */
  fallback: boolean;
  /** The form that links a report for maintainer review. */
  claim: ReactNode;
  onVerify: (projectId: string, advisory: string, key: string | null) => Promise<Verified>;
  onRecord: (request: RecordRequest, key: string | null) => Promise<Sent>;
  onImport: (projectId: string) => Promise<ImportNote>;
};

/** `#security-link`: a report filed on GitHub, verified by GitHub or linked for maintainer review, and its maintainers' import. */
export function LinkReportsView({ projects, maintained, automatic, fallback, claim, onVerify, onRecord, onImport }: LinkReportsViewProps) {
  const [directUnavailable, setDirectUnavailable] = useState(false);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const linked = fallback || directUnavailable;
  const open = toggled ?? (linked || location.hash === "#security-link");
  return (
    <Disclosure summary="Link report" open={open} onOpenChange={setToggled}>
      <div className="flex flex-col gap-6 pt-2 text-foreground">
        {automatic === true ? (
          <section id="security-link" aria-label="Verify a GitHub report" className="flex flex-col gap-4">
            <DirectVerifyForm projects={projects} onVerify={onVerify} onUnavailable={() => setDirectUnavailable(true)} />
            {linked ? (
              <>
                <p className="text-muted-foreground">Not verified. Link for maintainer review:</p>
                {claim}
              </>
            ) : null}
          </section>
        ) : automatic === false ? (
          <section id="security-link" aria-label="Link a GitHub report" className="flex flex-col gap-4">
            {claim}
          </section>
        ) : null}
        {maintained.length > 0 ? (
          <section aria-labelledby="security-import" className="flex flex-col gap-4">
            <h2 id="security-import" className="text-xl font-semibold text-foreground">
              Import
            </h2>
            {automatic === false ? <RecordForm projects={maintained} onRecord={onRecord} /> : <ImportReports projects={maintained} onImport={onImport} />}
          </section>
        ) : null}
      </div>
    </Disclosure>
  );
}

export type LinkReportsProps = {
  runtime: PageRuntime;
  section: CasesRuntime;
  /** The signed-in viewer's GitHub user ID. */
  owner: string;
  /** The project IDs the viewer maintains security for. */
  maintained: ReadonlyArray<string>;
  automatic: boolean | null;
  fallback: boolean;
  /** The case a link or record created, as the server returned it. */
  onCreated: (created: unknown) => void;
  /** GitHub's reports were imported; the case list is read again. */
  onImported: () => void;
};

/** The link, verify, record and import forms over the viewer's program choices; every refusal is the server's. */
export function LinkReports({ runtime, section, owner, maintained, automatic, fallback, onCreated, onImported }: LinkReportsProps) {
  const choices = useMounted(section, programChoices);
  if (choices.status === "running") return <p role="status">Loading projects…</p>;
  if (choices.status === "failed") return <Alert variant="destructive">{choices.message}</Alert>;
  if (choices.value.kind === "failed") return <Alert variant="destructive">{choices.value.message}</Alert>;
  const projects = choices.value.projects;
  const verify = async (projectId: string, advisory: string, key: string | null): Promise<Verified> => {
    const done = await run(runtime, verifyDirect(owner, projectId, advisory, key));
    if (!done.ok) return { key, error: done.message, unavailable: false };
    const { key: used, verified } = done.value;
    if (verified.kind === "redirect") {
      location.assign(verified.url);
      return { key: used, error: null, unavailable: false };
    }
    return { key: used, error: verified.message, unavailable: verified.kind === "unavailable" };
  };
  const record = async (request: RecordRequest, key: string | null): Promise<Sent> => {
    const done = await run(runtime, recordAdvisory(owner, request, key));
    if (!done.ok) return { key, error: done.message };
    const { key: used, result } = done.value;
    if (result.kind !== "done") return { key: used, error: refusalMessage(result) };
    onCreated(result.value.case);
    return { key: null, error: null };
  };
  const importReports = async (projectId: string): Promise<ImportNote> => {
    const done = await run(runtime, importAdvisories(owner, projectId));
    if (!done.ok) return { note: null, error: done.message };
    const result = done.value;
    if (result.kind !== "done") return { note: null, error: refusalMessage(result) };
    if (result.value.state === "unavailable") return { note: null, error: importMessages.unavailable };
    onImported();
    return { note: result.value.received === 0 ? importMessages.none : `${result.value.received} imported`, error: null };
  };
  return (
    <LinkReportsView
      projects={projects}
      maintained={projects.filter((project) => maintained.includes(project.id))}
      automatic={automatic}
      fallback={fallback}
      claim={<ClaimForm runtime={runtime} owner={owner} projects={projects} onCreated={onCreated} />}
      onVerify={verify}
      onRecord={record}
      onImport={importReports}
    />
  );
}

const submissionPattern = /^ss_[A-Za-z0-9_-]{8,72}$/u;
const grantPattern = /^grant_[a-z_]{3,40}$/u;

export type ReportsSlot = {
  section: CasesRuntime;
  /** The signed-in viewer's GitHub user ID. */
  owner: string;
  list: CaseList;
  filter: ReportFilter;
  selected: string | null;
  onOpen: (caseId: string | null) => void;
  /** The case a link or record created, as the server returned it. */
  onCreated: (created: unknown) => void;
  onReload: () => void;
  /** The case list section without the cases already shown as reports, shown when one remains. */
  cases: (known: ReadonlyArray<string>) => ReactNode;
  /** Shown inside the Inbox: the linked receipt is read first, no report text is read and nothing is linked. */
  embedded: boolean;
};

function returned(): { readonly focusId: string | null; readonly grantError: string | null } {
  const query = new URLSearchParams(location.search);
  const submission = query.get("submission");
  const intake = query.get("intake");
  return {
    focusId: submission !== null && submissionPattern.test(submission) ? submission : null,
    grantError: intake !== null && grantPattern.test(intake) ? intake : null,
  };
}

function summaryOf(record: SecurityCase): CaseSummary {
  return { id: record.id, advisory: record.advisory ?? null, nextStep: record.nextStep, nextStepDueAt: record.nextStepDueAt, award: awardShort(record) };
}

function detailOf(read: Settled<ReportRead>): DetailRead {
  if (read.status === "running") return { status: "loading" };
  if (read.status === "failed") return { status: "error", message: read.message };
  const value = read.value;
  switch (value.kind) {
    case "ready":
      return { status: "ready", report: value.report };
    case "signedOut":
      return { status: "signedOut" };
    case "failed":
      return { status: "error", message: value.message };
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

type ReaderProps = {
  section: ProgramRuntime;
  owner: string;
  submission: SubmissionView;
  headings: DetailHeadings;
  onUpdated: (submission: SubmissionView) => void;
};

function OpenedReport({ section, owner, submission, headings, onUpdated, onClose, onReread }: ReaderProps & { onClose: () => void; onReread: () => void }) {
  const read = useMounted(section, () => openSubmissionReport(owner, submission.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (request: SubmissionRequest) => {
    setBusy(true);
    setError(null);
    void run(section, actOnSubmission(owner, submission, request)).then((done) => {
      setBusy(false);
      if (!done.ok) return setError(done.message);
      const result = done.value;
      if (result.kind === "redirect") return location.assign(result.url);
      if (result.kind !== "updated") return setError(result.message);
      onUpdated(result.submission);
      onReread();
    });
  };
  return (
    <>
      <ReportDetail
        submission={submission}
        headings={headings}
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        detail={detailOf(read)}
        onRetry={onReread}
        busy={busy}
        onRevise={(draft) => act({ kind: "revise", draft })}
        onReview={(decision, reason) => act({ kind: "review", decision, reason })}
      />
      {error === null ? null : <Alert variant="destructive">{error}</Alert>}
    </>
  );
}

/** A report's private text, read only while its authorized reader keeps it open; closing it closes this report alone. */
function ReportReader(props: ReaderProps & { focused: boolean }) {
  const [open, setOpen] = useState(props.focused);
  const [round, setRound] = useState(0);
  const close = () => {
    setOpen(false);
    void run(props.section, closeSubmissionReport(props.submission.id));
  };
  if (open) return <OpenedReport key={round} {...props} onClose={close} onReread={() => setRound(round + 1)} />;
  return (
    <ReportDetail
      submission={props.submission}
      headings={props.headings}
      open={false}
      onOpenChange={setOpen}
      detail={{ status: "loading" }}
      onRetry={() => setOpen(true)}
      busy={false}
      onRevise={() => undefined}
      onReview={() => undefined}
    />
  );
}

/** The viewer's private reports, the cases they do not already show, and where a report filed on GitHub is linked or imported. */
export function SecurityReports({ runtime, section, owner, list, filter, selected, onOpen, onCreated, onReload, cases, embedded }: ReportsSlot & { runtime: PageRuntime }) {
  const program = programRuntime(runtime);
  const [{ focusId, grantError }] = useState(returned);
  const first = useMounted(program, () => loadSubmissions(owner, focusId, embedded));
  const [latest, setLatest] = useState<SubmissionsRead | null>(null);
  const [updated, setUpdated] = useState<ReadonlyMap<string, SubmissionView>>(() => new Map());
  const read: SubmissionsRead | null = latest ?? (first.status === "done" ? first.value : first.status === "failed" ? { kind: "failed", message: first.message } : null);
  const refresh = () =>
    void run(program, loadSubmissions(owner, focusId, embedded)).then((done) => {
      const next: SubmissionsRead = done.ok ? done.value : { kind: "failed", message: done.message };
      setUpdated(new Map());
      setLatest(next.kind === "failed" && read?.kind === "ready" ? { ...read, automatic: false, error: next.message } : next);
    });
  const update = (next: SubmissionView) => setUpdated((prior) => new Map(prior).set(next.id, next));
  const submissions = read?.kind === "ready" ? read.submissions.map((entry) => updated.get(entry.id) ?? entry) : [];
  const shown: SubmissionList =
    read === null
      ? { status: "loading" }
      : read.kind === "failed"
        ? { status: "failed", message: read.message }
        : { status: "ready", submissions, authorityUnavailable: read.authorityUnavailable, refreshError: read.error };
  const known = knownCaseIds(submissions, focusId);
  const showsCases = selected !== null || list.authorityUnavailable === true || list.cases.some((record) => !known.includes(record.id));
  const shows = (summary: CaseSummary | undefined) => {
    const record = summary === undefined ? undefined : list.cases.find((entry) => entry.id === summary.id);
    return record === undefined ? filter === "all" : matchesReport(record, filter);
  };
  const maintained = list.programs.filter((entry) => entry.roles.includes("security-maintainer")).map((entry) => entry.projectId);
  const entry = (submission: SubmissionView, caseRecord: CaseSummary | undefined, focused: boolean) => (
    <SubmissionEntry
      section={program}
      owner={owner}
      login={list.viewer.githubLogin}
      submission={submission}
      caseRecord={caseRecord}
      caseDeposit={caseRecord === undefined ? undefined : list.cases.find((record) => record.id === caseRecord.id)?.deposit}
      focused={focused}
      report={embedded || submission.intake === null ? undefined : (headings) => <ReportReader section={program} owner={owner} submission={submission} headings={headings} focused={focused} onUpdated={update} />}
      onUpdated={update}
      onOpenCase={onOpen}
    />
  );
  return (
    <>
      <SubmissionsPanel list={shown} cases={list.cases.map(summaryOf)} focusId={focusId} grantError={grantError} shows={shows} onRefresh={refresh} entry={entry} />
      {showsCases ? cases(known) : null}
      {embedded ? null : (
        <LinkReports
          runtime={runtime}
          section={section}
          owner={owner}
          maintained={maintained}
          automatic={read === null ? null : read.kind === "ready" && read.automatic}
          fallback={needsLinkFallback(submissions)}
          onCreated={onCreated}
          onImported={onReload}
        />
      )}
    </>
  );
}
