import { ExternalLink, Wallet as WalletIcon, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { browserDeployment } from "./lib/browser-deployment";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import {
  chainFamily,
  ESCROW_CHAINS,
  ESCROW_NETWORKS,
  type EscrowChain,
} from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
  formatBaseUnits,
  isAssetDecimals,
  isBaseUnits,
  PAYMENT_DELIVERY_STATES,
  type PaymentChain,
  type PaymentsAccount,
  transactionUrl,
  UNRESERVED_AWARD_STATES,
} from "./lib/payments/contracts";
import { apiRequest } from "./lib/project-api";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { isDirectTransfer } from "./lib/use-direct-transfers";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { PayoutConsent } from "./PayoutConsent";
import { formatCycleMonth, formatDate } from "./Presentation";
import { ReferralClaims } from "./ReferralClaims";

function chainDefaultNetwork(chain: EscrowChain): string {
  return (
    Object.entries(ESCROW_NETWORKS).find(
      ([, n]) => n.chain === chain && !n.testnet,
    )?.[0] ?? ""
  );
}

/** Direct transfers are imported only from reviewed USDC disclosures (6 decimals). */
function usdcAmount(value: string): string {
  return `${formatBaseUnits(value, 6)} USDC`;
}

class SignedOutError extends Error {}

async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await apiRequest(`payments/${path}`, {
    body,
    signal,
    timeoutMs: 30_000,
  });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "Your wallet changed. Refresh and confirm the current address.",
      );
    throw new Error("Payments could not load. Retry.");
  }
  return readBoundedJson(response, 1_048_576, "payment account");
}

function account(value: unknown): PaymentsAccount {
  if (!value || typeof value !== "object")
    throw new Error("Invalid payment account response.");
  const data = value as PaymentsAccount;
  const asset = (v: { assetAddress?: unknown; assetDecimals?: unknown }) =>
    typeof v.assetAddress === "string" &&
    /^[0-9A-Za-z]{32,44}$/.test(v.assetAddress) &&
    isAssetDecimals(v.assetDecimals);
  if (
    typeof data.githubUserId !== "string" ||
    !/^\d+$/.test(data.githubUserId) ||
    !Array.isArray(data.wallets) ||
    !Array.isArray(data.payments) ||
    !Array.isArray(data.balances) ||
    data.wallets.some(
      (w) =>
        !w ||
        !ESCROW_CHAINS.includes(w.chain) ||
        typeof w.claimId !== "string" ||
        typeof w.address !== "string" ||
        typeof w.authorized !== "boolean",
    ) ||
    data.payments.some(
      (p) =>
        !p ||
        !ESCROW_CHAINS.includes(p.chain) ||
        typeof p.projectId !== "string" ||
        typeof p.network !== "string" ||
        (p.transactionId !== null && typeof p.transactionId !== "string") ||
        (p.state === "paid" && !p.transactionId) ||
        typeof p.id !== "string" ||
        typeof p.vault !== "string" ||
        !asset(p) ||
        !isBaseUnits(p.grossBase) ||
        !isBaseUnits(p.netBase) ||
        !isBaseUnits(p.feeBase) ||
        BigInt(p.grossBase) !== BigInt(p.netBase) + BigInt(p.feeBase) ||
        !["reserved", "paid"].includes(p.state) ||
        !PAYMENT_DELIVERY_STATES.includes(p.deliveryState),
    ) ||
    !Array.isArray(data.monthlyAwards) ||
    data.monthlyAwards.some(
      (m) =>
        !m ||
        !ESCROW_CHAINS.includes(m.chain) ||
        typeof m.projectId !== "string" ||
        typeof m.network !== "string" ||
        !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(m.period) ||
        !asset(m) ||
        !isBaseUnits(m.grossBase) ||
        !isBaseUnits(m.netBase) ||
        !isBaseUnits(m.feeBase) ||
        BigInt(m.grossBase) !== BigInt(m.netBase) + BigInt(m.feeBase) ||
        !UNRESERVED_AWARD_STATES.includes(m.state),
    ) ||
    data.balances.some(
      (b) =>
        !b ||
        !ESCROW_CHAINS.includes(b.chain) ||
        typeof b.network !== "string" ||
        (Object.hasOwn(ESCROW_NETWORKS, b.network) &&
          ESCROW_NETWORKS[b.network as keyof typeof ESCROW_NETWORKS].chain !==
            b.chain) ||
        !asset(b) ||
        !isBaseUnits(b.netBase),
    ) ||
    !Array.isArray(data.directTransfers) ||
    !data.directTransfers.every(isDirectTransfer) ||
    !Array.isArray(data.walletObservations) ||
    data.walletObservations.some(
      (o) =>
        !o ||
        !ESCROW_CHAINS.includes(o.chain) ||
        typeof o.address !== "string" ||
        o.proofLevel !== "profile_readme" ||
        !/^https:\/\/github\.com\//u.test(o.sourceUrl) ||
        Number.isNaN(Date.parse(o.observedAt)),
    )
  )
    throw new Error("The payment record could not be verified. Please retry.");
  return data;
}

export function EarningsPage({
  walletsOnly = false,
}: {
  walletsOnly?: boolean;
} = {}) {
  const wallets = usePayoutWallets();
  const [picker, setPicker] = useState<PaymentChain | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PaymentsAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<PaymentChain | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    chain: PaymentChain;
    saved: string;
    address: string;
    sign(message: string): Promise<string>;
  } | null>(null);
  const changeHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<PaymentChain | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  const mounted = useRef(true);
  const heading = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a user refresh must reload the account.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request("me", undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSignedOut(false);
          setData(account(value));
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof SignedOutError) {
          setSignedOut(true);
          setData(null);
        } else setError(errorMessage(e, "Could not load your payouts."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (pendingChange) changeHeading.current?.focus();
    else if (returnFocus.current) {
      document.getElementById(`${heading}-${returnFocus.current}`)?.focus();
      returnFocus.current = null;
    }
  }, [pendingChange, heading]);

  useEffect(() => {
    if (picker) dialog.current?.showModal();
    else dialog.current?.close();
  }, [picker]);

  async function walletStep(chain: PaymentChain, step: () => Promise<void>) {
    setBusy(chain);
    setError("");
    setMessage("");
    try {
      await step();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof SignedOutError) {
        setSignedOut(true);
        setData(null);
      } else
        setError(errorMessage(e, "Wallet confirmation failed. Please retry."));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function register(
    chain: PaymentChain,
    address: string,
    sign: (message: string) => Promise<string>,
  ) {
    const claim = (await request("wallets/register", { chain, address })) as {
      claimId: string;
    };
    if (typeof claim.claimId !== "string")
      throw new Error("Wallet registration could not be verified.");
    const challenge = (await request("wallets/challenge", {
      claimId: claim.claimId,
    })) as {
      challengeId: string;
      message: string;
      address: string;
      chain: string;
    };
    if (
      challenge.address !== address ||
      challenge.chain !== chain ||
      typeof challenge.challengeId !== "string" ||
      typeof challenge.message !== "string"
    )
      throw new Error(
        "Wallet confirmation does not match your selected address.",
      );
    const signature = await sign(challenge.message);
    await request("wallets/authorize", {
      claimId: claim.claimId,
      challengeId: challenge.challengeId,
      signature,
    });
    if (mounted.current) {
      setMessage(
        `${NETWORK_NAMES[chain]} wallet confirmed. Eligible unpaid awards are sent automatically.`,
      );
      refresh();
    }
  }

  function connect(chosen: PayoutWallet, chain: PaymentChain) {
    setPicker(null);
    setPendingChange(null);
    const saved = data?.wallets.find((w) => w.chain === chain);
    void walletStep(chain, async () => {
      const { address, sign } = await chosen.connect({
        chooseAccount: saved?.authorized === true,
      });
      // The wallet decides which account it returns. A different address
      // from the saved one is a change, so it needs the same public-record
      // consent as Account Wallets before anything is registered (WAL-02).
      if (saved && saved.address !== address) {
        if (mounted.current)
          setPendingChange({ chain, saved: saved.address, address, sign });
        return;
      }
      await register(chain, address, sign);
    });
  }

  function confirmChange() {
    if (!pendingChange) return;
    const { chain, address, sign } = pendingChange;
    setPendingChange(null);
    void walletStep(chain, () => register(chain, address, sign));
  }

  function keepSaved() {
    if (!pendingChange) return;
    returnFocus.current = pendingChange.chain;
    setPendingChange(null);
    setMessage(
      `Kept your saved ${NETWORK_NAMES[pendingChange.chain]} address. Nothing was registered.`,
    );
  }

  const walletDetailChains = ESCROW_CHAINS.filter(
    (chain) =>
      data &&
      (data.wallets.some((wallet) => wallet.chain === chain) ||
        data.balances.some(
          (balance) => balance.chain === chain && balance.netBase !== "0",
        ) ||
        data.walletObservations.some(
          (observation) => observation.chain === chain,
        )),
  );
  const Root = walletsOnly ? "section" : "main";
  return (
    <Root
      className={
        walletsOnly ? "earnings-page" : "shell route-main earnings-page"
      }
      aria-labelledby={heading}
      id={walletsOnly ? "wallets" : undefined}
    >
      {walletsOnly ? (
        <h2 id={heading}>Wallets</h2>
      ) : (
        <h1 id={heading}>Your payouts</h1>
      )}
      {walletsOnly ? (
        <p>Confirm a wallet to receive payouts.</p>
      ) : (
        <p>
          <a href="/account#wallets">Manage payout wallets</a>
        </p>
      )}
      <dialog
        ref={dialog}
        className="wallet-picker"
        aria-labelledby={`${heading}-wallet-picker`}
        onCancel={() => setPicker(null)}
        onClose={() => setPicker(null)}
      >
        <div className="wallet-picker-header">
          <h2 id={`${heading}-wallet-picker`}>
            Connect a {picker ? NETWORK_NAMES[picker] : ""} wallet
          </h2>
          <button
            type="button"
            className="button ghost-button icon-button wallet-picker-close"
            aria-label="Close wallet picker"
            onClick={() => setPicker(null)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="wallet-picker-list">
          {wallets
            .filter((wallet) => picker && wallet.family === chainFamily(picker))
            .map((wallet) => (
              <button
                type="button"
                key={wallet.id}
                className="wallet-picker-row"
                onClick={() => picker && void connect(wallet, picker)}
              >
                {wallet.icon ? (
                  <img src={wallet.icon} width={32} height={32} alt="" />
                ) : (
                  <WalletIcon size={24} aria-hidden="true" />
                )}
                <span>{wallet.name}</span>
                <small>Detected</small>
              </button>
            ))}
          {!wallets.some(
            (wallet) => picker && wallet.family === chainFamily(picker),
          ) && (
            <>
              <p>No wallet found. Install one, then reload.</p>
              <a
                className="wallet-picker-row"
                href="https://metamask.io/download"
                target="_blank"
                rel="noopener noreferrer"
              >
                <WalletIcon size={24} aria-hidden="true" />
                <span>MetaMask</span>
                <small>
                  Install <ExternalLink size={16} aria-hidden="true" />
                </small>
              </a>
              <a
                className="wallet-picker-row"
                href="https://phantom.com/download"
                target="_blank"
                rel="noopener noreferrer"
              >
                <WalletIcon size={24} aria-hidden="true" />
                <span>Phantom</span>
                <small>
                  Install <ExternalLink size={16} aria-hidden="true" />
                </small>
              </a>
            </>
          )}
        </div>
      </dialog>
      {loading && <p role="status">Checking your payouts…</p>}
      {signedOut && !loading && (
        <div>
          <a
            className="button"
            href={
              walletsOnly
                ? "/login?next=%2Faccount%23wallets"
                : "/login?next=earnings"
            }
          >
            Sign in with GitHub
          </a>
        </div>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={refresh}
          >
            Retry
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <>
          {error && <p>Showing the last verified data.</p>}
          {!walletsOnly && <ReferralClaims />}
          {walletsOnly ? (
            <>
              {walletDetailChains.length < ESCROW_CHAINS.length ? (
                <fieldset className="admin-fieldset">
                  <legend>Add a payout wallet</legend>
                  <div className="handoff-actions">
                    {ESCROW_CHAINS.filter(
                      (chain) => !walletDetailChains.includes(chain),
                    ).map((chain) => (
                      <button
                        key={chain}
                        id={`${heading}-${chain}`}
                        className="button secondary-button"
                        type="button"
                        disabled={busy !== null || pendingChange !== null}
                        onClick={() => setPicker(chain)}
                      >
                        Connect {NETWORK_NAMES[chain]} wallet
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <section aria-label="Payout wallets" className="earnings-wallets">
                {walletDetailChains.map((chain) => {
                  const wallet = data.wallets.find((w) => w.chain === chain);
                  // Each network and asset keeps its own balance; never summed.
                  const unpaid = data.balances.filter(
                    (b) => b.chain === chain && b.netBase !== "0",
                  );
                  const defaultNetwork = chainDefaultNetwork(chain);
                  return (
                    <article key={chain} className="funding-workbench">
                      <h2>{NETWORK_NAMES[chain]}</h2>
                      {unpaid.length === 0 ? (
                        <p>No unpaid awards</p>
                      ) : (
                        unpaid.map((b) => (
                          <p key={`${b.network}:${b.assetAddress}`}>
                            <strong>{formatAssetAmount(b.netBase, b)}</strong>{" "}
                            unpaid
                            {b.network === defaultNetwork
                              ? ""
                              : ` on ${networkLabel(b.network)}`}
                          </p>
                        ))
                      )}
                      {wallet ? (
                        <p>
                          <span className="wallet-address">
                            {wallet.address}
                          </span>{" "}
                          <a
                            href={`${browserDeployment.api}/api/v1/wallet-claims/${encodeURIComponent(wallet.claimId)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View public record
                          </a>
                        </p>
                      ) : null}
                      {!wallet?.authorized &&
                        data.walletObservations
                          .filter(
                            (o) =>
                              o.chain === chain &&
                              o.address !== wallet?.address,
                          )
                          .slice(0, 1)
                          .map((o) => (
                            <p key={o.sourceUrl}>
                              Your{" "}
                              <a
                                href={o.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                GitHub profile README
                              </a>{" "}
                              listed{" "}
                              <span className="wallet-address">
                                {o.address}
                              </span>{" "}
                              on {formatDate(o.observedAt)}.
                            </p>
                          ))}
                      {wallet && (
                        <p>
                          {wallet.authorized ? "Confirmed" : "Not confirmed"}
                        </p>
                      )}
                      <button
                        id={`${heading}-${chain}`}
                        className="button secondary-button"
                        type="button"
                        disabled={busy !== null || pendingChange !== null}
                        onClick={() => setPicker(chain)}
                      >
                        {busy === chain
                          ? "Confirm in your wallet…"
                          : `${wallet?.authorized ? "Change" : "Connect"} ${NETWORK_NAMES[chain]} wallet`}
                      </button>
                      {pendingChange?.chain === chain && (
                        <section
                          className="wallet-confirmation"
                          aria-labelledby={`${heading}-${chain}-change`}
                        >
                          <h3
                            id={`${heading}-${chain}-change`}
                            className="wallet-heading"
                            ref={changeHeading}
                            tabIndex={-1}
                          >
                            Register a different {NETWORK_NAMES[chain]} address?
                          </h3>
                          <p>
                            Your wallet returned a different account. Nothing is
                            registered yet.
                          </p>
                          <dl>
                            <div>
                              <dt>Saved address</dt>
                              <dd>
                                <code className="wallet-address">
                                  {pendingChange.saved}
                                </code>
                              </dd>
                            </div>
                            <div>
                              <dt>Wallet account</dt>
                              <dd>
                                <code className="wallet-address">
                                  {pendingChange.address}
                                </code>
                              </dd>
                            </div>
                          </dl>
                          <p className="wallet-consequence">
                            <strong>
                              Your GitHub identity and this address become a
                              public, permanent record.
                            </strong>{" "}
                            The earlier address stays public.
                          </p>
                          <div className="wallet-change-actions">
                            <button
                              className="button primary-button"
                              type="button"
                              onClick={confirmChange}
                            >
                              Register wallet account
                            </button>
                            <button
                              className="button secondary-button"
                              type="button"
                              onClick={keepSaved}
                            >
                              Keep saved address
                            </button>
                          </div>
                        </section>
                      )}
                    </article>
                  );
                })}
              </section>
              <p>
                Payments publish your address on chain. Confirming a wallet
                moves no funds.
              </p>
            </>
          ) : (
            <>
              <section aria-labelledby={`${heading}-payments`}>
                <h2 id={`${heading}-payments`}>Payment history</h2>
                <button
                  className="button secondary-button"
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                >
                  Refresh payments
                </button>
                {data.payments.length === 0 &&
                data.monthlyAwards.length === 0 ? (
                  <p>No approved awards yet.</p>
                ) : (
                  <section
                    className="points-table"
                    aria-label="Payment history details; scroll horizontally for all columns"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the payment history on narrow screens.
                    tabIndex={0}
                  >
                    <table aria-labelledby={`${heading}-payments`}>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Network</th>
                          <th>Gross award</th>
                          <th>Fee</th>
                          <th>You receive</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.monthlyAwards.map((award) => (
                          <tr key={`${award.projectId}/${award.period}`}>
                            <td data-label="Project">
                              <a
                                href={`/projects/${encodeURIComponent(award.projectId)}`}
                              >
                                {award.projectId}
                              </a>{" "}
                              ({formatCycleMonth(award.period)})
                            </td>
                            <td data-label="Network">
                              {networkLabel(award.network)}
                            </td>
                            <td data-label="Gross award">
                              {formatAssetAmount(award.grossBase, award)}
                            </td>
                            <td data-label="Fee">
                              {formatAssetAmount(award.feeBase, award)}
                            </td>
                            <td data-label="You receive">
                              {formatAssetAmount(award.netBase, award)}
                            </td>
                            <td data-label="Status">
                              {award.state === "underfunded"
                                ? "Approved, underfunded"
                                : award.state === "conflict"
                                  ? "Approved, conflict: cannot be reserved"
                                  : "Approved, awaiting reservation"}
                            </td>
                          </tr>
                        ))}
                        {data.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td data-label="Project">
                              <a
                                href={`/projects/${encodeURIComponent(payment.projectId)}`}
                              >
                                {payment.projectId}
                              </a>
                            </td>
                            <td data-label="Network">
                              {networkLabel(payment.network)}
                            </td>
                            <td data-label="Gross award">
                              {formatAssetAmount(payment.grossBase, payment)}
                            </td>
                            <td data-label="Fee">
                              {formatAssetAmount(payment.feeBase, payment)}
                            </td>
                            <td data-label="You receive">
                              {formatAssetAmount(payment.netBase, payment)}
                            </td>
                            <td data-label="Status">
                              {
                                {
                                  paid: "Paid",
                                  needs_wallet: `Awaiting wallet: add or confirm your ${NETWORK_NAMES[payment.chain]} wallet`,
                                  ready: "Payment queued",
                                  submitted: "Submitted",
                                  held: "Held",
                                }[payment.deliveryState]
                              }
                              <PayoutConsent
                                key={
                                  data.wallets.find(
                                    (wallet) => wallet.chain === payment.chain,
                                  )?.claimId ?? "no-wallet"
                                }
                                payment={payment}
                                account={data}
                              />
                              {transactionUrl(
                                payment.network,
                                payment.transactionId,
                              ) && (
                                <p>
                                  <a
                                    href={
                                      transactionUrl(
                                        payment.network,
                                        payment.transactionId,
                                      ) ?? undefined
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View transaction
                                  </a>
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </section>
              {data.directTransfers.length > 0 && (
                <section aria-labelledby={`${heading}-direct`}>
                  <h2 id={`${heading}-direct`}>Direct transfers</h2>
                  <section
                    className="points-table"
                    aria-label="Direct payment details; scroll horizontally for all columns"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the payment history on narrow screens.
                    tabIndex={0}
                  >
                    <table aria-labelledby={`${heading}-direct`}>
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Month</th>
                          <th>Network</th>
                          <th>Received</th>
                          <th>Transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.directTransfers.map((t) => (
                          <tr key={`${t.network}:${t.transactionId}`}>
                            <td data-label="Project">
                              <a
                                href={`/projects/${encodeURIComponent(t.projectId)}`}
                              >
                                {t.projectId}
                              </a>
                            </td>
                            <td data-label="Month">{t.contributionMonth}</td>
                            <td data-label="Network">
                              {networkLabel(t.network)}
                            </td>
                            <td data-label="Received">
                              {usdcAmount(t.amountMicro)}
                            </td>
                            <td data-label="Transaction">
                              {transactionUrl(t.network, t.transactionId) ? (
                                <a
                                  href={
                                    transactionUrl(
                                      t.network,
                                      t.transactionId,
                                    ) ?? undefined
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View transfer
                                </a>
                              ) : (
                                t.transactionId
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </section>
              )}
            </>
          )}
        </>
      )}
    </Root>
  );
}
