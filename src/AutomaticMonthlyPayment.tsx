import { useState } from "react";
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
import {
  formatAssetAmount,
  formatBaseUnits,
  transactionUrl,
} from "./lib/payments/contracts";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { isWalletAddress } from "./lib/wallets";

type Pending = {
  version: 1;
  wallet: string;
  cap: string;
  enabled: boolean;
  decimals: number;
  hash: string | null;
  solanaBlockhash?: string;
};
function readPending(key: string, solana: boolean): Pending | null {
  const text = sessionStorage.getItem(key);
  if (!text) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
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
        : /^0x[0-9a-fA-F]{64}$/.test(value.hash)))
  )
    throw new Error(
      "The saved monthly payment request cannot be read. Check your wallet activity before starting a new one.",
    );
  return value;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The wallet request failed.";

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
  const solana = ESCROW_NETWORKS[deployment.network].family === "solana";
  const sameWallet = (a: string, b: string) =>
    solana ? a === b : a.toLowerCase() === b.toLowerCase();
  const key = `slop:vault-monthly:v1:${deployment.network}:${deployment.vault}`;
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
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [automatic, setAutomatic] = useState(true);
  const [review, setReview] = useState<MonthlyReview | null>(null);
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
          `Reconnect the wallet that submitted this setting: ${pending.wallet}`,
        );
      setWallet(connection);
      setReview(null);
    });
  const inspect = () =>
    run(async () => {
      if (!wallet) throw new Error("Choose a wallet first.");
      setReview(
        solana
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
            ),
      );
    });
  const send = () =>
    run(async () => {
      if (!wallet || !review?.changes || pending || storageError) return;
      const intent: Pending = {
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
          remember(intent);
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
      if (!pending.hash) remember({ ...pending, hash });
      if (result === "pending") {
        setNotice("Submitted. Waiting for finalized chain evidence.");
        return;
      }
      remember(null);
      setReview(null);
      if (result === "failed") {
        setNotice(
          "The transaction failed on the finalized chain. The monthly payment setting did not change. Review it again before another attempt.",
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
      className="admin-card vault-actions"
      aria-label={`Automatic monthly payment · ${deployment.network}`}
    >
      <h3>Automatic monthly payment · {deployment.network}</h3>
      <p>
        Automatic monthly payment lets the month&apos;s signed allocation be
        committed from this vault after each calendar month (UTC), up to the
        project&apos;s monthly amount. Only the vault owner{" "}
        <code>{deployment.owner}</code> can change it, and can turn it off at
        any time. Awards already committed stay committed.
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
              : "Connect the vault owner's wallet"}
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
            {pending.enabled
              ? `Turning on automatic monthly payment, up to ${formatted(pending.cap, pending.decimals)} each month,`
              : "Turning off automatic monthly payment"}{" "}
            awaiting verification. Do not send it again.
          </p>
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
            <legend>Monthly payment setting</legend>
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
                <dt>Current setting (finalized chain)</dt>
                <dd>{describe(review.current, review.decimals)}</dd>
                <dt>After signing</dt>
                <dd>{describe(review.target, review.decimals)}</dd>
                {review.solanaPlan?.transaction && (
                  <>
                    <dt>Estimated network fee (SOL)</dt>
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
                      ? "Each month's commitment is limited to this cap and to the vault's free funds. This moves no funds now. Your wallet also charges network gas."
                      : "No new monthly allocation can be committed from this vault while it is off. Awards already committed stay committed. Your wallet also charges network gas."}
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
