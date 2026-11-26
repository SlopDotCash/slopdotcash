// spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"; spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown"; spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"
import { keepFeeLabel, keptAfterClosedDays, reclaimDays, refundUndecidedDays } from "@repo/backend/client";
import type { Layer } from "effect";
import { Alert, Button, ExternalLink, PageHeader, Spinner } from "@repo/ui";
import { Receipt } from "lucide-react";
import { useState } from "react";
import { wantedLabelName } from "../../../gen/backend__mergeActivity.ts";
import type { PageProps } from "../../app/pages.ts";
import { PageShell } from "../../app/PageShell.tsx";
import { networkLabel } from "../../kernels/assetText.ts";
import { amountText, wayKey } from "../../wallets/fee/feeCalls.ts";
import type { SolanaFeeWay } from "../../wallets/fee/solanaDeposit.vibe";
import { PaidRecord, PayForm, RecordState } from "./PayForm.tsx";
import type { FeePay, FeeSetup, FeeWay } from "./payFlow.vibe";
import { type FeeRuntime, feeRuntime } from "./runtime.vibe";
import { SubmissionFeePaySolana } from "./SubmissionFeePaySolana.tsx";
import { useOpened, usePay } from "./usePay.ts";

const section = "flex flex-col gap-3";
const heading = "text-xl font-semibold text-foreground";
const link = "text-primary underline underline-offset-4 hover:decoration-2";

const isSolanaNetwork = (network: string) => network.startsWith("solana");

function toSolanaWay(way: FeeWay): SolanaFeeWay {
  return {
    network: way.network,
    programId: way.contract,
    token: way.token,
    symbol: way.symbol,
    decimals: way.decimals,
    amount: way.amount,
    minimumAccepted: way.minimumAccepted,
    keptTo: way.keptTo,
    kind: "stable",
  };
}

function Terms({ ways }: { ways: readonly FeeWay[] }) {
  const stable = [...new Set(ways.filter((way) => way.kind === "stable").map((way) => way.symbol))].join(" or ");
  const slop = ways.some((way) => way.kind === "slop");
  const kept = [...(stable ? [`${stable} goes to Slop's fee wallet`] : []), ...(slop ? ["SLOP is sent to the burn address"] : [])].join(", and ");
  const contracts = [...new Set(ways.map((way) => way.contract))];
  return (
    <section aria-label="What happens to a deposit" className={section}>
      <h2 className={heading}>What happens to a deposit</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-muted-foreground">
        <li>It goes back to the wallet that paid it when this pull request is merged, or if no maintainer has merged or closed it {refundUndecidedDays} days after the deposit.</li>
        <li>It is kept if the pull request is closed without a merge and stays closed for {keptAfterClosedDays} days: {kept}. If the pull request closes an issue labelled {wantedLabelName} before it was opened, it goes back instead, unless a maintainer adds {keepFeeLabel} in that time.</li>
        <li>If nothing settles a deposit, the wallet that paid it can take it back from the deposit contract {reclaimDays} days after the deposit.</li>
        <li>A deposit of another token, or of less than the amount listed here, does not count.</li>
        <li>
          The only valid deposit contract is the address shown on this page and in Slopbot's comment on the pull request:{" "}
          {contracts.map((contract, index) => (
            <span key={contract}>
              {index > 0 ? ", " : ""}
              <code className="break-all font-mono text-sm">{contract}</code>
            </span>
          ))}
          . Nobody from Slop or from the project sends a payment address in a message.
        </li>
        <li>An AI agent does not move money. It hands this page to the person it works for.</li>
      </ul>
    </section>
  );
}

function Opened({ runtime, pay, named, number }: { runtime: FeeRuntime; pay: FeePay; named: string; number: string }) {
  const { state, shown } = usePay(runtime, pay);
  const [open, setOpen] = useState(false);
  const [openSolana, setOpenSolana] = useState(false);
  const [openReclaim, setOpenReclaim] = useState(false);
  if (state?.page === "NotAddressed") return <p className="text-muted-foreground">This address does not name a pull request.</p>;
  const record = shown?.record;
  const due = record?.due ?? [];
  const solanaDue = due.find((way) => isSolanaNetwork(way.network));
  const evmDue = due.filter((way) => !isSolanaNetwork(way.network));
  const solanaPaid = record?.paid !== null && record?.paid !== undefined && isSolanaNetwork(record.paid.network) && record.outcome === null;
  const pullNumber = Number(number);
  const solanaSubject =
    pay.repository !== undefined && record !== undefined && Number.isSafeInteger(pullNumber) && pullNumber > 0
      ? { repositoryId: pay.repository.repository, pullNumber, item: String(record.item) }
      : null;
  const recorded = state !== undefined && (state.page === "SwitchedOff" || state.page === "Due" || state.page === "Recorded");
  return (
    <>
      <p className="text-muted-foreground">
        Pull request{" "}
        <ExternalLink href={`https://github.com/${named}/pull/${number}`}>
          {named} #{number}
        </ExternalLink>
        {pay.repository ? (
          <>
            {" · "}
            <a className={link} href={`/projects/${pay.repository.projectSlug}`}>
              {pay.repository.projectName}
            </a>
          </>
        ) : null}
      </p>
      {state !== undefined && !state.switchedOn ? (
        <Alert variant="info">The submission fee is not switched on. No fee is due for any pull request, and this page offers no way to pay.</Alert>
      ) : null}
      {state?.page === "NotRegistered" ? (
        <p className="text-muted-foreground">{named} is not a repository of a project on Slop, so no submission fee is due for this pull request.</p>
      ) : (
        <RecordState state={state} shown={shown} loading="Loading the fee record" onRetry={() => void runtime.runPromise(pay.reload())} />
      )}
      {state?.page === "NothingAsked" ? <p className="text-muted-foreground">Slop has not asked a submission fee for this pull request. No fee is due.</p> : null}
      {recorded && record && shown ? (
        <>
          <PaidRecord record={record} held="The deposit is held by the deposit contract until this pull request is decided." />
          {solanaPaid && solanaSubject !== null && solanaDue !== undefined ? (
            openReclaim ? (
              <SubmissionFeePaySolana
                runtime={runtime}
                subject={solanaSubject}
                way={null}
                reclaim={toSolanaWay(solanaDue)}
                defaultDepositAddress={record.paid ? String(record.paid.depositId) : ""}
                onDeposit={() => void runtime.runPromise(pay.reload())}
              />
            ) : (
              <div>
                <Button variant="outline" size="sm" onClick={() => setOpenReclaim(true)}>
                  Take back a Solana deposit
                </Button>
              </div>
            )
          ) : null}
          {state.page === "SwitchedOff" ? <p className="text-muted-foreground">Slop recorded this pull request for a fee, but the fee is not switched on, so nothing is asked for it now.</p> : null}
          {state.switchedOn && due.length > 0 ? (
            <>
              <section aria-label="Fee due" className={section}>
                <h2 className={heading}>Fee due</h2>
                <p className="text-muted-foreground">One deposit pays the fee for this pull request. Slopbot&apos;s review is free and starts once the deposit is recorded.</p>
                <ul className="flex flex-col gap-1">
                  {due.map((way) => (
                    <li key={wayKey(way)}>
                      <strong className="font-semibold text-foreground">{amountText(way)}</strong> on {networkLabel(way.network)}
                      {way.kind === "slop" ? ". The SLOP amount follows Slop's published rate and can change." : ""}
                    </li>
                  ))}
                </ul>
                {record.slopWithheld ? (
                  <p className="text-muted-foreground">SLOP is not offered right now: Slop&apos;s published SLOP rate could not be read, so the SLOP amount could not be checked. Reload the page to try again.</p>
                ) : null}
              </section>
              <Terms ways={due} />
            </>
          ) : null}
          {state.switchedOn && (open || state.slot.identity !== "" || shown.unreadable) ? (
            <PayForm runtime={runtime} pay={pay} state={state} shown={shown} noun="pull request" />
          ) : state.switchedOn && evmDue.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpen(true)}>Pay from a wallet</Button>
              {solanaDue !== undefined && solanaSubject !== null && !openSolana ? (
                <Button variant="secondary" onClick={() => setOpenSolana(true)}>Pay on Solana</Button>
              ) : null}
            </div>
          ) : state.switchedOn && solanaDue !== undefined && solanaSubject !== null && !openSolana ? (
            <div>
              <Button onClick={() => setOpenSolana(true)}>Pay on Solana</Button>
            </div>
          ) : null}
          {state.switchedOn && openSolana && solanaDue !== undefined && solanaSubject !== null ? (
            <SubmissionFeePaySolana
              runtime={runtime}
              subject={solanaSubject}
              way={toSolanaWay(solanaDue)}
              reclaim={null}
              onDeposit={() => void runtime.runPromise(pay.reload())}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function SubmissionFeePage({ route, setup }: Pick<PageProps, "route"> & { setup?: Layer.Layer<FeeSetup> }) {
  const runtime = feeRuntime(setup);
  const opened = useOpened(runtime, { kind: "pullRequest", owner: route.owner, repo: route.repo, number: route.number });
  return (
    <PageShell width="md" gap="8">
      <PageHeader title="Submission fee" icon={<Receipt className="size-6 text-primary" />} />
      {opened.status === "running" ? <Spinner label="Loading the fee record" /> : null}
      {opened.status === "failed" ? <Alert variant="destructive">{opened.message}</Alert> : null}
      {opened.status === "done" ? (
        <Opened runtime={runtime} pay={opened.value} named={opened.value.repository?.repository ?? `${route.owner}/${route.repo}`} number={route.number} />
      ) : null}
    </PageShell>
  );
}
