import { useEffect, useRef, useState } from "react";
import { loginHref } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import type { EscrowDeployment } from "./lib/escrow-policy.mjs";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, type PayoutPolicy } from "./lib/payments/contracts";
import { apiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { sendSolanaWalletTransaction } from "./lib/solana-vault-actions";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import {
  checkedVaultSetupReview,
  isVaultCreationId,
  solanaVaultCreationMessage,
  type VaultSetupInput,
  type VaultSetupReview,
} from "./lib/vault-setup";
import { sameWalletAddress } from "./lib/wallets";

type Connection = Awaited<ReturnType<PayoutWallet["connect"]>>;
type Pending = {
  version: 1;
  input: VaultSetupInput & { expectedRevision: number };
  review: VaultSetupReview;
  hash: string | null;
};
type WalletClaim = {
  chain: string;
  claimId: string;
  address: string;
  authorized: boolean;
};
async function request(path: string, body?: unknown) {
  const response = await apiRequest(path, { body, timeoutMs: 45_000 });
  const result = (await readBoundedJson(
    response,
    1_048_576,
    "vault setup",
  )) as { message?: string; error?: string };
  if (!response.ok)
    throw Object.assign(
      new Error(
        result.message ??
          (response.status === 401
            ? "Sign in with GitHub to set up the project vault."
            : "Vault setup could not be loaded. Retry."),
      ),
      { code: result.error },
    );
  return result;
}
function restore(key: string): Pending | null {
  const text = sessionStorage.getItem(key);
  if (!text) return null;
  const value = JSON.parse(text) as Pending;
  if (
    value.version !== 1 ||
    !value.input ||
    !value.review ||
    typeof value.review.owner !== "string" ||
    typeof value.review.capDisplay !== "string" ||
    !Object.hasOwn(ESCROW_NETWORKS, value.input.network) ||
    (value.hash !== null && !isVaultCreationId(value.input.network, value.hash))
  )
    throw new Error(
      "The saved request cannot be read. Check your wallet activity before creating a vault.",
    );
  return value;
}
export function OwnerVaultSetup({
  project,
  onRegistered,
  payoutPolicy = "ordinary",
}: {
  project: ProjectDefinition;
  payoutPolicy?: PayoutPolicy;
  onRegistered: (
    project: ProjectDefinition,
    wallet: Connection | null,
    notice: string | undefined,
    revision: number,
  ) => void | Promise<void>;
}) {
  const bounty = payoutPolicy === "security-bounty";
  const key = `slop:vault-setup:v1:${project.id}${bounty ? ":security-bounty" : ""}`;
  const [saved] = useState(() => {
    try {
      return { pending: restore(key), error: "" };
    } catch (error) {
      return { pending: null, error: String(error) };
    }
  });
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const [error, setError] = useState(saved.error);
  const [info, setInfo] = useState<{
    revision: number;
    networks: string[];
  } | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [claims, setClaims] = useState<WalletClaim[]>([]);
  const [network, setNetwork] = useState(saved.pending?.input.network ?? "");
  const [automatic, setAutomatic] = useState(true);
  const [wallet, setWallet] = useState<Connection | null>(null);
  const [review, setReview] = useState<Pending | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const hashInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failedCreation, setFailedCreation] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const [reload, setReload] = useState(0);
  const solana =
    ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]?.family ===
    "solana";
  const sameWallet = (a: string, b: string) =>
    sameWalletAddress(solana ? "solana" : "evm", a, b);
  const wallets = usePayoutWallets().filter((w) =>
    solana ? w.family === "solana" && w.solanaFunding : w.family === "evm",
  );
  // An existing vault has no create button; move to its hash field instead.
  useEffect(() => {
    if (review && !pending && !busy)
      (createButton.current ?? hashInput.current)?.focus();
  }, [review, pending, busy]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload explicitly repeats these uncached reads.
  useEffect(() => {
    let active = true;
    request("project-session")
      .then(async (result) => {
        if (!active) return null;
        if (!(result as unknown as { session: unknown }).session) {
          setSignInRequired(true);
          return null;
        }
        setSignInRequired(false);
        return Promise.all([
          request(`project-vaults/${project.id}?purpose=${payoutPolicy}`),
          request("payments/me"),
        ]);
      })
      .then((result) => {
        if (!active || !result) return;
        const [setup, account] = result;
        const value = setup as unknown as {
          revision: number;
          networks: string[];
        };
        setInfo(value);
        setNetwork((current) => current || value.networks[0] || "");
        setClaims((account as unknown as { wallets: WalletClaim[] }).wallets);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e, "Vault setup could not load."));
      });
    return () => {
      active = false;
    };
  }, [project.id, payoutPolicy, reload]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setFailedCreation(
        (e as { code?: string })?.code === "vault_creation_failed",
      );
      setError(errorMessage(e, "The wallet request failed."));
    } finally {
      setBusy(false);
    }
  };
  const remember = (value: Pending | null) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
  const connect = (provider: PayoutWallet) =>
    run(async () => {
      const connected = await provider.connect();
      if (pending && !sameWallet(connected.address, pending.review.owner))
        throw new Error("Reconnect the wallet used for this vault request.");
      setWallet(connected);
      setReview(null);
    });
  const ownerClaims = claims.filter(
    (c) =>
      c.authorized &&
      c.chain ===
        ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]?.chain,
  );
  const claim = wallet
    ? ownerClaims.find((c) => sameWallet(c.address, wallet.address))
    : undefined;
  const recoveryClaim = ownerClaims.length === 1 ? ownerClaims[0] : undefined;
  const reviewCreation = (existingOnly = false) =>
    run(async () => {
      const selectedClaim = existingOnly ? recoveryClaim : claim;
      if (!info || !selectedClaim)
        throw new Error(
          "Confirm this wallet in your account, then reload the setup options.",
        );
      const input = {
        network: network as EscrowDeployment["network"],
        claimId: selectedClaim.claimId,
        automatic: bounty ? false : automatic,
        payoutPolicy,
        expectedRevision: info.revision,
      };
      const result = (await request(`project-vaults/${project.id}`, {
        ...input,
        step: "review",
      })) as unknown as { review: VaultSetupReview };
      const checked = checkedVaultSetupReview(
        result.review,
        project,
        input,
        selectedClaim.address,
      );
      if (existingOnly && !checked.existingVault)
        throw new Error(
          "No existing vault was found for your confirmed wallet. Connect it to create one.",
        );
      setReview({ version: 1, input, review: checked, hash: null });
    });
  const create = () =>
    run(async () => {
      if (!wallet || !review) throw new Error("Connect and review first.");
      if (review.review.family === "evm") {
        if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
        const accounts = await wallet.evmRequest("eth_accounts", []);
        if (
          !Array.isArray(accounts) ||
          String(accounts[0]).toLowerCase() !==
            review.review.owner.toLowerCase() ||
          BigInt(String(await wallet.evmRequest("eth_chainId", []))) !==
            BigInt(review.review.chainId)
        )
          throw new Error(
            `Connect the reviewed wallet on ${networkLabel(review.input.network)}.`,
          );
      }
      const fresh = (await request(`project-vaults/${project.id}`, {
        ...review.input,
        step: "review",
      })) as unknown as { review: VaultSetupReview };
      checkedVaultSetupReview(
        fresh.review,
        project,
        review.input,
        wallet.address,
      );
      if (fresh.review.existingVault)
        throw new Error(
          "This vault already exists. Recover its creation transaction instead of sending another.",
        );
      if (
        fresh.review.family !== review.review.family ||
        (fresh.review.family === "evm" &&
          JSON.stringify(fresh.review.transaction) !==
            JSON.stringify(review.review.transaction)) ||
        (fresh.review.family === "solana" &&
          review.review.family === "solana" &&
          JSON.stringify(fresh.review.creation) !==
            JSON.stringify(review.review.creation))
      )
        throw new Error("The creation request changed. Review again.");
      // Refresh Solana's transaction lifetime only after the owner, policy and
      // exact creation instructions still match the review above.
      const ready = { ...review, review: fresh.review };
      remember(ready);
      try {
        let hash: unknown;
        if (ready.review.family === "solana") {
          if (!ready.review.transaction)
            throw new Error("Recover the existing vault transaction.");
          hash = await sendSolanaWalletTransaction(
            { network: ready.input.network },
            wallet,
            ready.review.transaction.transaction,
            solanaVaultCreationMessage(ready.review),
            () => remember(ready),
          );
        } else {
          if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
          hash = await wallet.evmRequest("eth_sendTransaction", [
            ready.review.transaction,
          ]);
        }
        if (
          typeof hash !== "string" ||
          !isVaultCreationId(ready.input.network, hash)
        )
          throw new Error(
            "The wallet did not return a transaction hash. Recover it from wallet activity.",
          );
        remember({ ...ready, hash });
        setRecoveryHash(hash);
        setReview(null);
        setNotice("Creation sent. Check registration once it is finalized.");
      } catch (e) {
        if ((e as { code?: number })?.code === 4001) remember(null);
        throw e;
      }
    });
  const register = () =>
    run(async () => {
      const current = pending ?? review;
      if (!current) throw new Error("Review the existing vault first.");
      const hash = recoveryHash.trim();
      if (!isVaultCreationId(current.input.network, hash))
        throw new Error(
          "Enter the creation transaction hash from your wallet.",
        );
      remember({ ...current, hash });
      const result = (await request(`project-vaults/${project.id}`, {
        ...current.input,
        step: "register",
        transactionId: hash,
      })) as unknown as {
        status: string;
        deployment?: EscrowDeployment;
        project?: ProjectDefinition;
        notice?: string;
        revision?: number;
      };
      if (result.status === "pending") {
        setNotice("The creation is not finalized yet. Wait, then check again.");
        return;
      }
      if (
        result.status !== "registered" ||
        !result.deployment ||
        result.project?.id !== project.id ||
        !Number.isSafeInteger(result.revision) ||
        Number(result.revision) < 1
      )
        throw new Error("Registration could not be verified. Check again.");
      await onRegistered(
        result.project,
        wallet,
        result.notice,
        Number(result.revision),
      );
      remember(null);
      setReview(null);
    });
  const active = pending ?? review;
  return (
    <section
      className="section"
      aria-label={bounty ? "Set up bounty vault" : "Set up project vault"}
    >
      <h3>{bounty ? "Set up your bounty vault" : "Set up your vault"}</h3>
      <p>Your wallet creates and owns the vault.</p>
      {signInRequired ? (
        <p>
          <a
            href={loginHref(
              `/projects/${project.slug}/${bounty ? "manage" : "funding"}`,
            )}
          >
            Sign in with GitHub
          </a>{" "}
          to set up the vault.
        </p>
      ) : null}
      {!info && !error && !signInRequired ? (
        <p role="status">Loading setup options…</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {failedCreation ? (
        <button
          type="button"
          onClick={() => {
            remember(null);
            setReview(null);
            setFailedCreation(false);
          }}
        >
          Review a new creation request
        </button>
      ) : null}
      {saved.error ? (
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(key);
            location.reload();
          }}
        >
          I checked wallet activity; clear the unreadable saved request
        </button>
      ) : null}
      {!active && info ? (
        info.networks.length === 0 ? (
          <p>Vault creation is not available on this network yet.</p>
        ) : (
          <>
            <label>
              Network{" "}
              <select
                value={network}
                disabled={busy}
                onChange={(e) => {
                  setNetwork(e.target.value);
                  setWallet(null);
                  setReview(null);
                }}
              >
                {info.networks.map((n) => (
                  <option key={n} value={n}>
                    {networkLabel(n)}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {wallet
                ? `Connected: ${wallet.address}`
                : "Connect your confirmed owner wallet."}
            </p>
            {wallets.map((w) => (
              <button
                key={w.id}
                className="button secondary-button"
                type="button"
                disabled={busy}
                onClick={() => void connect(w)}
              >
                Connect {w.name}
              </button>
            ))}
            {wallet && !claim ? (
              <p>
                <a href="/account#wallets">
                  Confirm this wallet in your account
                </a>
                , then reload the setup options.
              </p>
            ) : null}
            {!bounty ? (
              <>
                <label>
                  Automatic monthly payment
                  <select
                    value={automatic ? "on" : "off"}
                    disabled={busy}
                    onChange={(e) => setAutomatic(e.target.value === "on")}
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <p>
                  Monthly cap: {project.reward.monthlyCapDisplay}. You can
                  change this later.
                </p>
              </>
            ) : null}
            <button
              className="button"
              type="button"
              disabled={busy || !claim || Boolean(saved.error)}
              onClick={() => void reviewCreation()}
            >
              Review vault creation
            </button>
            {!wallet ? (
              recoveryClaim ? (
                <>
                  <p>
                    Recover a vault you already created without reconnecting
                    your confirmed wallet.
                    {!bounty
                      ? " Select the automatic monthly payment setting that you used at creation."
                      : null}
                  </p>
                  <button
                    className="button secondary-button"
                    type="button"
                    disabled={busy || Boolean(saved.error)}
                    onClick={() => void reviewCreation(true)}
                  >
                    Recover existing vault
                  </button>
                </>
              ) : (
                <p>
                  To recover an existing vault,{" "}
                  <a href="/account#wallets">confirm a wallet</a> for this
                  network, then reload the setup options.
                </p>
              )
            ) : null}
          </>
        )
      ) : null}
      {active ? (
        <>
          <dl>
            <dt>Network</dt>
            <dd>{networkLabel(active.input.network)}</dd>
            <dt>Owner wallet</dt>
            <dd>{active.review.owner}</dd>
            <dt>Reward token</dt>
            <dd>{active.review.asset}</dd>
            {!bounty ? (
              <>
                <dt>Monthly cap</dt>
                <dd>{active.review.capDisplay}</dd>
                <dt>Automatic payment</dt>
                <dd>{active.input.automatic ? "On" : "Off"}</dd>
              </>
            ) : (
              <>
                <dt>Payment policy</dt>
                <dd>Security bounty: 75% researcher, 25% Slop</dd>
              </>
            )}
            {active.review.family === "solana" && active.review.transaction && (
              <>
                <dt>Estimated network fee</dt>
                <dd>
                  {formatBaseUnits(
                    active.review.transaction.networkFeeLamports,
                    9,
                  )}{" "}
                  SOL
                </dd>
              </>
            )}
          </dl>
          {!pending && !active.review.existingVault ? (
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void create()}
              ref={createButton}
            >
              Create vault in wallet
            </button>
          ) : null}
          {pending || active.review.existingVault ? (
            <>
              <label>
                Creation transaction {solana ? "signature" : "hash"}{" "}
                <input
                  ref={hashInput}
                  value={recoveryHash}
                  disabled={busy}
                  onChange={(e) => setRecoveryHash(e.target.value)}
                />
              </label>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void register()}
              >
                Check vault registration
              </button>
              {pending && !pending.hash ? (
                <details>
                  <summary>Wallet confirms nothing was sent</summary>
                  <p>
                    Check wallet activity first. If creation was sent, enter its
                    hash above.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      remember(null);
                      setReview(null);
                      setRecoveryHash("");
                      setNotice(
                        "Local request cleared. Review again before sending.",
                      );
                    }}
                  >
                    I checked my wallet; this request was not sent
                  </button>
                </details>
              ) : null}
            </>
          ) : null}
          {!pending ? (
            <button
              type="button"
              className="button secondary-button"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Change review
            </button>
          ) : null}
        </>
      ) : null}
      {!pending ? (
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={() => {
            setError("");
            setReload((n) => n + 1);
          }}
        >
          Reload setup options
        </button>
      ) : null}
    </section>
  );
}
