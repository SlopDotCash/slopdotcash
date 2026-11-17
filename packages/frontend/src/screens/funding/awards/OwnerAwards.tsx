// spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"; spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"; spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
import { Alert, Button } from "@repo/ui";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useMachine as useMonthly } from "../../../../gen/frontend__ownerMonthly.react.ts";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useAddress } from "../../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { viewActor } from "../../../session/session.vibe";
import { sessionSlots } from "../../../wallets/core/slots.ts";
import { deploymentOf } from "../../../wallets/owner/commitmentCalls.ts";
import { familyOf } from "../../../wallets/owner/commitments.vibe";
import type { NetworkPays } from "../../public/funding.ts";
import { deploymentsOf, type FundingProject, NetworkName } from "../vault/index.ts";
import { awardsRuntime, finalizeAwards, refreshAwards, saveAllocation, setAutomatic } from "./awards.vibe";
import { useAwardAction, useFollowedMonth, useMonthView } from "./hooks.ts";
import { monthBounds, monthsBetween, monthText, savedCommitmentMonths, shiftMonth } from "./month.ts";
import { MonthPanel } from "./MonthPanel.tsx";
import { OwnerCommitment } from "./OwnerCommitment.tsx";

export type OwnerAwardsProps = {
  /** The page's runtime, which knows the signed-in account. */
  runtime: PageRuntime;
  /** The project whose monthly awards these are. */
  project: FundingProject;
  /** The months the public cycle index lists for the project, `YYYY-MM`. */
  awardMonths: ReadonlyArray<string>;
  /** Whether payments run on a network. */
  networkPays: NetworkPays;
};

type MonthProps = {
  project: FundingProject;
  period: string;
  account: number;
  githubId: string;
  loginHref: string | undefined;
  networkPays: NetworkPays;
};

function AwardMonth({ project, period, account, githubId, loginHref, networkPays }: MonthProps) {
  const runtime = awardsRuntime(project, period);
  const followed = useFollowedMonth(runtime, account, githubId);
  const view = useMonthView(runtime);
  const monthly = useMonthly(runtime);
  const { busy, error, notice, setNotice, act } = useAwardAction(runtime);
  const [selected, setSelected] = useState<string>();
  const state = monthly.state;
  const loading = followed.status === "running";
  const shownError = error || (followed.status === "failed" ? followed.message : "");
  const deployment = view === undefined ? undefined : deploymentOf(view.deployment);
  const family = deployment === undefined ? undefined : familyOf(deployment);
  const registered = deployment === undefined ? undefined : deploymentsOf(project).find((entry) => entry.network === deployment.network && entry.vault === deployment.vault);
  const paymentsDisabled = project.reward.kind === "external-prize-share" || !deploymentsOf(project).some((entry) => networkPays(entry.network));
  const refresh = () => act(refreshAwards());
  return (
    <div className="flex flex-col gap-4">
      {loginHref !== undefined ? (
        <a href={loginHref} className="self-start text-sm text-primary underline-offset-4 hover:underline">
          Sign in with GitHub
        </a>
      ) : null}
      {shownError ? <Alert variant="destructive">{shownError}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {account !== 0 ? (
        <Button variant="secondary" className="self-start" loading={busy || loading} onClick={refresh}>
          Refresh awards
        </Button>
      ) : null}
      {view !== undefined && state !== undefined ? (
        <>
          {deployment ? <NetworkName network={deployment.network} /> : null}
          <MonthPanel
            view={view}
            state={state}
            busy={busy || loading}
            manageHref={registered ? `/projects/${project.slug}/manage#vault-monthly-${registered.network}-${registered.vault}` : undefined}
            paymentsDisabled={paymentsDisabled}
            onSave={(change) => act(saveAllocation(change.githubUserId, change.grossBase, change.cut, change.reason), setNotice)}
            onFinalize={() => act(finalizeAwards(), setNotice)}
            onAutomaticChange={(automatic) => act(setAutomatic(automatic))}
            onReserve={setSelected}
            commitment={
              deployment && family ? (
                <OwnerCommitment
                  key={selected ?? "saved"}
                  runtime={runtime}
                  account={account}
                  network={deployment.network}
                  family={family}
                  githubUserId={selected}
                  onFinalized={() => {
                    setSelected(undefined);
                    void refresh();
                  }}
                />
              ) : null
            }
          />
        </>
      ) : null}
    </div>
  );
}

/** A project's monthly awards for its owner: month by month, the allocations before the freeze and the frozen awards the owner's wallet reserves. */
export function OwnerAwards({ runtime, project, awardMonths, networkPays }: OwnerAwardsProps) {
  const shown = useSession(runtime);
  const address = useAddress();
  const bounds = monthBounds(awardMonths, Date.now());
  const saved = savedCommitmentMonths(sessionSlots(), project.id, monthsBetween(bounds.first, bounds.start));
  const [opened, setOpened] = useState(saved.length > 0);
  const [period, setPeriod] = useState(bounds.start);
  if (project.reward.kind !== "monthly-pool" && awardMonths.length === 0 && saved.length === 0 && !opened) return null;
  const account = shown ? viewActor(shown.view) : 0;
  const githubId = shown?.view.status === "signedIn" ? shown.view.session.githubId : "";
  const loginHref = shown?.view.status === "signedOut" ? loginHrefFor(shown, address) : undefined;
  const elsewhere = saved.filter((month) => month !== period);
  return (
    <section id="monthly-awards" aria-labelledby="monthly-awards-heading" className="flex flex-col gap-4">
      <h2 id="monthly-awards-heading" className="flex items-center gap-2 text-xl font-semibold text-foreground">
        <CalendarDays aria-hidden="true" className="size-6" /> Monthly awards
      </h2>
      {elsewhere.map((month) => (
        <Alert
          key={month}
          variant="info"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setOpened(true);
                setPeriod(month);
              }}
            >
              Open {monthText(month)}
            </Button>
          }
        >
          A commitment for {monthText(month)} awaits verification.
        </Alert>
      ))}
      {!opened ? (
        <Button variant="secondary" className="self-start" onClick={() => setOpened(true)}>
          Review monthly awards
        </Button>
      ) : (
        <>
          <nav aria-label="Contribution month" className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous award month" disabled={period <= bounds.first} onClick={() => setPeriod(shiftMonth(period, -1))}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span aria-live="polite" className="min-w-40 text-center font-semibold text-foreground">
              {monthText(period)}
            </span>
            <Button variant="secondary" size="icon" aria-label="Next award month" disabled={period >= bounds.lastClosed} onClick={() => setPeriod(shiftMonth(period, 1))}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
          <AwardMonth key={period} project={project} period={period} account={account} githubId={githubId} loginHref={loginHref} networkPays={networkPays} />
        </>
      )}
    </section>
  );
}
