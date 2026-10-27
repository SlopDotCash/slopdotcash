import { Wallet as WalletIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { evmBindingTypedData } from "../contracts/evm/adapter";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import type { AccountPayment, PaymentsAccount } from "./lib/payments/contracts";
import {
  type SolanaBindingContext,
  verifyPreparedSolanaBinding,
  verifySignedSolanaBinding,
} from "./lib/payout-consent";
import { apiRequest } from "./lib/project-api";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { sameWalletAddress } from "./lib/wallets";

async function request(path: string, body: unknown) {
  const response = await apiRequest(`payments/wallets/${path}`, {
    body,
    timeoutMs: 45_000,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in again, then review your payout wallet."
        : response.status === 409
          ? "The wallet changed or is still being prepared. Refresh payments and review again."
          : "Payout consent is unavailable. Your award stays reserved. Retry later.",
    );
  return (await readBoundedJson(response, 16_384, "payout consent")) as Record<
    string,
    unknown
  >;
}

/** Consent authorizes only this vault's destination binding; finalized payment is a separate result. */
export function PayoutConsent({
  payment,
  account,
}: {
  payment: AccountPayment;
  account: PaymentsAccount;
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
  if (!network || !claim || !payment.vault || payment.state !== "reserved")
    return null;
  async function authorize(provider: PayoutWallet) {
    if (!claim || !network) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const wallet = await provider.connect();
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
        const challenge = await request("bind-challenge", consent);
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
        const accounts = await rpc("eth_accounts", []);
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
        const signature = await rpc("eth_signTypedData_v4", [
          claim.address,
          JSON.stringify(expected),
        ]);
        if (typeof signature !== "string")
          throw new Error("Your wallet did not return a signature.");
        const result = await request("bind-authorize", {
          ...consent,
          expectedVersion: expected.message.expectedVersion,
          expiresAt: expected.message.expiresAt,
          signature,
        });
        if (result.authorized !== true)
          throw new Error(
            "Payout consent was not stored. Refresh and review again.",
          );
        setNotice(
          "Wallet consent saved. Payment is not yet verified. Refresh payments to check progress.",
        );
      } else {
        if (!wallet.solanaSign)
          throw new Error(
            "Choose a wallet that can sign a Solana binding transaction.",
          );
        const prepared = await request("solana-bind/prepare", {
          obligationId: payment.id,
        });
        if (typeof prepared.transaction !== "string")
          throw new Error(
            "The binding is already pending or unavailable. Refresh payments before trying again.",
          );
        const bytes = Uint8Array.from(atob(prepared.transaction), (c) =>
          c.charCodeAt(0),
        );
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
        const signed = await wallet.solanaSign(bytes, chain);
        // The attester must receive the exact prepared message and its existing signature.
        verifySignedSolanaBinding(bytes, signed, claim.address);
        const result = await request("solana-bind/complete", {
          obligationId: payment.id,
          transaction: btoa(String.fromCharCode(...signed)),
        });
        if (typeof result.transactionId !== "string")
          throw new Error(
            "Binding submission could not be verified. Refresh payments before retrying.",
          );
        setNotice(
          "Binding submitted; payment is not yet verified. Refresh payments to check progress.",
        );
      }
      setOpen(false);
    } catch (e) {
      setError(
        errorMessage(e, "Payout consent failed. Your award stays reserved."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="payout-consent">
      {!open && !notice && (
        <button
          type="button"
          ref={actionButton}
          className="button secondary-button"
          onClick={() => setOpen(true)}
        >
          Authorize payout wallet
        </button>
      )}
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
          <h2 id={headingId} tabIndex={-1} ref={reviewHeading}>
            Authorize payout wallet
          </h2>
          <p>
            Receive your awards from this vault on{" "}
            {networkLabel(payment.network)}.
          </p>
          <dl>
            <dt>Confirmed payout address</dt>
            <dd className="wallet-address">{claim.address}</dd>
            <dt>Project vault</dt>
            <dd className="wallet-address">{payment.vault}</dd>
          </dl>
          <p>
            {network.family === "evm"
              ? "Sign to authorize this payout address. No funds move."
              : "Sign the binding transaction. No funds move; Slop pays the network fee."}
          </p>
          {wallets.length === 0 && (
            <p>
              Open this page in a wallet browser with{" "}
              {network.family === "evm"
                ? "an EVM wallet"
                : "a Solana wallet that supports transaction signing"}
              .
            </p>
          )}
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
                  <WalletIcon size={24} aria-hidden="true" />
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
          {error && <p role="alert">{error}</p>}
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
