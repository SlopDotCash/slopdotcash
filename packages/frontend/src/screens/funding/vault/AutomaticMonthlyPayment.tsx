// spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/settlement/escrow.md, "The owner turns monthly commitments on with a positive cap or off"; spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"
import { Address, Alert, Button, Card, CardTitle, Checkbox, Disclosure, Label, Status, Switch, WalletChooser } from "@repo/ui";
import { useId, useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import { formatAssetAmount } from "../../../kernels/assetText.ts";
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
  reviewSetting,
  saveDefault,
  sendSetting,
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
  const [cleared, setCleared] = useState(0);
  const unreadable = useSettled(runtime, `unreadable-setting:${cleared}`, () => unreadableSetting());
  const defaultId = useId();
  const authorizeId = useId();
  const state = monthly.state;
  if (account === 0 || month.status !== "done" || month.value === undefined || state === undefined || !state.manages) return null;
  const evm = familyOf(deployment) === "evm";
  const slotUnreadable = unreadable.status === "done" && unreadable.value;
  const savedDefault = chosenDefault ?? month.value.automatic;
  const wanted = automatic ?? savedDefault;
  const flow = state.setting;
  const pending = live.has(flow.phase) && flow.slotOwner === account;
  const hash = flow.slot.hash || flow.slot.candidate;
  const decimals = project.reward.asset?.decimals;
  const described = (setting: MonthlySetting) =>
    setting.enabled ? `On, up to ${decimals === undefined ? setting.cap.toString() : formatAssetAmount(setting.cap, { network: deployment.network, assetAddress: deployment.asset, assetDecimals: decimals })} each month` : "Off";
  const reward = { kind: project.reward.kind, chain: project.reward.chain ?? "", monthlyCapMinor: project.reward.monthlyCapMinor ?? "0", asset: project.reward.asset ?? null };
  const signLabel = !review ? "" : !review.target.enabled ? "Turn off automatic monthly payment in wallet" : review.current.enabled ? "Update the monthly cap in wallet" : "Turn on automatic monthly payment in wallet";
  const verified = (result: { finalized: boolean; message: string }) => {
    setNotice(result.message);
    if (result.finalized) onFinalized();
  };

  return (
    <Card className="flex flex-col gap-4" aria-label={`Automatic monthly payment · ${deployment.network}`}>
      <CardTitle className="flex items-center gap-2">
        Automatic monthly payment <NetworkName network={deployment.network} />
      </CardTitle>
      <div className="flex items-center gap-3">
        <Switch id={defaultId} checked={savedDefault} loading={busy} onCheckedChange={(next) => act(saveDefault(next), setChosenDefault)} />
        <Label htmlFor={defaultId}>Pay contributors automatically each month</Label>
      </div>
      {project.reward.monthlyCapDisplay ? <p className="text-sm text-muted-foreground">Monthly cap: {project.reward.monthlyCapDisplay}</p> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {evm ? (
        <section aria-label="Vault monthly authorization" className="flex flex-col gap-3">
          <Disclosure summary="Owner details" defaultOpen={pending || review !== undefined}>
            <Address value={deployment.owner} label="Owner" />
          </Disclosure>
          {slotUnreadable ? (
            <Button variant="secondary" disabled={busy} onClick={() => act(clearUnreadableSetting(), () => setCleared((count) => count + 1))}>
              I checked wallet activity; clear the unreadable local record
            </Button>
          ) : null}
          <WalletChooser
            legend={pending ? "Reconnect to check this transaction" : "Connect the vault owner's wallet"}
            address={wallet?.address}
            disabled={busy || slotUnreadable}
            wallets={offers.filter((offer) => offer.family === "evm").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
            onConnect={(offer) =>
              act(connectWallet(Number(offer.id), false), (connection) => {
                setWallet(connection);
                setReview(undefined);
              })
            }
          />
          {pending ? (
            <PendingCheck
              action="Monthly payment setting"
              hash={hash}
              explorerUrl={transactionUrl(deployment.network, hash || undefined)}
              canCheck={wallet !== undefined}
              busy={busy}
              onCheck={() => wallet && act(checkSetting(wallet), verified)}
              onEnterHash={hash === "" ? (candidate) => wallet && act(enterSettingHash(wallet, candidate), verified) : undefined}
              onConfirmUnsent={flow.phase === "Unclear" ? () => act(confirmSettingUnsent(), () => setNotice(fundingMessages.cleared)) : undefined}
            />
          ) : wallet && !slotUnreadable ? (
            <>
              <div className="flex items-center gap-3">
                <Checkbox
                  id={authorizeId}
                  checked={wanted}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    setAutomatic(checked === true);
                    setReview(undefined);
                  }}
                />
                <Label htmlFor={authorizeId}>Commit each month's awards from this vault</Label>
              </div>
              <Button
                variant="secondary"
                loading={busy}
                onClick={() =>
                  act(reviewSetting(wallet, wanted, reward), setReview)
                }
              >
                Review monthly payment setting
              </Button>
              {review ? (
                <section aria-label="Review monthly payment setting" className="flex flex-col gap-3">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Current setting</dt>
                    <dd className="text-foreground">{described(review.current)}</dd>
                    <dt className="text-muted-foreground">After signing</dt>
                    <dd className="text-foreground">{described(review.target)}</dd>
                  </dl>
                  {review.changes ? (
                    <>
                      <p className="text-sm text-foreground">
                        {review.target.enabled
                          ? "Each month's commitment is limited to this cap and the vault's free funds. No funds move now."
                          : "While off, no new monthly awards are committed. Committed awards stay committed."}
                      </p>
                      <Button
                        loading={busy}
                        onClick={() =>
                          act(sendSetting(wallet, review.target), (sent) => {
                            setReview(undefined);
                            setNotice(`Submitted ${sent}. ${fundingMessages.waitingWallet}`);
                          })
                        }
                      >
                        {signLabel}
                      </Button>
                    </>
                  ) : (
                    <Status presentation={{ tone: "Positive", icon: "Check", label: "The vault already has this setting. Nothing to sign." }} />
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </Card>
  );
}
