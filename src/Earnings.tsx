import {
  Check,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  TriangleAlert,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ChainIcon } from "./ChainIcon";
import { readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_CHAINS,
  ESCROW_NETWORKS,
  type EscrowChain,
  EVM_CHAINS,
} from "./lib/escrow-policy.mjs";
import { networkLabel } from "./lib/network-names";
import {
  formatAssetAmount,
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
import { shortAddress } from "./lib/wallets";
import { PayoutConsent } from "./PayoutConsent";
import {
  AWARD_STATUS,
  NetAmount,
  PAYMENT_STATUS,
  PayoutAmount,
  PayoutRow,
  RECEIVED_STATUS,
} from "./PayoutRows";
import { formatCycleMonth } from "./Presentation";
import { ReferralClaims } from "./ReferralClaims";

function chainDefaultNetwork(chain: EscrowChain): string {
  return (
    Object.entries(ESCROW_NETWORKS).find(
      ([, n]) => n.chain === chain && !n.testnet,
    )?.[0] ?? ""
  );
}

type WalletFamily = "evm" | "solana";
/**
 * Offered when no wallet of the family is detected. Any wallet that announces
 * itself (EIP-6963 or Wallet Standard) is detected without being listed here.
 */
const WALLET_DOWNLOADS: Record<
  WalletFamily,
  readonly { name: string; href: string }[]
> = {
  evm: [
    { name: "MetaMask", href: "https://metamask.io/download" },
    { name: "Rabby", href: "https://rabby.io" },
    {
      name: "Coinbase Wallet",
      href: "https://www.coinbase.com/wallet/downloads",
    },
    { name: "Phantom", href: "https://phantom.com/download" },
  ],
  solana: [
    { name: "Phantom", href: "https://phantom.com/download" },
    { name: "Solflare", href: "https://solflare.com/download" },
  ],
};
/** One wallet covers every chain of its family; each chain is still confirmed on its own. */
const WALLET_FAMILIES: readonly {
  id: WalletFamily;
  label: string;
  article: string;
  chains: readonly PaymentChain[];
}[] = [
  { id: "solana", label: "Solana", article: "a", chains: ["solana"] },
  { id: "evm", label: "EVM", article: "an", chains: EVM_CHAINS },
];

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
  const [picker, setPicker] = useState<WalletFamily | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PaymentsAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<WalletFamily | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    family: WalletFamily;
    saved: string;
    address: string;
    sign(message: string): Promise<string>;
  } | null>(null);
  const changeHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<WalletFamily | null>(null);
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

  async function walletStep(family: WalletFamily, step: () => Promise<void>) {
    setBusy(family);
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
  }

  /** Confirms the address on each chain of the family that lacks it, one signature per chain. */
  async function registerFamily(
    family: WalletFamily,
    address: string,
    sign: (message: string) => Promise<string>,
  ) {
    const { label, chains } = familyOf(family);
    try {
      for (const chain of chains) {
        const saved = data?.wallets.find((w) => w.chain === chain);
        if (saved?.authorized && saved.address === address) continue;
        await register(chain, address, sign);
      }
    } finally {
      // A stopped confirmation can leave earlier chains confirmed.
      if (mounted.current) refresh();
    }
    if (mounted.current)
      setMessage(
        `${label} wallet confirmed. Eligible unpaid awards are sent automatically.`,
      );
  }

  const familyOf = (id: WalletFamily) =>
    WALLET_FAMILIES.find(
      (family) => family.id === id,
    ) as (typeof WALLET_FAMILIES)[number];
  const savedWallets = (id: WalletFamily) =>
    data?.wallets.filter((w) => familyOf(id).chains.includes(w.chain)) ?? [];

  function connect(chosen: PayoutWallet, family: WalletFamily) {
    setPicker(null);
    setPendingChange(null);
    const saved = savedWallets(family);
    void walletStep(family, async () => {
      const { address, sign } = await chosen.connect({
        chooseAccount: saved.some((w) => w.authorized),
      });
      // The wallet decides which account it returns. A different address
      // from a saved one is a change, so it needs the same public-record
      // consent as Account Wallets before anything is registered (WAL-02).
      const different = saved.find((w) => w.address !== address);
      if (different) {
        if (mounted.current)
          setPendingChange({
            family,
            saved: different.address,
            address,
            sign,
          });
        return;
      }
      await registerFamily(family, address, sign);
    });
  }

  function confirmChange() {
    if (!pendingChange) return;
    const { family, address, sign } = pendingChange;
    setPendingChange(null);
    void walletStep(family, () => registerFamily(family, address, sign));
  }

  function keepSaved() {
    if (!pendingChange) return;
    returnFocus.current = pendingChange.family;
    setPendingChange(null);
    setMessage(
      `Kept your saved ${familyOf(pendingChange.family).label} address. Nothing was registered.`,
    );
  }

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
      <dialog
        ref={dialog}
        className="wallet-picker"
        aria-labelledby={`${heading}-wallet-picker`}
        onCancel={() => setPicker(null)}
        onClose={() => setPicker(null)}
      >
        <div className="wallet-picker-header">
          <h2 id={`${heading}-wallet-picker`}>
            Connect{" "}
            {picker
              ? `${familyOf(picker).article} ${familyOf(picker).label}`
              : "a"}{" "}
            wallet
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
            .filter((wallet) => wallet.family === picker)
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
          {picker && !wallets.some((wallet) => wallet.family === picker) && (
            <>
              <p>No wallet found. Install one, then reload.</p>
              {WALLET_DOWNLOADS[picker].map((download) => (
                <a
                  key={download.name}
                  className="wallet-picker-row"
                  href={download.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <WalletIcon size={24} aria-hidden="true" />
                  <span>{download.name}</span>
                  <small>
                    Install <ExternalLink size={16} aria-hidden="true" />
                  </small>
                </a>
              ))}
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
            <section aria-label="Payout wallets" className="wallet-cards">
              {WALLET_FAMILIES.map((family) => {
                const rows = family.chains.map((chain) => ({
                  chain,
                  wallet: data.wallets.find((w) => w.chain === chain),
                  // Each network and asset keeps its own balance; never summed.
                  unpaid: data.balances.filter(
                    (b) => b.chain === chain && b.netBase !== "0",
                  ),
                }));
                const addresses = [
                  ...new Set(
                    rows.flatMap((r) => (r.wallet ? [r.wallet.address] : [])),
                  ),
                ];
                const confirmed =
                  addresses.length === 1 &&
                  rows.every((r) => r.wallet?.authorized);
                // Only a confirmed wallet can be changed; any other state connects.
                const changing = rows.some((r) => r.wallet?.authorized);
                const state =
                  addresses.length === 0
                    ? "empty"
                    : confirmed
                      ? "confirmed"
                      : "attention";
                const status = (ok: boolean) =>
                  ok ? (
                    <Check
                      className="wallet-ok"
                      role="img"
                      aria-label="Confirmed"
                    />
                  ) : (
                    <TriangleAlert
                      className="wallet-warn"
                      role="img"
                      aria-label="Not confirmed"
                    />
                  );
                return (
                  <article
                    key={family.id}
                    className="wallet-card"
                    data-state={state}
                    aria-label={`${family.label} wallet`}
                  >
                    <div className="wallet-card-chains">
                      {rows.map(({ chain, wallet }) => (
                        <ChainIcon
                          key={chain}
                          chain={chain}
                          status={
                            wallet
                              ? wallet.authorized && addresses.length === 1
                                ? "confirmed"
                                : "not confirmed"
                              : undefined
                          }
                        />
                      ))}
                    </div>
                    <div className="wallet-card-main">
                      <h3>{family.label}</h3>
                      {addresses.length === 1 ? (
                        <p className="wallet-card-address">
                          <span aria-hidden="true" title={addresses[0]}>
                            {shortAddress(addresses[0])}
                          </span>
                          <span className="visually-hidden">
                            {addresses[0]}
                          </span>
                          {status(confirmed)}
                        </p>
                      ) : (
                        rows.some((r) => r.wallet) && (
                          <ul className="wallet-card-rows">
                            {rows.map(({ chain, wallet }) =>
                              wallet ? (
                                <li key={chain}>
                                  <ChainIcon chain={chain} decorative />
                                  <span
                                    aria-hidden="true"
                                    title={wallet.address}
                                  >
                                    {shortAddress(wallet.address)}
                                  </span>
                                  <span className="visually-hidden">
                                    {NETWORK_NAMES[chain]} {wallet.address}
                                  </span>
                                  {status(wallet.authorized)}
                                </li>
                              ) : null,
                            )}
                          </ul>
                        )
                      )}
                      {rows.flatMap(({ chain, unpaid }) =>
                        unpaid.map((b) => (
                          <span
                            key={`${chain}:${b.network}:${b.assetAddress}`}
                            className="wallet-chip"
                            title={`Unpaid${b.network === chainDefaultNetwork(chain) ? "" : ` on ${networkLabel(b.network)}`}`}
                          >
                            <ChainIcon chain={chain} decorative />
                            <strong>{formatAssetAmount(b.netBase, b)}</strong>
                            <span className="visually-hidden">
                              unpaid on {NETWORK_NAMES[chain]}
                            </span>
                          </span>
                        )),
                      )}
                    </div>
                    <button
                      id={`${heading}-${family.id}`}
                      className="button secondary-button icon-button wallet-card-action"
                      type="button"
                      disabled={busy !== null || pendingChange !== null}
                      aria-label={
                        busy === family.id
                          ? "Confirm in your wallet…"
                          : `${changing ? "Change" : "Connect"} ${family.label} wallet`
                      }
                      onClick={() => setPicker(family.id)}
                    >
                      {busy === family.id ? (
                        <LoaderCircle
                          className="wallet-spin"
                          aria-hidden="true"
                        />
                      ) : changing ? (
                        <Pencil aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                    </button>
                    {pendingChange?.family === family.id && (
                      <section
                        className="wallet-confirmation"
                        aria-labelledby={`${heading}-${family.id}-change`}
                      >
                        <h3
                          id={`${heading}-${family.id}-change`}
                          className="wallet-heading"
                          ref={changeHeading}
                          tabIndex={-1}
                        >
                          Register a different {family.label} address?
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
          ) : (
            <>
              <section aria-labelledby={`${heading}-payments`}>
                <h2 id={`${heading}-payments`}>Payment history</h2>
                {data.payments.length === 0 &&
                data.monthlyAwards.length === 0 ? (
                  <p>No approved awards yet.</p>
                ) : (
                  <ul
                    className="payout-rows"
                    aria-labelledby={`${heading}-payments`}
                  >
                    {data.monthlyAwards.map((award) => (
                      <PayoutRow
                        key={`${award.projectId}/${award.period}`}
                        chain={award.chain}
                        network={award.network}
                        amount={<NetAmount payout={award} />}
                        note={formatCycleMonth(award.period)}
                        status={AWARD_STATUS[award.state]}
                        transactionUrl={null}
                        transactionLabel=""
                      />
                    ))}
                    {data.payments.map((payment) => (
                      <PayoutRow
                        key={payment.id}
                        chain={payment.chain}
                        network={payment.network}
                        amount={<NetAmount payout={payment} />}
                        status={PAYMENT_STATUS[payment.deliveryState]}
                        statusTitle={
                          payment.deliveryState === "needs_wallet"
                            ? `Awaiting wallet: add or confirm your ${NETWORK_NAMES[payment.chain]} wallet`
                            : undefined
                        }
                        transactionUrl={transactionUrl(
                          payment.network,
                          payment.transactionId,
                        )}
                        transactionLabel="View transaction"
                      >
                        <PayoutConsent
                          key={
                            data.wallets.find(
                              (wallet) => wallet.chain === payment.chain,
                            )?.claimId ?? "no-wallet"
                          }
                          payment={payment}
                          account={data}
                        />
                      </PayoutRow>
                    ))}
                  </ul>
                )}
              </section>
              {data.directTransfers.length > 0 && (
                <section aria-labelledby={`${heading}-direct`}>
                  <h2 id={`${heading}-direct`}>Direct transfers</h2>
                  <ul
                    className="payout-rows"
                    aria-labelledby={`${heading}-direct`}
                  >
                    {data.directTransfers.map((t) => {
                      const url = transactionUrl(t.network, t.transactionId);
                      return (
                        <PayoutRow
                          key={`${t.network}:${t.transactionId}`}
                          chain={t.chain}
                          network={t.network}
                          amount={
                            <PayoutAmount
                              base={t.amountMicro}
                              decimals={6}
                              symbol="USDC"
                            />
                          }
                          note={
                            url
                              ? formatCycleMonth(t.contributionMonth)
                              : `${formatCycleMonth(t.contributionMonth)} · ${t.transactionId}`
                          }
                          status={RECEIVED_STATUS}
                          transactionUrl={url}
                          transactionLabel="View transfer"
                        />
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </Root>
  );
}
