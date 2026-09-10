import { useEffect, useId, useRef, useState } from "react";
import {
  prepareWalletRegistration,
  type RegisteredWalletClaim,
  type WalletRegistrationSession,
} from "./lib/wallet-registration";
import { isSolanaAddress } from "./lib/wallets";

/** Standalone route or profile section; routing belongs to the parent. */
export function WalletRegistration() {
  const addressId = useId();
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "signing-in" | "preview" | "registering" | "done"
  >("idle");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<WalletRegistrationSession | null>(
    null,
  );
  const [registered, setRegistered] = useState<RegisteredWalletClaim | null>(
    null,
  );
  const active = useRef<{
    controller: AbortController;
    session?: WalletRegistrationSession;
  } | null>(null);
  const release = () => {
    const run = active.current;
    active.current = null;
    run?.controller.abort();
    run?.session?.cancel();
  };
  useEffect(
    () => () => {
      const run = active.current;
      active.current = null;
      run?.controller.abort();
      run?.session?.cancel();
    },
    [],
  );
  async function start() {
    const exactAddress = address.trim();
    if (!isSolanaAddress(exactAddress)) {
      setMessage("Enter a valid Solana public address (32-byte base58).");
      return;
    }
    release();
    // Reserve the popup during the user gesture; never place bearer credentials
    // in the application URL or communicate credentials via postMessage.
    const popup = window.open(
      "about:blank",
      "_blank",
      "popup,width=600,height=720",
    );
    if (!popup) {
      setMessage("Allow the GitHub sign-in popup, then try again.");
      return;
    }
    // The identity origin isolates its opener. Do not read or close this window
    // after navigation: Chromium reports unsafe cross-origin popup operations.
    popup.opener = null;
    const run = {
      controller: new AbortController(),
      session: undefined as WalletRegistrationSession | undefined,
    };
    active.current = run;
    setSession(null);
    setRegistered(null);
    setMessage("");
    setPhase("signing-in");
    try {
      const prepared = await prepareWalletRegistration(exactAddress, {
        signal: run.controller.signal,
        authorize: (url) => {
          popup.location.replace(url);
        },
      });
      if (active.current !== run) {
        prepared.cancel();
        return;
      }
      run.session = prepared;
      setSession(prepared);
      setPhase("preview");
    } catch (error) {
      if (active.current !== run) return;
      release();
      setPhase("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Wallet sign-in failed. Start again.",
      );
    }
  }
  async function confirm() {
    if (!session || !active.current || phase !== "preview") return;
    const run = active.current;
    setPhase("registering");
    setMessage("");
    try {
      const result = await session.confirm();
      if (active.current !== run) return;
      release();
      setSession(null);
      setRegistered(result);
      setPhase("done");
    } catch (error) {
      if (active.current !== run) return;
      release();
      setSession(null);
      setPhase("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Registration could not be verified. Start again to check the current claim.",
      );
    }
  }
  const busy = phase === "signing-in" || phase === "registering";
  return (
    <section
      aria-labelledby={`${addressId}-heading`}
      className="funding-workbench"
    >
      <h1 id={`${addressId}-heading`}>Register your wallet</h1>
      <p>
        Link your GitHub account to a public Solana address for USDC rewards. No
        wallet connection, private keys, or signing required.
      </p>
      <p>
        Your GitHub identity and address become a public, permanent claim.
        Registration does not prove control of the address or authorize a
        payment. Existing cycle wallets stay locked.
      </p>
      <form
        className="owner-form"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <label htmlFor={addressId}>Solana public address</label>
        <input
          id={addressId}
          name="wallet-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={44}
          required
          disabled={busy || phase === "preview"}
        />
        {(phase === "idle" || phase === "done") && (
          <button className="button primary-button" type="submit">
            Continue with GitHub
          </button>
        )}
      </form>
      {phase === "signing-in" && (
        <p role="status">
          Complete GitHub sign-in in the popup using your own account. This
          expires after five minutes. You can cancel here if you close the
          popup.
        </p>
      )}
      {session && phase === "preview" && (
        <div>
          <h2>Confirm your public registration</h2>
          <p>
            GitHub: <strong>{session.preview.identity.githubLogin}</strong> (ID{" "}
            {session.preview.identity.githubActorId})
          </p>
          <p>
            Solana address:{" "}
            <code className="wallet-address">{session.preview.address}</code>
          </p>
          <p>
            {session.preview.current ? (
              <>
                Current address:{" "}
                <code className="wallet-address">
                  {session.preview.current.address}
                </code>
                . A changed address appends a successor claim.
              </>
            ) : (
              "No current wallet claim."
            )}
          </p>
          <p>Sign-in is complete. You can close the GitHub sign-in window.</p>
          <p>This preview expires at {session.preview.expiresAt}.</p>
          <button
            className="button primary-button"
            type="button"
            onClick={() => void confirm()}
          >
            Confirm register
          </button>
        </div>
      )}
      {phase === "registering" && (
        <p role="status">Registering and verifying the returned claim…</p>
      )}
      {(busy || phase === "preview") && (
        <button
          className="button"
          type="button"
          onClick={() => {
            const submitted = phase === "registering";
            release();
            setSession(null);
            setPhase("idle");
            setMessage(
              submitted
                ? "Request cancelled. It may have reached the registry; sign in again to check the current claim."
                : "Registration cancelled. No wallet claim was submitted.",
            );
          }}
        >
          Cancel
        </button>
      )}
      {message && <p role="alert">{message}</p>}
      {registered && (
        <div role="status">
          <h2>Wallet registered</h2>
          <p>
            {registered.githubLogin}:{" "}
            <code className="wallet-address">{registered.address}</code>
          </p>
          <p>Observed: {registered.observedAt}</p>
          <p>
            Record digest:{" "}
            <code className="wallet-address">{registered.recordDigest}</code>
          </p>
          <a
            href={`https://api.slop.cash/api/v1/wallet-claims/${registered.claimId}`}
            target="_blank"
            rel="noreferrer"
          >
            View public claim
          </a>
        </div>
      )}
    </section>
  );
}
