import { ExternalLink, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { networkLabel } from "./lib/network-names";
import { transactionUrl } from "./lib/payments/contracts";
import { findHistoricalProjectByRepositoryId } from "./lib/projects.mjs";
import {
  SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS,
  SUBMISSION_FEE_RECLAIM_DAYS,
  SUBMISSION_FEE_REFUND_UNDECIDED_DAYS,
} from "./lib/submission-fee.mjs";
import {
  FEE_RATE_PATH,
  type FeeItem,
  type FeeRates,
  FeeRecordError,
  type FeeTables,
  type FeeWay,
  feeAmountText,
  feeDepositKey,
  feeItemPath,
  feeRepository,
  feeRoute,
  readFeeItem,
  readFeeRates,
} from "./lib/submission-fee-page";
import { feePageSetup } from "./lib/submission-fee-setup";
import { usePublicResource } from "./lib/use-public-resource";
import { formatDate, Spinner } from "./Presentation";
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
  retainFailure: (error: unknown) => !(error instanceof FeeRecordError),
};

/** A payment saved in this tab reopens the form after a reload. */
function hasSavedRequest(item: string): boolean {
  try {
    return sessionStorage.getItem(feeDepositKey(item)) !== null;
  } catch {
    return false;
  }
}

/** The fee record of one pull request, or null when Slop has asked no fee for it. */
async function loadFeeItem(
  repositoryId: string,
  pullNumber: number,
  tables: FeeTables,
  signal?: AbortSignal,
): Promise<FeeItem | null> {
  const response = await fetchWithDeadline(
    feeItemPath(repositoryId, pullNumber),
    // The record changes when a deposit is recorded; never show a cached one.
    { signal, cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The fee record is unavailable.");
  const body = await readBoundedJson(response, 65_536, "submission fee record");
  // The rates are read after the record, so they are never the older of the two.
  const listsSlop =
    Array.isArray((body as { due?: unknown } | null)?.due) &&
    (body as { due: { symbol?: unknown }[] }).due.some(
      (entry) => entry?.symbol === "SLOP",
    );
  return readFeeItem(
    body,
    repositoryId,
    pullNumber,
    tables,
    listsSlop ? await loadFeeRates(signal) : null,
  );
}

/**
 * Slop's published SLOP rates, or null when they cannot be read. A SLOP
 * amount is checked against them; without them SLOP is not offered.
 */
async function loadFeeRates(signal?: AbortSignal): Promise<FeeRates | null> {
  try {
    const response = await fetchWithDeadline(FEE_RATE_PATH, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return readFeeRates(
      await readBoundedJson(response, 4_096, "submission fee rate"),
    );
  } catch {
    // An aborted page read ends with the record read; anything else is "unread".
    signal?.throwIfAborted();
    return null;
  }
}

export function TransactionLink({
  network,
  hash,
  label,
}: {
  network: string;
  hash: string;
  label: string;
}) {
  const href = transactionUrl(network, hash);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      <ExternalLink aria-hidden="true" size={15} /> {label}
    </a>
  ) : (
    <code>{hash}</code>
  );
}

/** A recorded deposit and what became of it, as either pay page reads it. */
type RecordedDeposit = Pick<FeeItem, "paid" | "outcome" | "resolveTransaction">;

/** What a recorded deposit is waiting for, or what became of it. */
function outcomeText(item: RecordedDeposit, held: string): string {
  const kind = item.paid?.kind ?? "stable";
  if (item.outcome === "refunded")
    return "The deposit was sent back to the wallet that paid it.";
  if (item.outcome === "kept")
    return kind === "slop"
      ? "The deposit was kept: the SLOP was sent to the burn address."
      : "The deposit was kept: it was sent to Slop's fee wallet.";
  if (item.outcome === "refund_due")
    return "The deposit is due back to the wallet that paid it. Slop sends it once the deposit's block is final.";
  if (item.outcome === "kept_due")
    return kind === "slop"
      ? "The deposit is to be kept: the SLOP will be sent to the burn address once the deposit's block is final."
      : "The deposit is to be kept: it will be sent to Slop's fee wallet once the deposit's block is final.";
  return held;
}

export function PaidRecord({
  item,
  held = "The deposit is held by the deposit contract until this pull request is decided.",
}: {
  item: RecordedDeposit;
  /** What an undecided deposit waits for. */
  held?: string;
}) {
  const paid = item.paid;
  if (!paid) return null;
  return (
    <section className="fee-section" aria-label="Payment recorded">
      <h2>Paid</h2>
      <p>
        {feeAmountText(paid)} on {networkLabel(paid.network)}, recorded{" "}
        {formatDate(paid.at)} as deposit {paid.depositId}.{" "}
        {paid.finalized
          ? "Its block is final."
          : `Its block is not final yet. ${networkLabel(paid.network)} can still replace it, and the record follows the chain.`}
      </p>
      <p>
        <TransactionLink
          network={paid.network}
          hash={paid.transaction}
          label="Deposit transaction"
        />
      </p>
      <p>{outcomeText(item, held)}</p>
      {item.resolveTransaction ? (
        <p>
          <TransactionLink
            network={paid.network}
            hash={item.resolveTransaction}
            label={
              item.outcome === "kept"
                ? "Kept transaction"
                : "Refund transaction"
            }
          />
        </p>
      ) : null}
    </section>
  );
}

/** The terms, in plain words, shown before a wallet is chosen. */
function Terms({ ways }: { ways: readonly FeeWay[] }) {
  const stable = [
    ...new Set(
      ways.filter((way) => way.kind === "stable").map((way) => way.symbol),
    ),
  ].join(" or ");
  const slop = ways.some((way) => way.kind === "slop");
  const kept = [
    ...(stable ? [`${stable} goes to Slop's fee wallet`] : []),
    ...(slop ? ["SLOP is sent to the burn address"] : []),
  ].join(", and ");
  const contracts = [...new Set(ways.map((way) => way.contract))];
  return (
    <section className="fee-section" aria-label="What happens to a deposit">
      <h2>What happens to a deposit</h2>
      <ul>
        <li>
          It goes back to the wallet that paid it when this pull request is
          merged, or if no maintainer has merged or closed it{" "}
          {SUBMISSION_FEE_REFUND_UNDECIDED_DAYS} days after the deposit.
        </li>
        <li>
          It is kept if the pull request is closed without a merge and stays
          closed for {SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS} days: {kept}.
        </li>
        <li>
          If nothing settles a deposit, the wallet that paid it can take it back
          from the deposit contract {SUBMISSION_FEE_RECLAIM_DAYS} days after the
          deposit.
        </li>
        <li>
          A deposit of another token, or of less than the amount listed here,
          does not count.
        </li>
        <li>
          The only valid deposit contract is the address shown on this page and
          in Slopbot's comment on the pull request:{" "}
          {contracts.map((contract, index) => (
            <span key={contract}>
              {index > 0 ? ", " : ""}
              <code>{contract}</code>
            </span>
          ))}
          . Nobody from Slop or from the project sends a payment address in a
          message.
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
  item,
  tables,
  onChanged,
}: {
  item: FeeItem;
  tables: FeeTables;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(() => hasSavedRequest(item.item));
  const confirmDue = useCallback(
    async (way: FeeWay) => {
      const latest = await loadFeeItem(
        item.repositoryId,
        item.pullNumber,
        tables,
      );
      const current = latest?.due.find(
        (entry) =>
          entry.network === way.network &&
          entry.token.toLowerCase() === way.token.toLowerCase(),
      );
      if (!current || current.amount !== way.amount) {
        onChanged();
        throw new Error(
          latest?.paid
            ? "This pull request is already recorded as paid. Nothing was sent."
            : way.kind === "slop" && latest?.slopWithheld
              ? "Slop's published SLOP rate could not be read just now, so the SLOP amount could not be checked. Nothing was sent. Try again, or pay in a stablecoin."
              : "The fee due for this pull request changed. Nothing was sent. Review the payment again.",
        );
      }
    },
    [item.repositoryId, item.pullNumber, tables, onChanged],
  );
  return (
    <>
      {item.due.length > 0 ? (
        <>
          <section className="fee-section" aria-label="Fee due">
            <h2>Fee due</h2>
            <p>
              One deposit pays the fee for this pull request. Slopbot's review
              is free and starts once the deposit is recorded.
            </p>
            <ul>
              {item.due.map((way) => (
                <li key={`${way.network}:${way.token}`}>
                  <strong>{feeAmountText(way)}</strong> on{" "}
                  {networkLabel(way.network)}
                  {way.kind === "slop"
                    ? ". The SLOP amount follows Slop's published rate and can change."
                    : ""}
                </li>
              ))}
            </ul>
            {item.slopWithheld ? (
              <p>
                SLOP is not offered right now: Slop's published SLOP rate could
                not be read, so the SLOP amount could not be checked. Reload the
                page to try again.
              </p>
            ) : null}
          </section>
          <Terms ways={item.due} />
        </>
      ) : null}
      {open ? (
        <Suspense fallback={<Spinner label="Loading the payment form" />}>
          <SubmissionFeePay
            item={item.item}
            ways={item.due}
            tables={tables}
            confirmDue={confirmDue}
            onDeposit={onChanged}
          />
        </Suspense>
      ) : item.due.length > 0 ? (
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
 * The contributor pay page of the refundable submission fee (PRD section 5).
 * No sign-in: any wallet may pay, and the refund goes to the wallet that
 * paid. The address names the pull request and nothing else.
 */
export default function SubmissionFeePage({
  owner,
  repo,
  number,
}: {
  owner: string;
  repo: string;
  number: string;
}) {
  const route = feeRoute(owner, repo, number);
  const repository = route
    ? feeRepository(route, findHistoricalProjectByRepositoryId)
    : null;
  const [{ switchedOn, tables }] = useState(feePageSetup);
  const repositoryId = repository?.repositoryId ?? null;
  const pullNumber = route?.number ?? null;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (repositoryId === null || pullNumber === null)
        throw new Error("No pull request.");
      return {
        item: await loadFeeItem(repositoryId, pullNumber, tables, signal),
      };
    },
    [repositoryId, pullNumber, tables],
  );
  const [state, retry] = usePublicResource(
    repositoryId !== null,
    load,
    "The fee record is unavailable.",
    12_000,
    RECORD_RETENTION,
  );
  // After this tab's deposit reaches a block, read the record until it shows.
  const [watching, setWatching] = useState(false);
  const recorded = state.status === "ready" && state.item?.paid != null;
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
  if (!route)
    return (
      <main className="shell route-main fee-page">
        <h1>Submission fee</h1>
        <p>This address does not name a pull request.</p>
      </main>
    );
  const named = repository?.repository ?? `${route.owner}/${route.repo}`;
  const item = state.status === "ready" ? state.item : undefined;
  return (
    <main className="shell route-main fee-page">
      <h1>Submission fee</h1>
      <p>
        Pull request{" "}
        <a
          href={`https://github.com/${named}/pull/${route.number}`}
          target="_blank"
          rel="noreferrer"
        >
          {named} #{route.number}
        </a>
        {repository ? (
          <>
            {" · "}
            <Link href={`/projects/${repository.projectSlug}`}>
              {repository.projectName}
            </Link>
          </>
        ) : null}
      </p>
      {switchedOn ? null : (
        <p className="fee-off" role="note">
          The submission fee is not switched on. No fee is due for any pull
          request, and this page offers no way to pay.
        </p>
      )}
      {!repository ? (
        <p>
          {named} is not a repository of a project on Slop, so no submission fee
          is due for this pull request.
        </p>
      ) : state.status === "error" ? (
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
      ) : item === undefined ? (
        <p aria-label="Loading the fee record" role="status">
          <LoaderCircle aria-hidden="true" className="wallet-spin" size={18} />
        </p>
      ) : item === null ? (
        <p>
          Slop has not asked a submission fee for this pull request. No fee is
          due.
        </p>
      ) : (
        <>
          {state.status === "ready" && state.refreshError ? (
            <p role="status">
              The record could not be read again just now. The last one read is
              shown.
            </p>
          ) : null}
          <PaidRecord item={item} />
          {item.paid ? null : switchedOn ? null : (
            <p>
              Slop recorded this pull request for a fee, but the fee is not
              switched on, so nothing is asked for it now.
            </p>
          )}
          {/* A payment saved in this tab is still checked after it is recorded. */}
          {switchedOn ? (
            <Due item={item} tables={tables} onChanged={changed} />
          ) : null}
        </>
      )}
    </main>
  );
}
