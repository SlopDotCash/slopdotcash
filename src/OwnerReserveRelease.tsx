import { useEffect, useRef, useState } from "react";
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
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import { useAction } from "./lib/use-action";
import { usePayoutWallets } from "./lib/use-payout-wallets";
import {
  PendingTransaction,
  UnsentTransactionRecovery,
} from "./OwnerPresentation";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Pending = PendingAttempt & { planId: string; hash: string | null };
const HELD: Record<string, string> = {
  "allocation-unavailable":
    "The complete original allocation is unavailable. The reserve stays held.",
  "allocation-mismatch": "This reserve is not proven faulty. It stays held.",
  "no-wrong-sum-fault": "The reserve total is correct. No release is needed.",
  "prior-reserve-transition":
    "This reserve has already changed. It cannot use this repair.",
};
/** Session storage prefix for a project's submitted reserve releases. */
export const releaseStoragePrefix = (projectId: string) =>
  `slop:monthly-release:v1:${projectId}:`;
export default function OwnerReserveRelease({
  view,
}: {
  view: MonthlyOwnerView;
}) {
  const key = `${releaseStoragePrefix(view.projectId)}${view.period}:${view.deployment?.network}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [initial] = useState(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      if (raw === null) return { pending: null, error: "", raw };
      const parsed = JSON.parse(raw) as Pending;
      if (
        !validPendingAttemptId(parsed.attemptId) ||
        !/^[a-f0-9]{64}$/.test(parsed.planId) ||
        (parsed.hash !== null && typeof parsed.hash !== "string")
      )
        throw new Error();
      return { pending: parsed, error: "", raw };
    } catch {
      return {
        pending: null,
        raw,
        error:
          "The saved release cannot be read. Check wallet activity before another request.",
      };
    }
  });
  const storedPending = useRef<Pending | null>(initial.pending);
  const [pending, setPending] = useState<Pending | null>(initial.pending);
  const [plan, setPlan] = useState<ReadyMonthlyRelease | null>(null);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [hash, setHash] = useState(initial.pending?.hash ?? "");
  const { busy, error, run: act } = useAction(initial.error);
  const [storageError, setStorageError] = useState(!!initial.error);
  const [notice, setNotice] = useState("");
  const family = view.deployment
    ? ESCROW_NETWORKS[view.deployment.network].family
    : null;
  const wallets = usePayoutWallets().filter((w) => w.family === family);
  const run = (action: () => Promise<void>) => {
    setNotice("");
    return act(action, (caught) =>
      errorMessage(caught, "The release is unavailable. Retry."),
    );
  };

  function save(value: Pending, previous?: Pending) {
    const stored = previous
      ? updatePendingAttempt(key, previous, value)
      : createPendingAttempt(key, value);
    if (!stored) return false;
    storedPending.current = value;
    if (mounted.current) setPending(value);
    return true;
  }
  function clear(value: Pending) {
    if (!mounted.current) return false;
    if (!clearPendingAttempt(key, value))
      throw new Error("The saved request changed. Reload before continuing.");
    storedPending.current = null;
    setPending(null);
    return true;
  }
  const amount = plan?.prepared.evidence.releasedGross;
  return (
    <details className="owner-reserve-release">
      <summary>Repair a stuck monthly reserve</summary>
      <p>Returns a reserve whose total is wrong to the vault's free balance.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (!mounted.current) return;
              if (sessionStorage.getItem(key) !== initial.raw)
                throw new Error(
                  "The saved request changed. Reload before continuing.",
                );
              sessionStorage.removeItem(key);
              setStorageError(false);
            })
          }
        >
          I checked wallet activity; clear the unreadable local request
        </button>
      )}
      {pending ? (
        <PendingTransaction>
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
                const captured = storedPending.current;
                if (!captured)
                  throw new Error(
                    "The saved request changed. Reload before continuing.",
                  );
                const result = await requestMonthlyRelease(view, {
                  planId: pending.planId,
                  transactionId: hash.trim(),
                });
                if (!mounted.current) return;
                if (result.status === "pending") {
                  const candidate = { ...pending, hash: hash.trim() };
                  if (!updatePendingRecord(key, captured, candidate))
                    throw new Error(
                      "The saved request changed. Reload before continuing.",
                    );
                  storedPending.current = candidate;
                  setPending(candidate);
                  setNotice("Waiting for the transaction to finalize.");
                  return;
                }
                if (result.status !== "failed" && result.status !== "finalized")
                  throw new Error("The transaction status is unavailable.");
                clear(captured);
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
            <UnsentTransactionRecovery
              disabled={busy}
              onClear={() =>
                void run(async () => {
                  clear(storedPending.current ?? pending);
                  setPlan(null);
                  setNotice("Local request cleared after your wallet check.");
                })
              }
            />
          )}
        </PendingTransaction>
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
                if (!mounted.current) return;
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
                to the vault's free balance. This does not pay contributors or
                withdraw funds.
              </p>
              {!wallet ? (
                <WalletConnection
                  address={null}
                  wallets={wallets}
                  disabled={busy}
                  legend="Connect the vault owner's wallet"
                  empty={<NoWalletFound solana={family === "solana"} />}
                  onConnect={(provider) =>
                    void run(async () => {
                      const connected = await provider.connect();
                      if (mounted.current) setWallet(connected);
                    })
                  }
                />
              ) : (
                <button
                  className="button primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const intent: Pending = {
                        attemptId: crypto.randomUUID(),
                        planId: plan.planId,
                        hash: null,
                      };
                      const transactionId = await sendMonthlyRelease(
                        plan,
                        wallet,
                        () => {
                          if (!mounted.current)
                            throw new Error(
                              "The wallet view was closed. Review before sending.",
                            );
                          if (!save(intent))
                            throw new Error(
                              "The saved request changed. Reload before continuing.",
                            );
                        },
                      );
                      try {
                        if (!save({ ...intent, hash: transactionId }, intent)) {
                          if (mounted.current)
                            setNotice(
                              `Submitted: ${transactionId}. The saved request was cleared or replaced. Keep this identifier with your wallet activity.`,
                            );
                          return;
                        }
                      } catch {
                        if (mounted.current) {
                          setPending({ ...intent, hash: transactionId });
                          setHash(transactionId);
                          setNotice(
                            `Submitted: ${transactionId}. Browser storage could not save it. Keep this identifier with your wallet activity.`,
                          );
                        }
                        return;
                      }
                      if (!mounted.current) return;
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
