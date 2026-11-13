import { ArrowRight, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
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
  type PendingAttempt,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import {
  isWalletAddress,
  sameWalletAddress,
  shortAddress,
} from "./lib/wallets";
import { CompactIdentifier } from "./Operations";
import { PendingWalletCheck } from "./OwnerPresentation";
import {
  NetworkName,
  NoWalletFound,
  StatusBadge,
  WalletConnection,
} from "./Presentation";

const spinner = (
  <LoaderCircle className="wallet-spin" aria-hidden="true" size={14} />
);

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
    throw new Error("Saved request unreadable. Check wallet activity.");
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
  const {
    mounted,
    saved,
    storedPending,
    pending,
    storageError,
    clear,
    submit,
    recordRecoveryHash,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(
    key,
    (raw) => readPending(raw, solana),
    (error) => errorMessage(error, "The wallet request failed."),
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [automatic, setAutomatic] = useState(true);
  const [review, setReview] = useState<MonthlyReview | null>(null);
  const [notice, setNotice] = useState<ReactNode>("");
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
        : await reviewEvmMonthlySetting(project, deployment, wallet, automatic);
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
      await submit(
        intent,
        (beforeSend) =>
          solana
            ? sendSolanaMonthlySetting(deployment, wallet, review, beforeSend)
            : sendEvmMonthlySetting(deployment, wallet, review, beforeSend),
        {
          submitted: (hash) => ({ ...intent, hash, hashSource: "wallet" }),
          notify: setNotice,
          onBeforeSend: () => setRecoveryHash(""),
          unclear: "Result unclear. Enter the transaction hash.",
        },
      );
      if (mounted.current) setReview(null);
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
          if (!recordRecoveryHash(captured, candidate)) {
            setNotice(
              `Not saved on this device. Keep this ${solana ? "signature" : "hash"}: ${hash}.`,
            );
            return;
          }
        }
        setNotice(<>{spinner} Finalizing</>);
        return;
      }
      clear(captured);
      setRecoveryHash("");
      setReview(null);
      if (result === "failed") {
        setNotice("Transaction failed. Nothing changed.");
        return;
      }
      const verified = transactionUrl(deployment.network, hash);
      setNotice(
        <>
          <StatusBadge
            tone={pending.enabled ? "success" : "neutral"}
            icon={<Check size={12} />}
          >
            {pending.enabled ? "On" : "Off"}
          </StatusBadge>{" "}
          {verified ? (
            <a
              href={verified}
              target="_blank"
              rel="noreferrer"
              aria-label="View transaction"
              title="View transaction"
            >
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : (
            <code>{hash}</code>
          )}
        </>,
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
    setting.enabled ? `On · ${formatted(setting.cap, decimals)}/mo` : "Off";
  const link = transactionUrl(deployment.network, pending?.hash ?? null);
  const signLabel = !review
    ? ""
    : !review.target.enabled
      ? "Turn off"
      : review.current.enabled
        ? "Update cap"
        : "Turn on";
  return (
    <section
      id={`vault-monthly-${deployment.network}-${deployment.vault}`}
      className="admin-card vault-actions"
      aria-label={`Vault monthly authorization · ${networkLabel(deployment.network)}`}
    >
      <h3>
        Auto-pay{" "}
        <NetworkName chain={ESCROW_NETWORKS[deployment.network].chain} iconOnly>
          {networkLabel(deployment.network)}
        </NetworkName>
      </h3>
      <CompactIdentifier
        label="owner address"
        value={deployment.owner}
        preview={`Owner ${shortAddress(deployment.owner)}`}
        open={Boolean(review || pending)}
      />
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
          Clear saved record
        </button>
      ) : null}
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || storageError}
        className="admin-fieldset"
        legend={pending ? "Reconnect wallet" : "Owner wallet"}
        // The funding card above shows the missing wallet once; a saved
        // request still needs it here to explain the disabled check.
        empty={pending ? <NoWalletFound solana={solana} /> : undefined}
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
          unsent={!pending.hash}
          onClear={() =>
            void run(async () => {
              clear(storedPending.current ?? pending);
              setReview(null);
              setNotice("Cleared.");
            })
          }
        >
          <p>
            {spinner} Pending: {describe(pending, pending.decimals)} · don't
            resend
          </p>
        </PendingWalletCheck>
      ) : wallet && !storageError ? (
        <>
          <fieldset
            className="admin-fieldset"
            aria-label="Auto-pay"
            disabled={busy}
          >
            <label className="checkbox-field">
              <button
                type="button"
                role="switch"
                aria-checked={automatic}
                className="email-switch"
                onClick={() => {
                  setAutomatic(!automatic);
                  setReview(null);
                }}
              />
              Auto-pay monthly
            </label>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => void inspect()}
            >
              Review
            </button>
          </fieldset>
          {review ? (
            <section aria-label="Review monthly payment setting">
              <p>
                {describe(review.current, review.decimals)}{" "}
                <ArrowRight aria-hidden="true" size={14} />
                <span className="visually-hidden">to</span>{" "}
                {describe(review.target, review.decimals)}
              </p>
              {review.solanaPlan?.transaction && (
                <dl>
                  <dt>Estimated network fee</dt>
                  <dd>
                    {formatBaseUnits(
                      review.solanaPlan.transaction.networkFeeLamports,
                      9,
                    )}{" "}
                    SOL
                  </dd>
                </dl>
              )}
              {review.changes ? (
                <button
                  type="button"
                  className="button primary-button"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {signLabel}
                </button>
              ) : (
                <p role="status">No change</p>
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
      {busy && (
        <p role="status">
          {spinner}
          <span className="visually-hidden">Waiting for wallet</span>
        </p>
      )}
    </section>
  );
}
