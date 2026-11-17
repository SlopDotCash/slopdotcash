// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { DirectTransfer, PublicVaultPayment } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Button, ExternalLink, Status } from "@repo/ui";
import { Fragment, type ReactNode, useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { CHAIN_NAMES, formatRewardMinor } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import type { Shown } from "../home/listing.ts";
import { formatDate, formatMonth, PaymentRecord, VaultPaymentRecord } from "../projects/index.ts";
import { contributorStateLabel, cycleLifecycleLabel, percentText, pointsText } from "../cycles/labels.ts";
import type { Tier } from "../../platform/config.vibe";
import { type CycleShare, moneyReceived, shownRecords } from "./profile.ts";

export type ProfilePaymentsProps = {
  /** The member's archived cycle rows, once the cycle index is read. */
  cycles: ReadonlyArray<CycleShare> | undefined;
  /** The decimal GitHub id the payment records are kept under, when it is known. */
  githubId: string | undefined;
  /** Direct transfers to the member. */
  direct: Shown<ReadonlyArray<DirectTransfer>>;
  /** Finalized ordinary vault payments to the member. */
  vault: Shown<ReadonlyArray<PublicVaultPayment>>;
  /** The listed name of a project, when the registry lists it. */
  nameOf: (projectId: string) => string | undefined;
  /** Now, in milliseconds, against which a cycle's review window is judged. */
  nowMs: number;
  /** The deployment tier; testnet payments count toward money received only on staging. */
  tier: Tier;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";
const settled: ReadonlySet<ReadStatus> = new Set(["Current", "Empty", "Stale"]);
const pending: ReadonlySet<ReadStatus> = new Set(["Idle", "Loading"]);

interface Entry {
  readonly id: string;
  readonly sortAt: string;
  readonly content: ReactNode;
}

/** @throws {never} */
function usdc(minor: string): string {
  return `${formatRewardMinor(parseBaseUnits(minor) ?? 0n)} USDC`;
}

/** @throws {never} */
function testnet(network: string): boolean {
  return isNetworkKey(network) && NETWORKS[network].testnet;
}

function cycleEntry({ contributor, cycle }: CycleShare, nameOf: ProfilePaymentsProps["nameOf"], nowMs: number): Entry {
  const amount =
    cycle.kind === "external-prize-share"
      ? contributor.sharePartsPerMillion === null
        ? "Share not recorded"
        : `${percentText(contributor.sharePartsPerMillion)} share`
      : usdc(contributor.state === "paid" ? contributor.paidMinor : contributor.approvedMinor !== "0" ? contributor.approvedMinor : contributor.suggestedMinor);
  return {
    id: `cycle:${cycle.projectId}:${cycle.cycleId}`,
    sortAt: cycle.settledAt ?? cycle.approvedAt ?? cycle.generatedAt,
    content: (
      <PaymentRecord
        name={
          <a href={`/cycles/${cycle.projectId}/${cycle.cycleId}`} className={linkClass}>
            {nameOf(cycle.projectId) ?? cycle.projectId} · {formatMonth(cycle.cycleId)}
          </a>
        }
        detail={
          <>
            Archived cycle · {cycleLifecycleLabel(cycle, nowMs)} · {pointsText(contributor.scoreThirds ?? contributor.score * 3)} points
          </>
        }
        amount={
          <>
            <strong className="font-mono tabular-nums">{amount}</strong>
            <small className="text-xs text-muted-foreground">{contributorStateLabel(contributor.state)}</small>
          </>
        }
      />
    ),
  };
}

function directEntry(payment: DirectTransfer, nameOf: ProfilePaymentsProps["nameOf"]): Entry {
  const href = transactionUrl(payment.network, payment.transactionId);
  return {
    id: `direct:${payment.network}:${payment.transactionId}`,
    sortAt: payment.blockTime,
    content: (
      <PaymentRecord
        name={nameOf(payment.projectId) ?? payment.projectId}
        detail={
          <>
            Direct transfer · {CHAIN_NAMES[payment.chain]}
            {testnet(payment.network) ? " testnet" : ""} · Work month: {formatMonth(payment.contributionMonth)} · Paid {formatDate(payment.blockTime)}
          </>
        }
        amount={
          <>
            <strong className="font-mono tabular-nums">{usdc(payment.amountMicro)}</strong>
            <small className="text-xs text-muted-foreground">Paid directly</small>
          </>
        }
        action={
          href ? (
            <ExternalLink href={href} className={linkClass}>
              View transaction
            </ExternalLink>
          ) : (
            <a href={`/projects/${payment.projectId}/funding`} className={linkClass}>
              Funding record
            </a>
          )
        }
      />
    ),
  };
}

function Notice({ read, failure, retryLabel, loading }: { read: Shown<unknown>; failure: string; retryLabel: string; loading: string }) {
  if (pending.has(read.status)) return <Status presentation={{ tone: "Neutral", icon: "Spinner", label: loading }} />;
  if (settled.has(read.status)) return null;
  return (
    <p>
      {failure}{" "}
      <Button variant="link" size="sm" onClick={read.onRetry}>
        {retryLabel}
      </Button>
    </p>
  );
}

/** One record list keeping archived awards, direct transfers and vault payments distinct, with the money received over all time. */
export function ProfilePayments({ cycles, githubId, direct, vault, nameOf, nowMs, tier }: ProfilePaymentsProps) {
  const [showAll, setShowAll] = useState(false);
  const directRows = settled.has(direct.status) ? (direct.value ?? []) : undefined;
  const vaultRows = settled.has(vault.status) ? (vault.value ?? []) : undefined;
  const total = githubId === undefined ? undefined : moneyReceived({ tier, cycles, direct: directRows, vault: vaultRows });
  const failed = githubId === undefined || !(settled.has(direct.status) || pending.has(direct.status)) || !(settled.has(vault.status) || pending.has(vault.status));
  const entries = [
    ...(cycles ?? []).map((share) => cycleEntry(share, nameOf, nowMs)),
    ...(directRows ?? []).map((payment) => directEntry(payment, nameOf)),
    ...(vaultRows ?? []).map((payment) => ({ id: `vault:${payment.id}`, sortAt: payment.indexedAt, content: <VaultPaymentRecord payment={payment} projectName={nameOf(payment.projectId)} /> })),
  ].sort((left, right) => right.sortAt.localeCompare(left.sortAt) || left.id.localeCompare(right.id));
  return (
    <section aria-label="Awards and payments" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">Awards and payments</h2>
      <p>
        Money received (all time): <strong className="font-mono tabular-nums">{total !== undefined ? formatRewardMinor(total) : failed ? "Unavailable" : "Loading…"}</strong>
      </p>
      {githubId === undefined ? (
        <p role="status">Payment identity unavailable.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Notice read={direct} failure="Direct payment records unavailable." retryLabel="Retry payment records" loading="Loading direct payments…" />
          <Notice read={vault} failure="Project payment records unavailable." retryLabel="Retry project payments" loading="Loading project payments…" />
        </div>
      )}
      {entries.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {(showAll ? entries : entries.slice(0, shownRecords)).map((entry) => (
            <Fragment key={entry.id}>{entry.content}</Fragment>
          ))}
        </ul>
      ) : directRows !== undefined && vaultRows !== undefined ? (
        <p className="text-muted-foreground">No awards or payments recorded.</p>
      ) : null}
      {entries.length > shownRecords ? (
        <Button variant="outline" size="sm" className="self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show recent records" : `Show all ${entries.length} records`}
        </Button>
      ) : null}
    </section>
  );
}
