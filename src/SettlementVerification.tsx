/**
 * Public surface for the settlement verification boundary. Every address on
 * this page is derived in the visitor's browser by the same module the backend
 * verifier uses, so the derivation can be checked against any explorer. The
 * page observes; it never approves, authorizes, signs, or broadcasts.
 */

import { type ReactNode, useEffect, useId, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import { SOLANA_MAINNET_USDC_MINT } from "./lib/settlement-plan";
import { assertSquadsExecutionIndex } from "./lib/squads-execution";
import {
  squadsExecutionAddress,
  squadsUsdcAta,
} from "./lib/squads-execution-verifier";
import {
  deriveSquadsVaultAddress,
  deriveVaultUsdcTokenAccount,
  SQUADS_V4_PROGRAM_ID,
} from "./lib/squads-funding";
import { isSolanaAddress } from "./lib/wallets";

type Derivation =
  | { status: "idle" }
  | { status: "invalid"; reason: string }
  | { status: "deriving" }
  | { status: "derived"; ata: string; proposal: string; bump: number }
  | { status: "failed"; reason: string };

type Vault =
  | { status: "idle" }
  | { status: "invalid"; reason: string }
  | { status: "deriving" }
  | { status: "derived"; vault: string; tokenAccount: string }
  | { status: "failed"; reason: string };

type Bindings =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "bound"; count: number }
  | { status: "failed"; reason: string };

function explorer(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address)}`;
}

function Address({ label, value }: { label: string; value: string }) {
  return (
    <div className="funding-route">
      <p>{label}</p>
      <code>{value}</code>
      <a href={explorer(value)} rel="noreferrer" target="_blank">
        Check {label.toLowerCase()} on an explorer
      </a>
    </div>
  );
}

function useBindings(): Bindings {
  const [bindings, setBindings] = useState<Bindings>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch("/data/squads-executions.json", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Execution bindings are unavailable.");
      const index = assertSquadsExecutionIndex(
        await readBoundedJson(response, 2 * 1024 * 1024, "Execution index"),
      );
      if (!active) return;
      setBindings(
        index.executions.length === 0
          ? { status: "empty" }
          : { status: "bound", count: index.executions.length },
      );
    })().catch((error: unknown) => {
      if (!active) return;
      setBindings({
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "Execution bindings are unavailable.",
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  return bindings;
}

function BindingState({ bindings }: { bindings: Bindings }): ReactNode {
  if (bindings.status === "loading")
    return <p role="status">Loading reviewed vault proposals…</p>;
  if (bindings.status === "failed")
    return (
      <p role="status">
        Reviewed vault proposals could not be loaded: {bindings.reason}
      </p>
    );
  if (bindings.status === "empty")
    return (
      <p role="status">
        No execution has been bound yet. No cycle has reached an approved
        allocation and execution plan, so there is nothing on chain for the
        verifier to observe. The ledger is empty rather than withheld, and an
        empty ledger is the only state the transition gate accepts until the
        first reviewed binding lands.
      </p>
    );
  return (
    <p role="status">
      {bindings.count} reviewed vault{" "}
      {bindings.count === 1 ? "proposal is" : "proposals are"} bound. Each is
      shown on its own cycle page with a live observation.
    </p>
  );
}

export function SettlementVerification({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const Container = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const headingId = useId();
  const addressId = useId();
  const indexId = useId();
  const multisigId = useId();
  const vaultIndexId = useId();
  const [address, setAddress] = useState("");
  const [transactionIndex, setTransactionIndex] = useState("1");
  const [derivation, setDerivation] = useState<Derivation>({ status: "idle" });
  const [multisig, setMultisig] = useState("");
  const [vaultIndex, setVaultIndex] = useState("0");
  const [vault, setVault] = useState<Vault>({ status: "idle" });
  const bindings = useBindings();

  const derive = () => {
    const candidate = address.trim();
    if (!isSolanaAddress(candidate)) {
      setDerivation({
        status: "invalid",
        reason: "Enter a valid Solana public address (32-byte base58).",
      });
      return;
    }
    if (!/^\d{1,19}$/u.test(transactionIndex.trim())) {
      setDerivation({
        status: "invalid",
        reason: "Enter a transaction index as a whole number.",
      });
      return;
    }
    setDerivation({ status: "deriving" });
    void (async () => {
      const [ata, proposal] = await Promise.all([
        squadsUsdcAta(candidate),
        squadsExecutionAddress(candidate, transactionIndex.trim(), true),
      ]);
      setDerivation({
        status: "derived",
        ata,
        proposal: proposal.address,
        bump: proposal.bump,
      });
    })().catch((error: unknown) => {
      setDerivation({
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "This address could not be derived.",
      });
    });
  };

  const deriveVault = () => {
    const candidate = multisig.trim();
    const index = Number(vaultIndex.trim());
    if (!isSolanaAddress(candidate)) {
      setVault({
        status: "invalid",
        reason: "Enter a valid Squads multisig address (32-byte base58).",
      });
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index > 255) {
      setVault({
        status: "invalid",
        reason: "Enter a vault index from 0 through 255.",
      });
      return;
    }
    setVault({ status: "deriving" });
    void (async () => {
      const derived = await deriveSquadsVaultAddress(candidate, index);
      setVault({
        status: "derived",
        vault: derived,
        tokenAccount: await deriveVaultUsdcTokenAccount(derived),
      });
    })().catch((error: unknown) => {
      setVault({
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "This vault could not be derived.",
      });
    });
  };

  return (
    <Container
      className={embedded ? "model-outcomes-section" : "shell route-main"}
      id={embedded ? "verification" : undefined}
      aria-labelledby={embedded ? undefined : headingId}
    >
      <section aria-labelledby={headingId} className="funding-workbench">
        <Heading id={headingId}>Settlement verification</Heading>
        <p>
          Slop does not take your word for a payment, and you do not have to
          take ours. Every monthly execution is bound to one external Squads v4
          vault proposal, and a verifier re-derives and re-reads that proposal
          from Solana mainnet before anything is described as paid.
        </p>

        <h2>What the verifier checks</h2>
        <ul>
          <li>
            Three fixed mainnet RPC authorities at finalized commitment, with
            two required to agree. One disagreeing or unavailable endpoint
            leaves the observation unresolved rather than passing it.
          </li>
          <li>
            The Squads program owner, account discriminators, full Borsh layout,
            multisig, transaction index, canonical PDAs, vault index and bump,
            and proposal status.
          </li>
          <li>
            Exactly the approved plan's ordered USDC transfers, including its
            fee transfer, with exact amounts, source vault authority, and
            canonical token accounts. A reassigned token account does not pass
            merely by matching an address.
          </li>
          <li>
            The instruction decoder follows the official Squads v4 Rust layout
            and is derived from that source rather than trusting an installed
            SDK. Unknown layouts, malformed vectors, trailing bytes, and
            unsupported instructions all fail closed.
          </li>
        </ul>

        <h2>What it does not establish</h2>
        <p>
          A verified instruction match is not approval, not available funding,
          and not permission to carry an amount forward. A matched plan is not a
          paid one. Slop holds no key, signs nothing, and broadcasts nothing;
          the creator signs and broadcasts externally, and settlement is
          described as paid only once finalized on-chain deltas reconcile
          exactly.
        </p>

        <h2>Bound proposals today</h2>
        <BindingState bindings={bindings} />

        <h2>Derive the addresses yourself</h2>
        <p>
          The fields below run the verifier's own derivation in your browser.
          Nothing is sent anywhere. Enter any Solana address to see the
          canonical USDC associated token account the verifier would require for
          it, and the Squads v4 proposal address it would derive for a given
          transaction index. Both are checkable against any explorer.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            derive();
          }}
        >
          <label htmlFor={addressId}>Solana address</label>
          <input
            autoComplete="off"
            id={addressId}
            maxLength={44}
            name="derivation-address"
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Owner wallet or Squads multisig"
            required
            spellCheck={false}
            value={address}
          />
          <label htmlFor={indexId}>Squads transaction index</label>
          <input
            autoComplete="off"
            id={indexId}
            inputMode="numeric"
            maxLength={19}
            name="derivation-index"
            onChange={(event) => setTransactionIndex(event.target.value)}
            required
            spellCheck={false}
            value={transactionIndex}
          />
          <button className="button primary-button" type="submit">
            Derive addresses
          </button>
        </form>

        {derivation.status === "invalid" && (
          <p role="alert">{derivation.reason}</p>
        )}
        {derivation.status === "deriving" && <p role="status">Deriving…</p>}
        {derivation.status === "failed" && (
          <p role="alert">Derivation failed: {derivation.reason}</p>
        )}
        {derivation.status === "derived" && (
          <div className="funding-routes">
            <Address label="USDC token account" value={derivation.ata} />
            <Address label="Squads proposal" value={derivation.proposal} />
            <p>
              Proposal bump {derivation.bump}. Derived against Squads v4 program{" "}
              <code>{SQUADS_V4_PROGRAM_ID}</code> and USDC mint{" "}
              <code>{SOLANA_MAINNET_USDC_MINT}</code>.
            </p>
            <p>
              A derived address existing on chain does not mean it belongs to a
              reviewed Slop cycle. Derivation is arithmetic, not authorization.
            </p>
          </div>
        )}

        <h2>Check a vault before you commit</h2>
        <p>
          If you are considering funding a pool, this is the exact account Slop
          would watch. Enter the Squads v4 multisig you control and the vault
          index, and the same derivation the commitment verifier uses will
          return the vault address and its canonical USDC token account. You can
          confirm both against your own Squads interface before declaring
          anything, and Slop never needs a key, a signer seat, or an admin role
          on that vault to read it.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            deriveVault();
          }}
        >
          <label htmlFor={multisigId}>Squads v4 multisig</label>
          <input
            autoComplete="off"
            id={multisigId}
            maxLength={44}
            name="vault-multisig"
            onChange={(event) => setMultisig(event.target.value)}
            required
            spellCheck={false}
            value={multisig}
          />
          <label htmlFor={vaultIndexId}>Vault index</label>
          <input
            autoComplete="off"
            id={vaultIndexId}
            inputMode="numeric"
            maxLength={3}
            name="vault-index"
            onChange={(event) => setVaultIndex(event.target.value)}
            required
            spellCheck={false}
            value={vaultIndex}
          />
          <button className="button primary-button" type="submit">
            Derive vault accounts
          </button>
        </form>

        {vault.status === "invalid" && <p role="alert">{vault.reason}</p>}
        {vault.status === "deriving" && <p role="status">Deriving vault…</p>}
        {vault.status === "failed" && (
          <p role="alert">Vault derivation failed: {vault.reason}</p>
        )}
        {vault.status === "derived" && (
          <div className="funding-routes">
            <Address label="Vault address" value={vault.vault} />
            <Address label="Vault USDC account" value={vault.tokenAccount} />
            <p>
              A committed pool additionally requires a reviewed instrument in
              the project manifest and deterministic verifier evidence. No
              project declares one today, so nothing on Slop is currently
              reporting a verified commitment. Deriving these accounts commits
              nothing and is not an escrow, a guarantee, or an approval.
            </p>
          </div>
        )}
      </section>
    </Container>
  );
}
