import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, transactionUrl } from "./lib/payments/contracts";
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import {
  type ReferralAccount,
  type ReferralResponse,
  referralResponse,
  reviewReferralClaim,
  sendReferralClaim,
} from "./lib/referral-claims";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { formatDateTime } from "./Presentation";

type Connection = Awaited<ReturnType<PayoutWallet["connect"]>>;
interface Pending extends PendingAttempt {
  hash: string | null;
  cumulative: string;
}
function pendingKey(data: ReferralAccount) {
  return `slop:referral-claim:${data.program?.network}:${data.program?.distributor}:${data.wallet}`;
}
// An unreadable marker is unknown, not proof that no request was sent.
// Keep this local status separate from the verified amounts.
type PendingSnapshot = {
  value: Pending | null | undefined;
  raw: string | null | undefined;
};
function readPending(data: ReferralAccount): PendingSnapshot {
  let stored: string | null | undefined;
  try {
    stored = localStorage.getItem(pendingKey(data));
    if (stored === null) return { value: null, raw: null };
    const p = JSON.parse(stored) as Pending;
    if (
      !p ||
      !validPendingAttemptId(p.attemptId) ||
      (p.hash !== null &&
        (typeof p.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(p.hash))) ||
      typeof p.cumulative !== "string" ||
      !/^(0|[1-9][0-9]{0,77})$/.test(p.cumulative)
    )
      return { value: undefined, raw: stored };
    return { value: p, raw: stored };
  } catch {
    return { value: undefined, raw: stored };
  }
}
async function withPendingLock<T>(
  data: ReferralAccount,
  work: () => T | Promise<T>,
) {
  if (!navigator.locks)
    throw new Error(
      "This browser cannot coordinate claim requests. Use a browser with Web Locks.",
    );
  return navigator.locks.request(
    `${pendingKey(data)}:mutation`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "A claim request is active in another view. Wait for it to finish, then refresh.",
        );
      return work();
    },
  );
}
export function ReferralClaims() {
  const wallets = usePayoutWallets().filter((w) => w.family === "evm");
  const [data, setData] = useState<ReferralResponse | null>(null);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    data: ReferralAccount;
    wallet: Connection;
  } | null>(null);
  const [pending, setPending] = useState<Pending | null | undefined>(null);
  const mounted = useRef(true);
  const action = useRef(0);
  const latestData = useRef(data);
  latestData.current = data;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      action.current += 1;
    };
  }, []);
  const readController = useRef<AbortController | null>(null);
  // Retire the previous read at commit, before a granted Web Lock can resume
  // its automatic pending-record cleanup. Fetch and display updates stay passive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(() => () => readController.current?.abort(), [revision]);
  const pendingIntent = useRef<{
    key: string;
    value: Pending | null | undefined;
    snapshot: PendingSnapshot;
  } | null>(null);
  const [message, setMessage] = useState("");
  const rememberPending = (
    account: ReferralAccount,
    value: Pending | null | undefined,
    snapshot: PendingSnapshot,
  ) => {
    pendingIntent.current = { key: pendingKey(account), value, snapshot };
    setPending(value);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: user refresh rechecks the cached record.
  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    setError("");
    setReview(null);
    fetch("/api/v1/referrals/me", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Referral request ${response.status}`);
        const value = referralResponse(
          await readBoundedJson(response, 262144, "referral claim"),
        );
        if (controller.signal.aborted) return;
        setData(value);
        setLoadFailed(false);
        if (value.enabled && value.program && value.wallet) {
          let snapshot = readPending(value);
          let p = snapshot.value;
          const previous = pendingIntent.current;
          if (
            previous?.key === pendingKey(value) &&
            (snapshot.raw === undefined ||
              snapshot.raw === previous.snapshot.raw)
          ) {
            // A failed hash write can leave newer evidence only in this view.
            // A different stored attempt always wins over that local evidence.
            p = previous.value;
            snapshot = previous.snapshot;
          } else if (
            previous?.key === pendingKey(value) &&
            previous.value &&
            snapshot.value &&
            snapshot.value.attemptId === undefined &&
            BigInt(previous.value.cumulative) >=
              BigInt(snapshot.value.cumulative)
          ) {
            // A legacy/older writer must not use a smaller total to confirm
            // this view's newer request. Keep the actual stored bytes separate.
            p = previous.value;
          }
          rememberPending(value, p, snapshot);
          if (
            p &&
            value.claimedBase !== null &&
            BigInt(value.claimedBase) >= BigInt(p.cumulative)
          ) {
            try {
              const cleared = await withPendingLock(value, () => {
                if (controller.signal.aborted || !snapshot.value) return false;
                return clearPendingAttempt(
                  pendingKey(value),
                  snapshot.value,
                  localStorage,
                );
              });
              if (controller.signal.aborted) return;
              if (cleared)
                rememberPending(value, null, { value: null, raw: null });
              else {
                const current = readPending(value);
                rememberPending(value, current.value, current);
                setError(
                  "The saved claim request changed. Refresh its record before clearing it.",
                );
              }
              if (cleared) setMessage("Your claim is verified.");
            } catch (cause) {
              if (controller.signal.aborted) return;
              setMessage("Your claim is verified.");
              setError(
                errorMessage(
                  cause,
                  "Your browser could not clear the saved claim status. Refresh before another attempt.",
                ),
              );
            }
          }
        } else setPending(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          setError("Additional payout records could not load.");
        }
      });
    return () => controller.abort();
  }, [revision]);
  const reload = () => setRevision((v) => v + 1);
  if (!data?.enabled)
    return error ? (
      <div role="alert">
        <p>{error}</p>
        <button
          className="button secondary-button button-small"
          type="button"
          onClick={reload}
        >
          Retry
        </button>
      </div>
    ) : null;
  const amount = (value: string | null) =>
    value === null || !data.program
      ? "Unknown"
      : `${formatBaseUnits(value, data.program.decimals)} program tokens`;
  const canReview =
    !loadFailed &&
    data.status === "ready" &&
    !data.paused &&
    !data.ended &&
    data.claim !== null &&
    data.claimableBase !== null &&
    BigInt(data.claimableBase) > 0n &&
    pending === null;
  const connect = async (choice: PayoutWallet) => {
    if (!mounted.current) return;
    const currentAction = ++action.current;
    const key = pendingKey(data);
    const current = () =>
      mounted.current &&
      action.current === currentAction &&
      latestData.current?.enabled === true &&
      pendingKey(latestData.current) === key;
    setBusy(true);
    setError("");
    setMessage("");
    setReview(null);
    try {
      const wallet = await choice.connect();
      if (!current()) return;
      await reviewReferralClaim(data, wallet);
      if (!current()) return;
      setReview({ data, wallet });
    } catch (e) {
      if (current())
        setError(errorMessage(e, "The claim could not be reviewed."));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const send = async () => {
    if (!review || !mounted.current) return;
    const account = review.data;
    const key = pendingKey(account);
    const currentAction = ++action.current;
    const current = () =>
      mounted.current &&
      action.current === currentAction &&
      latestData.current?.enabled === true &&
      pendingKey(latestData.current) === key;
    setBusy(true);
    setError("");
    let requested = false;
    let declined = false;
    try {
      await withPendingLock(account, async () => {
        if (!current()) return;
        const recorded: { value: Pending | null } = { value: null };
        try {
          const hash = await sendReferralClaim(account, review.wallet, () => {
            if (!current())
              throw new Error(
                "This claim view has closed. Review again before sending.",
              );
            const p: Pending = {
              hash: null,
              cumulative: account.claim?.cumulativeBase ?? "0",
              attemptId: crypto.randomUUID(),
            };
            let created = false;
            try {
              created = createPendingAttempt(key, p, localStorage);
            } catch {
              throw new Error(
                "Your browser could not save the claim status. Enable site storage, then retry. No wallet request was sent.",
              );
            }
            if (!created)
              throw new Error(
                "A saved claim request already exists. Refresh and check wallet activity before another attempt.",
              );
            recorded.value = p;
            rememberPending(account, p, { value: p, raw: JSON.stringify(p) });
            requested = true;
          });
          const captured = recorded.value;
          if (!captured) throw new Error("The claim request was not recorded.");
          const result = { ...captured, hash };
          let updated = false;
          try {
            updated = updatePendingAttempt(key, captured, result, localStorage);
          } catch {
            if (current()) {
              rememberPending(account, result, {
                value: captured,
                raw: JSON.stringify(captured),
              });
              setError(
                "Your browser could not save the claim status. Keep this page open and check wallet activity.",
              );
            }
            return;
          }
          if (current()) {
            if (updated) {
              rememberPending(account, result, {
                value: result,
                raw: JSON.stringify(result),
              });
              setMessage(
                "Claim submitted. Wait for the verified record to refresh.",
              );
            } else {
              setError(
                "The saved claim request changed. Refresh before another attempt.",
              );
            }
          }
        } catch (cause) {
          if ((cause as { code?: unknown })?.code === 4001 && recorded.value) {
            declined = true;
            if (!clearPendingAttempt(key, recorded.value, localStorage))
              throw new Error(
                "The saved claim request changed. Refresh before another attempt.",
              );
            if (current())
              rememberPending(account, null, { value: null, raw: null });
          }
          throw cause;
        }
      });
    } catch (e) {
      if (!current()) return;
      if ((e as { code?: unknown })?.code === 4001) {
        setMessage("The wallet request was cancelled.");
      } else if (declined) {
        setError(
          `The wallet request was cancelled. ${errorMessage(e, "The saved status could not be cleared. Refresh before another attempt.")}`,
        );
      } else
        setError(
          requested
            ? "The send result is unknown. Check wallet activity before another attempt."
            : errorMessage(e, "The claim could not be sent."),
        );
    } finally {
      if (current()) {
        setBusy(false);
        setReview(null);
      }
    }
  };
  const resetPending = async () => {
    if (!mounted.current) return;
    const currentAction = ++action.current;
    const key = pendingKey(data);
    const captured = pendingIntent.current;
    const current = () =>
      mounted.current &&
      action.current === currentAction &&
      latestData.current?.enabled === true &&
      pendingKey(latestData.current) === key;
    setBusy(true);
    setError("");
    try {
      await withPendingLock(data, () => {
        if (!current()) return;
        if (
          !captured ||
          captured.key !== key ||
          captured.snapshot.raw === undefined
        )
          throw new Error(
            "Your browser could not read the saved claim status. Enable site storage and refresh before clearing it.",
          );
        if (captured.snapshot.value) {
          if (!clearPendingAttempt(key, captured.snapshot.value, localStorage))
            throw new Error(
              "The saved claim request changed. Refresh before clearing it.",
            );
        } else {
          if (localStorage.getItem(key) !== captured.snapshot.raw)
            throw new Error(
              "The saved claim request changed. Refresh before clearing it.",
            );
          localStorage.removeItem(key);
        }
        rememberPending(data, null, { value: null, raw: null });
        setReview(null);
        reload();
      });
    } catch (cause) {
      if (current())
        setError(
          errorMessage(
            cause,
            "Your browser could not clear the claim status. Enable site storage, then retry.",
          ),
        );
    } finally {
      if (current()) setBusy(false);
    }
  };
  const link =
    pending?.hash && data.program
      ? transactionUrl(data.program.network, pending.hash)
      : null;
  return (
    <section
      aria-labelledby="referral-rewards-heading"
      className="referral-claims"
    >
      <h2 id="referral-rewards-heading">Referral rewards</h2>
      {error && <p role="alert">{error}</p>}
      {data.status === "unknown" && (
        <p role="status">The claim record is not available yet.</p>
      )}
      {data.status === "stale" && (
        <p role="status">
          This claim record is stale. Showing the last verified amounts.
        </p>
      )}
      <p>
        <strong>{amount(data.claimableBase)}</strong> claimable
      </p>
      {data.paused && <p role="status">Claims are paused.</p>}
      {data.ended && <p role="status">Claims are closed.</p>}
      {data.latestVoided && (
        <p role="status">
          The latest monthly update was voided. Only earlier rewards can be
          claimed.
        </p>
      )}
      {data.pendingUntil && (
        <p>
          New rewards can be claimed after {formatDateTime(data.pendingUntil)},
          once verified.
        </p>
      )}
      {!data.wallet ? (
        <p>
          <a href="/account#wallets">Confirm a Robinhood wallet in Account</a>.
          The first wallet included stays fixed.
        </p>
      ) : null}
      {message && <p role="status">{message}</p>}
      {pending !== null && (
        <div role="status">
          <p>
            {pending?.hash
              ? "A claim was submitted. It is not yet verified in this record."
              : "A wallet request may have been sent. Check wallet activity."}{" "}
            {link && (
              <a href={link} target="_blank" rel="noreferrer">
                View transaction
              </a>
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void resetPending()}
          >
            I checked wallet activity. Review again
          </button>
        </div>
      )}
      <div className="handoff-actions">
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={reload}
        >
          Refresh record
        </button>
        {canReview &&
          !review &&
          wallets.map((wallet) => (
            <button
              className="button primary-button"
              key={wallet.id}
              type="button"
              disabled={busy}
              onClick={() => void connect(wallet)}
            >
              Review with {wallet.name}
            </button>
          ))}
      </div>
      {canReview && !wallets.length && (
        <p>Open this page in a browser with your EVM wallet to claim.</p>
      )}
      {review && (
        <section
          className="referral-claim-review"
          aria-label="Review referral claim"
        >
          <h3>Review your claim</h3>
          <p>
            Receive {amount(review.data.claimableBase)} on{" "}
            {networkLabel(review.data.program?.network ?? "")}.
          </p>
          <p>
            Destination:{" "}
            <code className="referral-address">{review.data.wallet}</code>
          </p>
          <p>
            Contract:
            <code className="referral-address">
              {review.data.program?.distributor}
            </code>
          </p>
          <p>
            Your wallet pays the network fee. No token approval is required.
          </p>
          <div className="handoff-actions">
            <button
              className="button primary-button"
              type="button"
              disabled={busy}
              onClick={() => void send()}
            >
              Confirm claim in wallet
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <details>
        <summary>Reward details</summary>
        <dl>
          <dt>Accrued</dt>
          <dd>{amount(data.accruedBase)}</dd>
          <dt>Pending</dt>
          <dd>{amount(data.pendingBase)}</dd>
          <dt>Claimed</dt>
          <dd>{amount(data.claimedBase)}</dd>
        </dl>
        {data.program && <p>Network: {networkLabel(data.program.network)}.</p>}
        {data.observedAt && <p>Updated {formatDateTime(data.observedAt)}.</p>}
        {data.wallet ? (
          <p>
            Referral wallet (fixed for this program):
            <code className="referral-address">{data.wallet}</code>
          </p>
        ) : null}
      </details>
    </section>
  );
}
