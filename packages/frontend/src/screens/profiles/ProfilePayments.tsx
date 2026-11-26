// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { DirectTransfer, PublicVaultPayment } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { isNetworkKey, NETWORKS } from "@repo/settlement/kernels/networks";
import { Button, cn, ExternalLink, NetworkMark, Spinner, Status } from "@repo/ui";
import { ExternalLink as ExternalLinkIcon, RotateCcw } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { CHAIN_NAMES, formatRewardMinor } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import type { Shown } from "../home/listing.ts";
import { formatDate, formatMonth, PaymentRecord, VaultPaymentRecord } from "../projects/index.ts";
import { contributorStateLabel, cycleLifecyclePresentation, percentText, pointsText } from "../cycles/labels.ts";
import type { Tier } from "../../platform/config.vibe";
import { type CycleShare, moneyReceived, shownRecords } from "./profile.ts";
import { profileCard, profileCardTitle } from "./ProfileActivity.tsx";

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
        ? "—"
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
          <span className="inline-flex flex-wrap items-center gap-2">
            <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Cycle" }} />
            <Status presentation={cycleLifecyclePresentation(cycle, nowMs)} />
            {pointsText(contributor.scoreThirds ?? contributor.score * 3)} pts
          </span>
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
          <span className="inline-flex flex-wrap items-center gap-2">
            <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Direct" }} />
            <NetworkMark network={CHAIN_NAMES[payment.chain]} size="sm" showName={false} role="img" aria-label={CHAIN_NAMES[payment.chain]} title={CHAIN_NAMES[payment.chain]} />
            {testnet(payment.network) ? <Status presentation={{ tone: "Neutral", icon: "Dot", label: "testnet" }} /> : null}· {formatMonth(payment.contributionMonth)} · {formatDate(payment.blockTime)}
          </span>
        }
        amount={
          <>
            <strong className="font-mono tabular-nums">{usdc(payment.amountMicro)}</strong>
            <Status presentation={{ tone: "Positive", icon: "Check", label: "Paid" }} />
          </>
        }
        action={
          href ? (
            <ExternalLink href={href} className={linkClass} label="Transaction">
              <ExternalLinkIcon aria-hidden className="size-4" />
            </ExternalLink>
          ) : (
            <a href={`/projects/${payment.projectId}/funding`} className={linkClass} aria-label="Funding record" title="Funding record">
              <ExternalLinkIcon aria-hidden className="size-4" />
            </a>
          )
        }
      />
    ),
  };
}

function Notices({ direct, vault }: Pick<ProfilePaymentsProps, "direct" | "vault">) {
  const failed = [direct, vault].filter((read) => !settled.has(read.status) && !pending.has(read.status));
  if (failed.length > 0) {
    return (
      <p role="status" className="flex items-center gap-2">
        Some payments unavailable
        <Button variant="ghost" size="icon" aria-label="Retry payment records" title="Retry payment records" onClick={() => failed.forEach((read) => read.onRetry?.())}>
          <RotateCcw aria-hidden className="size-4" />
        </Button>
      </p>
    );
  }
  return pending.has(direct.status) || pending.has(vault.status) ? <Spinner label="Loading payments" /> : null;
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
    <section aria-label="Awards and payments" className={cn(profileCard, "gap-4")}>
      <h2 className={profileCardTitle}>Awards and payments</h2>
      <p className="text-muted-foreground">
        <strong className="block font-mono text-2xl font-bold text-foreground tabular-nums">
          {total !== undefined ? (
            formatRewardMinor(total)
          ) : failed ? (
            <span role="img" aria-label="Unavailable" title="Unavailable">
              —
            </span>
          ) : (
            <Spinner label="Loading" />
          )}
        </strong>
        Received
      </p>
      {githubId === undefined ? null : <Notices direct={direct} vault={vault} />}
      {entries.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {(showAll ? entries : entries.slice(0, shownRecords)).map((entry) => (
            <Fragment key={entry.id}>{entry.content}</Fragment>
          ))}
        </ul>
      ) : directRows !== undefined && vaultRows !== undefined ? (
        <p className="text-muted-foreground">None yet</p>
      ) : null}
      {entries.length > shownRecords ? (
        <Button variant="outline" size="sm" className="self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show less" : `Show all (${entries.length})`}
        </Button>
      ) : null}
    </section>
  );
}
