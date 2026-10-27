import { useEffect, useRef, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, transactionUrl } from "./lib/payments/contracts";
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
interface Pending {
  hash: string | null;
  cumulative: string;
}
function pendingKey(data: ReferralAccount) {
  return `slop:referral-claim:${data.program?.network}:${data.program?.distributor}:${data.wallet}`;
}
// An unreadable marker is unknown, not proof that no request was sent.
// Keep this local status separate from the verified amounts.
function readPending(data: ReferralAccount): Pending | null | undefined {
  try {
    const stored = localStorage.getItem(pendingKey(data));
    if (!stored) return null;
    const p = JSON.parse(stored) as Pending;
    if (
      (p.hash !== null &&
        (typeof p.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(p.hash))) ||
      typeof p.cumulative !== "string" ||
      !/^(0|[1-9][0-9]{0,77})$/.test(p.cumulative)
    )
      return undefined;
    return p;
  } catch {
    return undefined;
  }
}
function writePending(data: ReferralAccount, p: Pending | null) {
  try {
    if (p) localStorage.setItem(pendingKey(data), JSON.stringify(p));
    else localStorage.removeItem(pendingKey(data));
    return true;
  } catch {
    return false;
  }
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
  const pendingIntent = useRef<{
    key: string;
    value: Pending | null | undefined;
  } | null>(null);
  const [message, setMessage] = useState("");
  const rememberPending = (
    account: ReferralAccount,
    value: Pending | null | undefined,
  ) => {
    pendingIntent.current = { key: pendingKey(account), value };
    setPending(value);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: user refresh rechecks the cached record.
  useEffect(() => {
    const controller = new AbortController();
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
          throw new Error("Additional payout records could not load. Retry.");
        const value = referralResponse(
          await readBoundedJson(response, 262144, "referral claim"),
        );
        if (controller.signal.aborted) return;
        setData(value);
        setLoadFailed(false);
        if (value.enabled && value.program && value.wallet) {
          let p = readPending(value);
          const previous = pendingIntent.current;
          if (previous?.key === pendingKey(value)) {
            // A missing, unreadable or older marker cannot erase this page's
            // newer intent or confirm it using an earlier claim's total.
            if (
              previous.value &&
              (!p || BigInt(previous.value.cumulative) >= BigInt(p.cumulative))
            )
              p = previous.value;
            else if (previous.value === undefined && p === null) p = undefined;
          }
          if (
            p &&
            value.claimedBase !== null &&
            BigInt(value.claimedBase) >= BigInt(p.cumulative)
          ) {
            writePending(value, null);
            rememberPending(value, null);
            setMessage("Your claim is verified.");
          } else rememberPending(value, p);
        } else setPending(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          setError(
            errorMessage(e, "Additional payout records could not load. Retry."),
          );
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
    setBusy(true);
    setError("");
    setMessage("");
    setReview(null);
    try {
      const wallet = await choice.connect();
      await reviewReferralClaim(data, wallet);
      setReview({ data, wallet });
    } catch (e) {
      setError(errorMessage(e, "The claim could not be reviewed."));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!review) return;
    setBusy(true);
    setError("");
    let requested = false;
    try {
      const hash = await sendReferralClaim(review.data, review.wallet, () => {
        const p = {
          hash: null,
          cumulative: review.data.claim?.cumulativeBase ?? "0",
        };
        if (!writePending(review.data, p))
          throw new Error(
            "Your browser could not save the claim status. Enable site storage, then retry. No wallet request was sent.",
          );
        rememberPending(review.data, p);
        requested = true;
      });
      const p = { hash, cumulative: review.data.claim?.cumulativeBase ?? "0" };
      rememberPending(review.data, p);
      if (!writePending(review.data, p))
        setError(
          "Your browser could not save the claim status. Keep this page open and check wallet activity.",
        );
      setMessage("Claim submitted. Wait for the verified record to refresh.");
    } catch (e) {
      if ((e as { code?: unknown })?.code === 4001) {
        writePending(review.data, null);
        rememberPending(review.data, null);
        setMessage("The wallet request was cancelled.");
      } else
        setError(
          requested
            ? "The send result is unknown. Check wallet activity before another attempt."
            : errorMessage(e, "The claim could not be sent."),
        );
    } finally {
      setBusy(false);
      setReview(null);
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
      <dl>
        <dt>Accrued</dt>
        <dd>{amount(data.accruedBase)}</dd>
        <dt>Pending</dt>
        <dd>{amount(data.pendingBase)}</dd>
        <dt>Claimable</dt>
        <dd>{amount(data.claimableBase)}</dd>
        <dt>Claimed</dt>
        <dd>{amount(data.claimedBase)}</dd>
      </dl>
      {data.program && <p>Network: {networkLabel(data.program.network)}.</p>}
      {data.observedAt && <p>Updated {formatDateTime(data.observedAt)}.</p>}
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
      {data.wallet ? (
        <p>
          Referral wallet (fixed for this program):
          <code className="referral-address">{data.wallet}</code>
        </p>
      ) : (
        <p>
          <a href="/account#wallets">Confirm a Robinhood wallet in Account</a>.
          The first wallet included stays fixed.
        </p>
      )}
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
            onClick={() => {
              if (!writePending(data, null)) {
                setError(
                  "Your browser could not clear the claim status. Enable site storage, then retry.",
                );
                return;
              }
              rememberPending(data, null);
              setReview(null);
              setError("");
              reload();
            }}
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
    </section>
  );
}
