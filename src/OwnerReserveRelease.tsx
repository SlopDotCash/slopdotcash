import { LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
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
  type PendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import { formatAssetSymbol } from "./lib/reward-asset.mjs";
import { useAction } from "./lib/use-action";
import { usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import { CopyIdentifier } from "./Operations";
import {
  PendingTransaction,
  UnsentTransactionRecovery,
} from "./OwnerPresentation";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Pending = PendingAttempt & { planId: string; hash: string | null };
const spinner = (
  <LoaderCircle className="wallet-spin" aria-hidden="true" size={14} />
);
const HELD: Record<string, string> = {
  "allocation-unavailable": "Allocation unavailable. Held.",
  "allocation-mismatch": "Not proven faulty. Held.",
  "no-wrong-sum-fault": "Total correct. Nothing to release.",
  "prior-reserve-transition": "Already changed. Not repairable.",
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
  const {
    mounted,
    saved: initial,
    storedPending,
    pending,
    setPending,
    storageError,
    remember: save,
    clear,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(
    key,
    (raw) => {
      const parsed = JSON.parse(raw) as Pending;
      if (
        !validPendingAttemptId(parsed.attemptId) ||
        !/^[a-f0-9]{64}$/.test(parsed.planId) ||
        (parsed.hash !== null && typeof parsed.hash !== "string")
      )
        throw new Error();
      return parsed;
    },
    () => "Saved request unreadable. Check wallet activity.",
  );
  const [plan, setPlan] = useState<ReadyMonthlyRelease | null>(null);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [hash, setHash] = useState(initial.pending?.hash ?? "");
  const { busy, error, run: act } = useAction(initial.error);
  const [notice, setNotice] = useState<ReactNode>("");
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
  const amount = plan?.prepared.evidence.releasedGross;
  return (
    <details className="owner-reserve-release">
      <summary>Repair reserve</summary>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void run(async () => clearUnreadable())}
        >
          Clear saved record
        </button>
      )}
      {pending ? (
        <PendingTransaction>
          <p>{spinner} Pending · don't resend</p>
          <label>
            Transaction hash
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
                  setNotice(<>{spinner} Finalizing</>);
                  return;
                }
                if (result.status !== "failed" && result.status !== "finalized")
                  throw new Error("The transaction status is unavailable.");
                clear(captured);
                setPlan(null);
                setNotice(
                  result.status === "finalized"
                    ? "Released."
                    : "Transaction failed. Nothing released.",
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
                  setNotice("Cleared.");
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
                  ? `${formatBaseUnits(amount, view.asset.assetDecimals)}${view.asset.symbol ? ` ${formatAssetSymbol(view.asset.symbol)}` : ""}`
                  : `${amount} token base units`}{" "}
                → free balance
              </p>
              {!wallet ? (
                <WalletConnection
                  address={null}
                  wallets={wallets}
                  disabled={busy}
                  legend="Owner wallet"
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
                      const keep = (
                        <>
                          Not saved. Keep this{" "}
                          {family === "solana" ? "signature" : "hash"}:{" "}
                          <CopyIdentifier
                            label="transaction hash"
                            value={transactionId}
                          />
                        </>
                      );
                      try {
                        if (!save({ ...intent, hash: transactionId }, intent)) {
                          if (mounted.current) setNotice(keep);
                          return;
                        }
                      } catch {
                        if (mounted.current) {
                          setPending({ ...intent, hash: transactionId });
                          setHash(transactionId);
                          setNotice(keep);
                        }
                        return;
                      }
                      if (!mounted.current) return;
                      setHash(transactionId);
                      setNotice(<>{spinner} Submitted</>);
                    })
                  }
                >
                  Sign release
                </button>
              )}
            </div>
          )}
        </>
      )}
    </details>
  );
}
