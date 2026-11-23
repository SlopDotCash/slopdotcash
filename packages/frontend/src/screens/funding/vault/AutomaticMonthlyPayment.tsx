// spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/settlement/escrow.md, "The owner turns monthly commitments on with a positive cap or off"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Address, Alert, Button, Card, CardTitle, Disclosure, ExternalLink, Label, Spinner, Status, Switch, WalletChooser } from "@repo/ui";
import { ArrowRight, ExternalLink as ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import { formatAssetAmount, networkLabel } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import {
  checkSetting,
  clearUnreadableSetting,
  confirmSettingUnsent,
  connectWallet,
  type Connection,
  enterSettingHash,
  followMonthly,
  fundingMessages,
  type MonthlySetting,
  pendingSetting,
  reviewSetting,
  saveDefault,
  sendSetting,
  type SettingChecked,
  type SettingReview,
  unreadableSetting,
  vaultRuntime,
} from "./funding.vibe";
import { useAction, useSettled, useWalletOffers } from "./hooks.ts";
import { PendingCheck } from "./PendingCheck.tsx";
import type { FundingDeployment, FundingProject } from "./project.schema.ts";
import { familyOf } from "../../../wallets/owner/commitments.vibe";
import { NetworkName } from "./VaultActions.tsx";

export type AutomaticMonthlyPaymentProps = {
  /** The monthly-pool project whose default and vault authorization these are. */
  project: FundingProject;
  /** The registered vault on one network. */
  deployment: FundingDeployment;
  /** The UTC month, `YYYY-MM`, the owner's authority is read for. */
  period: string;
  /** The signed-in account's GitHub id as a number, or 0 when signed out. */
  account: number;
  /** The signed-in account's GitHub id. */
  githubId: string;
  /** Called once a setting change is verified on the finalized chain. */
  onFinalized: () => void;
};

const live = new Set(["Awaiting", "Sent", "Unclear"]);

/** @throws {never} */
function short(address: string): string {
  return `${address.slice(0, address.startsWith("0x") ? 6 : 4)}…${address.slice(-4)}`;
}

/** A setting check's outcome: still finalizing, failed, or the vault's new setting with its transaction. */
function SettingResult({ network, checked }: { network: string; checked: SettingChecked }) {
  const link = checked.status === "finalized" ? transactionUrl(network, checked.hash) : undefined;
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
      {checked.status === "pending" ? (
        <Status presentation={{ tone: "Neutral", icon: "Spinner", label: fundingMessages.finalizing }} />
      ) : checked.status === "failed" ? (
        <Status presentation={{ tone: "Negative", icon: "Alert", label: fundingMessages.settingFailed }} />
      ) : (
        <Status presentation={{ tone: checked.enabled ? "Positive" : "Neutral", icon: "Check", label: checked.enabled ? "On" : "Off" }} />
      )}
      {checked.status !== "finalized" ? null : link ? (
        <ExternalLink href={link} label="View transaction" title="View transaction" className="text-primary">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
        </ExternalLink>
      ) : (
        <code className="break-all font-mono text-foreground">{checked.hash}</code>
      )}
    </p>
  );
}

/** The project's automatic monthly payment: its default, changed with current authority, and the vault's own authorization, signed by the owner's wallet. */
export function AutomaticMonthlyPayment({ project, deployment, period, account, githubId, onFinalized }: AutomaticMonthlyPaymentProps) {
  const runtime = vaultRuntime(project, deployment, period);
  const month = useSettled(runtime, `monthly:${account}`, () => followMonthly(account, githubId));
  const monthly = useMonthly(runtime);
  const offers = useWalletOffers(runtime);
  const { busy, error, notice, setNotice, act } = useAction(runtime);
  const [chosenDefault, setChosenDefault] = useState<boolean>();
  const [automatic, setAutomatic] = useState<boolean>();
  const [wallet, setWallet] = useState<Connection>();
  const [review, setReview] = useState<SettingReview>();
  const [checked, setChecked] = useState<SettingChecked>();
  const [ownerOpen, setOwnerOpen] = useState<boolean>();
  const [cleared, setCleared] = useState(0);
  const unreadable = useSettled(runtime, `unreadable-setting:${cleared}`, () => unreadableSetting());
  const flow = monthly.state?.setting;
  const saved = useSettled(runtime, `pending-setting:${flow?.slot.identity ?? ""}`, () => pendingSetting());
  const defaultId = useId();
  const authorizeId = useId();
  const state = monthly.state;
  if (account === 0 || month.status !== "done" || month.value === undefined || state === undefined || flow === undefined || !state.manages) return null;
  const family = familyOf(deployment);
  const solana = family === "solana";
  const slotUnreadable = unreadable.status === "done" && unreadable.value;
  const savedDefault = chosenDefault ?? month.value.automatic;
  const wanted = automatic ?? savedDefault;
  const pending = live.has(flow.phase) && flow.slotOwner === account;
  const hash = flow.slot.hash || flow.slot.candidate;
  const decimals = project.reward.asset?.decimals;
  const describe = (setting: MonthlySetting) =>
    setting.enabled ? `On · ${decimals === undefined ? setting.cap.toString() : formatAssetAmount(setting.cap, { network: deployment.network, assetAddress: deployment.asset, assetDecimals: decimals })}/mo` : "Off";
  const pendingTarget = saved.status === "done" ? saved.value : undefined;
  const reward = { kind: project.reward.kind, chain: project.reward.chain ?? "", monthlyCapMinor: project.reward.monthlyCapMinor ?? "0", asset: project.reward.asset ?? null };
  const signLabel = !review ? "" : !review.target.enabled ? "Turn off" : review.current.enabled ? "Update cap" : "Turn on";
  const verified = (result: SettingChecked) => {
    setChecked(result);
    if (result.status !== "pending") setReview(undefined);
    if (result.status === "finalized") onFinalized();
  };
  const settingAct: typeof act = (work, then) => {
    setChecked(undefined);
    return act(work, then);
  };

  return (
    <Card className="flex flex-col gap-4" aria-label={`Vault monthly authorization · ${networkLabel(deployment.network)}`}>
      <CardTitle className="flex items-center gap-2">
        Auto-pay <NetworkName network={deployment.network} />
      </CardTitle>
      <div className="flex items-center gap-3">
        <Switch id={defaultId} checked={savedDefault} loading={busy} onCheckedChange={(next) => settingAct(saveDefault(next), setChosenDefault)} />
        <Label htmlFor={defaultId}>Pay contributors automatically each month</Label>
      </div>
      {project.reward.monthlyCapDisplay ? <p className="text-sm text-muted-foreground">Monthly cap: {project.reward.monthlyCapDisplay}</p> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {checked ? <SettingResult network={deployment.network} checked={checked} /> : null}
      {family !== undefined ? (
        <section aria-label="Vault monthly authorization" className="flex flex-col gap-3">
          <Disclosure summary={`Owner ${short(deployment.owner)}`} open={ownerOpen ?? (pending || review !== undefined)} onOpenChange={setOwnerOpen}>
            <Address value={deployment.owner} label="owner address" copyLabel="Copy owner address" />
          </Disclosure>
          {slotUnreadable ? (
            <>
              <Alert variant="destructive">{fundingMessages.settingUnreadable}</Alert>
              <Button variant="secondary" disabled={busy} onClick={() => settingAct(clearUnreadableSetting(), () => setCleared((count) => count + 1))}>
                Checked wallet activity · clear saved record
              </Button>
            </>
          ) : null}
          <WalletChooser
            legend={pending ? "Reconnect wallet" : "Owner wallet"}
            family={family}
            address={wallet?.address}
            disabled={busy || slotUnreadable}
            wallets={offers.filter((offer) => offer.family === family).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
            onConnect={(offer) =>
              settingAct(connectWallet(Number(offer.id), false), (connection) => {
                setWallet(connection);
                setReview(undefined);
              })
            }
          />
          {pending ? (
            <PendingCheck
              action="Monthly payment setting"
              status={pendingTarget ? `Pending: ${describe(pendingTarget)} · don't resend` : "Pending · don't resend"}
              hash={hash}
              solana={solana}
              explorerUrl={transactionUrl(deployment.network, hash || undefined)}
              canCheck={wallet !== undefined}
              busy={busy}
              onCheck={() => wallet && settingAct(checkSetting(wallet), verified)}
              onEnterHash={hash === "" ? (candidate) => wallet && settingAct(enterSettingHash(wallet, candidate), verified) : undefined}
              onConfirmUnsent={
                flow.phase === "Unclear"
                  ? () =>
                      settingAct(confirmSettingUnsent(), () => {
                        setReview(undefined);
                        setNotice(fundingMessages.settingCleared);
                      })
                  : undefined
              }
            />
          ) : wallet && !slotUnreadable ? (
            <fieldset aria-label="Auto-pay" disabled={busy} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  id={authorizeId}
                  checked={wanted}
                  onCheckedChange={(next) => {
                    setAutomatic(next);
                    setReview(undefined);
                  }}
                />
                <Label htmlFor={authorizeId}>Auto-pay monthly</Label>
                <Button variant="secondary" loading={busy} onClick={() => settingAct(reviewSetting(wallet, wanted, reward), setReview)}>
                  Review
                </Button>
              </div>
              {review ? (
                <section aria-label="Review monthly payment setting" className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-1 text-sm text-foreground">
                    {describe(review.current)} <ArrowRight aria-hidden="true" className="size-4" />
                    <span className="sr-only">to</span> {describe(review.target)}
                  </p>
                  {review.solana?.plan.transaction ? (
                    <p className="text-sm text-muted-foreground">
                      Estimated network fee: {formatBaseUnits({ value: BigInt(review.solana.plan.transaction.networkFeeLamports), decimals: 9 })} SOL
                    </p>
                  ) : null}
                  {review.changes ? (
                    <Button
                      loading={busy}
                      onClick={() =>
                        settingAct(sendSetting(wallet, review), () => {
                          setReview(undefined);
                        })
                      }
                    >
                      {signLabel}
                    </Button>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      No change
                    </p>
                  )}
                </section>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  setWallet(undefined);
                  setReview(undefined);
                }}
              >
                Choose another wallet
              </Button>
            </fieldset>
          ) : null}
          {busy ? <Spinner size="sm" label="Waiting for wallet" /> : null}
        </section>
      ) : null}
    </Card>
  );
}
