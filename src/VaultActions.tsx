import { CircleAlert } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "./lib/escrow-policy.mjs";
import {
  checkVaultAction,
  reviewVaultAction,
  sendVaultAction,
  type VaultActionReview,
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

type Step = "approve" | "reset" | "send";
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
};
type Review = VaultActionReview & { solanaPlan?: SolanaFundingPlan };
function readPending(text: string | null, solana: boolean): Pending | null {
  if (text === null) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
    !validPendingAttemptId(value.attemptId) ||
    !isWalletAddress(solana ? "solana" : "base", value.wallet) ||
    !["deposit", "withdraw"].includes(value.operation) ||
    !["approve", "reset", "send"].includes(value.step) ||
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
  const { busy, error, run: act } = useAction(saved.error);
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
        const submitted: Pending = { ...intent, hash, hashSource: "wallet" };
        try {
          if (!remember(submitted, intent) && mounted.current)
            setNotice(
              `Submitted ${hash}. Keep this hash; the saved request changed.`,
            );
        } catch {
          if (mounted.current) {
            setPending(submitted);
            setNotice(
              `Submitted ${hash}. Keep this hash; browser storage could not save it.`,
            );
          }
        }
        if (mounted.current) setReview(null);
      } catch (caught) {
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
  const check = () =>
    run(async () => {
      if (!pending || !wallet) return;
      const captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      // Older records have no provenance. Keep their evidence editable;
      // only a hash returned by this wallet interaction is fixed here.
      const hash =
        pending.hashSource === "wallet" ? pending.hash : recoveryHash.trim();
      if (!hash) throw new Error("Enter the transaction from your wallet.");
      const result = solana
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
      if (result === "pending") {
        if (pending.hashSource !== "wallet") {
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
          pending.hashSource === "wallet"
            ? "Submitted. Waiting for finalized chain evidence."
            : "Waiting for finalized chain evidence.",
        );
        return;
      }
      clear(captured);
      setRecoveryHash("");
      setReview(null);
      if (result === "failed")
        setNotice(
          "The transaction failed. Review the amount and wallet, then retry.",
        );
      else if (result === "approval-confirmed")
        setNotice(
          "Token approval confirmed. Review the deposit to continue; no funds have been deposited yet.",
        );
      else {
        setNotice(
          `${pending.operation === "deposit" ? "Deposit" : "Withdrawal"} verified on the finalized chain. ${hash}`,
        );
        onFinalized();
      }
    });
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
          unsent={!pending.hash && !recoveryHash.trim()}
          onClear={() =>
            void run(async () => {
              clear(storedPending.current ?? pending);
              setReview(null);
              setNotice("Local request cleared. Review again before sending.");
            })
          }
        >
          <p>
            {pending.step === "send"
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
              {review.resetAllowance ? (
                <p>Reset the existing token allowance to zero first.</p>
              ) : null}
              <button
                type="button"
                className="button primary-button"
                disabled={busy || (!canDeposit && operation === "deposit")}
                onClick={() =>
                  void send(
                    review.resetAllowance
                      ? "reset"
                      : review.approvalNeeded
                        ? "approve"
                        : "send",
                  )
                }
              >
                {review.resetAllowance
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
