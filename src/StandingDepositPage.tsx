import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import { networkLabel } from "./lib/network-names";
import {
  STANDING_DEPOSIT_COVER_DAYS,
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_OPEN_CAP,
  STANDING_DEPOSIT_RECLAIM_DAYS,
  STANDING_DEPOSIT_STRIKE_GRACE_HOURS,
  STANDING_DEPOSIT_STRIKE_WINDOW_DAYS,
  STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS,
} from "./lib/standing-deposit.mjs";
import {
  readStandingDeposit,
  STANDING_COVER_TEXT,
  STANDING_DEPOSIT_API,
  STANDING_DEPOSIT_PAGE,
  STANDING_DEPOSIT_WITHDRAW_API,
  type StandingDepositRecord,
  StandingDepositRecordError,
  type StandingDepositRow,
  standingDepositPhase,
} from "./lib/standing-deposit-page";
import {
  SUBMISSION_FEE_KEEP_LABEL,
  SUBMISSION_FEE_SLOP_DECIMALS,
} from "./lib/submission-fee.mjs";
import {
  type FeeTables,
  type FeeWay,
  feeAmountText,
  feeDepositKey,
} from "./lib/submission-fee-page";
import { standingDepositSetup } from "./lib/submission-fee-setup";
import { useAction } from "./lib/use-action";
import { usePoints } from "./Points";
import { formatDate, SignInPanel, Spinner } from "./Presentation";
import { PaidRecord } from "./SubmissionFeePage";
import "./submission-fee.css";

const SubmissionFeePay = lazy(() =>
  import("./SubmissionFeePay").then((module) => ({
    default: module.SubmissionFeePay,
  })),
);

/** While this tab's deposit waits to be recorded, the record is read again this often. */
const RECORD_REFRESH_MS = 20_000;

type Setup = ReturnType<typeof standingDepositSetup>;

/** A payment saved in this tab reopens the form after a reload. */
function hasSavedRequest(item: string): boolean {
  try {
    return sessionStorage.getItem(feeDepositKey(item)) !== null;
  } catch {
    return false;
  }
}

function slopText(amount: string): string {
  return feeAmountText({
    amount,
    decimals: SUBMISSION_FEE_SLOP_DECIMALS,
    symbol: "SLOP",
  });
}

async function request(
  path: string,
  githubId: string,
  setup: Setup,
  init: { method: "GET" | "POST"; signal?: AbortSignal },
): Promise<StandingDepositRecord> {
  const response = await fetchWithDeadline(path, {
    method: init.method,
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal,
    headers: {
      "x-slop-expected-github-id": githubId,
      ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(init.method === "POST" ? { body: "{}" } : {}),
  });
  const body = await readBoundedJson(response, 65_536, "standing deposit");
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? (body as { message?: unknown }).message
        : undefined;
    throw new Error(
      typeof message === "string" && message !== "Internal error"
        ? message
        : "The standing deposit is unavailable. Try again.",
    );
  }
  return readStandingDeposit(body, githubId, setup.contract, setup.tables);
}

/** The terms, in plain words, shown before any wallet. */
function Terms({ contract }: { contract: string }) {
  return (
    <section className="fee-section" aria-label="How a standing deposit works">
      <h2>How it works</h2>
      <ul>
        <li>
          You post one deposit of SLOP on{" "}
          {networkLabel(STANDING_DEPOSIT_NETWORK)}, worth 10 US dollars at
          Slop's published SLOP rate when you ask for it. While it stands,
          Slopbot does not ask you the submission fee on a project that accepts
          standing deposits, once you have had a pull request merged there. Up
          to {STANDING_DEPOSIT_OPEN_CAP} covered pull requests can be open at
          once; the next one is asked the usual fee.
        </li>
        <li>
          It is kept only if a maintainer closes a covered pull request without
          a merge within {STANDING_DEPOSIT_STRIKE_WINDOW_DAYS} days and adds{" "}
          {SUBMISSION_FEE_KEEP_LABEL}, and both still stand{" "}
          {STANDING_DEPOSIT_STRIKE_GRACE_HOURS} hours later. The whole deposit
          is then sent to the burn address and coverage ends. An ordinary close
          costs nothing.
        </li>
        <li>
          You can withdraw it at any time. New pull requests stop being covered
          at once, and the deposit is sent back to the wallet that paid it{" "}
          {STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS} days later, unless a covered
          pull request closed with {SUBMISSION_FEE_KEEP_LABEL} is still pending.
        </li>
        <li>
          Coverage of new pull requests ends {STANDING_DEPOSIT_COVER_DAYS} days
          after payment, and the deposit is then sent back the same way. If
          nothing settles it, the wallet that paid can take it back from the
          deposit contract {STANDING_DEPOSIT_RECLAIM_DAYS} days after the
          deposit.
        </li>
        <li>
          A deposit of another token, or of less than the amount shown here,
          does not count. The only valid deposit contract is the address shown
          on this page: <code>{contract}</code>. Nobody from Slop sends a
          payment address in a message.
        </li>
        <li>
          An AI agent does not move money. It hands this page to the person it
          works for.
        </li>
      </ul>
    </section>
  );
}

/** Where a recorded deposit stands, when no outcome is decided yet. */
function Standing({ row }: { row: StandingDepositRow }) {
  const phase = standingDepositPhase(row, new Date());
  if (phase === null) return null;
  if (phase.phase === "covering")
    return (
      <p>
        It covers your new pull requests until{" "}
        {formatDate(phase.coverEndsAt.toISOString())}, unless you withdraw it
        sooner.
      </p>
    );
  return (
    <p>
      {phase.asked
        ? `Withdrawal requested on ${formatDate(phase.coverEndedAt.toISOString())}.`
        : `Coverage of new pull requests ended on ${formatDate(phase.coverEndedAt.toISOString())}.`}{" "}
      It is due back to the wallet that paid it on{" "}
      {formatDate(phase.dueBackAt.toISOString())}, unless a covered pull request
      closed with {SUBMISSION_FEE_KEEP_LABEL} is still pending.
    </p>
  );
}

function Covers({ record }: { record: StandingDepositRecord }) {
  if (record.covers.length === 0) return null;
  return (
    <section className="fee-section" aria-label="Covered pull requests">
      <h2>Covered pull requests</h2>
      <ul>
        {record.covers.map((cover) => (
          <li key={`${cover.repository}#${cover.pullNumber}`}>
            <a
              href={`https://github.com/${cover.repository}/pull/${cover.pullNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              {cover.repository} #{cover.pullNumber}
            </a>
            {cover.open ? " · Open" : " · Closed"} ·{" "}
            {STANDING_COVER_TEXT[cover.state]}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Withdraw({
  row,
  busy,
  onConfirm,
}: {
  row: StandingDepositRow;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const paid = row.paid !== null;
  if (paid && (row.outcome !== null || row.withdrawRequestedAt !== null))
    return null;
  if (!confirming)
    return (
      <p>
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {paid ? "Withdraw" : "Cancel this deposit"}
        </button>
      </p>
    );
  return (
    <div className="fee-section">
      <p>
        {paid
          ? `New pull requests stop being covered now. The deposit is sent back ${STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS} days from now, unless a covered pull request closed with ${SUBMISSION_FEE_KEEP_LABEL} is pending.`
          : "This deposit will no longer be asked. If you already sent it, it does not count and is sent back to the wallet that paid it."}
      </p>
      <p>
        <button
          type="button"
          className="button primary-button"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {paid ? "Confirm withdrawal" : "Confirm cancellation"}
        </button>{" "}
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep the deposit
        </button>
      </p>
    </div>
  );
}

function Due({
  row,
  record,
  tables,
  busy,
  confirmDue,
  onChanged,
  onRefresh,
}: {
  row: StandingDepositRow;
  record: StandingDepositRecord;
  tables: FeeTables;
  busy: boolean;
  confirmDue: (way: FeeWay) => Promise<void>;
  onChanged: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(() => hasSavedRequest(row.item));
  const way = row.due[0];
  return (
    <>
      {way ? (
        <section className="fee-section" aria-label="Deposit due">
          <h2>Deposit due</h2>
          <p>
            <strong>{feeAmountText(way)}</strong> on {networkLabel(way.network)}
            .
          </p>
          {record.quote !== null && record.quote !== row.amount && !open ? (
            <p>
              Slop's published SLOP rate changed since this deposit was asked;
              at the rate now it is {slopText(record.quote)}.{" "}
              <button
                type="button"
                className="button secondary-button"
                disabled={busy}
                onClick={onRefresh}
              >
                Update the amount
              </button>
            </p>
          ) : null}
        </section>
      ) : null}
      {open ? (
        <Suspense fallback={<Spinner label="Loading the payment form" />}>
          <SubmissionFeePay
            item={row.item}
            ways={row.due}
            tables={tables}
            confirmDue={confirmDue}
            onDeposit={onChanged}
            subject="standing deposit"
          />
        </Suspense>
      ) : way ? (
        <p>
          <button
            type="button"
            className="button primary-button"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            Pay from a wallet
          </button>
        </p>
      ) : null}
    </>
  );
}

type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; record: StandingDepositRecord };

function SignedIn({ githubId, setup }: { githubId: string; setup: Setup }) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [watching, setWatching] = useState(false);
  const { busy, error, run } = useAction();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reloads the record.
  useEffect(() => {
    const controller = new AbortController();
    request(STANDING_DEPOSIT_API, githubId, setup, {
      method: "GET",
      signal: controller.signal,
    }).then(
      (record) => {
        if (!controller.signal.aborted) setState({ status: "ready", record });
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        // A record that fails the address check is never kept on screen.
        setState((current) =>
          current.status === "ready" &&
          !(caught instanceof StandingDepositRecordError)
            ? current
            : {
                status: "error",
                message:
                  caught instanceof Error
                    ? caught.message
                    : "The standing deposit is unavailable.",
              },
        );
      },
    );
    return () => controller.abort();
  }, [githubId, setup, attempt]);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const recorded =
    state.status === "ready" && state.record.deposit?.paid != null;
  useEffect(() => {
    if (!watching || recorded) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") reload();
    }, RECORD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [watching, recorded, reload]);
  const changed = useCallback(() => {
    setWatching(true);
    reload();
  }, [reload]);
  const confirmDue = useCallback(
    async (way: FeeWay) => {
      const latest = await request(STANDING_DEPOSIT_API, githubId, setup, {
        method: "GET",
      });
      const current = latest.deposit?.due[0];
      if (!current || current.amount !== way.amount) {
        changed();
        throw new Error(
          latest.deposit?.paid
            ? "Your standing deposit is already recorded. Nothing was sent."
            : "The deposit due changed. Nothing was sent. Review the payment again.",
        );
      }
    },
    [githubId, setup, changed],
  );
  const post = (path: string) =>
    void run(async () => {
      const record = await request(path, githubId, setup, { method: "POST" });
      setState({ status: "ready", record });
    });
  if (state.status === "loading")
    return <Spinner label="Loading your standing deposit" />;
  if (state.status === "error")
    return (
      <div role="alert">
        <p>{state.message}</p>
        <button
          className="button secondary-button"
          type="button"
          onClick={reload}
        >
          Try again
        </button>
      </div>
    );
  const { record } = state;
  if (!record.deployed || setup.contract === null)
    return <p>Standing deposits are not available yet.</p>;
  const row = record.deposit;
  const finished =
    row === null || row.outcome === "refunded" || row.outcome === "kept";
  return (
    <>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {row ? (
        <PaidRecord
          item={row}
          held="The deposit contract holds it while it stands."
        />
      ) : null}
      {row && row.outcome === null ? <Standing row={row} /> : null}
      {row && row.paid === null && row.outcome === null ? (
        <Due
          row={row}
          record={record}
          tables={setup.tables}
          busy={busy}
          confirmDue={confirmDue}
          onChanged={changed}
          onRefresh={() => post(STANDING_DEPOSIT_API)}
        />
      ) : null}
      {row && row.outcome === null ? (
        <Withdraw
          row={row}
          busy={busy}
          onConfirm={() => post(STANDING_DEPOSIT_WITHDRAW_API)}
        />
      ) : null}
      {finished ? (
        record.quote === null ? (
          <p>
            Slop has no published SLOP rate right now, so a standing deposit
            cannot be asked. Try again later.
          </p>
        ) : (
          <p>
            <button
              type="button"
              className="button primary-button"
              disabled={busy}
              onClick={() => post(STANDING_DEPOSIT_API)}
            >
              Ask for a standing deposit of {slopText(record.quote)}
            </button>
          </p>
        )
      ) : null}
      <Covers record={record} />
    </>
  );
}

/**
 * The standing deposit page (PRD section 5, "Standing deposit"). Signed in:
 * a contributor sees and pays their own deposit, and withdraws it. While the
 * contract is not deployed the page says so and offers nothing.
 */
export default function StandingDepositPage() {
  const { me, session } = usePoints();
  const [setup] = useState(standingDepositSetup);
  const githubId = me ? githubUserIdFromNodeId(me.actor.id) : null;
  return (
    <main className="shell route-main fee-page">
      <h1>Standing deposit</h1>
      {!setup.deployed ? (
        <p className="fee-off" role="note">
          Standing deposits are not available yet.
        </p>
      ) : (
        <>
          <p>
            One refundable SLOP deposit that stands in for the submission fee on
            your pull requests.
          </p>
          {setup.contract ? <Terms contract={setup.contract} /> : null}
          {session === "loading" ? (
            <Spinner label="Checking sign-in" />
          ) : me === null || githubId === null ? (
            <SignInPanel
              state={
                session === "error"
                  ? {
                      status: "error",
                      message: "Sign-in could not be checked. Try again.",
                    }
                  : { status: "signed-out" }
              }
              next={STANDING_DEPOSIT_PAGE}
              purpose="Sign in to post or manage your standing deposit."
            />
          ) : (
            <SignedIn key={githubId} githubId={githubId} setup={setup} />
          )}
        </>
      )}
    </main>
  );
}
