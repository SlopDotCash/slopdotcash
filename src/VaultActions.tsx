import { CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "./lib/escrow-policy.mjs";
import {
  checkVaultAction,
  checkVaultBatch,
  reviewVaultAction,
  sendVaultAction,
  sendVaultBatch,
  type VaultActionReview,
  VaultBatchUnavailable,
  type VaultConnection,
  type VaultOperation,
} from "./lib/evm-vault-actions";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import { networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
  formatBaseUnits,
  type PayoutPolicy,
  transactionUrl,
} from "./lib/payments/contracts";
import {
  clearPendingAttempt,
  type PendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import {
  checkSolanaVaultAction,
  reviewSolanaVaultAction,
  type SolanaFundingPlan,
  sendSolanaVaultAction,
} from "./lib/solana-vault-actions";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import { isWalletAddress, sameWalletAddress } from "./lib/wallets";
import { PendingWalletCheck } from "./OwnerPresentation";
import { NetworkName, NoWalletFound, WalletConnection } from "./Presentation";

/** "batch" is one wallet request that carries the approval and the deposit. */
type Step = "approve" | "reset" | "send" | "batch";
type Pending = PendingAttempt & {
  version: 1;
  wallet: string;
  operation: VaultOperation;
  amount: string;
  gross: string;
  decimals: number;
  step: Step;
  hash: string | null;
  hashSource?: "wallet" | "recovery";
  solanaBlockhash?: string;
  /** The wallet's reference for a batch; its transaction hash is read later. */
  batchId?: string;
};
type Review = Omit<VaultActionReview, "batch"> & {
  batch?: boolean;
  solanaPlan?: SolanaFundingPlan;
};
/**
 * A submitted wallet transaction is checked without a click: every 3 seconds
 * at first, then every 15, for about an hour. "Check transaction" stays for
 * a hash the owner entered and for later visits.
 */
const AUTO_CHECK_FAST_MS = 3_000;
const AUTO_CHECK_SLOW_MS = 15_000;
const AUTO_CHECK_FAST_ATTEMPTS = 20;
const AUTO_CHECK_ATTEMPTS = 240;
function readPending(text: string | null, solana: boolean): Pending | null {
  if (text === null) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
    !validPendingAttemptId(value.attemptId) ||
    !isWalletAddress(solana ? "solana" : "base", value.wallet) ||
    !["deposit", "withdraw"].includes(value.operation) ||
    !["approve", "reset", "send", "batch"].includes(value.step) ||
    (value.step === "batch" && (solana || value.operation !== "deposit")) ||
    (value.batchId !== undefined &&
      (value.step !== "batch" ||
        typeof value.batchId !== "string" ||
        value.batchId.length < 1 ||
        value.batchId.length > 4096)) ||
    !/^[1-9][0-9]*$/.test(value.gross) ||
    typeof value.amount !== "string" ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 36 ||
    (solana &&
      (value.step !== "send" ||
        !isWalletAddress("solana", value.solanaBlockhash))) ||
    (value.hash !== null &&
      !(solana
        ? isSolanaTransactionId(value.hash)
        : /^0x[0-9a-fA-F]{64}$/.test(value.hash))) ||
    (value.hashSource !== undefined &&
      (value.hash === null ||
        !["wallet", "recovery"].includes(value.hashSource)))
  )
    throw new Error(
      "The saved transaction cannot be read. Check your wallet activity before starting a new action.",
    );
  return value;
}

/** Wallet-confirmed funding actions; no keys or signing authority enter Slop. */
export function VaultActions({
  projectId,
  deployment,
  connectedWallet,
  payoutPolicy = "ordinary",
  canDeposit = true,
  onFinalized,
}: {
  projectId: string;
  deployment: EscrowDeployment;
  connectedWallet?: VaultConnection;
  payoutPolicy?: PayoutPolicy;
  canDeposit?: boolean;
  onFinalized: () => void;
}) {
  const family = ESCROW_NETWORKS[deployment.network].family;
  const solana = family === "solana";
  const sameWallet = (a: string, b: string) => sameWalletAddress(family, a, b);
  const key = `slop:vault-action:v1:${deployment.network}:${deployment.vault}:${deployment.asset}`;
  const {
    mounted,
    saved,
    storedPending,
    pending,
    setPending,
    storageError,
    remember,
    clear,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(
    key,
    (raw) => readPending(raw, solana),
    (error) => errorMessage(error, "The wallet request failed."),
  );
  const depositAllowed = useRef(canDeposit);
  // The shared hook retires the view; publish permission changes at commit.
  useLayoutEffect(() => {
    depositAllowed.current = canDeposit;
  }, [canDeposit]);
  const [wallet, setWallet] = useState<VaultConnection | null>(
    connectedWallet ?? null,
  );
  const [operation, setOperation] = useState<VaultOperation>(
    saved.pending?.operation ?? (canDeposit ? "deposit" : "withdraw"),
  );
  const [amount, setAmount] = useState(saved.pending?.amount ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const wallets = usePayoutWallets().filter((entry) =>
    solana
      ? entry.family === "solana" && entry.solanaFunding
      : entry.family === "evm",
  );
  const { busy, error, setError, run: act } = useAction(saved.error);
  const run = (action: () => Promise<void>) => {
    setNotice("");
    return act(action, (caught) =>
      errorMessage(caught, "The wallet request failed."),
    );
  };
  const connect = (provider: PayoutWallet) =>
    run(async () => {
      const connection = await provider.connect();
      if (!mounted.current) return;
      if (pending && !sameWallet(connection.address, pending.wallet))
        throw new Error(
          `Reconnect the wallet that submitted this action: ${pending.wallet}`,
        );
      if (
        !canDeposit &&
        !pending &&
        !sameWallet(connection.address, deployment.owner)
      )
        throw new Error(
          "Connect the vault owner's wallet to withdraw free funds.",
        );
      setWallet(connection);
      setReview(null);
      // Only the owner may withdraw; any other wallet can only deposit.
      if (!sameWallet(connection.address, deployment.owner))
        setOperation("deposit");
    });
  const inspect = () =>
    run(async () => {
      if (!wallet) throw new Error("Choose a wallet first.");
      if (!canDeposit && operation === "deposit")
        throw new Error("New deposits are currently unavailable.");
      const result = solana
        ? await reviewSolanaVaultAction(
            projectId,
            deployment,
            wallet,
            operation,
            amount,
            payoutPolicy,
          )
        : await reviewVaultAction(
            deployment,
            wallet,
            operation,
            amount,
            payoutPolicy,
          );
      if (mounted.current) setReview(result);
    });
  const send = (step: Step) =>
    run(async () => {
      if (!wallet || !review || pending || storageError) return;
      if (!canDeposit && operation === "deposit")
        throw new Error("New deposits are currently unavailable.");
      const current = solana
        ? await reviewSolanaVaultAction(
            projectId,
            deployment,
            wallet,
            operation,
            amount,
            payoutPolicy,
          )
        : review;
      if (
        current.gross !== review.gross ||
        current.fee !== review.fee ||
        current.net !== review.net ||
        current.decimals !== review.decimals
      )
        throw new Error(
          "The vault review changed. Review the action again before signing.",
        );
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        version: 1,
        wallet: wallet.address,
        operation,
        amount,
        gross: review.gross,
        decimals: review.decimals,
        step,
        hash: null,
        ...(current.solanaPlan
          ? { solanaBlockhash: current.solanaPlan.blockhash }
          : {}),
      };
      let requested = false;
      try {
        const beforeSend = () => {
          if (!mounted.current)
            throw new Error(
              "The wallet view was closed. Review before sending.",
            );
          if (operation === "deposit" && !depositAllowed.current)
            throw new Error("New deposits are currently unavailable.");
          if (!remember(intent))
            throw new Error(
              "The saved request changed. Reload before continuing.",
            );
          if (mounted.current) setRecoveryHash("");
          requested = true;
        };
        let hash: string;
        if (solana) {
          if (!current.solanaPlan || step !== "send")
            throw new Error("Review the Solana action again.");
          hash = await sendSolanaVaultAction(
            deployment,
            wallet,
            current.solanaPlan,
            beforeSend,
          );
        } else if (step === "batch") {
          hash = await sendVaultBatch(
            deployment,
            wallet,
            amount,
            beforeSend,
            payoutPolicy,
          );
        } else {
          hash = await sendVaultAction(
            deployment,
            wallet,
            operation,
            amount,
            step,
            beforeSend,
            payoutPolicy,
          );
        }
        // A batch returns the wallet's reference, not a transaction hash.
        const submitted: Pending =
          step === "batch"
            ? { ...intent, batchId: hash }
            : { ...intent, hash, hashSource: "wallet" };
        const kept = step === "batch" ? "batch reference" : "hash";
        try {
          if (!remember(submitted, intent) && mounted.current)
            setNotice(
              `Submitted ${hash}. Keep this ${kept}; the saved request changed.`,
            );
        } catch {
          if (mounted.current) {
            setPending(submitted);
            setNotice(
              `Submitted ${hash}. Keep this ${kept}; browser storage could not save it.`,
            );
          }
        }
        if (mounted.current) setReview(null);
      } catch (caught) {
        if (caught instanceof VaultBatchUnavailable) {
          // The wallet refused before sending: offer the two separate requests.
          if (requested) {
            if (mounted.current) clear(intent);
            else clearPendingAttempt(key, intent);
          }
          if (mounted.current) setReview({ ...review, batch: false });
          throw caught;
        }
        if ((caught as { code?: unknown } | null)?.code === 4001) {
          if (requested) {
            if (mounted.current) clear(intent);
            else clearPendingAttempt(key, intent);
          }
          throw new Error("You declined the wallet request. Nothing was sent.");
        }
        if (requested)
          throw new Error(
            "The wallet result is unclear. Check wallet activity and enter its transaction hash below before another attempt.",
          );
        throw caught;
      }
    });
  const checking = useRef(false);
  /**
   * Reads the chain for the pending request. An automatic check signs nothing,
   * shows no busy state and leaves the notice alone while the result is pending.
   */
  const verify = async (automatic: boolean) => {
    if (!pending || !wallet || checking.current) return;
    checking.current = true;
    try {
      let captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      // Older records have no provenance. Keep their evidence editable;
      // only a hash returned by this wallet interaction is fixed here.
      const entered =
        pending.hashSource === "wallet" ? pending.hash : recoveryHash.trim();
      let hash = entered ?? "";
      let fromWallet = pending.hashSource === "wallet";
      let result:
        | "pending"
        | "not-sent"
        | "failed"
        | "approval-confirmed"
        | "finalized";
      if (pending.step === "batch") {
        if (!entered && !pending.batchId)
          throw new Error("Enter the transaction from your wallet.");
        const checked = await checkVaultBatch(
          deployment,
          wallet,
          pending.gross,
          pending.batchId ?? null,
          entered || null,
          payoutPolicy,
        );
        if (!mounted.current) return;
        result = checked.status;
        hash = checked.transactionId ?? "";
        if (!entered && checked.transactionId) {
          // The wallet named the batch transaction: fix it like a returned hash.
          const named: Pending = {
            ...pending,
            hash: checked.transactionId,
            hashSource: "wallet",
          };
          fromWallet = true;
          let stored = false;
          try {
            stored = updatePendingRecord(key, captured, named);
          } catch {
            // Storage refused the write; this view still names the transaction.
            if (result === "pending") setPending(named);
          }
          if (stored) {
            captured = named;
            storedPending.current = named;
            if (result === "pending") setPending(named);
          }
        }
      } else {
        if (!hash) throw new Error("Enter the transaction from your wallet.");
        result = solana
          ? await checkSolanaVaultAction(
              projectId,
              deployment,
              wallet,
              pending.operation,
              pending.gross,
              pending.solanaBlockhash as string,
              hash,
              payoutPolicy,
            )
          : await checkVaultAction(
              deployment,
              wallet,
              pending.operation,
              pending.gross,
              hash,
              pending.step,
              payoutPolicy,
            );
        if (!mounted.current) return;
      }
      if (result === "pending") {
        if (automatic) return;
        if (!fromWallet && hash) {
          const candidate: Pending = {
            ...pending,
            hash,
            hashSource: "recovery",
          };
          let stored: boolean;
          try {
            stored = updatePendingRecord(key, captured, candidate);
          } catch {
            setPending(candidate);
            setNotice(
              `Not saved on this device. Keep this ${solana ? "signature" : "hash"}: ${hash}.`,
            );
            return;
          }
          if (!stored)
            throw new Error(
              "The saved request changed. Reload before continuing.",
            );
          storedPending.current = candidate;
          setPending(candidate);
        }
        setNotice(
          fromWallet || pending.batchId
            ? "Submitted. Waiting for finalized chain evidence."
            : "Waiting for finalized chain evidence.",
        );
        return;
      }
      clear(captured);
      setRecoveryHash("");
      setReview(null);
      if (automatic) setError(null);
      if (result === "failed")
        setNotice(
          "The transaction failed. Review the amount and wallet, then retry.",
        );
      else if (result === "not-sent")
        setNotice(
          "Your wallet reports that this request was not sent. Review the deposit, then retry.",
        );
      else if (result === "approval-confirmed") {
        setNotice(
          "Token approval confirmed. Review the deposit to continue; no funds have been deposited yet.",
        );
        // Open the next review so the owner does not enter the amount again.
        // It reads the live allowance; a failed read leaves the form as it was.
        if (solana || !canDeposit) return;
        setOperation("deposit");
        setAmount(pending.amount);
        const next = await reviewVaultAction(
          deployment,
          wallet,
          "deposit",
          pending.amount,
          payoutPolicy,
        ).catch(() => null);
        if (mounted.current && next && storedPending.current === null)
          setReview(next);
      } else {
        setNotice(
          `${pending.operation === "deposit" ? "Deposit" : "Withdrawal"} verified on the finalized chain. ${hash}`,
        );
        onFinalized();
      }
    } finally {
      checking.current = false;
    }
  };
  const check = () => run(() => verify(false));
  const latestVerify = useRef(verify);
  useLayoutEffect(() => {
    latestVerify.current = verify;
  });
  // Only a hash this wallet interaction returned is checked automatically.
  const [autoCheck, setAutoCheck] = useState({
    hash: "",
    attempts: 0,
    ticks: 0,
  });
  const autoHash =
    wallet && !busy && !storageError && pending
      ? pending.hashSource === "wallet"
        ? pending.hash
        : (pending.batchId ?? null)
      : null;
  const autoAttempts = autoCheck.hash === autoHash ? autoCheck.attempts : 0;
  const autoTicks = autoCheck.ticks;
  useEffect(() => {
    if (autoHash === null || autoAttempts >= AUTO_CHECK_ATTEMPTS) return;
    const timer = window.setTimeout(
      () => {
        const done = (checked: boolean) => {
          if (mounted.current)
            setAutoCheck({
              hash: autoHash,
              attempts: autoAttempts + (checked ? 1 : 0),
              ticks: autoTicks + 1,
            });
        };
        // A hidden tab reads nothing and uses no attempt; the next tick retries.
        if (document.visibilityState === "hidden") done(false);
        else
          void latestVerify
            .current(true)
            .catch(() => undefined)
            .then(() => done(true));
      },
      autoAttempts < AUTO_CHECK_FAST_ATTEMPTS
        ? AUTO_CHECK_FAST_MS
        : AUTO_CHECK_SLOW_MS,
    );
    return () => window.clearTimeout(timer);
  }, [autoHash, autoAttempts, autoTicks, mounted]);
  const formatted = (value: string, decimals: number) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: decimals,
    });
  const isOwner =
    wallet !== null && sameWallet(wallet.address, deployment.owner);
  const link = transactionUrl(deployment.network, pending?.hash ?? null);
  return (
    <section
      className="admin-card vault-actions"
      aria-label={`Fund or withdraw · ${networkLabel(deployment.network)}`}
    >
      <h3>
        Fund or withdraw ·{" "}
        <NetworkName chain={ESCROW_NETWORKS[deployment.network].chain}>
          {networkLabel(deployment.network)}
        </NetworkName>
      </h3>
      <details
        className="vault-contract-details"
        open={Boolean(review || pending)}
      >
        <summary>Contract details</summary>
        <dl className="vault-addresses">
          <div>
            <dt>Vault</dt>
            <dd>
              <code>{deployment.vault}</code>
            </dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>
              <code>{deployment.asset}</code>
            </dd>
          </div>
        </dl>
      </details>
      <p className="setup-badge setup-badge--warning">
        <CircleAlert aria-hidden="true" size={14} />
        Direct transfers are not credited
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {storageError ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => clearUnreadable())}
        >
          I checked wallet activity; clear the unreadable local record
        </button>
      ) : null}
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || storageError}
        className="admin-fieldset"
        legend={
          pending ? "Reconnect to check this transaction" : "Choose a wallet"
        }
        empty={<NoWalletFound solana={solana} />}
        onConnect={(provider) => void connect(provider)}
      />
      {pending ? (
        <PendingWalletCheck
          link={link}
          hashSource={pending.hashSource}
          solana={solana}
          recoveryHash={recoveryHash}
          onRecoveryHash={setRecoveryHash}
          busy={busy}
          canCheck={!!wallet}
          onCheck={() => void check()}
          unsent={!pending.hash && !pending.batchId && !recoveryHash.trim()}
          onClear={() =>
            void run(async () => {
              clear(storedPending.current ?? pending);
              setReview(null);
              setNotice("Local request cleared. Review again before sending.");
            })
          }
        >
          <p>
            {pending.step === "send" || pending.step === "batch"
              ? pending.operation === "deposit"
                ? "Deposit"
                : "Withdrawal"
              : "Token approval"}{" "}
            awaiting verification. Do not send it again.
          </p>
          <p>{formatted(pending.gross, pending.decimals)}</p>
        </PendingWalletCheck>
      ) : wallet && !storageError ? (
        <>
          <fieldset className="admin-fieldset" disabled={busy}>
            <fieldset className="vault-operation">
              <legend>Action</legend>
              {(isOwner
                ? canDeposit
                  ? (["deposit", "withdraw"] as const)
                  : (["withdraw"] as const)
                : canDeposit
                  ? (["deposit"] as const)
                  : []
              ).map((choice) => (
                <label key={choice}>
                  <input
                    type="radio"
                    name={`vault-operation-${deployment.network}-${deployment.vault}`}
                    value={choice}
                    checked={operation === choice}
                    onChange={() => {
                      setOperation(choice);
                      setReview(null);
                    }}
                  />
                  <span>
                    {choice === "deposit"
                      ? "Deposit tokens"
                      : "Withdraw free funds"}
                  </span>
                </label>
              ))}
              {isOwner ? null : (
                <p>Only the vault owner's wallet can withdraw free funds.</p>
              )}
            </fieldset>
            <label>
              Token amount
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setReview(null);
                }}
              />
            </label>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => void inspect()}
              disabled={!canDeposit && operation === "deposit"}
            >
              Review {operation === "deposit" ? "deposit" : "withdrawal"}
            </button>
          </fieldset>
          {review ? (
            <section aria-label="Review vault action">
              <dl>
                <dt>Current free balance</dt>
                <dd>
                  {review.freeBalance === null
                    ? "Unavailable"
                    : formatted(review.freeBalance, review.decimals)}
                </dd>
                {review.solanaPlan && (
                  <>
                    <dt>Estimated network fee</dt>
                    <dd>
                      {formatBaseUnits(review.solanaPlan.networkFeeLamports, 9)}{" "}
                      SOL, plus any token-account rent
                    </dd>
                  </>
                )}
                <dt>Amount</dt>
                <dd>{formatted(review.gross, review.decimals)}</dd>
                <dt>Fee</dt>
                <dd>{formatted(review.fee, review.decimals)}</dd>
                <dt>
                  {operation === "deposit"
                    ? "Added to free funds"
                    : "Returned to owner"}
                </dt>
                <dd>{formatted(review.net, review.decimals)}</dd>
              </dl>
              {operation === "deposit" ? (
                <p>
                  This deposit joins the project's free funds. Only its owner
                  can award or withdraw them, less a 2% withdrawal fee.
                  Depositors have no refund right.
                </p>
              ) : (
                <p>
                  Reserved awards cannot be withdrawn. Funds go only to{" "}
                  <code>{deployment.owner}</code>.
                </p>
              )}
              {review.resetAllowance && !review.batch ? (
                <p>Reset the existing token allowance to zero first.</p>
              ) : null}
              <button
                type="button"
                className="button primary-button"
                disabled={busy || (!canDeposit && operation === "deposit")}
                onClick={() =>
                  void send(
                    review.batch
                      ? "batch"
                      : review.resetAllowance
                        ? "reset"
                        : review.approvalNeeded
                          ? "approve"
                          : "send",
                  )
                }
              >
                {review.batch
                  ? "Approve and deposit in wallet"
                  : review.resetAllowance
                    ? "Reset token allowance in wallet"
                    : review.approvalNeeded
                      ? "Approve exact token amount in wallet"
                      : operation === "deposit"
                        ? "Confirm deposit in wallet"
                        : "Confirm withdrawal in wallet"}
              </button>
            </section>
          ) : null}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setWallet(null);
              setReview(null);
            }}
          >
            Choose another wallet
          </button>
        </>
      ) : null}
      {busy && <p role="status">Waiting for wallet or chain response…</p>}
    </section>
  );
}
