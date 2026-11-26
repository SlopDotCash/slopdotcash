// spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"
import { keepFeeLabel } from "@repo/backend/client";
import { Address, Alert, Button, ExternalLink, PageHeader, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { retryOnce, useAction, useNow, useOnce } from "../../app/hooks.ts";
import { PageShell } from "../../app/PageShell.tsx";
import type { PageRuntime } from "../../app/runtime.vibe";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import {
  formatSlopAmount,
  loadStandingDeposit,
  requestNewStandingDeposit,
  STANDING_DEPOSIT_CONTRACT,
  STANDING_DEPOSIT_COVER_DAYS,
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_OPEN_CAP,
  STANDING_DEPOSIT_PAGE,
  STANDING_DEPOSIT_RECLAIM_DAYS,
  STANDING_DEPOSIT_STRIKE_GRACE_HOURS,
  STANDING_DEPOSIT_STRIKE_WINDOW_DAYS,
  STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS,
  type StandingCover,
  type StandingDepositRecord,
  type StandingDepositRow,
  standingDepositPhase,
  withdrawStandingDeposit,
} from "../../flows/account/standingDeposit.vibe";
import { networkLabel } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import { formatDate } from "../projects/summary.ts";

const coverStateText: Readonly<Record<StandingCover["state"], string>> = {
  watch: "Covered",
  pending: `Closed with ${keepFeeLabel} — in ${STANDING_DEPOSIT_STRIKE_GRACE_HOURS}h grace window`,
  clear: "Cleared",
  strike: "Deposit kept",
};

function Terms({ contract }: { contract: string }) {
  return (
    <section aria-label="How a standing deposit works" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">How it works</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
        <li>
          You post one deposit of SLOP on {networkLabel(STANDING_DEPOSIT_NETWORK)}, worth 10 US dollars at Slop&apos;s published SLOP rate when you ask for it. While it stands, Slopbot does not ask you the submission fee on a project that accepts standing deposits, once you have had a pull request merged there. Up to {STANDING_DEPOSIT_OPEN_CAP} covered pull requests can be open at once; the next one is asked the usual fee.
        </li>
        <li>
          It is kept only if a maintainer closes a covered pull request without a merge within {STANDING_DEPOSIT_STRIKE_WINDOW_DAYS} days and adds {keepFeeLabel}, and both still stand {STANDING_DEPOSIT_STRIKE_GRACE_HOURS} hours later. The whole deposit is then sent to the burn address and coverage ends. An ordinary close costs nothing.
        </li>
        <li>
          You can withdraw it at any time. New pull requests stop being covered at once, and the deposit is sent back to the wallet that paid it {STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS} days later, unless a covered pull request closed with {keepFeeLabel} is still pending.
        </li>
        <li>
          Coverage of new pull requests ends {STANDING_DEPOSIT_COVER_DAYS} days after payment, and the deposit is then sent back the same way. If nothing settles it, the wallet that paid can take it back from the deposit contract {STANDING_DEPOSIT_RECLAIM_DAYS} days after the deposit.
        </li>
        <li>
          A deposit of another token, or of less than the amount shown here, does not count. The only valid deposit contract is the address shown on this page: <code className="font-mono text-xs break-all text-foreground">{contract}</code>. Nobody from Slop sends a payment address in a message.
        </li>
        <li>An AI agent does not move money. It hands this page to the person it works for.</li>
      </ul>
    </section>
  );
}

function StandingPaid({ row, nowMs }: { row: StandingDepositRow; nowMs: number }) {
  const paid = row.paid;
  if (paid === null) return null;
  const network = networkLabel(paid.network);
  const phase = standingDepositPhase(row, nowMs);
  const depositUrl = transactionUrl(paid.network, paid.transaction);
  const resolveUrl = row.resolveTransaction ? transactionUrl(paid.network, row.resolveTransaction) : undefined;
  return (
    <section aria-label="Standing deposit status" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="text-lg font-semibold text-foreground">Paid</h2>
        <p className="text-muted-foreground">
          {formatSlopAmount(paid.amount)} on {network}, recorded {formatDate(paid.at)} as deposit {paid.depositId}.{" "}
          {paid.finalized ? "Its block is final." : `Its block is not final yet. ${network} can still replace it, and the record follows the chain.`}
        </p>
        {depositUrl ? <p><ExternalLink href={depositUrl}>Deposit transaction</ExternalLink></p> : null}
        {phase?.phase === "covering" ? (
          <p className="text-foreground">It covers your new pull requests until {formatDate(phase.coverEndsAt.toISOString())}, unless you withdraw it sooner.</p>
        ) : phase?.phase === "waiting" ? (
          <p className="text-foreground">
            {phase.asked ? `Withdrawal requested on ${formatDate(phase.coverEndedAt.toISOString())}.` : `Coverage of new pull requests ended on ${formatDate(phase.coverEndedAt.toISOString())}.`}{" "}
            It is due back to the wallet that paid it on {formatDate(phase.dueBackAt.toISOString())}, unless a covered pull request closed with {keepFeeLabel} is still pending.
          </p>
        ) : null}
        {row.outcome === "refunded" ? <p className="text-muted-foreground">The deposit was sent back to the wallet that paid it.</p> : null}
        {row.outcome === "kept" ? <p className="text-muted-foreground">The deposit was kept: the SLOP was sent to the burn address.</p> : null}
        {row.outcome === "refund_due" ? <p className="text-muted-foreground">The deposit is due back to the wallet that paid it. Slop sends it once the deposit&apos;s block is final.</p> : null}
        {row.outcome === "kept_due" ? <p className="text-muted-foreground">The deposit is to be kept: the SLOP will be sent to the burn address once the deposit&apos;s block is final.</p> : null}
        {resolveUrl ? (
          <p><ExternalLink href={resolveUrl}>{row.outcome === "kept" ? "Kept transaction" : "Refund transaction"}</ExternalLink></p>
        ) : null}
      </section>
  );
}

function Covers({ covers }: { covers: ReadonlyArray<StandingCover> }) {
  if (covers.length === 0) return null;
  return (
    <section aria-label="Covered pull requests" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">Covered pull requests</h2>
      <div className="overflow-x-auto">
        <Table label="Covered pull requests">
          <TableHeader>
            <TableRow>
              <TableHead>Pull request</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {covers.map((cover) => (
              <TableRow key={`${cover.repository}#${cover.pullNumber}`}>
                <TableCell>
                  <ExternalLink href={`https://github.com/${cover.repository}/pull/${cover.pullNumber}`}>
                    {cover.repository} #{cover.pullNumber}
                  </ExternalLink>
                </TableCell>
                <TableCell>{coverStateText[cover.state]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SignedInDeposit({ runtime, githubId }: { runtime: PageRuntime; githubId: string }) {
  const key = `standing-deposit:${githubId}`;
  const loaded = useOnce(runtime, key, () => loadStandingDeposit(githubId));
  const [override, setOverride] = useState<StandingDepositRecord | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const { busy, error, act } = useAction(runtime);
  const nowMs = useNow();

  if (loaded.status === "running") return <Spinner label="Loading your standing deposit" />;
  if (loaded.status === "failed") {
    return (
      <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, key)}>Try again</Button>}>
        {loaded.message}
      </Alert>
    );
  }

  const record = override ?? loaded.value;
  if (!record.deployed) return <p className="text-sm text-muted-foreground">Standing deposits are not available yet.</p>;

  const row = record.deposit;
  const finished = row === null || row.outcome === "refunded" || row.outcome === "kept";
  const dueWay = row?.due[0];

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {row ? <StandingPaid row={row} nowMs={nowMs} /> : null}
      {row && row.paid === null && row.outcome === null && dueWay ? (
        <section aria-label="Standing deposit due" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <h2 className="text-lg font-semibold text-foreground">Deposit due</h2>
          <p className="text-muted-foreground">
            Send <strong className="text-foreground">{formatSlopAmount(dueWay.amount)}</strong> on {networkLabel(dueWay.network)} to the standing deposit contract for item <code className="font-mono text-xs break-all text-foreground">{row.item}</code>.
          </p>
          <dl className="grid gap-2 sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Contract</dt>
            <dd><Address value={dueWay.contract} label="Deposit contract" /></dd>
            <dt className="text-muted-foreground">Token</dt>
            <dd><Address value={dueWay.token} label="SLOP token" /></dd>
            <dt className="text-muted-foreground">If kept, it goes to</dt>
            <dd><Address value={dueWay.keptTo} label="Burn address" /></dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void act(requestNewStandingDeposit(githubId), setOverride)}>
              Refresh quote
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { setOverride(null); retryOnce(runtime, key); }}>
              Check payment status
            </Button>
          </div>
        </section>
      ) : null}
      {row && row.paid !== null && row.outcome === null && row.withdrawRequestedAt === null ? (
        <section aria-label="Withdraw standing deposit" className="flex flex-col gap-3">
          {confirmWithdraw ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
              <p className="text-foreground">
                Withdrawing stops coverage of new pull requests immediately. Your deposit is returned {STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS} days later unless a covered pull request is pending a strike.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" loading={busy} onClick={() => void act(withdrawStandingDeposit(githubId), (next) => { setOverride(next); setConfirmWithdraw(false); })}>
                  Confirm withdrawal
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmWithdraw(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmWithdraw(true)}>
                Withdraw standing deposit
              </Button>
            </div>
          )}
        </section>
      ) : null}
      {finished ? (
        record.quote === null ? (
          <p className="text-sm text-muted-foreground">Slop has no published SLOP rate right now, so a standing deposit cannot be asked. Try again later.</p>
        ) : (
          <div>
            <Button loading={busy} onClick={() => void act(requestNewStandingDeposit(githubId), setOverride)}>
              Ask for a standing deposit of {formatSlopAmount(record.quote)}
            </Button>
          </div>
        )
      ) : null}
      <Covers covers={record.covers} />
    </div>
  );
}

export function StandingDepositPage({ runtime }: { runtime: PageRuntime }) {
  const shown = useSession(runtime);
  return (
    <PageShell width="md" gap="6">
      <PageHeader title="Standing deposit" icon={<ShieldCheck className="size-6 text-primary" />} />
      <p className="text-sm text-muted-foreground">One refundable SLOP deposit that stands in for the submission fee on your pull requests.</p>
      <Terms contract={STANDING_DEPOSIT_CONTRACT} />
      {shown === undefined || shown.view.status === "checking" ? (
        <Spinner label="Checking sign-in" />
      ) : shown.view.status !== "signedIn" ? (
        <SignInPanel
          view={shown.view}
          href={loginHrefFor(shown, STANDING_DEPOSIT_PAGE)}
          purpose="Sign in to post or manage your standing deposit."
        />
      ) : (
        <SignedInDeposit key={shown.view.session.githubId} runtime={runtime} githubId={shown.view.session.githubId} />
      )}
    </PageShell>
  );
}
