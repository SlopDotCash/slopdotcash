import { useEffect, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
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

type Connection = Awaited<ReturnType<PayoutWallet["connect"]>>;
interface Pending {
  hash: string | null;
  cumulative: string;
}
function pendingKey(data: ReferralAccount) {
  return `slop:referral-claim:${data.program?.network}:${data.program?.distributor}:${data.wallet}`;
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
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
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
          const stored = localStorage.getItem(pendingKey(value));
          const p: Pending | null = stored ? JSON.parse(stored) : null;
          if (
            p &&
            value.claimedBase !== null &&
            BigInt(value.claimedBase) >= BigInt(p.cumulative)
          ) {
            localStorage.removeItem(pendingKey(value));
            setPending(null);
            setMessage("Your claim is verified.");
          } else setPending(p);
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          setError(
            e instanceof Error
              ? e.message
              : "Additional payout records could not load. Retry.",
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
        <button type="button" onClick={reload}>
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
    !pending;
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
      setError(
        e instanceof Error ? e.message : "The claim could not be reviewed.",
      );
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
        localStorage.setItem(pendingKey(review.data), JSON.stringify(p));
        setPending(p);
        requested = true;
      });
      const p = { hash, cumulative: review.data.claim?.cumulativeBase ?? "0" };
      localStorage.setItem(pendingKey(review.data), JSON.stringify(p));
      setPending(p);
      setMessage("Claim submitted. Wait for the verified record to refresh.");
    } catch (e) {
      if ((e as { code?: unknown })?.code === 4001) {
        localStorage.removeItem(pendingKey(review.data));
        setPending(null);
        setMessage("The wallet request was cancelled.");
      } else
        setError(
          requested
            ? "The send result is unknown. Check wallet activity before another attempt."
            : e instanceof Error
              ? e.message
              : "The claim could not be sent.",
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
      className="earnings-section"
    >
      <h2 id="referral-rewards-heading">Referral rewards</h2>
      <p>Program tokens are separate from Points and project awards.</p>
      {error && <p role="alert">{error}</p>}
      {data.status === "unknown" && (
        <p role="status">
          The claim record is not available yet. Amounts stay unknown until
          verification succeeds.
        </p>
      )}
      {data.status === "stale" && (
        <p role="status">
          This claim record is stale. The last verified amounts are shown.
          Claims wait for a successful background refresh.
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
      {data.observedAt && (
        <p>
          Updated {new Date(data.observedAt).toLocaleString()}.{" "}
          {data.finalizedAt && (
            <>
              Chain evidence through{" "}
              {new Date(data.finalizedAt).toLocaleString()}.
            </>
          )}
        </p>
      )}
      {data.paused && (
        <p role="status">
          Claims are paused. A pending root’s wait is frozen until the owner
          resumes it.
        </p>
      )}
      {data.ended && (
        <p role="status">
          The owner has closed this distribution. Claims are unavailable.
        </p>
      )}
      {data.latestVoided && (
        <p role="status">
          The latest root was voided. Only rewards in a previous valid root can
          be claimed.
        </p>
      )}
      {data.pendingUntil && (
        <p>
          The next root’s wait ends{" "}
          {new Date(data.pendingUntil).toLocaleString()}. A background check
          must verify it before claims open.
        </p>
      )}
      {data.wallet ? (
        <p>
          Referral wallet: <span className="wallet-address">{data.wallet}</span>
          . This address stays fixed for this program.
        </p>
      ) : (
        <p>
          <a href="/account#wallets">Confirm a Robinhood wallet in Account</a>.
          Rewards enter a later monthly root after confirmation.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {pending && (
        <div role="status">
          <p>
            {pending.hash
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
              localStorage.removeItem(pendingKey(data));
              setPending(null);
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
        <section className="callout" aria-label="Review referral claim">
          <h3>Review your claim</h3>
          <p>
            Receive {amount(review.data.claimableBase)} at{" "}
            <span className="wallet-address">{review.data.wallet}</span> on{" "}
            {networkLabel(review.data.program?.network ?? "")}. Your wallet pays
            the network fee. No token approval is required.
          </p>
          <p>
            Contract:{" "}
            <span className="wallet-address">
              {review.data.program?.distributor}
            </span>
            .
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
