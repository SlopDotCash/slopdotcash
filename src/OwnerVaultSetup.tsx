import { useEffect, useRef, useState } from "react";
import { loginHref } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import type { EscrowDeployment } from "./lib/escrow-policy.mjs";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import { formatBaseUnits, type PayoutPolicy } from "./lib/payments/contracts";
import {
  clearPendingAttempt,
  createPendingAttempt,
  type PendingAttempt,
  updatePendingRecord,
  validPendingAttemptId,
} from "./lib/pending-attempt";
import { apiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { formatRewardCapDisplay } from "./lib/reward-amount";
import { formatAssetSymbol } from "./lib/reward-asset.mjs";
import { sendSolanaWalletTransaction } from "./lib/solana-vault-actions";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import {
  checkedVaultSetupReview,
  isVaultCreationId,
  solanaVaultCreationMessage,
  type VaultSetupInput,
  type VaultSetupReview,
} from "./lib/vault-setup";
import { vaultSetupAttempt } from "./lib/vault-setup-attempt";
import { sameWalletAddress } from "./lib/wallets";
import { UnsentTransactionRecovery } from "./OwnerPresentation";
import { NetworkName, WalletConnection } from "./Presentation";
import { VaultActions } from "./VaultActions";

type Connection = Awaited<ReturnType<PayoutWallet["connect"]>>;
type Pending = PendingAttempt & {
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
    !validPendingAttemptId(value.attemptId) ||
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
/**
 * A saved creation transaction is checked for registration without a click:
 * every 10 seconds at first, then every 30, for about an hour, paused while the
 * tab is hidden. "Check vault registration" stays for an entered hash.
 */
/**
 * A creation this page just sent, or whose deposit it just verified, is asked
 * about early: inclusion alone lets the owner fund the vault.
 */
const AUTO_REGISTER_SOON_MS = 4_000;
const AUTO_REGISTER_FAST_MS = 10_000;
const AUTO_REGISTER_SLOW_MS = 30_000;
const AUTO_REGISTER_FAST_ATTEMPTS = 6;
const AUTO_REGISTER_ATTEMPTS = 120;
/** A check that keeps failing is not a wait; stop asking and leave the button. */
const AUTO_REGISTER_ERRORS = 3;
/**
 * The server's answer for a creation that is in a canonical block but not final:
 * the deployment it verified against the review. It is shown, never stored, and
 * must name this request's network, owner, token and creation transaction.
 */
function provisionalDeployment(
  value: unknown,
  submitted: Pending,
): EscrowDeployment | null {
  const deployment = value as EscrowDeployment | null | undefined;
  if (
    !deployment ||
    typeof deployment !== "object" ||
    submitted.review.family !== "evm" ||
    deployment.network !== submitted.input.network ||
    typeof deployment.vault !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(deployment.vault) ||
    typeof deployment.owner !== "string" ||
    deployment.owner.toLowerCase() !== submitted.review.owner.toLowerCase() ||
    typeof deployment.asset !== "string" ||
    deployment.asset.toLowerCase() !== submitted.review.asset.toLowerCase() ||
    typeof deployment.deploymentTransaction !== "string" ||
    deployment.deploymentTransaction.toLowerCase() !==
      submitted.hash?.toLowerCase()
  )
    return null;
  return deployment;
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
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      return { pending: restore(key), error: "", raw };
    } catch (error) {
      return { pending: null, error: String(error), raw };
    }
  });
  const mounted = useRef(true);
  const action = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      action.current += 1;
    };
  }, []);
  const storedPending = useRef<Pending | null>(saved.pending);
  const [pending, setPending] = useState<Pending | null>(saved.pending);
  const { busy, error, setError, run: act } = useAction(saved.error);
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
  const [failedCreation, setFailedCreation] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState(saved.pending?.hash ?? "");
  const [reload, setReload] = useState(0);
  // The included, not yet registered vault the owner may already fund.
  const [provisional, setProvisional] = useState<EscrowDeployment | null>(null);
  const fundingWallet = useRef<Connection | null>(null);
  const [fundingBusy, setFundingBusy] = useState(false);
  // The creation hash whose next automatic check should run early.
  const [askSoon, setAskSoon] = useState<string | null>(null);
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
          setInfo(null);
          setClaims([]);
          setWallet(null);
          setReview(null);
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
        if (!active) return;
        setInfo(null);
        setClaims([]);
        setWallet(null);
        setReview(null);
        setError(errorMessage(e, "Vault setup could not load."));
      });
    return () => {
      active = false;
    };
  }, [project.id, payoutPolicy, reload]);
  /** True while the shown error came from an automatic check, not an owner action. */
  const autoErrored = useRef(false);
  const run = (work: (current: () => boolean) => Promise<void>) => {
    if (!mounted.current) return;
    const request = ++action.current;
    const current = () => mounted.current && action.current === request;
    setNotice("");
    autoErrored.current = false;
    return act(
      async () => {
        try {
          await work(current);
        } catch (caught) {
          if (current()) throw caught;
        }
      },
      (caught) => {
        if (current())
          setFailedCreation(
            (caught as { code?: string })?.code === "vault_creation_failed",
          );
        return errorMessage(caught, "The wallet request failed.");
      },
    );
  };

  const remember = (
    value: Pending,
    current: () => boolean,
    previous?: Pending,
  ) => {
    const stored = previous
      ? updatePendingRecord(key, previous, value)
      : createPendingAttempt(key, value);
    if (!stored) return false;
    storedPending.current = value;
    if (current()) setPending(value);
    return true;
  };
  const clear = (expected: Pending, current: () => boolean) => {
    if (!clearPendingAttempt(key, expected)) return false;
    storedPending.current = null;
    if (current()) setPending(null);
    return true;
  };
  const connect = (provider: PayoutWallet) =>
    run(async (current) => {
      const connected = await provider.connect();
      if (!current()) return;
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
    run(async (current) => {
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
      if (!current()) return;
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
    run(async (current) => {
      if (!wallet || !review) throw new Error("Connect and review first.");
      if (review.review.family === "evm") {
        if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
        const accounts = await wallet.evmRequest("eth_accounts", []);
        if (!current()) return;
        if (
          !Array.isArray(accounts) ||
          String(accounts[0]).toLowerCase() !==
            review.review.owner.toLowerCase()
        )
          throw new Error(
            `Connect the reviewed wallet on ${networkLabel(review.input.network)}.`,
          );
        const chainId = await wallet.evmRequest("eth_chainId", []);
        if (!current()) return;
        if (BigInt(String(chainId)) !== BigInt(review.review.chainId))
          throw new Error(
            `Connect the reviewed wallet on ${networkLabel(review.input.network)}.`,
          );
      }
      const fresh = (await request(`project-vaults/${project.id}`, {
        ...review.input,
        step: "review",
      })) as unknown as { review: VaultSetupReview };
      if (!current()) return;
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
      const ready: Pending = {
        ...review,
        attemptId: crypto.randomUUID(),
        review: fresh.review,
      };
      const attempt = vaultSetupAttempt(key, ready);
      let requested = false;
      const beforeSend = () => {
        if (!current())
          throw new Error(
            "The vault setup view was closed. Review before sending.",
          );
        if (!attempt.begin())
          throw new Error(
            "The saved vault request changed. Reload before continuing.",
          );
        storedPending.current = ready;
        if (current()) setPending(ready);
        requested = true;
      };
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
            beforeSend,
          );
        } else {
          if (!wallet.evmRequest) throw new Error("Choose an EVM wallet.");
          beforeSend();
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
        const submitted = { ...ready, hash };
        try {
          if (attempt.submitted(hash)) {
            storedPending.current = submitted;
            if (current()) {
              setPending(submitted);
              setAskSoon(hash);
              setNotice(
                "Creation sent. Check registration once it is finalized.",
              );
            }
          } else if (current())
            setNotice(
              `Creation sent: ${hash}. The saved request changed. Keep this hash with your wallet activity.`,
            );
        } catch {
          if (current())
            setNotice(
              `Creation sent: ${hash}. Keep this hash; browser storage could not save it.`,
            );
        }
        if (current()) {
          setRecoveryHash(hash);
          setReview(null);
        }
      } catch (e) {
        if (
          requested &&
          (e as { code?: number })?.code === 4001 &&
          attempt.declined()
        ) {
          storedPending.current = null;
          if (current()) setPending(null);
        }
        throw e;
      }
    });
  const registering = useRef(false);
  /**
   * Asks the server to verify and register the saved creation. An automatic
   * check signs nothing, shows no busy state and leaves the notice alone while
   * the creation is not finalized.
   */
  const performRegister = async (
    current: () => boolean,
    automatic: boolean,
  ) => {
    if (registering.current) return;
    registering.current = true;
    try {
      const viewed = pending ?? review;
      if (!viewed) throw new Error("Review the existing vault first.");
      const hash = recoveryHash.trim();
      if (!isVaultCreationId(viewed.input.network, hash))
        throw new Error(
          "Enter the creation transaction hash from your wallet.",
        );
      const captured = storedPending.current;
      if (pending && !captured)
        throw new Error(
          "The saved vault request changed. Reload before continuing.",
        );
      const submitted: Pending = {
        ...viewed,
        ...(pending ? {} : { attemptId: crypto.randomUUID() }),
        hash,
      };
      if (!remember(submitted, current, captured ?? undefined))
        throw new Error(
          "The saved vault request changed. Reload before continuing.",
        );
      const result = (await request(`project-vaults/${project.id}`, {
        ...submitted.input,
        step: "register",
        transactionId: hash,
      }).catch((caught: unknown) => {
        // A refused creation has no vault to fund. An unread network keeps the form.
        if (
          current() &&
          ["vault_creation_failed", "vault_creation_invalid"].includes(
            String((caught as { code?: string })?.code),
          )
        )
          setProvisional(null);
        throw caught;
      })) as unknown as {
        status: string;
        deployment?: EscrowDeployment;
        provisional?: unknown;
        project?: ProjectDefinition;
        notice?: string;
        revision?: number;
      };
      if (!current()) return;
      if (JSON.stringify(restore(key)) !== JSON.stringify(submitted))
        throw new Error(
          "The saved vault request changed. Reload before continuing.",
        );
      if (result.status === "pending") {
        const included = provisionalDeployment(result.provisional, submitted);
        // The block that carried the creation was replaced: the vault is not
        // on chain now, so its funding form goes away until it is included again.
        const dropped = provisional !== null && included === null;
        const appeared = provisional === null && included !== null;
        setProvisional(included);
        if (dropped)
          setNotice(
            "The block that held the vault creation was replaced. Wait for the creation to be included again before you deposit.",
          );
        else if (included && (appeared || !automatic)) {
          const chain = networkLabel(included.network);
          setNotice(
            `The vault is on ${chain} but its creation is not finalized yet. You can fund it below now. A deposit counts once ${chain} finalizes it.`,
          );
        } else if (!automatic)
          setNotice(
            "The creation is not finalized yet. Wait, then check again.",
          );
        // The check works again: withdraw the error an earlier one showed.
        if (automatic && autoErrored.current) setError(null);
        autoErrored.current = false;
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
        // Keep the wallet that funded the vault before registration, so its
        // pending deposit is still checked without another connection.
        fundingWallet.current ?? wallet,
        result.notice,
        Number(result.revision),
      );
      if (!clear(submitted, current) && current())
        throw new Error(
          "The saved vault request changed. Reload before continuing.",
        );
      if (current()) setReview(null);
    } finally {
      registering.current = false;
    }
  };
  const register = () =>
    run(async (current) => {
      const checked = recoveryHash.trim();
      try {
        await performRegister(current, false);
      } catch (caught) {
        // The owner saw this hash fail; do not ask about it again unprompted.
        if (mounted.current)
          setAutoRegister((state) => ({
            hash: checked,
            attempts: AUTO_REGISTER_ATTEMPTS,
            errors: 0,
            ticks: state.ticks + 1,
          }));
        throw caught;
      }
    });
  const latestRegister = useRef(performRegister);
  useEffect(() => {
    latestRegister.current = performRegister;
  });
  // Only a saved creation the owner is not editing is checked automatically.
  const [autoRegister, setAutoRegister] = useState({
    hash: "",
    attempts: 0,
    errors: 0,
    ticks: 0,
  });
  // A wallet request in the funding form finishes before the page can switch
  // to the registered vault, so the check waits for it.
  const autoHash =
    pending?.hash &&
    !busy &&
    !fundingBusy &&
    !saved.error &&
    recoveryHash.trim() === pending.hash
      ? pending.hash
      : null;
  const autoAttempts =
    autoRegister.hash === autoHash ? autoRegister.attempts : 0;
  const autoErrors = autoRegister.hash === autoHash ? autoRegister.errors : 0;
  const autoTicks = autoRegister.ticks;
  useEffect(() => {
    if (autoHash === null || autoAttempts >= AUTO_REGISTER_ATTEMPTS) return;
    const timer = window.setTimeout(
      () => {
        const done = (attempts: number, errors: number) => {
          if (mounted.current)
            setAutoRegister({
              hash: autoHash,
              attempts,
              errors,
              ticks: autoTicks + 1,
            });
        };
        // A hidden tab asks nothing and uses no attempt; the next tick retries.
        if (document.visibilityState === "hidden") {
          done(autoAttempts, autoErrors);
          return;
        }
        // An owner action retires this check; it never retires an owner action.
        const token = action.current;
        const current = () => mounted.current && action.current === token;
        void latestRegister
          .current(current, true)
          .then(() => done(autoAttempts + 1, 0))
          .catch((caught) => {
            if (!current()) return done(autoAttempts + 1, autoErrors);
            // Show why the check fails. A failed creation is final, and so are
            // repeated failures; one failure is asked again and a later
            // success withdraws the message.
            const failed =
              (caught as { code?: string })?.code === "vault_creation_failed";
            const errors = autoErrors + 1;
            autoErrored.current = true;
            setFailedCreation(failed);
            setError(errorMessage(caught, "The wallet request failed."));
            done(
              failed || errors >= AUTO_REGISTER_ERRORS
                ? AUTO_REGISTER_ATTEMPTS
                : autoAttempts + 1,
              errors,
            );
          });
      },
      autoAttempts === 0 && askSoon === autoHash
        ? AUTO_REGISTER_SOON_MS
        : autoAttempts < AUTO_REGISTER_FAST_ATTEMPTS
          ? AUTO_REGISTER_FAST_MS
          : AUTO_REGISTER_SLOW_MS,
    );
    return () => window.clearTimeout(timer);
  }, [autoHash, autoAttempts, autoErrors, autoTicks, askSoon, setError]);
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
          onClick={() =>
            void run(async (current) => {
              const captured = storedPending.current;
              if (captured && !clear(captured, current))
                throw new Error(
                  "The saved vault request changed. Reload before continuing.",
                );
              setReview(null);
              setFailedCreation(false);
            })
          }
        >
          Review a new creation request
        </button>
      ) : null}
      {saved.error ? (
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              if (sessionStorage.getItem(key) !== saved.raw)
                throw new Error(
                  "The saved vault request changed. Reload before continuing.",
                );
              sessionStorage.removeItem(key);
              location.reload();
            })
          }
        >
          I checked wallet activity; clear the unreadable saved request
        </button>
      ) : null}
      {!active && !signInRequired && info ? (
        info.networks.length === 0 ? (
          <p>Vault creation is not available on this network yet.</p>
        ) : (
          <>
            {info.networks.length === 1 ? (
              <NetworkName
                chain={
                  ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS].chain
                }
              >
                {networkLabel(network)}
              </NetworkName>
            ) : (
              <label>
                Network{" "}
                <select
                  value={network}
                  disabled={busy}
                  onChange={(e) => {
                    action.current += 1;
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
            )}
            <WalletConnection
              address={wallet?.address ?? null}
              wallets={wallets}
              disabled={busy}
              legend="Connect your confirmed owner wallet"
              empty={
                <p>
                  Open this page in your wallet app or install a compatible
                  wallet.
                </p>
              }
              onConnect={(provider) => void connect(provider)}
            />
            {wallet ? (
              <button
                className="button secondary-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  action.current += 1;
                  setWallet(null);
                }}
              >
                Choose another wallet
              </button>
            ) : null}
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
                    onChange={(e) => {
                      action.current += 1;
                      setAutomatic(e.target.value === "on");
                    }}
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <p>
                  Monthly cap:{" "}
                  {formatRewardCapDisplay(
                    project.reward.monthlyCapDisplay,
                    project.rewardAsset,
                  )}
                  . You can change this later.
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
              <details className="owner-vault-recovery">
                <summary>Recover an existing vault</summary>
                {recoveryClaim ? (
                  <>
                    <p>
                      Recover without reconnecting your confirmed wallet.
                      {!bounty
                        ? " Use the automatic monthly payment setting selected at creation."
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
                    <a href="/account#wallets">Confirm a wallet</a> for this
                    network, then reload the setup options.
                  </p>
                )}
              </details>
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
                <dd>
                  {active.review.capDisplay.replace(
                    /(\s)(\S+)$/u,
                    (_match, space: string, symbol: string) =>
                      `${space}${formatAssetSymbol(symbol)}`,
                  )}
                </dd>
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
                  onChange={(e) => {
                    action.current += 1;
                    setRecoveryHash(e.target.value);
                    setProvisional(null);
                  }}
                />
              </label>
              <button
                className="button"
                type="button"
                disabled={busy || fundingBusy}
                onClick={() => void register()}
              >
                Check vault registration
              </button>
              {pending && !pending.hash ? (
                <UnsentTransactionRecovery
                  disabled={busy}
                  onClear={() =>
                    void run(async (current) => {
                      if (!clear(pending, current))
                        throw new Error(
                          "The saved vault request changed. Reload before continuing.",
                        );
                      setReview(null);
                      setRecoveryHash("");
                      setNotice(
                        "Local request cleared. Review again before sending.",
                      );
                    })
                  }
                />
              ) : null}
            </>
          ) : null}
          {!pending ? (
            <button
              type="button"
              className="button secondary-button"
              disabled={busy}
              onClick={() => {
                action.current += 1;
                setReview(null);
              }}
            >
              Change review
            </button>
          ) : null}
          {pending?.hash &&
          provisional &&
          provisional.deploymentTransaction.toLowerCase() ===
            pending.hash.toLowerCase() ? (
            <VaultActions
              key={`${provisional.network}:${provisional.vault}`}
              projectId={project.id}
              deployment={provisional}
              connectedWallet={
                wallet && sameWallet(wallet.address, provisional.owner)
                  ? wallet
                  : undefined
              }
              provisional
              onWallet={(connection) => {
                fundingWallet.current = connection;
              }}
              onBusy={(running) => {
                // A registration answer still in flight must not switch the
                // page under a wallet prompt; the next check asks again.
                if (running) action.current += 1;
                setFundingBusy(running);
              }}
              onFinalized={() => {
                // A final deposit means the creation before it is final too:
                // ask for registration soon instead of at the next timer.
                setAskSoon(pending.hash);
                setAutoRegister((state) => ({
                  ...state,
                  attempts: 0,
                  errors: 0,
                  ticks: state.ticks + 1,
                }));
              }}
            />
          ) : null}
        </>
      ) : null}
      {!pending ? (
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={() => {
            action.current += 1;
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
