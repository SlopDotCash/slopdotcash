import { useEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "./lib/escrow-policy.mjs";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import {
  checkEvmMonthlySetting,
  checkSolanaMonthlySetting,
  type MonthlyReview,
  type MonthlySetting,
  reviewEvmMonthlySetting,
  reviewSolanaMonthlySetting,
  sendEvmMonthlySetting,
  sendSolanaMonthlySetting,
} from "./lib/monthly-commitment-actions";
import { networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
  formatBaseUnits,
  transactionUrl,
} from "./lib/payments/contracts";
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { isWalletAddress, sameWalletAddress } from "./lib/wallets";
import {
  PendingTransaction,
  UnsentTransactionRecovery,
} from "./OwnerPresentation";
import { NetworkName, NoWalletFound, WalletConnection } from "./Presentation";

type Pending = PendingAttempt & {
  version: 1;
  wallet: string;
  cap: string;
  enabled: boolean;
  decimals: number;
  hash: string | null;
  hashSource?: "wallet" | "recovery";
  solanaBlockhash?: string;
};
function readPending(text: string | null, solana: boolean): Pending | null {
  if (text === null) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
    !validPendingAttemptId(value.attemptId) ||
    !isWalletAddress(solana ? "solana" : "base", value.wallet) ||
    typeof value.cap !== "string" ||
    !/^(0|[1-9][0-9]{0,38})$/.test(value.cap) ||
    typeof value.enabled !== "boolean" ||
    (value.enabled && value.cap === "0") ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 36 ||
    (solana && !isWalletAddress("solana", value.solanaBlockhash)) ||
    (value.hash !== null &&
      !(solana
        ? isSolanaTransactionId(value.hash)
        : /^0x[0-9a-fA-F]{64}$/.test(value.hash))) ||
    (value.hashSource !== undefined &&
      (value.hash === null ||
        !["wallet", "recovery"].includes(value.hashSource)))
  )
    throw new Error(
      "The saved monthly payment request cannot be read. Check your wallet activity before starting a new one.",
    );
  return value;
}

/**
 * The owner's switch for automatic monthly payment on an ordinary vault.
 * The default choice uses the project's monthly amount as the cap. Review
 * compares that choice with finalized chain state. Unchecking opts out.
 */
export function AutomaticMonthlyPayment({
  project,
  deployment,
  onFinalized,
}: {
  project: ProjectDefinition;
  deployment: EscrowDeployment;
  onFinalized: () => void;
}) {
  const family = ESCROW_NETWORKS[deployment.network].family;
  const solana = family === "solana";
  const sameWallet = (a: string, b: string) => sameWalletAddress(family, a, b);
  const key = `slop:vault-monthly:v1:${deployment.network}:${deployment.vault}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [saved] = useState(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      return { pending: readPending(raw, solana), error: "", raw };
    } catch (error) {
      return {
        pending: null,
        raw,
        error: errorMessage(error, "The wallet request failed."),
      };
    }
  });
  const storedPending = useRef<Pending | null>(saved.pending);
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const [storageError, setStorageError] = useState(Boolean(saved.error));
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [automatic, setAutomatic] = useState(true);
  const [review, setReview] = useState<MonthlyReview | null>(null);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const wallets = usePayoutWallets().filter((entry) =>
    solana
      ? entry.family === "solana" && entry.solanaFunding
      : entry.family === "evm",
  );
  const remember = (value: Pending, previous?: Pending) => {
    const stored = previous
      ? updatePendingAttempt(key, previous, value)
      : createPendingAttempt(key, value);
    if (!stored) return false;
    storedPending.current = value;
    if (mounted.current) setPending(value);
    return true;
  };
  const clear = (value: Pending) => {
    if (!mounted.current) return;
    if (!clearPendingAttempt(key, value))
      throw new Error("The saved request changed. Reload before continuing.");
    storedPending.current = null;
    setPending(null);
  };
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
          `Reconnect the wallet that submitted this setting: ${pending.wallet}`,
        );
      setWallet(connection);
      setReview(null);
    });
  const inspect = () =>
    run(async () => {
      if (!wallet) throw new Error("Choose a wallet first.");
      const result = solana
        ? await reviewSolanaMonthlySetting(
            project,
            deployment,
            wallet,
            automatic,
          )
        : await reviewEvmMonthlySetting(
            project,
            deployment,
            wallet,
            automatic,
          );
      if (mounted.current) setReview(result);
    });
  const send = () =>
    run(async () => {
      if (!wallet || !review?.changes || pending || storageError) return;
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        version: 1,
        wallet: wallet.address,
        cap: review.target.cap,
        enabled: review.target.enabled,
        decimals: review.decimals,
        hash: null,
        ...(review.solanaPlan?.transaction
          ? { solanaBlockhash: review.solanaPlan.transaction.blockhash }
          : {}),
      };
      let requested = false;
      try {
        const beforeSend = () => {
          if (!mounted.current)
            throw new Error("The wallet view was closed. Review before sending.");
          if (!remember(intent))
            throw new Error(
              "The saved request changed. Reload before continuing.",
            );
          if (mounted.current) setRecoveryHash("");
          requested = true;
        };
        const hash = solana
          ? await sendSolanaMonthlySetting(
              deployment,
              wallet,
              review,
              beforeSend,
            )
          : await sendEvmMonthlySetting(deployment, wallet, review, beforeSend);
        const submitted: Pending = { ...intent, hash, hashSource: "wallet" };
        try {
          if (!remember(submitted, intent) && mounted.current)
            setNotice(
              `Submitted: ${hash}. The saved request was cleared or replaced. Keep this hash with your wallet activity.`,
            );
        } catch {
          if (mounted.current) {
            setPending(submitted);
            setNotice(
              `Submitted: ${hash}. Keep this hash; browser storage could not save it.`,
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
      // Legacy records do not identify who supplied their hash. Keep them
      // editable; only a hash returned by this wallet request is fixed.
      const hash =
        pending.hashSource === "wallet" ? pending.hash : recoveryHash.trim();
      if (!hash) throw new Error("Enter the transaction from your wallet.");
      const target: MonthlySetting = {
        cap: pending.cap,
        enabled: pending.enabled,
      };
      const result = solana
        ? await checkSolanaMonthlySetting(
            project.id,
            deployment,
            wallet,
            target,
            pending.solanaBlockhash as string,
            hash,
          )
        : await checkEvmMonthlySetting(deployment, wallet, target, hash);
      if (!mounted.current) return;
      if (result === "pending") {
        if (pending.hashSource !== "wallet") {
          const candidate: Pending = {
            ...pending,
            hash,
            hashSource: "recovery",
          };
          let stored;
          try {
            stored = updatePendingRecord(key, captured, candidate);
          } catch {
            setPending(candidate);
            setNotice(
              `This transaction could not be saved on this device. Keep its ${solana ? "signature" : "hash"}: ${hash}. Check it again before another action.`,
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
      if (result === "failed") {
        setNotice(
          "The transaction failed. The setting did not change. Review again before retrying.",
        );
        return;
      }
      setNotice(
        pending.enabled
          ? `Automatic monthly payment is on, verified on the finalized chain. ${hash}`
          : `Automatic monthly payment is off, verified on the finalized chain. ${hash}`,
      );
      onFinalized();
    });
  const formatted = (value: string, decimals: number) =>
    formatAssetAmount(value, {
      network: deployment.network,
      assetAddress: deployment.asset,
      assetDecimals: decimals,
    });
  const describe = (setting: MonthlySetting, decimals: number) =>
    setting.enabled
      ? `On, up to ${formatted(setting.cap, decimals)} each month`
      : "Off";
  const link = transactionUrl(deployment.network, pending?.hash ?? null);
  const signLabel = !review
    ? ""
    : !review.target.enabled
      ? "Turn off automatic monthly payment in wallet"
      : review.current.enabled
        ? "Update the monthly cap in wallet"
        : "Turn on automatic monthly payment in wallet";
  return (
    <section
      id={`vault-monthly-${deployment.network}-${deployment.vault}`}
      className="admin-card vault-actions"
      aria-label={`Vault monthly authorization · ${networkLabel(deployment.network)}`}
    >
      <h3>
        Vault monthly authorization ·{" "}
        <NetworkName chain={ESCROW_NETWORKS[deployment.network].chain}>
          {networkLabel(deployment.network)}
        </NetworkName>
      </h3>
      <p>
        Commits each month&apos;s awards after the month ends (UTC), up to the
        monthly amount. Only the vault owner can change it.
      </p>
      <details
        className="vault-contract-details"
        open={Boolean(review || pending)}
      >
        <summary>Owner details</summary>
        <dl className="vault-addresses">
          <div>
            <dt>Owner</dt>
            <dd>
              <code>{deployment.owner}</code>
            </dd>
          </div>
        </dl>
      </details>
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
              if (!mounted.current) return;
              if (sessionStorage.getItem(key) !== saved.raw)
                throw new Error(
                  "The saved request changed. Reload before continuing.",
                );
              sessionStorage.removeItem(key);
              setStorageError(false);
            })
          }
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
          pending
            ? "Reconnect to check this transaction"
            : "Connect the vault owner's wallet"
        }
        // The funding card above shows the missing wallet once; a saved
        // request still needs it here to explain the disabled check.
        empty={pending ? <NoWalletFound solana={solana} /> : undefined}
        onConnect={(provider) => void connect(provider)}
      />
      {pending ? (
        <PendingTransaction>
          <p>
            {pending.enabled
              ? `Turning on automatic monthly payment, up to ${formatted(pending.cap, pending.decimals)} each month,`
              : "Turning off automatic monthly payment"}{" "}
            awaiting verification. Do not send it again.
          </p>
          {link ? (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                {pending.hashSource === "wallet"
                  ? "View submitted transaction"
                  : "View transaction to check"}
              </a>
            </p>
          ) : null}
          {pending.hashSource !== "wallet" ? (
            <label>
              Transaction {solana ? "signature" : "hash"} from your wallet
              <input
                value={recoveryHash}
                disabled={busy}
                onChange={(event) => setRecoveryHash(event.target.value)}
                spellCheck={false}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="button primary-button"
            disabled={busy || !wallet}
            onClick={() => void check()}
          >
            Check transaction
          </button>
          {!pending.hash ? (
            <UnsentTransactionRecovery
              disabled={busy}
              onClear={() =>
                void run(async () => {
                  clear(storedPending.current ?? pending);
                  setReview(null);
                  setNotice(
                    "Local request cleared. Review again before sending.",
                  );
                })
              }
            />
          ) : null}
        </PendingTransaction>
      ) : wallet && !storageError ? (
        <>
          <fieldset className="admin-fieldset" disabled={busy}>
            <legend>Vault monthly authorization</legend>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(event) => {
                  setAutomatic(event.target.checked);
                  setReview(null);
                }}
              />{" "}
              Pay contributors automatically each month
            </label>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => void inspect()}
            >
              Review monthly payment setting
            </button>
          </fieldset>
          {review ? (
            <section aria-label="Review monthly payment setting">
              <dl>
                <dt>Current setting</dt>
                <dd>{describe(review.current, review.decimals)}</dd>
                <dt>After signing</dt>
                <dd>{describe(review.target, review.decimals)}</dd>
                {review.solanaPlan?.transaction && (
                  <>
                    <dt>Estimated network fee</dt>
                    <dd>
                      {formatBaseUnits(
                        review.solanaPlan.transaction.networkFeeLamports,
                        9,
                      )}{" "}
                      SOL
                    </dd>
                  </>
                )}
              </dl>
              {review.changes ? (
                <>
                  <p>
                    {review.target.enabled
                      ? "Each month's commitment is limited to this cap and the vault's free funds. No funds move now."
                      : "While off, no new monthly awards are committed. Committed awards stay committed."}
                  </p>
                  <button
                    type="button"
                    className="button primary-button"
                    disabled={busy}
                    onClick={() => void send()}
                  >
                    {signLabel}
                  </button>
                </>
              ) : (
                <p role="status">
                  The vault already has this setting. Nothing to sign.
                </p>
              )}
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
