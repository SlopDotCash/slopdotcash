// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"
import { Alert, Button, Field, Select, Spinner, Status } from "@repo/ui";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { SignInPanel } from "../../../app/SignInPanel.tsx";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { useView } from "../../account/useView.ts";
import { run, useMounted } from "../program/hooks.ts";
import { type CaseList, type SecurityCase, caseOf } from "./case.schema.ts";
import { CaseDetail, type PaymentSlot } from "./CaseDetail.tsx";
import { SecurityReports } from "./LinkReports.tsx";
import { type ReportFilter, awardShort, badge, caseTitle, filterOption, listPresentation, matchesReport, reportFilters } from "./labels.ts";
import { RetryButton, StaleNotice } from "./parts.tsx";
import { type CasesRuntime, casesRuntime, loadCases, openCase, recheckSession, watchCases } from "./runtime.vibe";

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
  /** The viewer's reports around the case list, given the list without the cases they already show. */
  reports?: (cases: (known: ReadonlyArray<string>) => ReactNode) => ReactNode;
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
export function CasesView({ list, filter, onFilter, selected, onOpen, note, refreshError, onReload, detail, reports }: CasesViewProps) {
  const maintains = list.programs.some((entry) => entry.roles.includes("security-maintainer"));
  const cases = (known: ReadonlyArray<string>) => (
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
          {list.cases
            .filter((record) => !known.includes(record.id) && matchesReport(record, filter))
            .map((record) => (
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
  );
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
      {reports ? reports(cases) : cases([])}
    </div>
  );
}

function initialCase(): string | null {
  if (typeof location === "undefined") return null;
  const id = new URLSearchParams(location.search).get("case");
  return id !== null && casePattern.test(id) ? id : null;
}

type ContentProps = { runtime: PageRuntime; section: CasesRuntime; owner: string; embedded: boolean; payment?: PaymentSlot };

function InboxContent({ runtime, section, owner, embedded, payment }: ContentProps) {
  useMounted(section, () => loadCases(owner));
  const list = useView(section, watchCases);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [selected, setSelected] = useState<string | null>(initialCase);
  const [note, setNote] = useState<string | null>(null);
  const pendingScrollRef = useRef<string | null>(selected);
  const scrollDetailRef = (node: HTMLDivElement | null) => {
    if (node === null || pendingScrollRef.current === null || pendingScrollRef.current !== selected) return;
    pendingScrollRef.current = null;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reload = () => void run(section, loadCases(owner));
  const open = (caseId: string | null) => {
    setSelected(caseId);
    if (typeof location !== "undefined" && typeof history !== "undefined") {
      const query = new URLSearchParams(location.search);
      if (caseId) query.set("case", caseId);
      else query.delete("case");
      const suffix = query.size > 0 ? `?${query}` : "";
      history.replaceState(history.state, "", `${embedded ? "/inbox" : "/security"}${suffix}`);
    }
    if (caseId) {
      reload();
      if (selected === caseId && typeof document !== "undefined") {
        document.getElementById("security-case-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        pendingScrollRef.current = caseId;
      }
    } else {
      pendingScrollRef.current = null;
      void run(section, openCase(owner, null));
    }
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
          detail={selected ? <div id="security-case-detail" tabIndex={-1} ref={scrollDetailRef}><CaseDetail key={selected} runtime={section} owner={owner} caseId={selected} payment={payment} /></div> : null}
          reports={(cases) => (
            <SecurityReports
              runtime={runtime}
              section={section}
              owner={owner}
              list={list.value}
              filter={filter}
              selected={selected}
              onOpen={open}
              onCreated={created}
              onReload={reload}
              cases={cases}
              embedded={embedded}
            />
          )}
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
