import { useEffect, useRef, useState } from "react";
import type { VaultConnection } from "./lib/evm-vault-actions";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import { type PayoutWallet, usePayoutWallets } from "./lib/use-payout-wallets";
import { NoWalletFound, WalletConnection } from "./Presentation";

export type DirectEvmTransaction = {
  from: string;
  to: string;
  value: string;
  data: string;
  chainId: string;
  nonce: string;
};
type Entry = {
  transaction: DirectEvmTransaction;
  hash: string | null;
  candidate?: string;
};
type Journal = Record<string, Entry>;
const HASH = /^0x[a-f0-9]{64}$/iu;
const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const bytes = (transaction: DirectEvmTransaction) =>
  JSON.stringify(transaction);

/** Each wallet prompt is recorded before it can broadcast; unknown outcomes never retry automatically. */
export function DirectBountyPayment({
  caseId,
  generation,
  payer,
  transactions,
  cancellation = false,
  authorize,
  authorizeVerification,
  verify,
}: {
  caseId: string;
  generation: number;
  payer: string;
  transactions: DirectEvmTransaction[];
  cancellation?: boolean;
  authorize: () => Promise<void>;
  authorizeVerification?: () => Promise<void>;
  verify: (hashes: string[]) => Promise<void>;
}) {
  const [actor, setActor] = useState<string | null>(null);
  const [journal, setJournal] = useState<Journal>({});
  const [storageReady, setStorageReady] = useState(false);
  const [wallet, setWallet] = useState<VaultConnection | null>(null);
  const [recovered, setRecovered] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { busy, error, setError, run } = useAction();
  const wallets = usePayoutWallets().filter((entry) => entry.family === "evm");
  const purpose = cancellation ? "cancel" : "pay";
  const key = `slop:bounty-send:v1:${caseId}:${generation}:${purpose}:${actor ?? ""}`;
  useEffect(() => {
    let active = true;
    void currentProjectSession()
      .then((session) => {
        if (!active) return;
        if (!session)
          throw new Error("Sign in before connecting a payment wallet.");
        const storageKey = `slop:bounty-send:v1:${caseId}:${generation}:${purpose}:${session.githubId}`;
        const saved = sessionStorage.getItem(storageKey);
        const entries = saved ? (JSON.parse(saved) as Journal) : {};
        for (const [nonce, entry] of Object.entries(entries)) {
          if (
            !entry ||
            entry.transaction.nonce !== nonce ||
            !same(entry.transaction.from, payer) ||
            (entry.hash !== null && !HASH.test(entry.hash)) ||
            (entry.candidate !== undefined && !HASH.test(entry.candidate))
          )
            throw new Error(
              "The saved wallet request cannot be read. Check wallet activity before continuing.",
            );
        }
        setActor(session.githubId);
        setJournal(entries);
        setStorageReady(true);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "The saved wallet request cannot be read.",
          );
      });
    return () => {
      active = false;
    };
  }, [caseId, generation, payer, purpose, setError]);
  const remember = (entries: Journal) => {
    sessionStorage.setItem(key, JSON.stringify(entries));
    setJournal(entries);
  };
  const checkIdentity = async (verification = false) => {
    if (!mounted.current) throw new Error("The payment view was closed.");
    const current = await currentProjectSession();
    if (!actor || current?.githubId !== actor)
      throw new Error("Your account changed. Reload before making a payment.");
    await (verification && authorizeVerification
      ? authorizeVerification()
      : authorize());
    if (!mounted.current) throw new Error("The payment view was closed.");
  };
  const connect = (provider: PayoutWallet) =>
    void run(async () => {
      await checkIdentity();
      const connected = await provider.connect();
      if (!same(connected.address, payer))
        throw new Error("Connect the payer wallet shown above.");
      setWallet(connected);
    });
  const checkWallet = async (transaction: DirectEvmTransaction) => {
    if (!wallet?.evmRequest) throw new Error("Connect an EVM payment wallet.");
    const request = wallet.evmRequest;
    if (
      !same(wallet.address, transaction.from) ||
      !same(payer, transaction.from)
    )
      throw new Error("The prepared payer wallet changed.");
    let chain = await request("eth_chainId", []);
    if (
      typeof chain !== "string" ||
      BigInt(chain) !== BigInt(transaction.chainId)
    ) {
      await request("wallet_switchEthereumChain", [
        { chainId: transaction.chainId },
      ]);
      chain = await request("eth_chainId", []);
    }
    const accounts = await request("eth_accounts", []);
    if (
      typeof chain !== "string" ||
      BigInt(chain) !== BigInt(transaction.chainId) ||
      !Array.isArray(accounts) ||
      typeof accounts[0] !== "string" ||
      !same(accounts[0], payer)
    )
      throw new Error(
        "The wallet account or network changed. Reconnect before continuing.",
      );
    const pendingNonce = await request("eth_getTransactionCount", [
      payer,
      "pending",
    ]);
    if (typeof pendingNonce !== "string")
      throw new Error("The wallet nonce could not be checked. Retry.");
    if (BigInt(pendingNonce) < BigInt(transaction.nonce))
      throw new Error(
        "Complete earlier wallet transactions before this queued payment.",
      );
    if (BigInt(pendingNonce) > BigInt(transaction.nonce))
      throw new Error(
        "This nonce is pending or used. Refresh the case to verify or recover it.",
      );
    return request;
  };
  const uncertain = transactions.some(
    (transaction) => journal[transaction.nonce]?.hash === null,
  );
  const mismatched = transactions.some(
    (transaction) =>
      journal[transaction.nonce] &&
      bytes(journal[transaction.nonce].transaction) !== bytes(transaction),
  );
  const unsent = transactions.filter(
    (transaction) => !journal[transaction.nonce],
  );
  const send = () => {
    if (sending.current) return;
    sending.current = true;
    void run(async () => {
      try {
        if (!storageReady || uncertain || mismatched || !wallet) return;
        let entries = { ...journal };
        setNotice("");
        for (const transaction of unsent) {
          await checkIdentity();
          const request = await checkWallet(transaction);
          await request("eth_estimateGas", [transaction]);
          await checkIdentity();
          await checkWallet(transaction);
          entries = {
            ...entries,
            [transaction.nonce]: { transaction, hash: null },
          };
          remember(entries);
          try {
            const hash = await request("eth_sendTransaction", [transaction]);
            if (typeof hash !== "string" || !HASH.test(hash))
              throw new Error("The wallet did not return a transaction hash.");
            entries = {
              ...entries,
              [transaction.nonce]: { transaction, hash },
            };
            setJournal(entries);
            try {
              remember(entries);
            } catch {
              throw new Error(
                `Submitted ${hash}. Browser storage could not save it; keep this hash.`,
              );
            }
          } catch (cause) {
            if ((cause as { code?: unknown } | null)?.code === 4001) {
              delete entries[transaction.nonce];
              remember(entries);
              throw new Error(
                "You declined the wallet request. That transfer was not sent.",
              );
            }
            throw new Error(
              cause instanceof Error && cause.message.startsWith("Submitted ")
                ? cause.message
                : "The wallet result is uncertain. Check wallet activity and enter its hash; do not send again.",
            );
          }
        }
        setNotice(
          cancellation
            ? "Cancellation submitted. Verify it after finality."
            : "Transfers submitted. Verify them after finality.",
        );
      } finally {
        sending.current = false;
      }
    });
  };
  const hashes = transactions.flatMap((transaction) => {
    const entry = journal[transaction.nonce];
    if (!entry || bytes(entry.transaction) !== bytes(transaction)) return [];
    const hash =
      recovered[transaction.nonce]?.trim() ?? entry.candidate ?? entry.hash;
    return hash && HASH.test(hash) ? [hash] : [];
  });
  const check = () =>
    void run(async () => {
      await checkIdentity(true);
      const entries = { ...journal };
      for (const transaction of transactions) {
        const hash = recovered[transaction.nonce]?.trim();
        if (entries[transaction.nonce] && hash && HASH.test(hash))
          entries[transaction.nonce] = {
            ...entries[transaction.nonce],
            transaction,
            candidate: hash,
          };
      }
      remember(entries);
      await verify(hashes);
      setNotice("Finalized evidence verified.");
    });
  return (
    <section
      className="direct-bounty-payment"
      aria-label={
        cancellation ? "Cancel superseded transfer" : "Pay from your wallet"
      }
    >
      <WalletConnection
        address={wallet?.address ?? null}
        wallets={wallets}
        disabled={busy || !storageReady}
        legend="Payment wallet"
        empty={<NoWalletFound solana={false} />}
        onConnect={connect}
      />
      {transactions.map((transaction) => {
        const entry = journal[transaction.nonce];
        return entry ? (
          <div key={transaction.nonce}>
            <label>
              Transaction hash from your wallet
              <input
                value={
                  recovered[transaction.nonce] ??
                  entry.candidate ??
                  entry.hash ??
                  ""
                }
                onChange={(event) =>
                  setRecovered((value) => ({
                    ...value,
                    [transaction.nonce]: event.target.value,
                  }))
                }
                spellCheck={false}
              />
            </label>
          </div>
        ) : null;
      })}
      <div className="handoff-actions">
        {unsent.length > 0 ? (
          <button
            className="button primary-button"
            type="button"
            disabled={
              busy || !wallet || !storageReady || uncertain || mismatched
            }
            onClick={send}
          >
            {cancellation ? "Cancel old transfer" : "Pay remaining transfers"}
          </button>
        ) : null}
        {hashes.length > 0 ? (
          <button
            className="button secondary-button"
            type="button"
            disabled={busy || mismatched}
            onClick={check}
          >
            {cancellation ? "Verify cancellation" : "Verify submitted payments"}
          </button>
        ) : null}
      </div>
      {uncertain ? (
        <p role="status">
          Wallet result uncertain. Enter its transaction hash to continue.
        </p>
      ) : null}
      {mismatched ? (
        <p className="form-error" role="alert">
          The saved payment differs from this request. Check wallet activity
          before continuing.
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
