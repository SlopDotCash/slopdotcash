// spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerVault.md, "A withdrawal that would break the month's promise is refused on Slop's pages"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"; spec/frontend/batchedDeposit.md, "Capabilities that require a wallet upgrade use the separate-signature path"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending"; spec/settlement/vault.md, "Only the fixed refund destination receives free funds"; spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"; spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Address, Alert, Button, Card, CardTitle, Disclosure, Field, Input, NetworkMark, type NetworkMarkProps, RadioGroup, Status, WalletChooser } from "@repo/ui";
import { Effect } from "effect";
import { useState } from "react";
import type { Batch } from "../../../../gen/frontend__batchedDeposit.ts";
import { useMachine as useBatch } from "../../../../gen/frontend__batchedDeposit.react.ts";
import type { PoolFacts } from "../../../../gen/frontend__projections.ts";
import { useMachine as useVault } from "../../../../gen/frontend__ownerVault.react.ts";
import { formatAssetAmount, networkLabel } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { familyOf } from "../../../wallets/owner/commitments.vibe";
import {
  type ActionReview,
  type Connection,
  checkSaved,
  confirmTransferUnsent,
  connectWallet,
  enterTransferHash,
  fundingMessages,
  lookupBatch,
  observeBatch,
  type Outcome,
  recoverBatch,
  reviewAction,
  savedAction,
  sendAction,
  vaultRuntime,
  watchBatch,
  watchSaved,
  followVault,
  unreadableSaved,
  clearUnreadableSaved,
} from "./funding.vibe";
import { useAction, useSettled, useWalletOffers } from "./hooks.ts";
import { PendingCheck } from "./PendingCheck.tsx";
import type { FundingDeployment, FundingProject } from "./project.schema.ts";

export type VaultActionsProps = {
  /** The project whose vault this is. */
  project: FundingProject;
  /** The registered vault on one network. */
  deployment: FundingDeployment;
  /** The UTC month, `YYYY-MM`, whose saved owner requests belong to this page. */
  period: string;
  /** The signed-in account's GitHub id as a number, or 0 when signed out. */
  account: number;
  /** Where "Sign in with GitHub" goes, returning to this page. */
  loginHref: string;
  /** The pool's funding facts that a withdrawal must keep; a monthly pool without them offers deposits only. */
  pool?: PoolFacts;
  /** Called once a deposit or withdrawal is verified on the finalized chain. */
  onFinalized: () => void;
};

type Operation = "deposit" | "withdraw";

const live = new Set(["Awaiting", "Sent", "Unclear"]);
const batchLive = new Set<Batch["phase"]>(["IntentSaved", "WalletReference", "Uncertain", "HashKnown"]);
const marks = new Set<string>(["Base", "Base Sepolia", "Ethereum", "Ethereum Sepolia", "Robinhood Chain", "Robinhood Chain Testnet", "Solana"]);

const followed = new WeakMap<object, { readonly account: number; readonly turn: number }>();

function followKey(runtime: object, account: number): string {
  const last = followed.get(runtime);
  const current = last === undefined ? { account, turn: 0 } : last.account === account ? last : { account, turn: last.turn + 1 };
  followed.set(runtime, current);
  return `follow:${current.turn}:${account}`;
}

/** The network's mark beside its name, or its name alone where no mark exists. */
export function NetworkName({ network }: { network: string }) {
  const label = networkLabel(network);
  return marks.has(label) ? <NetworkMark network={label as NetworkMarkProps["network"]} size="sm" /> : <span>{label}</span>;
}

/** Deposits and withdrawals on one registered vault, each sent by the person's own wallet after the request is saved. */
export function VaultActions({ project, deployment, period, account, loginHref, pool, onFinalized }: VaultActionsProps) {
  const runtime = vaultRuntime(project, deployment, period);
  useSettled(runtime, followKey(runtime, account), () => followVault(account));
  const vault = useVault(runtime);
  const batch = useBatch(runtime);
  const offers = useWalletOffers(runtime);
  const { busy, error, notice, setNotice, act } = useAction(runtime);
  const [cleared, setCleared] = useState(0);
  const unreadable = useSettled(runtime, `unreadable:${cleared}`, () => unreadableSaved());
  const [wallet, setWallet] = useState<Connection>();
  const [operation, setOperation] = useState<Operation>("deposit");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<ActionReview>();
  const family = familyOf(deployment);
  const solana = family === "solana";
  const network = networkLabel(deployment.network);
  const isOwner = wallet !== undefined && wallet.address.toLowerCase() === deployment.owner.toLowerCase();
  const promiseUnread = project.reward.kind === "monthly-pool" && pool === undefined;
  const transfer = vault.state?.transfer;
  const batched = batch.state;
  const pendingTransfer = transfer !== undefined && live.has(transfer.phase) && transfer.slotOwner === account;
  const pendingBatch = batched !== undefined && batchLive.has(batched.phase) && batched.owner === account;
  const label = useSettled(runtime, `label:${transfer?.slot.identity ?? ""}:${cleared}`, () => savedAction());

  const settle = (outcome: Outcome) => {
    setNotice(outcome.message);
    if (outcome.answer === "FinalRead") onFinalized();
  };
  const watch = (connection: Connection) => {
    runtime.runFork(watchSaved(connection, (outcome) => Effect.sync(() => settle(outcome))));
  };
  const watchBatched = (connection: Connection) => {
    runtime.runFork(watchBatch(connection, (outcome) => Effect.sync(() => settle(outcome))));
  };
  const connect = (id: number) =>
    act(connectWallet(id, true), (connection) => {
      setWallet(connection);
      setReview(undefined);
      if (connection.address.toLowerCase() !== deployment.owner.toLowerCase()) setOperation("deposit");
      watch(connection);
      if (pendingBatch) watchBatched(connection);
    });

  if (family === undefined) return null;
  if (account === 0)
    return (
      <Card className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          Fund or withdraw <NetworkName network={deployment.network} />
        </CardTitle>
        <Button asChild variant="secondary">
          <a href={loginHref}>Sign in with GitHub</a>
        </Button>
      </Card>
    );

  const formatted = (value: bigint, decimals: number) => formatAssetAmount(value, { network: deployment.network, assetAddress: deployment.asset, assetDecimals: decimals });
  const hashOf = (attempt: { hash: string; candidate: string }) => attempt.hash || attempt.candidate;

  const pending = pendingBatch ? (
    <BatchPending
      batch={batched}
      network={deployment.network}
      canCheck={wallet !== undefined}
      busy={busy}
      onLookup={() => wallet && act(lookupBatch(wallet), settle)}
      onObserve={() => wallet && act(observeBatch(wallet), settle)}
      onRecover={(candidate) => wallet && act(recoverBatch(wallet, candidate, account), settle)}
    />
  ) : pendingTransfer && transfer ? (
    <PendingCheckPanel
      action={label.status === "done" ? label.value : "Transaction"}
      hash={hashOf(transfer.slot)}
      network={deployment.network}
      solana={solana}
      canCheck={wallet !== undefined}
      busy={busy}
      unclear={transfer.phase === "Unclear"}
      onCheck={() => wallet && act(checkSaved(wallet), ({ outcome }) => settle(outcome))}
      onEnterHash={(candidate) => wallet && act(enterTransferHash(wallet, candidate), ({ outcome }) => settle(outcome))}
      onConfirmUnsent={() => act(confirmTransferUnsent(), () => setNotice(fundingMessages.cleared))}
    />
  ) : null;

  const choices: Operation[] = isOwner && !promiseUnread ? ["deposit", "withdraw"] : ["deposit"];
  const step = review?.kind === "evm" ? (review.batch ? "batch" : review.review.resetAllowance ? "reset" : review.review.approvalNeeded ? "approve" : "send") : "send";
  const signLabel =
    step === "batch"
      ? "Approve and deposit in wallet"
      : step === "reset"
        ? "Reset token allowance in wallet"
        : step === "approve"
          ? "Approve exact token amount in wallet"
          : operation === "deposit"
            ? "Confirm deposit in wallet"
            : "Confirm withdrawal in wallet";

  return (
    <Card className="flex flex-col gap-4" aria-label={`Fund or withdraw · ${network}`}>
      <CardTitle className="flex items-center gap-2">
        Fund or withdraw <NetworkName network={deployment.network} />
      </CardTitle>
      <Disclosure summary="Contract details" defaultOpen={pending !== null || review !== undefined}>
        <div className="flex flex-col gap-2">
          <Address value={deployment.vault} label="Vault" />
          <Address value={deployment.asset} label="Token" />
        </div>
      </Disclosure>
      <Status presentation={{ tone: "Caution", icon: "Alert", label: "Direct transfers are not credited" }} />
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {unreadable.status === "done" && unreadable.value ? (
        <Button variant="secondary" disabled={busy} onClick={() => act(clearUnreadableSaved(), () => setCleared((count) => count + 1))}>
          I checked wallet activity; clear the unreadable local record
        </Button>
      ) : null}
      <WalletChooser
        legend={pending ? "Reconnect to check this transaction" : "Choose a wallet"}
        family={solana ? "solana" : "evm"}
        address={wallet?.address}
        disabled={busy}
        wallets={offers.filter((offer) => (solana ? offer.family === "solana" && offer.solanaFunding : offer.family === "evm")).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
        onConnect={(offer) => connect(Number(offer.id))}
      />
      {pending ??
        (wallet ? (
          <>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void act(reviewAction(wallet, operation, amount, pool, account), setReview);
              }}
            >
              <RadioGroup
                legend="Action"
                value={operation}
                disabled={busy}
                hint={!isOwner ? "Only the vault owner's wallet can withdraw free funds." : promiseUnread ? fundingMessages.promiseUnread : undefined}
                options={choices.map((choice) => ({ value: choice, label: choice === "deposit" ? "Deposit tokens" : "Withdraw free funds" }))}
                onValueChange={(value) => {
                  setOperation(value === "withdraw" ? "withdraw" : "deposit");
                  setReview(undefined);
                }}
              />
              <Field label="Token amount">
                <Input
                  inputMode="decimal"
                  value={amount}
                  disabled={busy}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setReview(undefined);
                  }}
                />
              </Field>
              <Button type="submit" variant="secondary" loading={busy} disabled={amount.trim() === ""}>
                Review {operation === "deposit" ? "deposit" : "withdrawal"}
              </Button>
            </form>
            {review ? (
              <section aria-label="Review vault action" className="flex flex-col gap-3">
                <ReviewFacts review={review} operation={operation} formatted={formatted} />
                <p className="text-sm text-foreground">
                  {operation === "deposit"
                    ? "This deposit joins the project's free funds. Only the vault owner can award them, or withdraw them less a 2% withdrawal fee to the refund destination below. Depositors have no refund right."
                    : "Reserved awards cannot be withdrawn. Funds go only to the refund destination below."}
                </p>
                <Address value={deployment.owner} label="Refund destination" />
                {step === "reset" ? <p className="text-sm text-muted-foreground">Reset the existing token allowance to zero first.</p> : null}
                <Button
                  loading={busy}
                  onClick={() =>
                    act(sendAction(wallet, review, amount), (sent) => {
                      setReview(undefined);
                      setNotice(step === "batch" ? fundingMessages.waitingWallet : `Submitted ${sent}. ${fundingMessages.waitingWallet}`);
                      if (step === "batch") watchBatched(wallet);
                      else watch(wallet);
                    })
                  }
                >
                  {signLabel}
                </Button>
              </section>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setWallet(undefined);
                setReview(undefined);
              }}
            >
              Choose another wallet
            </Button>
          </>
        ) : null)}
      {busy ? <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Waiting for wallet or chain response…" }} /> : null}
    </Card>
  );
}

function ReviewFacts({ review, operation, formatted }: { review: ActionReview; operation: Operation; formatted: (value: bigint, decimals: number) => string }) {
  const facts =
    review.kind === "evm"
      ? { free: review.review.freeBalance as bigint | null, gross: review.review.gross, fee: review.review.fee, net: review.review.net, decimals: review.review.decimals, networkFee: undefined }
      : {
          free: review.funding.plan.freeBalance === null ? null : BigInt(review.funding.plan.freeBalance),
          gross: BigInt(review.funding.plan.gross),
          fee: BigInt(review.funding.plan.fee),
          net: BigInt(review.funding.plan.net),
          decimals: review.funding.plan.decimals,
          networkFee: BigInt(review.funding.plan.networkFeeLamports),
        };
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Current free balance", facts.free === null ? "Unavailable" : formatted(facts.free, facts.decimals)],
    ...(facts.networkFee === undefined ? [] : [["Estimated network fee", `${formatBaseUnits({ value: facts.networkFee, decimals: 9 })} SOL, plus any token-account rent`] as const]),
    ["Amount", formatted(facts.gross, facts.decimals)],
    ["Fee", formatted(facts.fee, facts.decimals)],
    [operation === "deposit" ? "Added to free funds" : "Returned to owner", formatted(facts.net, facts.decimals)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PendingCheckPanel({
  action,
  hash,
  network,
  solana,
  canCheck,
  busy,
  unclear,
  onCheck,
  onEnterHash,
  onConfirmUnsent,
}: {
  action: string;
  hash: string;
  network: string;
  solana: boolean;
  canCheck: boolean;
  busy: boolean;
  unclear: boolean;
  onCheck: () => void;
  onEnterHash: (candidate: string) => void;
  onConfirmUnsent: () => void;
}) {
  return (
    <PendingCheck
      action={action}
      hash={hash}
      explorerUrl={transactionUrl(network, hash || undefined)}
      solana={solana}
      canCheck={canCheck}
      busy={busy}
      onCheck={onCheck}
      onEnterHash={hash === "" ? onEnterHash : undefined}
      onConfirmUnsent={unclear && hash === "" ? onConfirmUnsent : undefined}
    />
  );
}

function BatchPending({
  batch,
  network,
  canCheck,
  busy,
  onLookup,
  onObserve,
  onRecover,
}: {
  batch: Batch;
  network: string;
  canCheck: boolean;
  busy: boolean;
  onLookup: () => void;
  onObserve: () => void;
  onRecover: (candidate: string) => void;
}) {
  return (
    <PendingCheck
      action="Deposit"
      hash={batch.transaction}
      explorerUrl={transactionUrl(network, batch.transaction || undefined)}
      canCheck={canCheck}
      busy={busy}
      onCheck={batch.phase === "WalletReference" ? onLookup : onObserve}
      onEnterHash={batch.phase === "Uncertain" ? onRecover : undefined}
    />
  );
}
