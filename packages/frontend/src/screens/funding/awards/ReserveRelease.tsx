// spec/settlement/reserveRelease.md, "Current authority and fresh complete wrong-total evidence permit approval"; spec/settlement/reserveRelease.md, "Finalized release returns the whole untouched reserve"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
import type { MonthlyOwnerView } from "@repo/settlement/client";
import { Alert, Button, Disclosure, Status, WalletChooser, type WalletOption } from "@repo/ui";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { deploymentOf } from "../../../wallets/owner/commitmentCalls.ts";
import { monthlyMessages } from "../../../wallets/owner/ownerMonthly.vibe";
import { releaseMessages } from "../../../wallets/owner/reserveRelease.vibe";
import { useSettled } from "../vault/hooks.ts";
import { PendingCheck } from "../vault/PendingCheck.tsx";
import {
  type AwardsRuntime,
  type Connection,
  checkSavedRelease,
  clearUnreadableRelease,
  confirmReleaseUnsent,
  connectReleaseOwner,
  enterReleaseHash,
  type ReleaseChecked,
  type ReleaseReady,
  reviewRelease,
  savedReleaseHeld,
  sendRelease,
  unreadableRelease,
} from "./awards.vibe";
import { useAwardAction, useAwardOffers } from "./hooks.ts";
import { amountText } from "./month.ts";

export type ReleaseNotice = { readonly tone: "Neutral" | "Positive" | "Negative"; readonly spinner?: boolean; readonly text: string };

export type ReserveReleaseProps = {
  /** The month's vault network, which names the explorer and the wallet family. */
  network: string;
  /** The reserve the attester approved for release, already formatted; absent until the reserve was checked. */
  released?: string;
  /** A saved release waits for its chain check, with its transaction hash when one is known. */
  pending?: { readonly hash: string; readonly unclear: boolean };
  /** The saved release cannot be read. */
  unreadable?: boolean;
  /** The last outcome to say. */
  notice?: ReleaseNotice;
  /** The last action's error. */
  error?: string;
  /** The connected owner wallet's address. */
  address?: string;
  /** The EVM wallets the browser offers. */
  wallets: readonly WalletOption[];
  /** A request is running. */
  busy?: boolean;
  /** Opens the panel at first, as for a saved release. */
  defaultOpen?: boolean;
  onCheckReserve: () => void;
  onConnect: (wallet: WalletOption) => void;
  onSign: () => void;
  onCheck: () => void;
  onEnterHash: (candidate: string) => void;
  onConfirmUnsent: () => void;
  onClearUnreadable: () => void;
};

/** "Repair reserve": the owner checks a wrong-total reserve, signs the approved release, then checks it on the finalized chain. */
export function ReserveRelease({ network, released, pending, unreadable = false, notice, error, address, wallets, busy = false, defaultOpen, onCheckReserve, onConnect, onSign, onCheck, onEnterHash, onConfirmUnsent, onClearUnreadable }: ReserveReleaseProps) {
  return (
    <Disclosure summary="Repair reserve" defaultOpen={defaultOpen} className="flex flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? (
        <p role="status">
          <Status presentation={{ tone: notice.tone, icon: notice.spinner ? "Spinner" : notice.tone === "Negative" ? "Alert" : notice.tone === "Positive" ? "Check" : "Dot", label: notice.text }} />
        </p>
      ) : null}
      {unreadable ? (
        <>
          <Alert variant="destructive">{monthlyMessages.unreadable}</Alert>
          <Button variant="secondary" className="self-start" disabled={busy} onClick={onClearUnreadable}>
            Checked wallet activity · clear saved record
          </Button>
        </>
      ) : null}
      {pending ? (
        <PendingCheck
          action="Reserve release"
          status="Pending · don't resend"
          hash={pending.hash}
          explorerUrl={transactionUrl(network, pending.hash || undefined)}
          canCheck
          busy={busy}
          onCheck={onCheck}
          onEnterHash={pending.hash === "" ? onEnterHash : undefined}
          onConfirmUnsent={pending.unclear ? onConfirmUnsent : undefined}
        />
      ) : (
        <>
          <Button variant="secondary" className="self-start" disabled={busy || unreadable} loading={busy && released === undefined} onClick={onCheckReserve}>
            Check reserve
          </Button>
          {released === undefined ? null : (
            <section aria-label="Reserve release" className="flex flex-col gap-3">
              <p className="flex flex-wrap items-center gap-1 text-sm text-foreground">
                Release {released} <ArrowRight aria-hidden="true" className="size-4" />
                <span className="sr-only">to</span> free balance
              </p>
              {address === undefined ? (
                <WalletChooser legend="Owner wallet" family="evm" wallets={wallets} disabled={busy} onConnect={onConnect} />
              ) : (
                <Button className="self-start" loading={busy} onClick={onSign}>
                  Sign release
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </Disclosure>
  );
}

const live = new Set(["Awaiting", "Sent", "Unclear"]);

export type OwnerReserveReleaseProps = {
  /** The month's owner runtime. */
  runtime: AwardsRuntime;
  /** The month as the server returned it to this viewer. */
  view: MonthlyOwnerView;
  /** The signed-in account's GitHub id as a number. */
  account: number;
  /** Called once a release is finalized, so the month is read again. */
  onReleased: () => void;
};

/** The month's reserve release for its current manager, or for whoever saved a release on this device. */
export function OwnerReserveRelease({ runtime, view, account, onReleased }: OwnerReserveReleaseProps) {
  const monthly = useMonthly(runtime);
  const offers = useAwardOffers(runtime);
  const { busy, error, act } = useAwardAction(runtime);
  const [wallet, setWallet] = useState<Connection>();
  const [ready, setReady] = useState<ReleaseReady>();
  const [notice, setNotice] = useState<ReleaseNotice>();
  const [cleared, setCleared] = useState(0);
  const unreadable = useSettled(runtime, `unreadable-release:${cleared}`, () => unreadableRelease());
  const held = useSettled(runtime, `saved-release:${cleared}:${monthly.state?.release.slot.identity ?? ""}`, () => savedReleaseHeld());
  const state = monthly.state;
  const deployment = deploymentOf(view.deployment);
  if (state === undefined || deployment === undefined || !(view.canManage || (held.status === "done" && held.value))) return null;
  const flow = state.release;
  const pending = live.has(flow.phase) && flow.slotOwner === account;
  const amount = amountText(view.asset);
  const releaseAct: typeof act = (work, then) => {
    setNotice(undefined);
    return act(work, then);
  };
  const checked = (result: ReleaseChecked) => {
    if (result.status === "pending") return setNotice({ tone: "Neutral", spinner: true, text: releaseMessages.finalizing });
    setReady(undefined);
    setNotice(result.status === "finalized" ? { tone: "Positive", text: releaseMessages.released } : { tone: "Negative", text: releaseMessages.failed });
    if (result.status === "finalized") onReleased();
  };
  return (
    <ReserveRelease
      network={deployment.network}
      released={ready ? amount(ready.terms.releasedGross) : undefined}
      pending={pending ? { hash: flow.slot.hash || flow.slot.candidate, unclear: flow.phase === "Unclear" } : undefined}
      unreadable={unreadable.status === "done" && unreadable.value}
      notice={notice}
      error={error}
      address={wallet?.address}
      wallets={offers.filter((offer) => offer.family === "evm").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
      busy={busy}
      defaultOpen={pending}
      onCheckReserve={() =>
        releaseAct(reviewRelease(), (reviewed) => {
          if (reviewed.kind === "held") {
            setReady(undefined);
            setNotice({ tone: "Neutral", text: reviewed.message });
          } else setReady(reviewed.ready);
        })
      }
      onConnect={(offer) => releaseAct(connectReleaseOwner(Number(offer.id)), setWallet)}
      onSign={() => wallet && ready && releaseAct(sendRelease(wallet, ready), () => setNotice({ tone: "Neutral", spinner: true, text: releaseMessages.submitted }))}
      onCheck={() => releaseAct(checkSavedRelease(), checked)}
      onEnterHash={(candidate) => releaseAct(enterReleaseHash(candidate), checked)}
      onConfirmUnsent={() =>
        releaseAct(confirmReleaseUnsent(), () => {
          setReady(undefined);
          setNotice({ tone: "Neutral", text: releaseMessages.cleared });
        })
      }
      onClearUnreadable={() => releaseAct(clearUnreadableRelease(), () => setCleared((count) => count + 1))}
    />
  );
}
