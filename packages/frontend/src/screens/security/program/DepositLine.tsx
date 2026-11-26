// spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"
import { ExternalLink } from "@repo/ui";
import { depositEnd } from "../../../flows/security/deposit.vibe";
import { type ReportDepositStatus, reportDepositPathCase, reportDepositStatusText } from "../../../projections/reportDeposit.ts";
import { useMounted } from "./hooks.ts";
import type { ProgramRuntime } from "./runtime.vibe";

export type DepositEndShown = { readonly status: "loading" } | { readonly status: "settled"; readonly href: string | null };

export type DepositLineViewProps = {
  status: ReportDepositStatus;
  /** The public record's answer for an ended deposit: the transaction that ended it, once read. */
  end: DepositEndShown;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

function ended(status: ReportDepositStatus): boolean {
  return status.state === "refunded" || status.state === "kept";
}

/** The reporter's deposit line: needed with the pay page, then recorded, then how it ended with the transaction that did it. */
export function DepositLineView({ status, end }: DepositLineViewProps) {
  const text = reportDepositStatusText(status);
  if (status.state === "needed")
    return (
      <p className="text-sm text-muted-foreground">
        {status.payPath === null ? (
          text
        ) : (
          <a href={status.payPath} className={linkClass}>
            {text}
          </a>
        )}
      </p>
    );
  const href = ended(status) && end.status === "settled" ? end.href : null;
  const record = ended(status) && end.status === "settled" && href === null ? status.payPath : null;
  return (
    <p className="text-sm text-muted-foreground">
      {text}
      {href === null ? null : (
        <>
          {" · "}
          <ExternalLink href={href} className={linkClass}>
            {status.state === "kept" ? "Kept transaction" : "Refund transaction"}
          </ExternalLink>
        </>
      )}
      {record === null ? null : (
        <>
          {" · "}
          <a href={record} className={linkClass}>
            Deposit record
          </a>
        </>
      )}
    </p>
  );
}

function EndedDeposit({ section, status, caseId }: { section: ProgramRuntime; status: ReportDepositStatus; caseId: string }) {
  const read = useMounted(section, () => depositEnd(caseId));
  const end: DepositEndShown = read.status === "running" ? { status: "loading" } : { status: "settled", href: read.status === "done" ? read.value.href : null };
  return <DepositLineView status={status} end={end} />;
}

/** The deposit line of one report; an ended deposit reads its public record once, without cache. */
export function DepositLine({ section, status }: { section: ProgramRuntime; status: ReportDepositStatus }) {
  const caseId = status.payPath === null ? null : reportDepositPathCase(status.payPath);
  if (ended(status) && caseId !== null) return <EndedDeposit section={section} status={status} caseId={caseId} />;
  return <DepositLineView status={status} end={{ status: "settled", href: null }} />;
}
