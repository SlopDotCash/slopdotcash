import { useState } from "react";
import type { MonthlyFinalizationExpected } from "../contracts/monthly-authorization";
import { decodeBase58Bytes } from "./lib/base58";
import { canonicalJson } from "./lib/canonical-json";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import type { VaultConnection } from "./lib/evm-vault-actions";
import {
  checkMonthlyFinalization,
  type MonthlyFinalizationReview,
  reviewMonthlyFinalization,
  sendMonthlyFinalization,
  verifySolanaMonthlyWalletPlan,
} from "./lib/monthly-finalization-actions";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, transactionUrl } from "./lib/payments/contracts";
import { useAction } from "./lib/use-action";
import { usePayoutWallets } from "./lib/use-payout-wallets";
import { isWalletAddress } from "./lib/wallets";
import { WalletConnection } from "./Presentation";

type Expected = MonthlyFinalizationExpected & { manifestSha256: string };
type Pending = {
  expected: Expected;
  review: MonthlyFinalizationReview;
  wallet: string;
  hash: string | null;
  decimals: number;
};
const prefix = (projectId: string) =>
  `slop:monthly-finalization:v1:${projectId}:`;
const storageKey = (expected: Expected) =>
  `${prefix(expected.projectId)}${expected.period}:${expected.deployment.network}`;

function readPending(key: string): Pending | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as Pending;
  const { expected, review } = value;
  const plan = review?.authorization?.plan;
  if (
    !expected ||
    !plan ||
    key !== storageKey(expected) ||
    plan.request.projectId !== expected.projectId ||
    plan.request.period !== expected.period ||
    plan.request.snapshotSha256 !== expected.snapshotSha256 ||
    plan.request.network !== expected.deployment.network ||
    !/^[a-f0-9]{64}$/.test(expected.snapshotSha256) ||
    !/^[a-f0-9]{64}$/.test(expected.manifestSha256) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(expected.period) ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 36
  )
    throw new Error(
      "A saved monthly reservation cannot be read. Check wallet activity before clearing it.",
    );
  const solana =
    ESCROW_NETWORKS[expected.deployment.network].family === "solana";
  if (
    !isWalletAddress(solana ? "solana" : "base", value.wallet) ||
    (value.hash !== null &&
      (solana
        ? decodeBase58Bytes(value.hash).length !== 64
        : !/^0x[0-9a-fA-F]{64}$/.test(value.hash)))
  )
    throw new Error(
      "The saved monthly reservation has an invalid wallet or transaction.",
    );
  if (solana) {
    if (!review.transaction)
      throw new Error("The saved Solana reservation is incomplete.");
    verifySolanaMonthlyWalletPlan(
      review.authorization,
      review.transaction,
      value.wallet,
    );
  }
  return value;
}

export function recoverMonthlyFinalizations(projectId: string) {
  return Object.keys(sessionStorage)
    .filter((key) => key.startsWith(prefix(projectId)))
    .map((key) => {
      const pending = readPending(key);
      if (!pending || pending.expected.projectId !== projectId)
        throw new Error(
          "A saved monthly reservation belongs to another project.",
        );
      return pending.expected;
    });
}

export default function OwnerMonthlyFinalization({
  expected,
  available = true,
  onFinalized,
}: {
  expected: Expected;
  available?: boolean;
  onFinalized?: () => void;
}) {
  const key = storageKey(expected);
  const family = ESCROW_NETWORKS[expected.deployment.network].family;
  const solana = family === "solana";
  const [saved] = useState(() => {
    try {
      return { pending: readPending(key), error: "" };
    } catch (error) {
      return {
        pending: null,
        error: errorMessage(
          error,
          "The saved monthly reservation cannot be read.",
        ),
      };
    }
  });
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const [storageError, setStorageError] = useState(Boolean(saved.error));
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [review, setReview] = useState<
    (MonthlyFinalizationReview & { decimals: number }) | null
  >(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [notice, setNotice] = useState("");
  const { busy, error, run: act } = useAction(saved.error);
  const wallets = usePayoutWallets().filter((entry) => entry.family === family);
  const sameWallet = (left: string, right: string) =>
    solana ? left === right : left.toLowerCase() === right.toLowerCase();
  const remember = (value: Pending | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
  const run = (action: () => Promise<void>) => {
    setNotice("");
    return act(action, (reason) =>
      errorMessage(reason, "The monthly reservation could not be verified."),
    );
  };
  const send = () =>
    run(async () => {
      if (!wallet || !review || pending || storageError || !available) return;
      const current = await reviewMonthlyFinalization(expected, wallet);
      if (
        canonicalJson(current.authorization) !==
        canonicalJson(review.authorization)
      ) {
        setReview(null);
        throw new Error("The monthly authorization changed. Review it again.");
      }
      const intent: Pending = {
        expected,
        review: current,
        wallet: wallet.address,
        hash: null,
        decimals: current.decimals,
      };
      let requested = false;
      try {
        const hash = await sendMonthlyFinalization(current, wallet, () => {
          remember(intent);
          requested = true;
        });
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
        if (requested) setPending(intent);
        throw reason;
      }
    });
  const check = () =>
    run(async () => {
      if (!wallet || !pending || !sameWallet(wallet.address, pending.wallet))
        return;
      const hash = pending.hash ?? recoveryHash.trim();
      if (!hash)
        throw new Error("Enter the transaction from the submitting wallet.");
      const result = await checkMonthlyFinalization(
        pending.review,
        wallet,
        hash,
      );
      if (result === "pending") {
        remember({ ...pending, hash });
        setNotice(
          "The reservation is not finalized yet. Do not send it again.",
        );
        return;
      }
      remember(null);
      setReview(null);
      setNotice(
        result === "failed"
          ? "The transaction finalized unsuccessfully. Review the allocation before another attempt."
          : "The monthly allocation is reserved on the finalized chain. Its payments can now proceed.",
      );
      onFinalized?.();
    });
  const active = pending?.review.authorization ?? review?.authorization;
  const link = pending?.hash
    ? transactionUrl(expected.deployment.network, pending.hash)
    : null;
  return (
    <section
      className="section"
      aria-label={`Authorize ${expected.period} monthly reservation`}
    >
      <h2>Reserve {expected.period} allocations</h2>
      <p>
        {networkLabel(expected.deployment.network)}. Your wallet authorizes the
        exact monthly allocation. This step reserves funds; it is not a
        completed payout.
      </p>
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
          pending
            ? "Reconnect the submitting owner wallet"
            : "Choose the vault owner wallet"
        }
        empty="Enable a wallet for this network, then reload."
        onConnect={(provider) =>
          void run(async () => {
            const connected = await provider.connect();
            if (pending && !sameWallet(connected.address, pending.wallet))
              throw new Error(
                "Reconnect the owner wallet that submitted this reservation.",
              );
            setWallet(connected);
            setReview(null);
          })
        }
      />
      {active && (
        <p>
          Monthly gross:{" "}
          {formatBaseUnits(
            active.plan.totalGrossBase,
            pending?.decimals ?? review?.decimals ?? 0,
          )}
        </p>
      )}
      {pending ? (
        <div>
          <p>Reservation awaiting verification. Do not send it again.</p>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer">
              View submitted transaction
            </a>
          ) : (
            <label>
              Monthly reservation transaction
              <input
                value={recoveryHash}
                onChange={(event) => setRecoveryHash(event.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <button
            type="button"
            disabled={busy || !wallet}
            onClick={() => void check()}
          >
            Check monthly reservation
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
                Clear the unsent request
              </button>
            </details>
          )}
        </div>
      ) : (
        <div>
          {!available && (
            <p>
              The whole month must be funded before its reservation can be
              prepared.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !wallet || storageError || !available}
            onClick={() =>
              void run(async () => {
                if (wallet)
                  setReview(await reviewMonthlyFinalization(expected, wallet));
              })
            }
          >
            Review monthly reservation
          </button>
          {review && (
            <button
              type="button"
              disabled={busy || storageError || !available}
              onClick={() => void send()}
            >
              Authorize monthly reservation in wallet
            </button>
          )}
        </div>
      )}
    </section>
  );
}
