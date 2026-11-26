// spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"; spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
import { reclaimDays } from "@repo/backend/client";
import { REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS, REPORT_DEPOSIT_REFUND_SILENT_DAYS } from "@repo/security/client";
import { Alert, Button, PageHeader, Spinner } from "@repo/ui";
import type { Layer } from "effect";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PageProps } from "../../app/pages.ts";
import { networkLabel } from "../../kernels/assetText.ts";
import { amountText } from "../../wallets/fee/feeCalls.ts";
import { PaidRecord, PayForm, RecordState } from "./PayForm.tsx";
import type { FeePay, FeeSetup, FeeWay } from "./payFlow.vibe";
import { type FeeRuntime, feeRuntime } from "./runtime.vibe";
import { useOpened, usePay } from "./usePay.ts";

const page = "mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-8 px-4 py-8";
const section = "flex flex-col gap-3";
const heading = "text-xl font-semibold text-foreground";

function Terms({ way }: { way: FeeWay }) {
  const network = networkLabel(way.network);
  return (
    <section aria-label="What happens to the deposit" className={section}>
      <h2 className={heading}>What happens to the deposit</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
        <li>
          It is sent back to the wallet that paid it when the report gets its first response that is not one of the closes named next, or if {REPORT_DEPOSIT_REFUND_SILENT_DAYS} days pass after the deposit with no response, or if the project turns the deposit off.
        </li>
        <li>
          It is kept only if the report is closed as spam, as a duplicate or as out of scope and that close stands for {REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS} days with no open appeal: the SLOP is then sent to the burn address, so neither Slop nor the project receives it.
        </li>
        <li>The deposit is public on {network}: it shows the wallet that paid, the amount and that it is a Slop deposit. It does not show the project or the report.</li>
        <li>If nothing settles the deposit, the wallet that paid it can take it back from the deposit contract {reclaimDays} days after the deposit.</li>
        <li>A deposit of another token, or of less than the amount shown here, does not count.</li>
        <li>
          The only valid deposit contract is the address shown on this page: <code className="break-all font-mono text-sm">{way.contract}</code>. Nobody from Slop or from the project sends a payment address in a message.
        </li>
        <li>An AI agent does not move money. It hands this page to the person it works for.</li>
      </ul>
    </section>
  );
}

function Opened({ runtime, pay }: { runtime: FeeRuntime; pay: FeePay }) {
  const { state, shown } = usePay(runtime, pay);
  const [open, setOpen] = useState(false);
  if (state?.page === "NotAddressed") return <p className="text-muted-foreground">This address does not name a report.</p>;
  const record = shown?.record;
  const [way] = record?.due ?? [];
  const recorded = state !== undefined && (state.page === "SwitchedOff" || state.page === "Due" || state.page === "Recorded");
  return (
    <>
      <p className="text-muted-foreground">The refundable deposit on one private security report.</p>
      {state !== undefined && !state.switchedOn ? (
        <Alert variant="info">The report deposit is not switched on. No deposit is due for any report, and this page offers no way to pay.</Alert>
      ) : null}
      <RecordState state={state} shown={shown} loading="Loading the deposit record" onRetry={() => void runtime.runPromise(pay.reload())} />
      {state?.page === "NothingAsked" ? <p className="text-muted-foreground">Slop has not asked a deposit for this report. No deposit is due.</p> : null}
      {recorded && record && shown ? (
        <>
          <PaidRecord record={record} held="The deposit is held by the deposit contract until the report gets a response." />
          {state.page === "SwitchedOff" ? <p className="text-muted-foreground">Slop recorded this report for a deposit, but the deposit is not switched on, so nothing is asked for it now.</p> : null}
          {state.switchedOn && way ? (
            <>
              <section aria-label="Deposit due" className={section}>
                <h2 className={heading}>Deposit due</h2>
                <p className="text-muted-foreground">
                  <strong className="font-semibold text-foreground">{amountText(way)}</strong> on {networkLabel(way.network)}. The report is already stored. It is screened once this deposit is recorded.
                </p>
              </section>
              <Terms way={way} />
            </>
          ) : null}
          {state.switchedOn && (open || state.slot.identity !== "" || shown.unreadable) ? (
            <PayForm runtime={runtime} pay={pay} state={state} shown={shown} noun="report" />
          ) : state.switchedOn && way ? (
            <div>
              <Button onClick={() => setOpen(true)}>Pay from a wallet</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function ReportDepositPage({ route, setup }: Pick<PageProps, "route"> & { setup?: Layer.Layer<FeeSetup> }) {
  const runtime = feeRuntime(setup);
  const opened = useOpened(runtime, { kind: "report", caseId: route.caseId });
  return (
    <main className={page}>
      <PageHeader title="Report deposit" icon={<ShieldCheck className="size-6 text-primary" />} />
      {opened.status === "running" ? <Spinner label="Loading the deposit record" /> : null}
      {opened.status === "failed" ? <Alert variant="destructive">{opened.message}</Alert> : null}
      {opened.status === "done" ? <Opened runtime={runtime} pay={opened.value} /> : null}
    </main>
  );
}
