// spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Address, Alert, Button, Card, CardTitle, WalletChooser } from "@repo/ui";
import { useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { useSettled } from "../vault/hooks.ts";
import { NetworkName, PendingCheck } from "../vault/index.ts";
import {
  type AwardsRuntime,
  awardMessages,
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
  /** Which family of wallet signs on that network. */
  family: "evm" | "solana";
  /** The approved award chosen for reservation; absent while only a saved request is recovered. */
  githubUserId?: string;
  /** Called once the reservation is verified on the finalized chain. */
  onFinalized: () => void;
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

/** The owner's wallet reserves one finalized award in the vault, from a request saved before the wallet is asked. */
export function OwnerCommitment({ runtime, account, network, family, githubUserId, onFinalized }: OwnerCommitmentProps) {
  const monthly = useMonthly(runtime);
  const offers = useAwardOffers(runtime);
  const { busy, error, notice, setNotice, act } = useAwardAction(runtime);
  const [wallet, setWallet] = useState<Connection>();
  const [review, setReview] = useState<CommitmentShown>();
  const [cleared, setCleared] = useState(0);
  const unreadable = useSettled(runtime, `unreadable-commitment:${cleared}`, () => unreadableCommitment());
  const state = monthly.state;
  if (state === undefined) return null;
  const flow = state.commitment;
  const pending = live.has(flow.phase) && flow.slotOwner === account;
  const slotUnreadable = unreadable.status === "done" && unreadable.value;
  if (!pending && githubUserId === undefined && !slotUnreadable) return null;
  const hash = flow.slot.hash || flow.slot.candidate;
  const solana = family === "solana";
  const checked = (result: Checked) => {
    setNotice(result.message);
    if (result.finalized) {
      setReview(undefined);
      onFinalized();
    }
  };
  return (
    <Card className="flex flex-col gap-4" aria-label="Authorize award commitment">
      <CardTitle className="flex items-center gap-2">
        Reserve this award <NetworkName network={network} />
      </CardTitle>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {slotUnreadable ? (
        <Button variant="secondary" disabled={busy} onClick={() => act(clearUnreadableCommitment(), () => setCleared((count) => count + 1))}>
          I checked wallet activity; clear the unreadable local record
        </Button>
      ) : null}
      <WalletChooser
        legend={pending ? "Reconnect the owner wallet" : "Choose the owner wallet"}
        family={family}
        address={wallet?.address}
        disabled={busy || slotUnreadable}
        wallets={offers.filter((offer) => offer.family === family).map((offer) => ({ id: String(offer.id), name: offer.name }))}
        onConnect={(offer) =>
          act(connectOwner(Number(offer.id)), (connection) => {
            setWallet(connection);
            setReview(undefined);
          })
        }
      />
      {pending ? (
        <PendingCheck
          action="Commitment"
          hash={hash}
          solana={solana}
          explorerUrl={transactionUrl(network, hash || undefined)}
          canCheck={wallet !== undefined}
          busy={busy}
          onCheck={() => wallet && act(checkCommitment(wallet), checked)}
          onEnterHash={hash === "" ? (candidate) => wallet && act(enterCommitmentHash(wallet, candidate), checked) : undefined}
          onConfirmUnsent={
            flow.phase === "Unclear"
              ? () =>
                  act(confirmCommitmentUnsent(), () => {
                    setReview(undefined);
                    setNotice(awardMessages.cleared);
                  })
              : undefined
          }
        />
      ) : wallet && githubUserId !== undefined && !slotUnreadable ? (
        <>
          <Button variant="secondary" className="self-start" loading={busy} onClick={() => act(reviewCommitment(wallet, githubUserId), setReview)}>
            Verify award and funding
          </Button>
          {review ? (
            <section aria-label="Commitment review" className="flex flex-col gap-3">
              <h4 className="font-semibold text-foreground">{review.login}</h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Gross reserved</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.gross, review.decimals)}</dd>
                <dt className="text-muted-foreground">Contributor amount</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.net, review.decimals)}</dd>
                <dt className="text-muted-foreground">Fee (2%)</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.fee, review.decimals)}</dd>
                <dt className="text-muted-foreground">Free balance</dt>
                <dd className="font-mono tabular-nums text-foreground">{units(review.freeBalance, review.decimals)}</dd>
              </dl>
              <Address value={review.asset} label="Token" />
              <Address value={review.vault} label="Vault" />
              <p className="text-sm text-foreground">Reserved funds cannot be withdrawn.</p>
              <Button
                className="self-start"
                loading={busy}
                onClick={() =>
                  act(sendCommitment(wallet, review), (sent) => {
                    setReview(undefined);
                    setNotice(`Submitted ${sent}. Check the commitment once it is finalized.`);
                  })
                }
              >
                Authorize this award in wallet
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
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
