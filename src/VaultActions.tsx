import { useState } from "react";
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
  transactionUrl,
} from "./lib/payments/contracts";
import {
  checkSolanaVaultAction,
  reviewSolanaVaultAction,
  type SolanaFundingPlan,
  sendSolanaVaultAction,
} from "./lib/solana-vault-actions";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { isWalletAddress } from "./lib/wallets";

type Step = "approve" | "reset" | "send";
type Pending = {
  version: 1;
  wallet: string;
  operation: VaultOperation;
  amount: string;
  gross: string;
  decimals: number;
  step: Step;
  hash: string | null;
  solanaBlockhash?: string;
};
type Review = VaultActionReview & { solanaPlan?: SolanaFundingPlan };
function readPending(key: string, solana: boolean): Pending | null {
  const text = sessionStorage.getItem(key);
  if (!text) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
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
        : /^0x[0-9a-fA-F]{64}$/.test(value.hash)))
  )
    throw new Error(
      "The saved transaction cannot be read. Check your wallet activity before starting a new action.",
    );
  return value;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The wallet request failed.";

/** Wallet-confirmed funding actions; no keys or signing authority enter Slop. */
export function VaultActions({
  projectId,
  deployment,
  connectedWallet,
  onFinalized,
}: {
  projectId: string;
  deployment: EscrowDeployment;
  connectedWallet?: VaultConnection;
  onFinalized: () => void;
}) {
  const solana = ESCROW_NETWORKS[deployment.network].family === "solana";
  const sameWallet = (a: string, b: string) =>
    solana ? a === b : a.toLowerCase() === b.toLowerCase();
  const key = `slop:vault-action:v1:${deployment.network}:${deployment.vault}:${deployment.asset}`;
  const [saved] = useState(() => {
    try {
      return { pending: readPending(key, solana), error: "" };
    } catch (error) {
      return { pending: null, error: message(error) };
    }
  });
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const [error, setError] = useState(saved.error);
  const [storageError, setStorageError] = useState(Boolean(saved.error));
  const [wallet, setWallet] = useState<VaultConnection | null>(
    connectedWallet ?? null,
  );
  const [operation, setOperation] = useState<VaultOperation>(
    saved.pending?.operation ?? "deposit",
  );
  const [amount, setAmount] = useState(saved.pending?.amount ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const wallets = usePayoutWallets().filter((entry) =>
    solana
      ? entry.family === "solana" && entry.solanaFunding
      : entry.family === "evm",
  );
  const remember = (value: Pending | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  const connect = (provider: PayoutWallet) =>
    run(async () => {
      const connection = await provider.connect();
      if (pending && !sameWallet(connection.address, pending.wallet))
        throw new Error(
          `Reconnect the wallet that submitted this action: ${pending.wallet}`,
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
      setReview(
        solana
          ? await reviewSolanaVaultAction(
              projectId,
              deployment,
              wallet,
              operation,
              amount,
            )
          : await reviewVaultAction(deployment, wallet, operation, amount),
      );
    });
  const send = (step: Step) =>
    run(async () => {
      if (!wallet || !review || pending || storageError) return;
      const current = solana
        ? await reviewSolanaVaultAction(
            projectId,
            deployment,
            wallet,
            operation,
            amount,
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
          remember(intent);
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
          );
        }
        const submitted = { ...intent, hash };
        setPending(submitted);
        try {
          remember(submitted);
        } catch {
          setNotice(
            `Submitted: ${hash}. Keep this hash; browser storage could not save it.`,
          );
        }
        setReview(null);
      } catch (caught) {
        if ((caught as { code?: unknown } | null)?.code === 4001) {
          remember(null);
          throw new Error(
            "You declined the wallet request. Nothing was submitted by this action.",
          );
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
      const hash = pending.hash ?? recoveryHash.trim();
      const result = solana
        ? await checkSolanaVaultAction(
            projectId,
            deployment,
            wallet,
            pending.operation,
            pending.gross,
            pending.solanaBlockhash as string,
            hash,
          )
        : await checkVaultAction(
            deployment,
            wallet,
            pending.operation,
            pending.gross,
            hash,
            pending.step,
          );
      if (!pending.hash) remember({ ...pending, hash });
      if (result === "pending") {
        setNotice("Submitted. Waiting for finalized chain evidence.");
        return;
      }
      remember(null);
      setReview(null);
      if (result === "failed")
        setNotice(
          "The transaction failed on the finalized chain. Review the amount and wallet before another attempt.",
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
  const formatted = (value: string) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: review?.decimals ?? pending?.decimals ?? 0,
    });
  const isOwner =
    wallet !== null && sameWallet(wallet.address, deployment.owner);
  const link = transactionUrl(deployment.network, pending?.hash ?? null);
  return (
    <section
      className="admin-card vault-actions"
      aria-label={`Fund or withdraw · ${networkLabel(deployment.network)}`}
    >
      <h3>Fund or withdraw · {networkLabel(deployment.network)}</h3>
      <p>
        Vault <code>{deployment.vault}</code>
      </p>
      <p>
        Token <code>{deployment.asset}</code>
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
          onClick={() =>
            void run(async () => {
              sessionStorage.removeItem(key);
              setStorageError(false);
            })
          }
        >
          I checked wallet activity; clear the unreadable local record
        </button>
      ) : null}
      {!wallet ? (
        <fieldset disabled={busy || storageError} className="admin-fieldset">
          <legend>
            {pending
              ? "Reconnect to check this transaction"
              : "Choose a wallet"}
          </legend>
          {wallets.length ? (
            wallets.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="button secondary-button"
                onClick={() => void connect(provider)}
              >
                Connect {provider.name}
              </button>
            ))
          ) : (
            <p>
              {solana
                ? "No Solana wallet with transaction support was found."
                : "No EVM wallet was found."}{" "}
              Open this page in your wallet's browser or enable its browser
              extension.
            </p>
          )}
        </fieldset>
      ) : (
        <p>
          Connected: <code>{wallet.address}</code>
        </p>
      )}
      {pending ? (
        <div>
          <p>
            {pending.step === "send"
              ? pending.operation === "deposit"
                ? "Deposit"
                : "Withdrawal"
              : "Token approval"}{" "}
            awaiting verification. Do not send it again.
          </p>
          <p>{formatted(pending.gross)}</p>
          {link ? (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                View submitted transaction
              </a>
            </p>
          ) : (
            <label>
              Transaction {solana ? "signature" : "hash"} from your wallet
              <input
                value={recoveryHash}
                onChange={(event) => setRecoveryHash(event.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <button
            type="button"
            className="button primary-button"
            disabled={busy || !wallet}
            onClick={() => void check()}
          >
            Check transaction
          </button>
          {!pending.hash ? (
            <details>
              <summary>Wallet confirms nothing was sent</summary>
              <p>
                Only clear this request after checking your wallet activity. If
                it was sent, enter its hash instead.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    remember(null);
                    setReview(null);
                    setNotice(
                      "Local request cleared. Review again before sending.",
                    );
                  })
                }
              >
                I checked my wallet; this request was not sent
              </button>
            </details>
          ) : null}
        </div>
      ) : wallet && !storageError ? (
        <>
          <fieldset className="admin-fieldset" disabled={busy}>
            <legend>Vault action</legend>
            <fieldset className="vault-operation">
              <legend>Action</legend>
              {(isOwner
                ? (["deposit", "withdraw"] as const)
                : (["deposit"] as const)
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
                    : formatted(review.freeBalance)}
                </dd>
                {review.solanaPlan && (
                  <>
                    <dt>Estimated network fee (SOL)</dt>
                    <dd>
                      {formatBaseUnits(review.solanaPlan.networkFeeLamports, 9)}{" "}
                      SOL, plus any token-account rent shown by your wallet
                    </dd>
                  </>
                )}
                <dt>Amount</dt>
                <dd>{formatted(review.gross)}</dd>
                <dt>Fee</dt>
                <dd>{formatted(review.fee)}</dd>
                <dt>
                  {operation === "deposit"
                    ? "Added to free funds"
                    : "Returned to owner"}
                </dt>
                <dd>{formatted(review.net)}</dd>
              </dl>
              {operation === "deposit" ? (
                <p>
                  This deposit joins the project's free funds. Only its owner
                  can award or withdraw them, less a 2% withdrawal fee.
                  Depositors have no refund right. Your wallet also charges
                  network gas.
                </p>
              ) : (
                <p>
                  Reserved awards are excluded. The 2% withdrawal fee is
                  deducted from this amount; the remainder goes only to{" "}
                  <code>{deployment.owner}</code>. Your wallet also charges
                  network gas.
                </p>
              )}
              {review.resetAllowance ? (
                <p>
                  This token has an existing allowance. Reset it to zero before
                  approving this exact amount.
                </p>
              ) : null}
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
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
