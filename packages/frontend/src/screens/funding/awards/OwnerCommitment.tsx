// spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Address, Alert, Button, Card, CardTitle, ExternalLink, Status, WalletChooser } from "@repo/ui";
import { ExternalLink as ExternalLinkIcon, Lock } from "lucide-react";
import { useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import { knownAssetSymbol } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { monthlyMessages } from "../../../wallets/owner/ownerMonthly.vibe";
import { useSettled } from "../vault/hooks.ts";
import { NetworkName, PendingCheck } from "../vault/index.ts";
import {
  type AwardsRuntime,
  type Checked,
  type CommitmentShown,
  type Connection,
  checkCommitment,
  clearUnreadableCommitment,
  confirmCommitmentUnsent,
  connectOwner,
  enterCommitmentHash,
  reviewCommitment,
  sendCommitment,
  unreadableCommitment,
} from "./awards.vibe";
import { useAwardAction, useAwardOffers } from "./hooks.ts";

export type OwnerCommitmentProps = {
  /** The month's owner runtime. */
  runtime: AwardsRuntime;
  /** The signed-in account's GitHub id as a number. */
  account: number;
  /** The network of the month's vault, which decides the wallet family. */
  network: string;
  /** The month's vault address. */
  vault: string;
  /** Which family of wallet signs on that network. */
  family: "evm" | "solana";
  /** The approved award chosen for reservation; absent while only a saved request is recovered. */
  githubUserId?: string;
  /** The chosen award's login. */
  login?: string;
  /** Called once the reservation is verified on the finalized chain, with that check. */
  onFinalized: (checked: Checked) => void;
};

const live = new Set(["Awaiting", "Sent", "Unclear"]);

/** @throws {never} */
function units(value: string, decimals: number): string {
  try {
    return formatBaseUnits({ value: BigInt(value), decimals });
  } catch {
    return `${value} token base units`;
  }
}

/** @throws {never} */
function short(address: string): string {
  return `${address.slice(0, address.startsWith("0x") ? 6 : 4)}…${address.slice(-4)}`;
}

function Identifier({ preview, label, value }: { preview: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{preview}</span>
      <Address value={value} label={label} copyLabel={`Copy ${label}`} />
    </div>
  );
}

/** A commitment check's outcome: still finalizing, failed, or reserved with its transaction. */
export function CommitmentResult({ network, checked }: { network: string; checked: Checked }) {
  if (checked.status === "pending") return <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Finalizing" }} />;
  if (checked.status === "failed") return <Status presentation={{ tone: "Negative", icon: "Alert", label: "Transaction failed. Not reserved." }} />;
  const link = transactionUrl(network, checked.hash);
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <Status presentation={{ tone: "Positive", icon: "Check", label: "Reserved" }} />
      {link ? (
        <ExternalLink href={link} label="View transaction" title="View transaction" className="text-primary">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
        </ExternalLink>
      ) : (
        <code className="break-all font-mono text-foreground">{checked.hash}</code>
      )}
    </p>
  );
}

/** The owner's wallet reserves one finalized award in the vault, from a request saved before the wallet is asked. */
export function OwnerCommitment({ runtime, account, network, vault, family, githubUserId, login, onFinalized }: OwnerCommitmentProps) {
  const monthly = useMonthly(runtime);
  const offers = useAwardOffers(runtime);
  const { busy, error, act } = useAwardAction(runtime);
  const [wallet, setWallet] = useState<Connection>();
  const [review, setReview] = useState<CommitmentShown>();
  const [result, setResult] = useState<Checked>();
  const [cleared, setCleared] = useState(0);
  const cardAct: typeof act = (work, then) => {
    setResult(undefined);
    return act(work, then);
  };
  const unreadable = useSettled(runtime, `unreadable-commitment:${cleared}`, () => unreadableCommitment());
  const state = monthly.state;
  if (state === undefined) return null;
  const flow = state.commitment;
  const pending = live.has(flow.phase) && flow.slotOwner === account;
  const slotUnreadable = unreadable.status === "done" && unreadable.value;
  if (!pending && githubUserId === undefined && !slotUnreadable) return null;
  const hash = flow.slot.hash || flow.slot.candidate;
  const solana = family === "solana";
  const shownLogin = review?.login ?? login;
  const checked = (outcome: Checked) => {
    setResult(outcome);
    if (outcome.status === "finalized") {
      setReview(undefined);
      onFinalized(outcome);
    }
  };
  return (
    <Card className="flex flex-col gap-4" aria-label="Authorize award commitment">
      <CardTitle className="flex items-center gap-2">
        Reserve{shownLogin ? ` · ${shownLogin}` : ""} <NetworkName network={network} />
      </CardTitle>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {result ? <CommitmentResult network={network} checked={result} /> : null}
      {slotUnreadable ? (
        <>
          <Alert variant="destructive">{monthlyMessages.unreadable}</Alert>
          <Button variant="secondary" className="self-start" disabled={busy} onClick={() => cardAct(clearUnreadableCommitment(), () => setCleared((count) => count + 1))}>
            Checked wallet activity · clear saved record
          </Button>
        </>
      ) : null}
      <WalletChooser
        legend="Owner wallet"
        family={family}
        address={wallet?.address}
        disabled={busy || slotUnreadable}
        wallets={offers.filter((offer) => offer.family === family).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
        onConnect={(offer) =>
          cardAct(connectOwner(Number(offer.id)), (connection) => {
            setWallet(connection);
            setReview(undefined);
          })
        }
      />
      {pending ? (
        <PendingCheck
          action="Commitment"
          status="Pending · don't resend"
          hash={hash}
          solana={solana}
          explorerUrl={transactionUrl(network, hash || undefined)}
          canCheck={wallet !== undefined}
          busy={busy}
          onCheck={() => wallet && cardAct(checkCommitment(wallet), checked)}
          onEnterHash={hash === "" ? (candidate) => wallet && cardAct(enterCommitmentHash(wallet, candidate), checked) : undefined}
          onConfirmUnsent={flow.phase === "Unclear" ? () => cardAct(confirmCommitmentUnsent(), () => setReview(undefined)) : undefined}
        />
      ) : wallet && githubUserId !== undefined && !slotUnreadable ? (
        <>
          <Button variant="secondary" className="self-start" loading={busy} onClick={() => cardAct(reviewCommitment(wallet, githubUserId), setReview)}>
            Review
          </Button>
          {review ? (
            <section aria-label="Commitment review" className="flex flex-col gap-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Gross</dt>
                <dd className="flex items-center gap-1 font-mono tabular-nums text-foreground">
                  {units(review.gross, review.decimals)}
                  <span title="Reserved funds cannot be withdrawn" className="text-muted-foreground">
                    <Lock aria-label="Reserved funds cannot be withdrawn" className="size-3.5" />
                  </span>
                </dd>
                <dt className="text-muted-foreground">Net</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.net, review.decimals)}</dd>
                <dt className="text-muted-foreground">Fee</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.fee, review.decimals)}</dd>
                <dt className="text-muted-foreground">Free</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.freeBalance, review.decimals)}</dd>
              </dl>
              <Identifier preview={knownAssetSymbol({ network, assetAddress: review.asset, assetDecimals: review.decimals }) ?? `Token ${short(review.asset)}`} label="token address" value={review.asset} />
              <Button className="self-start" loading={busy} onClick={() => cardAct(sendCommitment(wallet, review), () => setReview(undefined))}>
                Reserve in wallet
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
      {pending || review ? <Identifier preview={`Vault ${short(review?.vault ?? vault)}`} label="vault address" value={review?.vault ?? vault} /> : null}
      {wallet && !pending ? (
        <Button
          variant="ghost"
          className="self-start"
          disabled={busy}
          onClick={() => {
            setWallet(undefined);
            setReview(undefined);
          }}
        >
          Choose another wallet
        </Button>
      ) : null}
    </Card>
  );
}
