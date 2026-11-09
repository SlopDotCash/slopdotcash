import { ArrowDown, ShieldCheck, Vault, Wallet } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { evmBindingTypedData } from "../contracts/evm/adapter";
import { ChainIcon } from "./ChainIcon";
import { Link } from "./Link";
import { readBoundedJson } from "./lib/browser-json";
import { decodeBase64, encodeBase64 } from "./lib/byte-encoding";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import type { AccountPayment, PaymentsAccount } from "./lib/payments/contracts";
import {
  type SolanaBindingContext,
  verifyPreparedSolanaBinding,
  verifySignedSolanaBinding,
} from "./lib/payout-consent";
import {
  apiRequest,
  currentProjectSession,
  ProjectApiError,
  subscribeProjectSessionChange,
} from "./lib/project-api";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { sameWalletAddress } from "./lib/wallets";

async function request(
  path: string,
  body: unknown,
  actorId: string,
  signal: AbortSignal,
) {
  const response = await apiRequest(`payments/wallets/${path}`, {
    body,
    signal,
    timeoutMs: 45_000,
    headers: { "x-slop-expected-github-id": actorId },
  });
  if (response.status === 401)
    throw new ProjectApiError(401, "unauthorized", "Sign in again.");
  const value = (await readBoundedJson(
    response,
    16_384,
    "payout consent",
  )) as Record<string, unknown>;
  if (response.status === 403 && value?.error === "actor_changed")
    throw new ProjectApiError(403, "actor_changed", "Your account changed.");
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "The wallet changed or is still being prepared. Reload this page and review again."
        : "Payout consent is unavailable. Your award stays reserved. Retry later.",
    );
  return value;
}

/** Consent authorizes only this vault's destination binding; finalized payment is a separate result. */
export function PayoutConsent({
  payment,
  account,
  onAccessLost,
}: {
  payment: AccountPayment;
  account: PaymentsAccount;
  onAccessLost(signedOut: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const actionButton = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      reviewHeading.current?.focus();
    } else dialog.current?.close();
    if (!open && wasOpen.current)
      (notice ? result.current : actionButton.current)?.focus();
    wasOpen.current = open;
  }, [open, notice]);
  const network =
    ESCROW_NETWORKS[payment.network as keyof typeof ESCROW_NETWORKS];
  const claim = account.wallets.find(
    (w) => w.chain === payment.chain && w.authorized,
  );
  const wallets = usePayoutWallets().filter(
    (w) =>
      w.family === network?.family &&
      (w.family !== "solana" || w.solanaBinding),
  );
  const reviewKey = JSON.stringify([
    account.githubUserId,
    claim?.claimId,
    claim?.address,
    payment.id,
    payment.chain,
    payment.network,
    payment.vault,
    payment.state,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(() => {
    const reset = () => {
      operation.current?.abort();
      operation.current = null;
      setBusy(false);
      setOpen(false);
      setError("");
      setNotice("");
    };
    reset();
    const unsubscribe = subscribeProjectSessionChange(reset);
    return () => {
      unsubscribe();
      operation.current?.abort();
      operation.current = null;
    };
  }, [reviewKey]);
  if (!network || !claim || !payment.vault || payment.state !== "reserved")
    return null;
  async function authorize(provider: PayoutWallet) {
    if (!claim || !network || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const isCurrent = () =>
      operation.current === controller && !controller.signal.aborted;
    const checkActor = async () => {
      if (!isCurrent()) return false;
      const session = await currentProjectSession();
      if (!isCurrent()) return false;
      if (session === null)
        throw new ProjectApiError(401, "unauthorized", "Sign in again.");
      if (session.githubId !== account.githubUserId)
        throw new ProjectApiError(
          403,
          "actor_changed",
          "Your account changed.",
        );
      return true;
    };
    const requestConsent = (path: string, body: unknown) =>
      request(path, body, account.githubUserId, controller.signal);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await checkActor()) || !isCurrent()) return;
      const wallet = await provider.connect();
      if (!(await checkActor()) || !isCurrent()) return;
      if (!sameWalletAddress(network.family, wallet.address, claim.address))
        throw new Error(
          "Connect your confirmed payout address. To change it, use Account wallets first.",
        );
      if (network.family === "evm") {
        const rpc = wallet.evmRequest;
        if (!rpc) throw new Error("Choose an EVM wallet.");
        const consent = {
          claimId: claim.claimId,
          network: payment.network,
          vault: payment.vault,
        };
        const challenge = await requestConsent("bind-challenge", consent);
        if (!isCurrent()) return;
        const typed = challenge.typedData as ReturnType<
          typeof evmBindingTypedData
        >;
        if (!typed?.message || challenge.claimId !== claim.claimId)
          throw new Error("The payout consent could not be verified.");
        const expected = evmBindingTypedData(
          BigInt(network.chainId as string),
          payment.vault,
          {
            githubUserId: account.githubUserId,
            destination: claim.address,
            expectedVersion: typed.message.expectedVersion,
            claimDigest: typed.message.claimDigest,
            expiresAt: typed.message.expiresAt,
          },
        );
        if (JSON.stringify(typed) !== JSON.stringify(expected))
          throw new Error(
            "The payout consent names a different account, address, network or vault. Refresh and review again.",
          );
        if (!(await checkActor()) || !isCurrent()) return;
        const accounts = await rpc("eth_accounts", []);
        if (!isCurrent()) return;
        if (
          !Array.isArray(accounts) ||
          typeof accounts[0] !== "string" ||
          !sameWalletAddress(network.family, accounts[0], claim.address)
        )
          throw new Error(
            "The wallet account changed. Connect and review again.",
          );
        if (
          BigInt(String(await rpc("eth_chainId", []))) !==
          BigInt(network.chainId as string)
        )
          throw new Error(
            `Switch your wallet to ${networkLabel(payment.network)}, then review again.`,
          );
        if (!(await checkActor()) || !isCurrent()) return;
        const signature = await rpc("eth_signTypedData_v4", [
          claim.address,
          JSON.stringify(expected),
        ]);
        if (!(await checkActor()) || !isCurrent()) return;
        if (typeof signature !== "string")
          throw new Error("Your wallet did not return a signature.");
        const result = await requestConsent("bind-authorize", {
          ...consent,
          expectedVersion: expected.message.expectedVersion,
          expiresAt: expected.message.expiresAt,
          signature,
        });
        if (!(await checkActor()) || !isCurrent()) return;
        if (result.authorized !== true)
          throw new Error(
            "Payout consent was not stored. Refresh and review again.",
          );
        setNotice(
          "Wallet consent saved. Payment is not yet verified. Reload this page to check progress.",
        );
      } else {
        if (!wallet.solanaSign)
          throw new Error(
            "Choose a wallet that can sign a Solana binding transaction.",
          );
        const prepared = await requestConsent("solana-bind/prepare", {
          obligationId: payment.id,
        });
        if (!isCurrent()) return;
        if (typeof prepared.transaction !== "string")
          throw new Error(
            "The binding is already pending or unavailable. Reload this page before trying again.",
          );
        const bytes = decodeBase64(prepared.transaction);
        const context = prepared.bindingContext as SolanaBindingContext;
        if (
          !context ||
          context.vault !== payment.vault ||
          context.githubUserId !== account.githubUserId ||
          context.destination !== claim.address
        )
          throw new Error(
            "The prepared binding names another vault or account. Refresh and review again.",
          );
        verifyPreparedSolanaBinding(bytes, context);
        const chain =
          `solana:${payment.network === "solana-mainnet" ? "mainnet" : payment.network.slice(7)}` as `solana:${string}`;
        if (!(await checkActor()) || !isCurrent()) return;
        // Wallets may modify their input and retain the returned buffer. Keep
        // both our reviewed message and the result private across later awaits.
        const signed = Uint8Array.from(
          await wallet.solanaSign(bytes.slice(), chain),
        );
        if (!isCurrent()) return;
        // The attester must receive the exact prepared message and its existing signature.
        verifySignedSolanaBinding(bytes, signed, claim.address);
        if (!(await checkActor()) || !isCurrent()) return;
        const result = await requestConsent("solana-bind/complete", {
          obligationId: payment.id,
          transaction: encodeBase64(signed),
        });
        if (!(await checkActor()) || !isCurrent()) return;
        if (typeof result.transactionId !== "string")
          throw new Error(
            "Binding submission could not be verified. Reload this page before retrying.",
          );
        setNotice(
          "Binding submitted; payment is not yet verified. Reload this page to check progress.",
        );
      }
      setOpen(false);
    } catch (e) {
      if (!isCurrent()) return;
      if (
        e instanceof ProjectApiError &&
        (e.status === 401 || e.code === "actor_changed")
      ) {
        onAccessLost(e.status === 401);
        return;
      }
      setError(
        errorMessage(e, "Payout consent failed. Your award stays reserved."),
      );
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="payout-consent">
      {!open &&
        !notice &&
        (wallets.length === 0 ? (
          // This browser has no wallet that can sign; wallets are set up in account settings.
          <Link className="button secondary-button" href="/account#wallets">
            Authorize payout wallet
          </Link>
        ) : (
          <button
            type="button"
            ref={actionButton}
            className="button secondary-button"
            onClick={() => setOpen(true)}
          >
            Authorize payout wallet
          </button>
        ))}
      {createPortal(
        <dialog
          ref={dialog}
          className="wallet-picker payout-consent-dialog"
          aria-labelledby={headingId}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else {
              setOpen(false);
              setError("");
            }
          }}
          onClose={() => setOpen(false)}
        >
          <div className="consent-head">
            <ChainIcon chain={payment.chain} decorative />
            <div>
              <h2 id={headingId} tabIndex={-1} ref={reviewHeading}>
                Authorize payout wallet
              </h2>
              <p>{networkLabel(payment.network)}</p>
            </div>
          </div>
          <div className="consent-route">
            <dl className="consent-party">
              <dt>
                <Vault aria-hidden="true" size={16} />
                Vault
              </dt>
              <dd>
                <code className="wallet-address">{payment.vault}</code>
              </dd>
            </dl>
            <ArrowDown className="consent-arrow" aria-hidden="true" size={18} />
            <dl className="consent-party">
              <dt>
                <Wallet aria-hidden="true" size={16} />
                Your wallet
              </dt>
              <dd>
                <code className="wallet-address">{claim.address}</code>
              </dd>
            </dl>
          </div>
          <p className="consent-note">
            <ShieldCheck aria-hidden="true" size={16} />
            {network.family === "evm"
              ? "Signing moves no funds."
              : "Signing moves no funds. Slop pays the network fee."}
          </p>
          <div className="wallet-picker-list">
            {wallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="wallet-picker-row"
                disabled={busy}
                onClick={() => void authorize(wallet)}
              >
                {wallet.icon ? (
                  <img src={wallet.icon} width={32} height={32} alt="" />
                ) : (
                  <Wallet size={24} aria-hidden="true" />
                )}
                {busy ? "Confirm in your wallet…" : `Sign with ${wallet.name}`}
              </button>
            ))}
            <button
              type="button"
              className="button secondary-button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="consent-error">
              {error}
            </p>
          )}
        </dialog>,
        document.body,
      )}
      {notice && (
        <p role="status" tabIndex={-1} ref={result}>
          {notice}
        </p>
      )}
    </div>
  );
}
