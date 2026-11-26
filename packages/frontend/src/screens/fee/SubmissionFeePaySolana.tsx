// spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"
import { reclaimDays } from "@repo/backend/client";
import { Address, Alert, Button, ExternalLink, Field, Input, WalletChooser } from "@repo/ui";
import { useState } from "react";
import { useAction } from "../../app/hooks.ts";
import { networkLabel } from "../../kernels/assetText.ts";
import { transactionUrl } from "../../kernels/explorers.ts";
import { formatTokenUnits } from "../../kernels/standingDepositItem.ts";
import { connectSolana, type SolanaConnection } from "../../wallets/core/solana.vibe";
import { amountText } from "../../wallets/fee/feeCalls.ts";
import {
  checkSolanaFee,
  checkSolanaReclaim,
  reviewSolanaFee,
  reviewSolanaReclaim,
  sendSolanaFee,
  sendSolanaReclaim,
  type SolanaFeePlan,
  type SolanaFeeStatus,
  type SolanaFeeSubject,
  type SolanaFeeWay,
  type SolanaReclaimPlan,
} from "../../wallets/fee/solanaDeposit.vibe";
import { useView } from "../account/useView.ts";
import { type FeeRuntime, watchOffers } from "./runtime.vibe";

const lamportsText = (lamports: string) => `${formatTokenUnits(lamports, 9)} SOL`;

export interface SubmissionFeePaySolanaProps {
  readonly runtime: FeeRuntime;
  readonly subject: SolanaFeeSubject;
  readonly way: SolanaFeeWay | null;
  readonly reclaim: SolanaFeeWay | null;
  readonly defaultDepositAddress?: string;
  readonly onDeposit: () => void;
}

export function SubmissionFeePaySolana({ runtime, subject, way, reclaim, defaultDepositAddress = "", onDeposit }: SubmissionFeePaySolanaProps) {
  const offers = useView(runtime, watchOffers) ?? [];
  const solanaOffers = offers.filter((offer) => offer.family === "solana");
  const { busy, error, notice, setNotice, act } = useAction(runtime);
  const [connection, setConnection] = useState<SolanaConnection | null>(null);
  const [feePlan, setFeePlan] = useState<SolanaFeePlan | null>(null);
  const [reclaimDeposit, setReclaimDeposit] = useState(defaultDepositAddress);
  const [reclaimPlan, setReclaimPlan] = useState<SolanaReclaimPlan | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [status, setStatus] = useState<SolanaFeeStatus | null>(null);

  const activeWay = way ?? reclaim;
  if (activeWay === null) return null;

  const isReclaim = way === null && reclaim !== null;

  const connect = (id: number) =>
    void act(connectSolana(id), (connected) => {
      setConnection(connected);
      setFeePlan(null);
      setReclaimPlan(null);
      setStatus(null);
    });

  const reviewPay = () => {
    if (connection === null || way === null) return;
    void act(reviewSolanaFee(subject, way, connection.address), (plan) => {
      setFeePlan(plan);
      setSignature(null);
      setStatus(null);
    });
  };

  const sendPay = () => {
    if (connection === null || feePlan === null) return;
    void act(sendSolanaFee(connection, feePlan), (sig) => {
      setSignature(sig);
      setStatus("pending");
      setNotice("Deposit transaction sent. Check its finality below.");
    });
  };

  const checkPay = () => {
    if (connection === null || way === null || feePlan === null) return;
    void act(checkSolanaFee(subject, way, connection.address, feePlan.nonce, signature), (next) => {
      setStatus(next);
      if (next === "finalized") {
        setNotice("Your Solana deposit is final on chain.");
        onDeposit();
      } else if (next === "failed") {
        setNotice("The transaction failed on chain. Review and try again.");
      } else {
        setNotice("Still confirming on Solana.");
      }
    });
  };

  const reviewReclaim = () => {
    if (connection === null || reclaim === null || reclaimDeposit.trim() === "") return;
    void act(reviewSolanaReclaim(subject, reclaim, connection.address, reclaimDeposit.trim()), (plan) => {
      setReclaimPlan(plan);
      setSignature(null);
      setStatus(null);
    });
  };

  const sendReclaim = () => {
    if (connection === null || reclaimPlan === null) return;
    void act(sendSolanaReclaim(connection, reclaimPlan), (sig) => {
      setSignature(sig);
      setStatus("pending");
      setNotice("Reclaim transaction sent. Check its finality below.");
    });
  };

  const checkReclaim = () => {
    if (connection === null || reclaim === null || reclaimPlan === null) return;
    void act(checkSolanaReclaim(subject, reclaim, connection.address, reclaimPlan.deposit, signature), (next) => {
      setStatus(next);
      if (next === "finalized") {
        setNotice("Your Solana deposit was returned to your wallet.");
        onDeposit();
      } else if (next === "failed") {
        setNotice("The reclaim transaction failed on chain.");
      } else {
        setNotice("Still confirming on Solana.");
      }
    });
  };

  const explorerHref = signature ? transactionUrl(activeWay.network, signature) : undefined;

  return (
    <section aria-label={isReclaim ? "Take back a Solana deposit" : "Pay on Solana"} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold text-foreground">{isReclaim ? "Take back a Solana deposit" : "Pay from a Solana wallet"}</h2>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {notice ? <p role="status" className="text-sm text-foreground">{notice}</p> : null}
        <WalletChooser
          legend="Choose a Solana wallet"
          wallets={solanaOffers.map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
          address={connection?.address}
          disabled={busy}
          onConnect={(option) => connect(Number(option.id))}
        />
        {connection !== null && !isReclaim && way !== null ? (
          <div className="flex flex-col gap-3">
            <div>
              <Button variant="secondary" loading={busy} onClick={reviewPay}>
                Review Solana deposit ({amountText(way)} on {networkLabel(way.network)})
              </Button>
            </div>
            {feePlan !== null ? (
              <div className="flex flex-col gap-3 text-sm">
                <dl className="grid gap-2 sm:grid-cols-[max-content_1fr]">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd>{amountText(way)}</dd>
                  <dt className="text-muted-foreground">Program</dt>
                  <dd><Address value={way.programId} label="Deposit program" /></dd>
                  <dt className="text-muted-foreground">Deposit record</dt>
                  <dd>{feePlan.deposit ? <Address value={feePlan.deposit} label="Deposit record" /> : "Derived on chain"}</dd>
                  <dt className="text-muted-foreground">Estimated network fee</dt>
                  <dd>{lamportsText(feePlan.networkFeeLamports)}</dd>
                  <dt className="text-muted-foreground">Account rent (returned on settle)</dt>
                  <dd>{lamportsText(feePlan.rentLamports)}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy} disabled={signature !== null && status === "pending"} onClick={sendPay}>
                    Confirm deposit in Solana wallet
                  </Button>
                  {signature !== null ? (
                    <Button variant="outline" loading={busy} onClick={checkPay}>
                      Check finality
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {connection !== null && isReclaim && reclaim !== null ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              The wallet that paid a Solana deposit can take it back from the deposit program {reclaimDays} days after payment if nothing settled it.
            </p>
            <Field label="Solana deposit record address">
              <Input
                value={reclaimDeposit}
                onChange={(event) => setReclaimDeposit(event.currentTarget.value)}
                placeholder="Deposit record address"
                disabled={busy}
              />
            </Field>
            <div>
              <Button variant="secondary" loading={busy} disabled={reclaimDeposit.trim() === ""} onClick={reviewReclaim}>
                Review reclaim
              </Button>
            </div>
            {reclaimPlan !== null ? (
              <div className="flex flex-col gap-3 text-sm">
                <dl className="grid gap-2 sm:grid-cols-[max-content_1fr]">
                  <dt className="text-muted-foreground">Deposit record</dt>
                  <dd><Address value={reclaimPlan.deposit} label="Deposit record" /></dd>
                  <dt className="text-muted-foreground">Estimated network fee</dt>
                  <dd>{lamportsText(reclaimPlan.networkFeeLamports)}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button loading={busy} disabled={signature !== null && status === "pending"} onClick={sendReclaim}>
                    Confirm reclaim in Solana wallet
                  </Button>
                  {signature !== null ? (
                    <Button variant="outline" loading={busy} onClick={checkReclaim}>
                      Check finality
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {signature !== null ? (
          <p className="text-xs text-muted-foreground">
            Signature:{" "}
            {explorerHref ? (
              <ExternalLink href={explorerHref} className="font-mono">{signature}</ExternalLink>
            ) : (
              <code className="font-mono break-all">{signature}</code>
            )}
          </p>
        ) : null}
      </section>
  );
}
