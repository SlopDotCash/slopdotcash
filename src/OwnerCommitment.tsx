import { Check, ExternalLink, LoaderCircle, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { MonthlyCommitmentInput } from "../backend/payments/monthly";
import { decodeBase58Bytes } from "./lib/base58";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { networkLabel } from "./lib/network-names";
import {
  checkEvmCommitment,
  evmCommitmentIntent,
  type OwnerCommitmentPlan,
  requestOwnerCommitment,
  reviewEvmCommitment,
  sendEvmCommitment,
} from "./lib/owner-commitment-actions";
import {
  formatBaseUnits,
  knownAssetSymbol,
  transactionUrl,
} from "./lib/payments/contracts";
import {
  type PendingAttempt,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import {
  checkSolanaOwnerCommitment,
  reviewSolanaCommitment,
  type SolanaCommitmentPlan,
  sendSolanaCommitment,
  verifySolanaCommitmentPlan,
} from "./lib/solana-commitment-actions";
import { useAction } from "./lib/use-action";
import { usePayoutWallets } from "./lib/use-payout-wallets";
import { usePendingWalletAttempt } from "./lib/use-pending-wallet-attempt";
import { isWalletAddress, shortAddress } from "./lib/wallets";
import { CompactIdentifier } from "./Operations";
import {
  PendingTransaction,
  UnsentTransactionRecovery,
} from "./OwnerPresentation";
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
  plan: OwnerCommitmentPlan;
  wallet: string;
  hash: string | null;
  decimals: number;
  solanaPlan?: SolanaCommitmentPlan;
};
/** Keep submitted requests reachable even if a later review is held or unavailable. */
export function recoverOwnerCommitments(projectId: string) {
  const pending: { cycleId: string; expected: MonthlyCommitmentInput }[] = [];
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith(`slop:award-commitment:v2:${projectId}:`)) continue;
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as Pending;
    const plan = stored?.plan;
    if (
      !plan ||
      !validPendingAttemptId(stored.attemptId) ||
      plan.projectId !== projectId ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(plan.cycleId) ||
      ![plan.manifestSha256, plan.snapshotSha256].every((value) =>
        /^[a-f0-9]{64}$/.test(value),
      ) ||
      key !==
        `slop:award-commitment:v2:${projectId}:${plan.cycleId}:${plan.deployment.network}:${plan.award.githubUserId}`
    )
      throw new Error("Saved request unreadable. Check wallet activity.");
    pending.push({
      cycleId: plan.cycleId,
      expected: {
        network: plan.deployment.network,
        githubUserId: plan.award.githubUserId,
        manifestSha256: plan.manifestSha256,
        snapshotSha256: plan.snapshotSha256,
      },
    });
  }
  return pending;
}

export default function OwnerCommitment({
  projectId,
  cycleId,
  expected,
}: {
  projectId: string;
  cycleId: string;
  expected: MonthlyCommitmentInput;
}) {
  const family =
    ESCROW_NETWORKS[expected.network as keyof typeof ESCROW_NETWORKS]?.family;
  const solana = family === "solana";
  const key = `slop:award-commitment:v2:${projectId}:${cycleId}:${expected.network}:${expected.githubUserId}`;
  const {
    mounted,
    saved,
    storedPending,
    pending,
    storageError,
    clear,
    submit,
    clearUnreadable,
  } = usePendingWalletAttempt<Pending>(
    key,
    (raw) => {
      const value = JSON.parse(raw) as Pending;
      if (
        !validPendingAttemptId(value.attemptId) ||
        value.plan.projectId !== projectId ||
        value.plan.cycleId !== cycleId ||
        value.plan.deployment.network !== expected.network ||
        value.plan.award.githubUserId !== expected.githubUserId ||
        (solana
          ? !isWalletAddress("solana", value.wallet)
          : !/^0x[0-9a-fA-F]{40}$/.test(value.wallet)) ||
        (value.hash !== null &&
          (solana
            ? decodeBase58Bytes(value.hash).length !== 64
            : !/^0x[0-9a-fA-F]{64}$/.test(value.hash))) ||
        !Number.isInteger(value.decimals) ||
        value.decimals < 0 ||
        value.decimals > 36
      )
        throw new Error();
      if (solana) {
        if (!value.solanaPlan) throw new Error();
        verifySolanaCommitmentPlan(value.plan, value.solanaPlan, value.wallet);
      } else evmCommitmentIntent(value.plan);
      return value;
    },
    () => "Saved request unreadable. Check wallet activity.",
  );
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [review, setReview] = useState<{
    plan: OwnerCommitmentPlan;
    decimals: number;
    freeBalance: string;
  } | null>(null);
  const [notice, setNotice] = useState<ReactNode>("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const wallets = usePayoutWallets().filter((entry) => entry.family === family);
  const { busy, error, run: act } = useAction(saved.error);
  const run = (action: () => Promise<void>) => {
    setNotice("");
    return act(action, (caught) =>
      errorMessage(caught, "The commitment could not be verified."),
    );
  };
  const inspect = () =>
    run(async () => {
      if (!wallet) return;
      const plan = await requestOwnerCommitment(projectId, cycleId, expected);
      const state = solana
        ? await reviewSolanaCommitment(plan, wallet)
        : await reviewEvmCommitment(plan, wallet);
      if (!mounted.current) return;
      setReview({
        plan,
        decimals: state.decimals,
        freeBalance: state.freeBalance,
      });
    });
  const send = () =>
    run(async () => {
      if (!wallet || !review || pending || storageError) return;
      // Re-run authority, snapshot, funding and revision checks just before signing.
      const current = await requestOwnerCommitment(
        projectId,
        cycleId,
        expected,
      );
      if (JSON.stringify(current) !== JSON.stringify(review.plan)) {
        setReview(null);
        throw new Error("The prepared award changed. Review it again.");
      }
      const solanaPlan = solana
        ? await reviewSolanaCommitment(current, wallet)
        : undefined;
      const intent: Pending = {
        attemptId: crypto.randomUUID(),
        plan: current,
        wallet: wallet.address,
        hash: null,
        decimals: review.decimals,
        ...(solanaPlan ? { solanaPlan } : {}),
      };
      await submit(
        intent,
        (beforeSend) =>
          solanaPlan
            ? sendSolanaCommitment(current, wallet, solanaPlan, beforeSend)
            : sendEvmCommitment(current, wallet, beforeSend),
        {
          submitted: (hash) => ({ ...intent, hash }),
          notify: setNotice,
          unclear: "Result unclear. Enter the transaction hash.",
        },
      );
      if (mounted.current) setReview(null);
    });
  const check = () =>
    run(async () => {
      if (!wallet || !pending) return;
      const captured = storedPending.current;
      if (!captured)
        throw new Error("The saved request changed. Reload before continuing.");
      const hash = pending.hash ?? recoveryHash.trim();
      if (solana && !pending.solanaPlan)
        throw new Error("The saved Solana transaction is unavailable.");
      const status = pending.solanaPlan
        ? await checkSolanaOwnerCommitment(
            pending.plan,
            wallet,
            pending.solanaPlan,
            hash,
          )
        : await checkEvmCommitment(pending.plan, wallet, hash);
      if (!mounted.current) return;
      if (status === "pending") {
        setNotice(<>{spinner} Finalizing</>);
        return;
      }
      clear(captured);
      setReview(null);
      const verified = transactionUrl(expected.network, hash);
      setNotice(
        status === "failed" ? (
          "Transaction failed. Not reserved."
        ) : (
          <>
            <StatusBadge tone="success" icon={<Check size={12} />}>
              Reserved
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
          </>
        ),
      );
    });
  const activePlan = pending?.plan ?? review?.plan;
  const link = pending?.hash
    ? transactionUrl(expected.network, pending.hash)
    : null;
  return (
    <section aria-label="Authorize award commitment" className="section">
      <h2>
        Reserve{activePlan ? ` · ${activePlan.award.login}` : ""}{" "}
        <NetworkName
          chain={
            ESCROW_NETWORKS[expected.network as keyof typeof ESCROW_NETWORKS]
              ?.chain ?? ""
          }
          iconOnly
        >
          {networkLabel(expected.network)}
        </NetworkName>
      </h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => clearUnreadable())}
        >
          Clear saved record
        </button>
      )}
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || storageError}
        legend="Owner wallet"
        empty={<NoWalletFound solana={solana} />}
        onConnect={(provider) =>
          void run(async () => {
            const connection = await provider.connect();
            if (!mounted.current) return;
            if (
              pending &&
              (solana
                ? connection.address !== pending.wallet
                : connection.address.toLowerCase() !==
                  pending.wallet.toLowerCase())
            )
              throw new Error(
                `Reconnect the submitting wallet: ${pending.wallet}`,
              );
            setWallet(connection);
            setReview(null);
          })
        }
      />
      {pending ? (
        <PendingTransaction>
          <p>{spinner} Pending · don't resend</p>
          {link ? (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                View submitted transaction
              </a>
            </p>
          ) : (
            <label>
              Transaction hash
              <input
                value={recoveryHash}
                onChange={(event) => setRecoveryHash(event.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <button
            className="button primary-button"
            type="button"
            disabled={busy || !wallet}
            onClick={() => void check()}
          >
            Check commitment
          </button>
          {!pending.hash && (
            <UnsentTransactionRecovery
              disabled={busy}
              onClear={() =>
                void run(async () => {
                  clear(storedPending.current ?? pending);
                  setReview(null);
                })
              }
            />
          )}
        </PendingTransaction>
      ) : wallet && !storageError ? (
        <>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void inspect()}
          >
            Review
          </button>
          {review && (
            <section aria-label="Commitment review">
              <h3>{review.plan.award.login}</h3>
              <dl>
                <dt>Gross</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.gross, review.decimals)}{" "}
                  <span title="Reserved funds cannot be withdrawn">
                    <Lock
                      aria-label="Reserved funds cannot be withdrawn"
                      size={14}
                    />
                  </span>
                </dd>
                <dt>Net</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.net, review.decimals)}
                </dd>
                <dt>Fee (2%)</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.fee, review.decimals)}
                </dd>
                <dt>Free</dt>
                <dd>{formatBaseUnits(review.freeBalance, review.decimals)}</dd>
              </dl>
              <CompactIdentifier
                label="token address"
                value={review.plan.deployment.asset}
                preview={
                  knownAssetSymbol(
                    review.plan.deployment.network,
                    review.plan.deployment.asset,
                    review.decimals,
                  ) ?? `Token ${shortAddress(review.plan.deployment.asset)}`
                }
              />
              <button
                className="button primary-button"
                type="button"
                disabled={busy}
                onClick={() => void send()}
              >
                Reserve in wallet
              </button>
            </section>
          )}
        </>
      ) : null}
      {activePlan && (
        <CompactIdentifier
          label="vault address"
          value={activePlan.deployment.vault}
          preview={`Vault ${shortAddress(activePlan.deployment.vault)}`}
        />
      )}
      {wallet && !pending && (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={() => {
            setWallet(null);
            setReview(null);
          }}
        >
          Choose another wallet
        </button>
      )}
    </section>
  );
}
