import { LoaderCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { networkLabel } from "./lib/network-names";
import {
  type ReportDeposit,
  ReportDepositRecordError,
  readReportDeposit,
  reportDepositCase,
  reportDepositPath,
} from "./lib/report-deposit-page";
import {
  REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS,
  REPORT_DEPOSIT_REFUND_SILENT_DAYS,
} from "./lib/security-report-deposit.mjs";
import { SUBMISSION_FEE_RECLAIM_DAYS } from "./lib/submission-fee.mjs";
import {
  type FeeTables,
  type FeeWay,
  feeAmountText,
  feeDepositKey,
} from "./lib/submission-fee-page";
import { reportDepositSetup } from "./lib/submission-fee-setup";
import { usePublicResource } from "./lib/use-public-resource";
import { Spinner } from "./Presentation";
import { PaidRecord } from "./SubmissionFeePage";
import "./submission-fee.css";

const SubmissionFeePay = lazy(() =>
  import("./SubmissionFeePay").then((module) => ({
    default: module.SubmissionFeePay,
  })),
);

/** While this tab's deposit waits to be recorded, the record is read again this often. */
const RECORD_REFRESH_MS = 20_000;

/**
 * A refresh that fails in transit keeps the record on screen; a record that
 * fails the address check is never kept. One object, so the read's effect
 * does not restart on every render.
 */
const RECORD_RETENTION = {
  retainOnTransientFailure: true,
  retainFailure: (error: unknown) =>
    !(error instanceof ReportDepositRecordError),
};

/** A payment saved in this tab reopens the form after a reload. */
function hasSavedRequest(item: string): boolean {
  try {
    return sessionStorage.getItem(feeDepositKey(item)) !== null;
  } catch {
    return false;
  }
}

/** The deposit record of one report, or null when Slop has asked no deposit for it. */
async function loadReportDeposit(
  caseId: string,
  tables: FeeTables,
  signal?: AbortSignal,
): Promise<ReportDeposit | null> {
  const response = await fetchWithDeadline(
    reportDepositPath(caseId),
    // The record changes when a deposit is recorded; never show a cached one.
    { signal, cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The deposit record is unavailable.");
  return readReportDeposit(
    await readBoundedJson(response, 16_384, "report deposit record"),
    caseId,
    tables,
  );
}

/** The terms, in plain words, shown before a wallet is chosen. */
function Terms({ way }: { way: FeeWay }) {
  const network = networkLabel(way.network);
  return (
    <section className="fee-section" aria-label="What happens to the deposit">
      <h2>What happens to the deposit</h2>
      <ul>
        <li>
          It is sent back to the wallet that paid it when the report gets its
          first response that is not one of the closes named next, or if{" "}
          {REPORT_DEPOSIT_REFUND_SILENT_DAYS} days pass after the deposit with
          no response, or if the project turns the deposit off.
        </li>
        <li>
          It is kept only if the report is closed as spam, as a duplicate or as
          out of scope and that close stands for{" "}
          {REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS} days with no open appeal: the
          SLOP is then sent to the burn address, so neither Slop nor the project
          receives it.
        </li>
        <li>
          The deposit is public on {network}: it shows the wallet that paid, the
          amount and that it is a Slop deposit. It does not show the project or
          the report.
        </li>
        <li>
          If nothing settles the deposit, the wallet that paid it can take it
          back from the deposit contract {SUBMISSION_FEE_RECLAIM_DAYS} days
          after the deposit.
        </li>
        <li>
          A deposit of another token, or of less than the amount shown here,
          does not count.
        </li>
        <li>
          The only valid deposit contract is the address shown on this page:{" "}
          <code>{way.contract}</code>. Nobody from Slop or from the project
          sends a payment address in a message.
        </li>
        <li>
          An AI agent does not move money. It hands this page to the person it
          works for.
        </li>
      </ul>
    </section>
  );
}

function Due({
  deposit,
  tables,
  onChanged,
}: {
  deposit: ReportDeposit;
  tables: FeeTables;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(() => hasSavedRequest(deposit.item));
  const confirmDue = useCallback(
    async (way: FeeWay) => {
      const latest = await loadReportDeposit(deposit.caseId, tables);
      const current = latest?.due[0];
      if (!current || current.amount !== way.amount) {
        onChanged();
        throw new Error(
          latest?.paid
            ? "The deposit for this report is already recorded. Nothing was sent."
            : "The deposit due for this report changed. Nothing was sent. Review the payment again.",
        );
      }
    },
    [deposit.caseId, tables, onChanged],
  );
  const way = deposit.due[0];
  return (
    <>
      {way ? (
        <>
          <section className="fee-section" aria-label="Deposit due">
            <h2>Deposit due</h2>
            <p>
              <strong>{feeAmountText(way)}</strong> on{" "}
              {networkLabel(way.network)}. The report is already stored. It is
              screened once this deposit is recorded.
            </p>
          </section>
          <Terms way={way} />
        </>
      ) : null}
      {open ? (
        <Suspense fallback={<Spinner label="Loading the payment form" />}>
          <SubmissionFeePay
            item={deposit.item}
            ways={deposit.due}
            tables={tables}
            confirmDue={confirmDue}
            onDeposit={onChanged}
            subject="report"
          />
        </Suspense>
      ) : way ? (
        <p>
          <button
            type="button"
            className="button primary-button"
            onClick={() => setOpen(true)}
          >
            Pay from a wallet
          </button>
        </p>
      ) : null}
    </>
  );
}

/**
 * The pay page of the refundable SLOP deposit on a private security report
 * (PRD section 8). No sign-in: any wallet may pay, and the deposit goes back
 * to the wallet that paid. The address names the case and nothing else; the
 * page shows no project and no report.
 */
export default function ReportDepositPage({ caseId }: { caseId: string }) {
  const named = reportDepositCase(caseId);
  const [{ switchedOn, tables }] = useState(reportDepositSetup);
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (named === null) throw new Error("No report.");
      return { deposit: await loadReportDeposit(named, tables, signal) };
    },
    [named, tables],
  );
  const [state, retry] = usePublicResource(
    named !== null,
    load,
    "The deposit record is unavailable.",
    12_000,
    RECORD_RETENTION,
  );
  // After this tab's deposit reaches a block, read the record until it shows.
  const [watching, setWatching] = useState(false);
  const recorded = state.status === "ready" && state.deposit?.paid != null;
  useEffect(() => {
    if (!watching || recorded) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") retry();
    }, RECORD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [watching, recorded, retry]);
  const changed = useCallback(() => {
    setWatching(true);
    retry();
  }, [retry]);
  if (named === null)
    return (
      <main className="shell route-main fee-page">
        <h1>Report deposit</h1>
        <p>This address does not name a report.</p>
      </main>
    );
  const deposit = state.status === "ready" ? state.deposit : undefined;
  return (
    <main className="shell route-main fee-page">
      <h1>Report deposit</h1>
      <p>The refundable deposit on one private security report.</p>
      {switchedOn ? null : (
        <p className="fee-off" role="note">
          The report deposit is not switched on. No deposit is due for any
          report, and this page offers no way to pay.
        </p>
      )}
      {state.status === "error" ? (
        <div role="alert">
          <p>{state.message}</p>
          <button
            className="button secondary-button"
            type="button"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : deposit === undefined ? (
        <p aria-label="Loading the deposit record" role="status">
          <LoaderCircle aria-hidden="true" className="wallet-spin" size={18} />
        </p>
      ) : deposit === null ? (
        <p>Slop has not asked a deposit for this report. No deposit is due.</p>
      ) : (
        <>
          {state.status === "ready" && state.refreshError ? (
            <p role="status">
              The record could not be read again just now. The last one read is
              shown.
            </p>
          ) : null}
          <PaidRecord
            item={deposit}
            held="The deposit is held by the deposit contract until the report gets a response."
          />
          {deposit.paid ? null : switchedOn ? null : (
            <p>
              Slop recorded this report for a deposit, but the deposit is not
              switched on, so nothing is asked for it now.
            </p>
          )}
          {/* A payment saved in this tab is still checked after it is recorded. */}
          {switchedOn ? (
            <Due deposit={deposit} tables={tables} onChanged={changed} />
          ) : null}
        </>
      )}
    </main>
  );
}
