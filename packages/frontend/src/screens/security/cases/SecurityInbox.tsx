// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"
import { Alert, Button, Disclosure, Field, Select, Spinner, Status } from "@repo/ui";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { SignInPanel } from "../../../app/SignInPanel.tsx";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { useView } from "../../account/useView.ts";
import { LinkReportSection } from "../program/ClaimForm.tsx";
import { run, useMounted } from "../program/hooks.ts";
import { type CaseList, type SecurityCase, caseOf } from "./case.schema.ts";
import { CaseDetail, type PaymentSlot } from "./CaseDetail.tsx";
import { type ReportFilter, awardShort, badge, caseTitle, filterOption, listPresentation, matchesReport, reportFilters } from "./labels.ts";
import { RetryButton, StaleNotice } from "./parts.tsx";
import { type CasesRuntime, casesRuntime, loadCases, openCase, programChoices, recheckSession, watchCases } from "./runtime.vibe";

const casePattern = /^sc_[A-Za-z0-9_-]{8,72}$/u;

export type CasesViewProps = {
  list: CaseList;
  filter: ReportFilter;
  onFilter: (filter: ReportFilter) => void;
  selected: string | null;
  onOpen: (caseId: string | null) => void;
  note: string | null;
  refreshError: string | null;
  onReload: () => void;
  /** The selected case. */
  detail: ReactNode;
  /** Where a reporter links a report filed on GitHub. */
  link?: ReactNode;
};

function Retry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <Button variant="link" onClick={onRetry}>
      <RotateCcw aria-hidden className="size-4" /> {label}
    </Button>
  );
}

function CaseChoice({ record, selected, onOpen }: { record: SecurityCase; selected: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onOpen}
        className="flex w-full flex-col items-start gap-1 rounded-md border border-border p-4 text-left hover:border-primary aria-pressed:border-primary"
      >
        <span className="text-sm text-muted-foreground">{record.projectId}</span>
        <strong title={record.id} className="text-foreground">
          {caseTitle(record)}
        </strong>
        <span className="inline-flex flex-wrap items-center gap-2">
          <Status presentation={listPresentation(record)} />
          <small className="text-muted-foreground">{record.nextStep}</small>
        </span>
        <Status title="Award" presentation={badge(awardShort(record))} />
      </button>
    </li>
  );
}

/** The viewer's private cases: a filter for maintainers, the case list and the selected case. */
export function CasesView({ list, filter, onFilter, selected, onOpen, note, refreshError, onReload, detail, link }: CasesViewProps) {
  const maintains = list.programs.some((entry) => entry.roles.includes("security-maintainer"));
  const shown = list.cases.filter((record) => matchesReport(record, filter));
  return (
    <div className="flex flex-col gap-6">
      {note ? <p role="status">{note}</p> : null}
      {refreshError ? <StaleNotice error={refreshError} onRetry={onReload} /> : null}
      {maintains ? (
        <Field label={<span className="sr-only">Show reports</span>} className="max-w-xs">
          <Select value={filter} onChange={(event) => onFilter(event.target.value as ReportFilter)}>
            {reportFilters.map(([value, label]) => (
              <option key={value} value={value}>
                {filterOption(value, label, list.cases)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <section aria-labelledby="security-cases" className="flex flex-col gap-4">
        <h2 id="security-cases" className="text-xl font-semibold text-foreground">
          Cases
        </h2>
        {list.authorityUnavailable === true ? (
          <p role="status" className="flex items-center gap-2">
            <Status title="Some maintainer access could not be checked" presentation={badge("Partial list", "Caution", "Alert")} />
            <RetryButton label="Retry access check" onRetry={onReload} />
          </p>
        ) : null}
        {list.cases.length === 0 ? (
          <p className="text-muted-foreground">No cases</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((record) => (
              <CaseChoice key={record.id} record={record} selected={selected === record.id} onOpen={() => onOpen(record.id)} />
            ))}
          </ul>
        )}
        {selected ? (
          <>
            <Button variant="ghost" size="icon" className="self-start" aria-label="Back to reports" title="Back to reports" onClick={() => onOpen(null)}>
              <ArrowLeft aria-hidden className="size-4" />
            </Button>
            {detail}
          </>
        ) : null}
      </section>
      {link}
    </div>
  );
}

function initialCase(): string | null {
  const id = new URLSearchParams(location.search).get("case");
  return id !== null && casePattern.test(id) ? id : null;
}

function Link({ runtime, section, owner, onCreated }: { runtime: PageRuntime; section: CasesRuntime; owner: string; onCreated: (created: unknown) => void }) {
  const choices = useMounted(section, programChoices);
  return (
    <Disclosure summary="Link report" defaultOpen={location.hash === "#security-link"}>
      {choices.status === "running" ? (
        <p role="status">Loading projects…</p>
      ) : choices.status === "failed" ? (
        <Alert variant="destructive">{choices.message}</Alert>
      ) : choices.value.kind === "failed" ? (
        <Alert variant="destructive">{choices.value.message}</Alert>
      ) : (
        <LinkReportSection runtime={runtime} owner={owner} projects={choices.value.projects} onCreated={onCreated} />
      )}
    </Disclosure>
  );
}

type ContentProps = { runtime: PageRuntime; section: CasesRuntime; owner: string; embedded: boolean; payment?: PaymentSlot };

function InboxContent({ runtime, section, owner, embedded, payment }: ContentProps) {
  useMounted(section, () => loadCases(owner));
  const list = useView(section, watchCases);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [selected, setSelected] = useState<string | null>(initialCase);
  const [note, setNote] = useState<string | null>(null);
  const reload = () => void run(section, loadCases(owner));
  const open = (caseId: string | null) => {
    setSelected(caseId);
    const query = new URLSearchParams(location.search);
    if (caseId) query.set("case", caseId);
    else query.delete("case");
    history.replaceState(history.state, "", `${embedded ? "/inbox" : "/security"}?${query}`);
    if (caseId) reload();
    else void run(section, openCase(owner, null));
  };
  const created = (value: unknown) => {
    const record = caseOf(value);
    if (record) setSelected(record.id);
    setNote("Report saved.");
    reload();
  };
  if (list === undefined || list.status === "loading" || (list.status === "ready" && list.value.viewer.githubId !== owner)) return <Spinner size="sm" label="Loading your cases…" />;
  switch (list.status) {
    case "problem":
      return (
        <Alert variant="destructive" action={<Retry label="Reload" onRetry={() => void run(section, recheckSession()).then(reload)} />}>
          {list.message}
        </Alert>
      );
    case "failed":
      return (
        <Alert variant="destructive" action={<Retry label="Retry" onRetry={reload} />}>
          {list.message}
        </Alert>
      );
    case "ready":
      return (
        <CasesView
          list={list.value}
          filter={filter}
          onFilter={(next) => {
            setFilter(next);
            open(null);
          }}
          selected={selected}
          onOpen={open}
          note={note}
          refreshError={list.refreshError}
          onReload={reload}
          detail={selected ? <CaseDetail key={selected} runtime={section} owner={owner} caseId={selected} payment={payment} /> : null}
          link={embedded ? undefined : <Link runtime={runtime} section={section} owner={owner} onCreated={created} />}
        />
      );
    default: {
      const _exhaustive: never = list;
      return _exhaustive;
    }
  }
}

export type SecurityInboxProps = {
  runtime: PageRuntime;
  /** Shown inside the Inbox instead of on `/security`. */
  embedded?: boolean;
  /** The payment controls of a case, from the bounty payment screens. */
  payment?: PaymentSlot;
};

/** The signed-in viewer's private security cases, read again whenever the account or its lifetime changes. */
export function SecurityInbox({ runtime, embedded = false, payment }: SecurityInboxProps) {
  const shown = useSession(runtime);
  const section = casesRuntime(runtime);
  const signIn = shown === undefined ? "" : loginHrefFor(shown, embedded ? "/inbox?view=reports" : "/security");
  let body: ReactNode;
  if (shown === undefined || shown.view.status === "checking") body = <Spinner size="sm" label="Checking private session…" />;
  else if (shown.view.status === "signedIn")
    body = <InboxContent key={shown.view.session.githubId} runtime={runtime} section={section} owner={shown.view.session.githubId} embedded={embedded} payment={payment} />;
  else body = <SignInPanel view={shown.view} href={signIn} />;
  return embedded ? (
    <section aria-label="Private security reports" className="flex flex-col gap-6">
      {body}
    </section>
  ) : (
    body
  );
}
