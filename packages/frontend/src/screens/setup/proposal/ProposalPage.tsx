// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"; spec/backend/referralCodes.md, "A current reservation resolves through current open membership"; spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"
import type { SetupStatus } from "@repo/backend/client";
import { Alert, Button, PageHeader, StatusIcon } from "@repo/ui";
import { Exit } from "effect";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useNow } from "../../../app/hooks.ts";
import { pageShellClass } from "../../../app/PageShell.tsx";
import type { PageProps } from "../../../app/pages.ts";
import type { PageRuntime, SessionShown } from "../../../app/runtime.vibe";
import { useAddress } from "../../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import type { RepositoryLookup } from "@repo/backend/client";
import { normalizeRepositoryInput, type ProposalField } from "../../../flows/projects/proposal.ts";
import { focusField } from "../fields/ProjectFields.tsx";
import { slopbotInstallUrl } from "../fields/slopbot.ts";
import { creationUnconfirmed, createFromSetup, refreshSession } from "./create.vibe";
import {
  attemptedThrough,
  branchesOf,
  clearedWizard,
  draftPayload,
  firstErrorOf,
  fundingOf,
  type Lookup,
  lookupKey,
  poolOf,
  setupErrors,
  setupSteps,
  shownError,
  type StepIndex,
  stepOfField,
  withLookup,
  withField,
  withRepository,
  type Wizard,
} from "./form.ts";
import { FundingFields, type FundingField } from "./FundingFields.tsx";
import { draftManifest } from "./manifest.ts";
import { ProjectStep } from "./ProjectStep.tsx";
import { RepositoryPicker } from "./RepositoryPicker.tsx";
import { DraftSkills, ListingPreview, SubmitProject } from "./ReviewStep.tsx";
import { lookupAfterPause } from "./repository.vibe";
import { type Settled, useRun } from "./run.ts";
import { SetupSteps } from "./SetupSteps.tsx";
import { useWizard, useWizardStore, type WizardStore, type WizardView } from "./wizard.ts";

export interface CreatedProject {
  readonly projectId: string;
  readonly actorId: string;
  readonly setup: SetupStatus;
  readonly referrer: string | null;
}

export type ProposalPageProps = PageProps & {
  /** The signed-in account's pending applications, shown above the steps. */
  pendingApplications?: ReactNode;
  /** The readiness of a project just created. */
  setupStatus?: (created: CreatedProject) => ReactNode;
};

type Submission = { readonly status: "idle" | "submitting" } | { readonly status: "failed"; readonly message: string; readonly installSlopbot: boolean } | ({ readonly status: "created" } & CreatedProject);

const page = pageShellClass("lg", "6");
const signInReturn = "/projects/new";
const fundingFields = { mode: "fundingMode", network: "settlementChain", assetKind: "rewardKind", tokenAddress: "rewardAssetAddress", tokenSymbol: "rewardAssetSymbol", monthlyAmount: "monthlyPool" } as const satisfies Record<FundingField, ProposalField>;
const lastStep: StepIndex = 2;

function lookupOf(key: string | undefined, read: Settled<RepositoryLookup> | undefined): Lookup {
  if (key === undefined) return { state: "idle" };
  if (read === undefined || read.status === "running") return { state: "loading" };
  return read.status === "done" ? { state: "done", facts: read.value } : { state: "error", message: read.message };
}

function focusHeading() {
  document.getElementById("proposal-step-heading")?.focus();
}

/** Add a project: Project, Rewards and Review, restored from this tab's saved draft and created paused as revision 1. */
export function ProposalPage({ runtime, pendingApplications, setupStatus }: ProposalPageProps) {
  const address = useAddress();
  const store = useWizardStore(runtime, new URL(address, location.origin).search);
  const view = useWizard(store);
  const shown = useSession(runtime);
  if (store === undefined || view === undefined || shown === undefined)
    return (
      <main className={page}>
        <PageHeader title="Add a project" />
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusIcon icon="Spinner" />
          Loading saved draft…
        </p>
      </main>
    );
  return <ProposalForm runtime={runtime} store={store} view={view} shown={shown} pendingApplications={pendingApplications} setupStatus={setupStatus} />;
}

type ProposalFormProps = Omit<ProposalPageProps, "route"> & {
  runtime: PageRuntime;
  store: WizardStore;
  view: WizardView;
  shown: SessionShown;
};

function ProposalForm({ runtime, store, view, shown, pendingApplications, setupStatus }: ProposalFormProps) {
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const inFlightRef = useRef(false);
  const session = shown.view;
  const actor = session.status === "signedIn" ? session.session : undefined;
  const loginHref = loginHrefFor(shown, signInReturn);
  const saved = view.wizard;
  const key = actor === undefined ? undefined : lookupKey(saved);
  const settleLookup = (settled: Lookup) => {
    if (key !== undefined) store.update((current) => withLookup(current, key, settled));
  };
  const read = useRun(runtime, key === undefined ? undefined : `lookup:${key}`, () => lookupAfterPause(normalizeRepositoryInput(saved.proposal.repository)), "Repository could not load.", {
    settle: (facts) => settleLookup({ state: "done", facts }),
    fail: (message) => settleLookup({ state: "error", message }),
  });
  const lookup = lookupOf(key, read);
  const p = saved.proposal;
  const errors = setupErrors(p, lookup);
  const valid = Object.keys(errors).length === 0;
  const step = saved.step;
  const facts = branchesOf(p, lookup);
  const shownFor = (field: ProposalField) => shownError(saved, errors, field);
  const nowMs = useNow();
  const { manifest, bounty } = draftManifest({ proposal: p, actor, valid, now: new Date(nowMs).toISOString() });

  const update = (change: (current: Wizard) => Wizard) => store.update(change);
  const change = (field: Exclude<ProposalField, "repository">, value: string) => update((current) => withField(current, field, value, branchesOf(current.proposal, lookup)));
  const focusOn = (field: ProposalField) => {
    const owner = stepOfField(field) ?? step;
    update((current) => ({ ...current, step: owner }));
    const target = owner === 0 && p.repositoryNumericId === "" ? "repository" : field;
    requestAnimationFrame(() => focusField(target));
  };
  const goTo = (index: StepIndex) => {
    if (index > step || index === lastStep) {
      update((current) => attemptedThrough({ ...current, step }, index));
      for (const owner of [0, 1] as const) {
        const field = owner < index ? firstErrorOf(errors, owner) : undefined;
        if (field !== undefined) return focusOn(field);
      }
    }
    if (index === lastStep && step !== lastStep) void runtime.runPromise(refreshSession());
    update((current) => ({ ...current, step: index }));
    requestAnimationFrame(() => focusHeading());
  };
  const clearReferrer = () => update((current) => ({ ...current, referrer: null }));

  const submit = async () => {
    if (inFlightRef.current) return;
    if (!valid) return goTo(lastStep);
    if (actor === undefined) return void runtime.runPromise(refreshSession());
    const submitted = draftPayload(saved);
    inFlightRef.current = true;
    setSubmission({ status: "submitting" });
    const funding = fundingOf(p);
    const exit = await runtime.runPromiseExit(
      createFromSetup({ manifest, referrer: saved.referrer, monthlyAmount: funding.mode === "monthly" ? funding.monthlyAmount.trim() : null, bountyAmount: p.fundingMode === "bounty" ? p.monthlyPool.trim() : null, actor: actor.githubId }),
    );
    inFlightRef.current = false;
    if (Exit.isSuccess(exit)) {
      if (draftPayload(store.get().wizard) === submitted) clearReferrer();
      return setSubmission({ status: "created", projectId: exit.value.project.id, actorId: actor.githubId, setup: exit.value.setup, referrer: saved.referrer });
    }
    const failure = Exit.findErrorOption(exit);
    const refused = failure._tag === "Some" && failure.value._tag === "CreationFailed" ? failure.value : undefined;
    setSubmission({ status: "failed", message: refused?.message ?? creationUnconfirmed, installSlopbot: refused?.installSlopbot ?? false });
  };

  if (submission.status === "created")
    return (
      <main className={page}>
        <h1 ref={(node) => node?.focus()} tabIndex={-1} className="text-2xl font-semibold text-foreground">
          Project created
        </h1>
        {setupStatus?.(submission)}
        {submission.referrer ? <p className="text-sm text-muted-foreground">Referred by @{submission.referrer}.</p> : null}
        <div className="flex flex-wrap gap-4">
          <Button asChild>
            <a href={`/projects/${submission.projectId}`}>View project</a>
          </Button>
          <Button asChild variant="outline">
            <a href={`/projects/${submission.projectId}/manage`}>Manage project</a>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              update((current) => clearedWizard(current, null));
              setSubmission({ status: "idle" });
            }}
          >
            Add another
          </Button>
        </div>
      </main>
    );

  const picker = (
    <RepositoryPicker
      runtime={runtime}
      session={session}
      loginHref={loginHref}
      selected={p.repository}
      onChoose={(repository) => update((current) => withRepository(current, repository))}
      error={shownFor("repository") ?? (lookup.state === "error" ? lookup.message : undefined)}
      onRetryLookup={lookup.state === "error" ? () => update((current) => ({ ...current, generation: current.generation + 1 })) : undefined}
    />
  );

  return (
    <main className={page}>
      <nav aria-label="Breadcrumb" className="text-sm">
        <a href="/" className="text-muted-foreground hover:text-foreground">
          Projects
        </a>
      </nav>
      <PageHeader title="Add a project" />
      {pendingApplications}
      <SetupSteps current={step} onChoose={goTo} />
      <form noValidate className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
        <h2 id="proposal-step-heading" tabIndex={-1} className="sr-only">
          {setupSteps[step]}
        </h2>
        {step === 0 ? (
          <ProjectStep
            proposal={p}
            picker={picker}
            branches={facts?.branches ?? []}
            branchesLoading={lookup.state === "loading"}
            extraRuleFields={saved.extraRuleFields}
            imageKey={saved.generation}
            shown={shownFor}
            onChange={change}
          />
        ) : null}
        {step === 1 ? (
          <FundingFields
            compact
            bounty={p.fundingMode === "bounty"}
            onBounty={() => change("fundingMode", "bounty")}
            networkError={shownFor("settlementChain")}
            choice={fundingOf(p)}
            networkFixed={false}
            error={(field) => shownFor(field === "monthlyAmount" ? "monthlyPool" : field === "tokenAddress" ? "rewardAssetAddress" : "rewardAssetSymbol")}
            onChange={(field, value) => change(fundingFields[field], value)}
            promise={{ checked: p.honorSystem === "true", onChange: (checked) => change("honorSystem", String(checked)) }}
          />
        ) : null}
        {step === 2 ? (
          <>
            <ListingPreview proposal={p} pool={poolOf(p)} bounty={bounty} licenseKnown={p.licenseSpdx !== "" && errors.repository === undefined} referrer={saved.referrer} onClearReferrer={clearReferrer} />
            {valid ? (
              <>
                <DraftSkills runtime={runtime} manifest={manifest} />
                <div className="flex flex-col gap-4">
                  <SubmitProject session={session} loginHref={loginHref} submitting={submission.status === "submitting"} onSubmit={() => void submit()} />
                  {submission.status === "failed" ? (
                    <Alert variant="destructive">
                      {submission.message}
                      {submission.installSlopbot ? (
                        <>
                          {" "}
                          <a href={slopbotInstallUrl} className="underline">
                            Install Slopbot
                          </a>
                        </>
                      ) : null}
                    </Alert>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {view.saveFailed ? (
          <Alert variant="destructive">Draft could not save. Keep this page open.</Alert>
        ) : view.saving ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saving draft…
          </p>
        ) : null}
        <div className="flex flex-wrap gap-4">
          {step > 0 ? (
            <Button variant="outline" onClick={() => goTo(step === 2 ? 1 : 0)}>
              <ArrowLeft aria-hidden className="size-4" />
              Back
            </Button>
          ) : null}
          {step < lastStep ? (
            <Button onClick={() => goTo(step === 0 ? 1 : 2)}>
              Next
              <ArrowRight aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      </form>
    </main>
  );
}
