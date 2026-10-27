import { useState } from "react";
import type { MonthlyOwnerView } from "../backend/payments/monthly";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import type { VaultConnection } from "./lib/evm-vault-actions";
import {
  type ReadyMonthlyRelease,
  requestMonthlyRelease,
  sendMonthlyRelease,
} from "./lib/monthly-release-actions";
import { formatBaseUnits, transactionUrl } from "./lib/payments/contracts";
import { usePayoutWallets } from "./lib/use-payout-wallets";

type Pending = { planId: string; hash: string | null };
const HELD: Record<string, string> = {
  "allocation-unavailable":
    "The complete original allocation is unavailable. The reserve stays held.",
  "allocation-mismatch":
    "The retained allocation does not prove this reserve is faulty. The reserve stays held.",
  "no-wrong-sum-fault": "The reserve total is correct. No release is needed.",
  "prior-reserve-transition":
    "This reserve has already changed. It cannot use this repair.",
};
export default function OwnerReserveRelease({
  view,
}: {
  view: MonthlyOwnerView;
}) {
  const key = `slop:monthly-release:v1:${view.projectId}:${view.period}:${view.deployment?.network}`;
  const [initial] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return { pending: null, error: "" };
      const parsed = JSON.parse(raw) as Pending;
      if (
        !/^[a-f0-9]{64}$/.test(parsed.planId) ||
        (parsed.hash !== null && typeof parsed.hash !== "string")
      )
        throw new Error();
      return { pending: parsed, error: "" };
    } catch {
      return {
        pending: null,
        error:
          "The saved release cannot be read. Check wallet activity before another request.",
      };
    }
  });
  const [pending, setPending] = useState<Pending | null>(initial.pending);
  const [plan, setPlan] = useState<ReadyMonthlyRelease | null>(null);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [hash, setHash] = useState(initial.pending?.hash ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const [storageError, setStorageError] = useState(!!initial.error);
  const [notice, setNotice] = useState("");
  const family = view.deployment
    ? ESCROW_NETWORKS[view.deployment.network].family
    : null;
  const wallets = usePayoutWallets().filter((w) => w.family === family);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason, "The release is unavailable. Retry."));
    } finally {
      setBusy(false);
    }
  }
  function save(value: Pending) {
    sessionStorage.setItem(key, JSON.stringify(value));
    setPending(value);
  }
  const amount = plan?.prepared.evidence.releasedGross;
  return (
    <details className="owner-reserve-release">
      <summary>Repair a stuck monthly reserve</summary>
      <p>
        Check a reserve that cannot pay because its recorded total is wrong. A
        proven repair returns the untouched reserve to the vault's free balance.
        Funds stay in the vault.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              sessionStorage.removeItem(key);
              setStorageError(false);
            })
          }
        >
          I checked wallet activity; clear the unreadable local request
        </button>
      )}
      {pending ? (
        <div>
          <p>
            The wallet request is recorded. Check its result before another
            attempt.
          </p>
          <label>
            Transaction hash or signature
            <input
              value={hash}
              onChange={(event) => setHash(event.target.value)}
              disabled={busy}
            />
          </label>
          {pending.hash && view.deployment && (
            <p>
              <a
                href={
                  transactionUrl(view.deployment.network, pending.hash) ??
                  undefined
                }
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            </p>
          )}
          <button
            className="button secondary-button"
            type="button"
            disabled={busy || !hash.trim()}
            onClick={() =>
              void run(async () => {
                const result = await requestMonthlyRelease(view, {
                  planId: pending.planId,
                  transactionId: hash.trim(),
                });
                if (result.status === "pending") {
                  save({ ...pending, hash: hash.trim() });
                  setNotice("Waiting for the transaction to finalize.");
                  return;
                }
                if (result.status !== "failed" && result.status !== "finalized")
                  throw new Error("The transaction status is unavailable.");
                sessionStorage.removeItem(key);
                setPending(null);
                setPlan(null);
                setNotice(
                  result.status === "finalized"
                    ? "Release verified. The reserve returned to the vault's free balance."
                    : "The transaction failed. No reserve was released. You can review again.",
                );
              })
            }
          >
            Check transaction
          </button>
          {!pending.hash && (
            <button
              className="button secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                sessionStorage.removeItem(key);
                setPending(null);
                setPlan(null);
                setNotice("Local request cleared after your wallet check.");
              }}
            >
              I checked wallet activity; nothing was submitted
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy || storageError || !view.deployment}
            onClick={() =>
              void run(async () => {
                setPlan(null);
                const result = await requestMonthlyRelease(view);
                if (result.status === "held") {
                  setPlan(null);
                  setNotice(
                    HELD[result.reason] ?? "The reserve cannot be released.",
                  );
                  return;
                }
                if (result.status !== "ready")
                  throw new Error("The release could not be prepared.");
                setPlan(result);
              })
            }
          >
            Check reserve
          </button>
          {plan && (
            <div>
              <p>
                Release{" "}
                {view.asset && amount
                  ? `${formatBaseUnits(amount, view.asset.assetDecimals)} ${view.asset.symbol}`
                  : `${amount} token base units`}{" "}
                to the vault's free balance. Your wallet pays the network fee.
                This does not pay contributors or withdraw funds.
              </p>
              {!wallet ? (
                <fieldset disabled={busy}>
                  <legend>Connect the vault owner's wallet</legend>
                  {wallets.map((provider) => (
                    <button
                      className="button secondary-button"
                      type="button"
                      key={provider.id}
                      onClick={() =>
                        void run(async () =>
                          setWallet(await provider.connect()),
                        )
                      }
                    >
                      Connect {provider.name}
                    </button>
                  ))}
                  {!wallets.length && (
                    <p>
                      No compatible wallet found. Open your wallet extension and
                      reload.
                    </p>
                  )}
                </fieldset>
              ) : (
                <button
                  className="button primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const transactionId = await sendMonthlyRelease(
                        plan,
                        wallet,
                        () => save({ planId: plan.planId, hash: null }),
                      );
                      save({ planId: plan.planId, hash: transactionId });
                      setHash(transactionId);
                      setNotice(
                        "Submitted. Check the transaction to verify the release.",
                      );
                    })
                  }
                >
                  Review and sign release
                </button>
              )}
            </div>
          )}
        </>
      )}
    </details>
  );
}
