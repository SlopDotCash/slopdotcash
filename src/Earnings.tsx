import { useEffect, useId, useRef, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import type { PaymentChain, PaymentsAccount } from "./lib/payments/contracts";

const networkName = { base: "Base", solana: "Solana" };

const networkLabels: Record<string, string> = {
  "base-mainnet": "Base · USDC",
  "base-sepolia": "Base Sepolia · test USDC",
  "solana-mainnet": "Solana · USDC",
  "solana-devnet": "Solana Devnet · test USDC",
  "solana-testnet": "Solana Testnet · test token",
  anvil: "Local Base test · test USDC",
};
function transactionUrl(network: string, id: string | null): string | null {
  if (!id) return null;
  if (network === "base-sepolia")
    return `https://sepolia.basescan.org/tx/${encodeURIComponent(id)}`;
  if (network === "base-mainnet")
    return `https://basescan.org/tx/${encodeURIComponent(id)}`;
  if (network === "solana-mainnet")
    return `https://explorer.solana.com/tx/${encodeURIComponent(id)}`;
  if (network === "solana-devnet" || network === "solana-testnet")
    return `https://explorer.solana.com/tx/${encodeURIComponent(id)}?cluster=${network.slice(7)}`;
  return null;
}

function amount(value: string): string {
  const number = BigInt(value);
  const fraction = (number % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${(number / 1_000_000n).toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
}

async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/payments/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (response.status === 401)
    throw new Error("Sign in with GitHub to view your earnings.");
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "Your wallet changed. Refresh and confirm the current address.",
      );
    throw new Error(
      "The payment service is unavailable. Your recorded awards are unchanged. Please retry.",
    );
  }
  return readBoundedJson(response, 1_048_576, "payment account");
}

function account(value: unknown): PaymentsAccount {
  if (!value || typeof value !== "object")
    throw new Error("Invalid payment account response.");
  const data = value as PaymentsAccount;
  const money = (v: unknown) =>
    typeof v === "string" && /^(0|[1-9]\d*)$/.test(v);
  if (
    typeof data.githubUserId !== "string" ||
    !/^\d+$/.test(data.githubUserId) ||
    !Array.isArray(data.wallets) ||
    !Array.isArray(data.payments) ||
    !Array.isArray(data.balances) ||
    data.wallets.some(
      (w) =>
        !w ||
        !["base", "solana"].includes(w.chain) ||
        typeof w.claimId !== "string" ||
        typeof w.address !== "string" ||
        typeof w.authorized !== "boolean",
    ) ||
    data.payments.some(
      (p) =>
        !p ||
        !["base", "solana"].includes(p.chain) ||
        typeof p.projectId !== "string" ||
        typeof p.network !== "string" ||
        (p.transactionId !== null && typeof p.transactionId !== "string") ||
        (p.state === "paid" && !p.transactionId) ||
        typeof p.id !== "string" ||
        !money(p.grossMicro) ||
        !money(p.netMicro) ||
        !money(p.feeMicro) ||
        BigInt(p.grossMicro) !== BigInt(p.netMicro) + BigInt(p.feeMicro) ||
        !["reserved", "paid"].includes(p.state) ||
        ![
          "needs_wallet",
          "awaiting_binding",
          "submitted",
          "held",
          "paid",
        ].includes(p.deliveryState),
    ) ||
    data.balances.some(
      (b) => !b || !["base", "solana"].includes(b.chain) || !money(b.netMicro),
    )
  )
    throw new Error("The payment record could not be verified. Please retry.");
  return data;
}

type EthereumWallet = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};
type SolanaWallet = {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(
    message: Uint8Array,
    display: "utf8",
  ): Promise<{ signature: Uint8Array }>;
};
type WalletWindow = Window & {
  ethereum?: EthereumWallet;
  solana?: SolanaWallet;
  phantom?: { solana?: SolanaWallet };
};

export function EarningsPage() {
  const [data, setData] = useState<PaymentsAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<PaymentChain | null>(null);
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
        if (!controller.signal.aborted) setData(account(value));
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load your earnings.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  async function connect(chain: PaymentChain) {
    setBusy(chain);
    setError("");
    setMessage("");
    try {
      const provider = window as WalletWindow;
      let address: string;
      let sign: (message: string) => Promise<string>;
      if (chain === "base") {
        const wallet = provider.ethereum;
        if (!wallet)
          throw new Error(
            "Open this page in your Base wallet’s browser or enable its browser extension.",
          );
        const addresses = await wallet.request({
          method: "eth_requestAccounts",
        });
        if (!Array.isArray(addresses) || typeof addresses[0] !== "string")
          throw new Error("Your wallet did not return a Base address.");
        address = addresses[0].toLowerCase();
        sign = async (text) => {
          const hex = `0x${Array.from(new TextEncoder().encode(text), (n) => n.toString(16).padStart(2, "0")).join("")}`;
          const signature = await wallet.request({
            method: "personal_sign",
            params: [hex, address],
          });
          if (typeof signature !== "string")
            throw new Error("Your wallet did not return a signature.");
          return signature;
        };
      } else {
        const wallet = provider.phantom?.solana ?? provider.solana;
        if (!wallet)
          throw new Error(
            "Open this page in your Solana wallet’s browser or enable its browser extension.",
          );
        address = (await wallet.connect()).publicKey.toString();
        sign = async (text) => {
          const result = await wallet.signMessage(
            new TextEncoder().encode(text),
            "utf8",
          );
          return btoa(String.fromCharCode(...result.signature));
        };
      }
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
          `${networkName[chain]} wallet confirmed. Eligible unpaid awards will be sent automatically. Wallet changes wait at least 24 hours and any earlier payment must be reconciled first.`,
        );
        refresh();
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Wallet confirmation failed. Please retry.",
        );
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <main className="shell route-main earnings-page" aria-labelledby={heading}>
      <h1 id={heading}>Your earnings</h1>
      <p>Contributor amounts include the 2% payout fee deduction.</p>
      {loading && <p role="status">Checking your earnings…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <a href="/login?next=earnings">Log in with GitHub</a>{" "}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <>
          {error && <p>Showing the last verified account response.</p>}
          <section aria-label="Payout wallets" className="earnings-wallets">
            {(["base", "solana"] as const).map((chain) => {
              const wallet = data.wallets.find((w) => w.chain === chain);
              const balance =
                data.balances.find((b) => b.chain === chain)?.netMicro ?? "0";
              return (
                <article key={chain} className="funding-workbench">
                  <h2>{networkName[chain]}</h2>
                  <p>
                    <strong>{amount(balance)}</strong> unpaid
                  </p>
                  {wallet ? (
                    <p className="wallet-address">{wallet.address}</p>
                  ) : (
                    <p>
                      Add a {networkName[chain]} wallet to receive awards on
                      this network.
                    </p>
                  )}
                  {wallet && (
                    <p>
                      {wallet.authorized
                        ? "Confirmed for automatic payments"
                        : "Confirm this wallet to enable automatic payments"}
                    </p>
                  )}
                  {wallet?.activationEligibleAt &&
                    Date.parse(wallet.activationEligibleAt) > Date.now() && (
                      <p>
                        Wallet change becomes eligible after{" "}
                        {new Date(wallet.activationEligibleAt).toLocaleString()}
                        . Existing awards remain reserved.
                      </p>
                    )}
                  <button
                    className="button secondary-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void connect(chain)}
                  >
                    {busy === chain
                      ? "Confirm in your wallet…"
                      : `${wallet?.authorized ? "Change" : "Connect"} ${networkName[chain]} wallet`}
                  </button>
                </article>
              );
            })}
          </section>
          <p>
            Payments publish your destination on chain. Wallet confirmation
            authorizes that address to receive your awards; it does not transfer
            funds from your wallet.
          </p>
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
            {data.payments.length === 0 ? (
              <p>
                No funded awards yet. Proposed rewards appear on project pages
                until they are approved and funded.
              </p>
            ) : (
              <section
                className="points-table"
                aria-label="Payment history details; scroll horizontally for all columns"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the payment history on narrow screens.
                tabIndex={0}
              >
                <table>
                  <caption>
                    Approved, funded awards and verified payments
                  </caption>
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
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <a
                            href={`/projects/${encodeURIComponent(payment.projectId)}`}
                          >
                            {payment.projectId}
                          </a>
                        </td>
                        <td>
                          {networkLabels[payment.network] ?? payment.network}
                        </td>
                        <td>{amount(payment.grossMicro)}</td>
                        <td>{amount(payment.feeMicro)}</td>
                        <td>{amount(payment.netMicro)}</td>
                        <td>
                          {
                            {
                              paid: "Paid — verified on chain",
                              needs_wallet: `Add or confirm ${networkName[payment.chain]} wallet`,
                              awaiting_binding: "Awaiting automatic payment",
                              submitted:
                                "Submitted — waiting for chain verification",
                              held: "Payment held — funds remain reserved",
                            }[payment.deliveryState]
                          }
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
                                View verified transaction
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
        </>
      )}
    </main>
  );
}
