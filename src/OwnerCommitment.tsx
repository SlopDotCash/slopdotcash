import { useState } from "react";
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
import { formatBaseUnits, transactionUrl } from "./lib/payments/contracts";
import {
  checkSolanaOwnerCommitment,
  reviewSolanaCommitment,
  type SolanaCommitmentPlan,
  sendSolanaCommitment,
  verifySolanaCommitmentPlan,
} from "./lib/solana-commitment-actions";
import { useAction } from "./lib/use-action";
import { usePayoutWallets } from "./lib/use-payout-wallets";
import { isWalletAddress } from "./lib/wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

type Pending = {
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
      plan.projectId !== projectId ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(plan.cycleId) ||
      ![plan.manifestSha256, plan.snapshotSha256].every((value) =>
        /^[a-f0-9]{64}$/.test(value),
      ) ||
      key !==
        `slop:award-commitment:v2:${projectId}:${plan.cycleId}:${plan.deployment.network}:${plan.award.githubUserId}`
    )
      throw new Error(
        "A saved commitment cannot be read. Check wallet activity before starting another request.",
      );
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
  const [saved] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return { pending: null, error: "" };
      const value = JSON.parse(raw) as Pending;
      if (
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
      return { pending: value, error: "" };
    } catch {
      return {
        pending: null,
        error:
          "The saved commitment cannot be read. Check wallet activity before clearing it.",
      };
    }
  });
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const [storageError, setStorageError] = useState(Boolean(saved.error));
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [review, setReview] = useState<{
    plan: OwnerCommitmentPlan;
    decimals: number;
    freeBalance: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const wallets = usePayoutWallets().filter((entry) => entry.family === family);
  const remember = (value: Pending | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
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
        plan: current,
        wallet: wallet.address,
        hash: null,
        decimals: review.decimals,
        ...(solanaPlan ? { solanaPlan } : {}),
      };
      let requested = false;
      try {
        const beforeSend = () => {
          remember(intent);
          requested = true;
        };
        const hash = solanaPlan
          ? await sendSolanaCommitment(current, wallet, solanaPlan, beforeSend)
          : await sendEvmCommitment(current, wallet, beforeSend);
        const submitted = { ...intent, hash };
        setPending(submitted);
        setReview(null);
        try {
          remember(submitted);
        } catch {
          setNotice(
            `Submitted: ${hash}. Save this hash; browser storage could not save it.`,
          );
        }
      } catch (reason) {
        if ((reason as { code?: unknown } | null)?.code === 4001) {
          remember(null);
          throw new Error("You declined the wallet request. Nothing was sent.");
        }
        if (requested)
          throw new Error(
            "The wallet result is unclear. Check wallet activity and enter the transaction hash before another attempt.",
          );
        throw reason;
      }
    });
  const check = () =>
    run(async () => {
      if (!wallet || !pending) return;
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
      if (status === "pending") {
        setNotice("The commitment is not finalized yet. Check again later.");
        return;
      }
      remember(null);
      setReview(null);
      setNotice(
        status === "failed"
          ? "The transaction failed. The award was not reserved. Review again before retrying."
          : `Award reserved on the finalized chain: ${hash}. Not yet paid.`,
      );
    });
  const activePlan = pending?.plan ?? review?.plan;
  const link = pending?.hash
    ? transactionUrl(expected.network, pending.hash)
    : null;
  return (
    <section aria-label="Authorize award commitment" className="section">
      <h2>Reserve this award</h2>
      <p>Network: {networkLabel(expected.network)}</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {storageError && (
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
      )}
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || storageError}
        legend={
          pending ? "Reconnect the owner wallet" : "Choose the owner wallet"
        }
        empty={<NoWalletFound solana={solana} />}
        onConnect={(provider) =>
          void run(async () => {
            const connection = await provider.connect();
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
        <div>
          <p>Commitment awaiting verification. Do not send it again.</p>
          {link ? (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                View submitted transaction
              </a>
            </p>
          ) : (
            <label>
              Commitment transaction hash
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
            <details>
              <summary>Wallet confirms nothing was sent</summary>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    remember(null);
                    setReview(null);
                  })
                }
              >
                I checked my wallet; this request was not sent
              </button>
            </details>
          )}
        </div>
      ) : wallet && !storageError ? (
        <>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void inspect()}
          >
            Verify award and funding
          </button>
          {review && (
            <section aria-label="Commitment review">
              <h3>{review.plan.award.login}</h3>
              <dl className="transaction-amounts">
                <dt>Gross reserved</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.gross, review.decimals)}
                </dd>
                <dt>Contributor amount</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.net, review.decimals)}
                </dd>
                <dt>Fee (2%)</dt>
                <dd>
                  {formatBaseUnits(review.plan.award.fee, review.decimals)}
                </dd>
                <dt>Free balance</dt>
                <dd>{formatBaseUnits(review.freeBalance, review.decimals)}</dd>
              </dl>
              <p>
                Token: <code>{review.plan.deployment.asset}</code>
              </p>
              <p>Reserved funds cannot be withdrawn.</p>
              <button
                className="button primary-button"
                type="button"
                disabled={busy}
                onClick={() => void send()}
              >
                Authorize this award in wallet
              </button>
            </section>
          )}
        </>
      ) : null}
      {activePlan && (
        <p>
          Vault: <code>{activePlan.deployment.vault}</code>
        </p>
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
