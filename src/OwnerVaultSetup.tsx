import { useEffect, useRef, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import type { EscrowDeployment } from "./lib/escrow-policy.mjs";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import {
  checkedVaultSetupReview,
  type VaultSetupInput,
  type VaultSetupReview,
} from "./lib/vault-setup";
import { loginHref } from "./Points";

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
  const response = await fetch(`/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
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
    (value.hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.hash))
  )
    throw new Error(
      "The saved request cannot be read. Check your wallet activity before creating a vault.",
    );
  return value;
}
export function OwnerVaultSetup({
  project,
  onRegistered,
}: {
  project: ProjectDefinition;
  onRegistered: (
    project: ProjectDefinition,
    wallet: Connection | null,
    notice?: string,
  ) => void;
}) {
  const key = `slop:vault-setup:v1:${project.id}`;
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
  const [busy, setBusy] = useState(false);
  const [failedCreation, setFailedCreation] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const [reload, setReload] = useState(0);
  const wallets = usePayoutWallets().filter((w) => w.family === "evm");
  useEffect(() => {
    if (review && !pending && !busy) createButton.current?.focus();
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
          request(`project-vaults/${project.id}`),
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
        if (active)
          setError(
            e instanceof Error ? e.message : "Vault setup could not load.",
          );
      });
    return () => {
      active = false;
    };
  }, [project.id, reload]);
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
      setError(e instanceof Error ? e.message : "The wallet request failed.");
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
      if (
        pending &&
        connected.address.toLowerCase() !== pending.review.owner.toLowerCase()
      )
        throw new Error("Reconnect the wallet used for this vault request.");
      setWallet(connected);
      setReview(null);
    });
  const claim = claims.find(
    (c) =>
      c.authorized &&
      c.chain ===
        ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]?.chain &&
      c.address.toLowerCase() === wallet?.address.toLowerCase(),
  );
  const reviewCreation = () =>
    run(async () => {
      if (!info || !claim)
        throw new Error(
          "Confirm this wallet in Earnings, then reload the setup options.",
        );
      const input = {
        network: network as EscrowDeployment["network"],
        claimId: claim.claimId,
        automatic,
        expectedRevision: info.revision,
      };
      const result = (await request(`project-vaults/${project.id}`, {
        ...input,
        step: "review",
      })) as unknown as { review: VaultSetupReview };
      setReview({
        version: 1,
        input,
        review: checkedVaultSetupReview(
          result.review,
          project,
          input,
          claim.address,
        ),
        hash: null,
      });
    });
  const create = () =>
    run(async () => {
      if (!wallet?.evmRequest || !review)
        throw new Error("Connect and review first.");
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
        JSON.stringify(fresh.review.transaction) !==
        JSON.stringify(review.review.transaction)
      )
        throw new Error("The creation request changed. Review again.");
      remember(review);
      try {
        const hash = await wallet.evmRequest("eth_sendTransaction", [
          review.review.transaction,
        ]);
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
          throw new Error(
            "The wallet did not return a transaction hash. Recover it from wallet activity.",
          );
        remember({ ...review, hash });
        setRecoveryHash(hash);
        setReview(null);
        setNotice(
          "Creation sent. Check registration after the transaction is finalized.",
        );
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
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
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
      };
      if (result.status === "pending") {
        setNotice("The creation is not finalized yet. Wait, then check again.");
        return;
      }
      if (
        result.status !== "registered" ||
        !result.deployment ||
        result.project?.id !== project.id
      )
        throw new Error("Registration could not be verified. Check again.");
      remember(null);
      setReview(null);
      onRegistered(result.project, wallet, result.notice);
    });
  const active = pending ?? review;
  return (
    <section className="section" aria-label="Set up project vault">
      <h3>Set up your vault</h3>
      <p>
        Create the vault from your wallet, then deposit funds. Your wallet owns
        the vault.
      </p>
      {signInRequired ? (
        <p>
          <a href={loginHref(`/projects/${project.slug}/funding`)}>
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
          <p>
            Vault creation is unavailable until a compatible factory is reviewed
            for this project's network.
          </p>
        ) : (
          <>
            <label>
              Network{" "}
              <select
                value={network}
                disabled={busy}
                onChange={(e) => {
                  setNetwork(e.target.value);
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
                <a href="/earnings">Confirm this wallet in Earnings</a>, then
                reload the setup options.
              </p>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={automatic}
                disabled={busy}
                onChange={(e) => setAutomatic(e.target.checked)}
              />{" "}
              Automatically pay the monthly allocation
            </label>
            <p>
              The cap is {project.reward.monthlyCapDisplay} per month. You can
              turn automatic payment off later.
            </p>
            <button
              className="button"
              type="button"
              disabled={busy || !claim || Boolean(saved.error)}
              onClick={() => void reviewCreation()}
            >
              Review vault creation
            </button>
          </>
        )
      ) : null}
      {active ? (
        <>
          <dl>
            <dt>Network</dt>
            <dd>{networkLabel(active.input.network)}</dd>
            <dt>Owner wallet</dt>
            <dd className="break-all">{active.review.owner}</dd>
            <dt>Reward token</dt>
            <dd className="break-all">{active.review.asset}</dd>
            <dt>Monthly cap</dt>
            <dd>{active.review.capDisplay}</dd>
            <dt>Automatic payment</dt>
            <dd>{active.input.automatic ? "On" : "Off"}</dd>
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
                Creation transaction hash{" "}
                <input
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
