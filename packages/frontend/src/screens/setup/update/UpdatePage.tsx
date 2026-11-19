// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "A current maintainer removes a project and a lost reply can be retried"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import type { SetupStatus } from "@repo/backend/client";
import { Alert, Button, NotFound, PageHeader, StatusIcon } from "@repo/ui";
import { Exit } from "effect";
import { Check, CloudCheck, CloudOff, Lock, Settings2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type PageProps, signInPurposes } from "../../../app/pages.ts";
import { Chip } from "../../admin/parts.tsx";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { SignInPanel } from "../../../app/SignInPanel.tsx";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { lookupRepository } from "../../../flows/projects/github.vibe";
import { normalizeRepositoryInput } from "../../../flows/projects/proposal.ts";
import { maintainerCheck } from "../../../session/maintainer.vibe";
import { ProjectNav } from "../../projects/ProjectNav.tsx";
import { networkPays } from "../../../kernels/payingNetworks.ts";
import { EscrowFunding, type FundingProject, fundingProjectOf } from "../../funding/vault/index.ts";
import { useShownRead } from "../../projects/hooks.ts";
import { projectOf } from "../../projects/project.schema.ts";
import type { PoolFundingIndex } from "../../../reads/funding.vibe";
import { projectReads, projectRuntime, type ShownRead } from "../../projects/reads.vibe";
import { projectFunding } from "../../projects/summary.ts";
import { useOnce } from "../../security/program/hooks.ts";
import { focusField } from "../fields/ProjectFields.tsx";
import { failureMessage, useRun } from "../proposal/run.ts";
import { SetupStatusPanel } from "../status/SetupStatusPanel.tsx";
import { type CurrentRevision, currentRevision, publishUpdate, removeManaged, revisionUnreadable } from "./actions.vibe";
import { ChangeReview } from "./ChangeReview.tsx";
import { type EditStore, useEdit, useEditStore } from "./editStore.ts";
import type { PendingRepository } from "./manifest.schema.ts";
import { ProjectRemoved, RemoveProject } from "./RemoveProject.tsx";
import {
  additionRefusal,
  addedRepository,
  afterPublish,
  type FormGroup,
  groupOf,
  isBountyOnly,
  listedNames,
  managedOf,
  pendingRepositories,
  pendingText,
  repositoryIds,
  reviewOf,
  untouched,
  type UpdateField,
  withField,
} from "./revision.ts";
import { type Addition, UpdateForm } from "./UpdateForm.tsx";

const page = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-6 px-4 py-8";
const fieldIds: Readonly<Record<string, string>> = { monthlyAmount: "monthlyPool", tokenAddress: "rewardAssetAddress", tokenSymbol: "rewardAssetSymbol" };

type Submission = { readonly status: "idle" | "publishing" } | { readonly status: "failed"; readonly message: string; readonly staleRevision: boolean } | { readonly status: "published"; readonly revision: number; readonly vaultSetup: boolean };

type Removal = { readonly status: "idle" | "removed" } | { readonly status: "refused"; readonly message: string; readonly staleRevision: boolean };

interface Published {
  readonly revision: number;
  readonly manifest: unknown;
  readonly setup: SetupStatus;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={page}>
      <PageHeader title="Settings" />
      {children}
    </main>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <StatusIcon icon="Spinner" />
      {children}
    </p>
  );
}

type EditorProps = {
  runtime: PageRuntime;
  base: CurrentRevision;
  actorId: string;
  onAccessLost: () => void;
  onReload: () => void;
  /** Why the last reload of the current revision failed. */
  loadError: string | undefined;
};

function Editor({ runtime, base, actorId, onAccessLost, onReload, loadError, store }: EditorProps & { store: EditStore }) {
  const { edit, saving, saveFailed } = useEdit(store);
  const [published, setPublished] = useState<Published>();
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<FormGroup>>(new Set(["listing"]));
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const [removal, setRemoval] = useState<Removal>({ status: "idle" });
  const [repository, setRepository] = useState("");
  const [addition, setAddition] = useState<Addition>({ state: "idle" });
  const inFlight = useRef(false);
  const lookups = useRef(0);
  const current = published !== undefined && published.revision >= base.revision ? published : base;
  const managed = managedOf(current.revision, current.manifest);
  if (managed === undefined)
    return (
      <Frame>
        <Alert variant="destructive">{revisionUnreadable}</Alert>
      </Frame>
    );
  const { manifest } = managed;
  if (removal.status === "removed") return <ProjectRemoved name={manifest.name} />;
  const review = reviewOf(managed, edit, new Date());
  const valid = Object.keys(review.errors).length === 0;
  const publishing = submission.status === "publishing";
  const shown = (field: string) => (attempted ? review.errors[field] : undefined);
  const update = (field: UpdateField, value: string) => store.update((latest) => withField(latest, field, value, managed.revision));
  const changePending = (change: (list: ReadonlyArray<PendingRepository>) => ReadonlyArray<PendingRepository>) =>
    store.update((latest) => withField(latest, "repositories", pendingText(change(pendingRepositories(latest.fields?.repositories ?? ""))), managed.revision));

  const publish = async () => {
    if (inFlight.current) return;
    setAttempted(true);
    const invalid = Object.keys(review.errors);
    if (invalid.length > 0) {
      flushSync(() => setOpen((groups) => new Set([...groups, ...invalid.map(groupOf)])));
      return focusField(fieldIds[invalid[0] ?? ""] ?? invalid[0] ?? "");
    }
    if (!review.changed || review.stale) return;
    const submitted = edit;
    inFlight.current = true;
    setSubmission({ status: "publishing" });
    const exit = await runtime.runPromiseExit(publishUpdate({ projectId: base.projectId, manifest: review.next, expectedRevision: managed.revision, monthlyAmount: review.monthlyAmount, actor: actorId }));
    inFlight.current = false;
    if (Exit.isSuccess(exit)) {
      const { project, setup: answered } = exit.value;
      const after = managedOf(project.revision, project.manifest)?.manifest;
      setPublished({ revision: project.revision, manifest: project.manifest, setup: answered });
      setSetup(answered);
      store.update((latest) => afterPublish(latest, submitted, repositoryIds(project.manifest), project.revision));
      setAttempted(false);
      return setSubmission({ status: "published", revision: project.revision, vaultSetup: after !== undefined && !isBountyOnly(after) && after.escrow !== undefined && after.escrow.deployments.length === 0 });
    }
    const failure = Exit.findErrorOption(exit);
    const refused = failure._tag === "Some" && failure.value._tag === "EditorRefused" ? failure.value : undefined;
    if (refused?.accessLost) return onAccessLost();
    setSubmission({ status: "failed", message: refused?.message ?? failureMessage(exit.cause, "Publication could not be confirmed."), staleRevision: refused?.staleRevision ?? false });
  };

  const remove = async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const exit = await runtime.runPromiseExit(removeManaged(base.projectId, managed.revision, actorId));
    inFlight.current = false;
    if (Exit.isSuccess(exit)) {
      setRemoval({ status: "removed" });
      return true;
    }
    const failure = Exit.findErrorOption(exit);
    const refused = failure._tag === "Some" && failure.value._tag === "EditorRefused" ? failure.value : undefined;
    if (refused?.accessLost) onAccessLost();
    setRemoval({ status: "refused", message: refused?.message ?? failureMessage(exit.cause, "Removal could not be confirmed. Try again."), staleRevision: refused?.staleRevision ?? false });
    return false;
  };

  const add = async () => {
    const name = normalizeRepositoryInput(repository);
    const lookup = ++lookups.current;
    if (listedNames(manifest, review.added).includes(name.toLowerCase())) return setAddition({ state: "error", message: `${name} is already listed.` });
    setAddition({ state: "loading" });
    const exit = await runtime.runPromiseExit(lookupRepository(name));
    if (lookup !== lookups.current) return;
    if (Exit.isFailure(exit)) return setAddition({ state: "error", message: failureMessage(exit.cause, "Repository could not load.") });
    const refusal = additionRefusal(exit.value, listedNames(manifest, pendingRepositories(store.get().edit.fields?.repositories ?? "")));
    if (refusal !== undefined) return setAddition({ state: "error", message: refusal });
    changePending((list) => [...list, addedRepository(exit.value)]);
    setRepository("");
    setAddition({ state: "idle" });
  };

  const reload = (
    <Button variant="link" onClick={onReload}>
      Reload
    </Button>
  );
  return (
    <main className={page}>
      <nav aria-label="Breadcrumb" className="text-sm">
        <a href={`/projects/${manifest.slug}`} className="text-muted-foreground hover:text-foreground">
          {manifest.name}
        </a>
      </nav>
      <PageHeader icon={<Settings2 aria-hidden />} title="Settings" actions={!review.monthly && !review.bountyOnly ? <Chip>External award</Chip> : undefined} />
      <ProjectNav runtime={runtime} project={{ id: base.projectId, slug: manifest.slug, bountyOnly: review.bountyOnly }} current="settings" />
      <SetupStatusPanel generation={published ? `revision-${published.revision}` : "initial"} runtime={runtime} projectId={base.projectId} actorId={actorId} initial={published?.setup} onSetup={setSetup} showProjectLink={false} />
      <UpdateForm
        review={review}
        manifest={manifest}
        shown={shown}
        open={open}
        onOpen={(group, next) => setOpen((groups) => (next ? new Set([...groups, group]) : new Set([...groups].filter((entry) => entry !== group))))}
        onChange={update}
        onPending={changePending}
        repository={repository}
        addition={addition}
        onRepository={(entry) => {
          setRepository(entry);
          if (addition.state === "error") setAddition({ state: "idle" });
        }}
        onAdd={() => void add()}
        publishing={publishing}
      />
      {review.stale ? (
        <Alert variant="destructive">
          <p>
            Draft is from {edit.baseRevision === -1 ? "an unknown rev" : `rev ${edit.baseRevision}`}; now rev {managed.revision}.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" onClick={() => store.update((latest) => ({ ...latest, baseRevision: managed.revision }))}>
              Keep
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                store.update(() => untouched);
                setAttempted(false);
                setSubmission({ status: "idle" });
              }}
            >
              Discard
            </Button>
          </div>
        </Alert>
      ) : null}
      {review.changed ? <ChangeReview changes={review.changes} rows={review.rows} addedRepositories={review.added.length} scanCleared={setup?.checks.scan.state === "cleared"} active={manifest.status === "active"} nextCycle={review.nextCycle} /> : null}
      {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}
      {attempted && (!valid || !review.changed) ? <Alert variant="destructive">{review.changed ? "Fix the marked fields." : "Nothing changed."}</Alert> : null}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button loading={publishing} disabled={review.stale} onClick={() => void publish()}>
            {publishing ? "Publishing…" : "Publish changes"}
          </Button>
          <RemoveProject
            name={manifest.name}
            disabled={publishing}
            remove={remove}
            reason={
              removal.status === "refused" ? (
                <>
                  {removal.message} {removal.staleRevision ? reload : null}
                </>
              ) : null
            }
          />
        </div>
        {submission.status === "failed" ? (
          <Alert variant="destructive" action={submission.staleRevision ? reload : undefined}>
            {submission.message}
          </Alert>
        ) : submission.status === "published" ? (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <Chip tone="Positive" icon={<Check aria-hidden />}>
              Rev {submission.revision}
            </Chip>
            {submission.vaultSetup ? (
              <a href="#project-vault" className="text-primary underline underline-offset-4">
                Set up vault
              </a>
            ) : null}
          </p>
        ) : null}
        <p role="status" className="text-sm text-muted-foreground">
          {saveFailed ? (
            <Chip tone="Negative" icon={<CloudOff aria-hidden />} title="This browser cannot save the draft.">
              Draft not saved
            </Chip>
          ) : saving ? (
            <span role="img" aria-label="Saving draft…" title="Saving draft…">
              <StatusIcon icon="Spinner" />
            </span>
          ) : (
            <span role="img" aria-label="Draft saved on this device" title="Draft saved on this device">
              <CloudCheck aria-hidden className="size-4" />
            </span>
          )}
        </p>
      </div>
      <Vault runtime={runtime} manifest={current.manifest} />
      <p id="security-settings">
        <a href={`/projects/${manifest.slug}/security#security-settings`} className="text-primary underline underline-offset-4">
          Manage security bounty
        </a>
      </p>
    </main>
  );
}

function Vault({ runtime, manifest }: { runtime: PageRuntime; manifest: unknown }) {
  const managed = managedOf(0, manifest)?.manifest;
  const project = fundingProjectOf(manifest);
  if (managed === undefined || project === undefined || isBountyOnly(managed) || !managed.escrow || managed.reward.kind === "external-prize-share") return null;
  return (
    <div id="project-vault">
      <PooledEscrow runtime={runtime} project={project} manifest={manifest} />
    </div>
  );
}

function PooledEscrow({ runtime, project, manifest }: { runtime: PageRuntime; project: FundingProject; manifest: unknown }) {
  const reads = useOnce(projectRuntime(runtime), "reads", () => projectReads());
  return reads.status === "done" ? <CurrentPool runtime={runtime} project={project} manifest={manifest} pool={reads.value.pool} /> : <EscrowFunding runtime={runtime} project={project} />;
}

function CurrentPool({ runtime, project, manifest, pool }: { runtime: PageRuntime; project: FundingProject; manifest: unknown; pool: ShownRead<PoolFundingIndex> }) {
  const read = useShownRead(pool, "all");
  const shown = projectOf(manifest);
  const facts = shown !== undefined && read.status === "Current" ? projectFunding({ project: shown, read: { status: read.status, vaults: read.value?.get(shown.id) }, networkPays, nowMs: Date.now() }).facts : undefined;
  return <EscrowFunding runtime={runtime} project={project} pool={facts} />;
}

function ProjectEditor(props: EditorProps) {
  const store = useEditStore(props.runtime, props.base.projectId);
  if (store === undefined)
    return (
      <Frame>
        <Waiting>Loading saved draft…</Waiting>
      </Frame>
    );
  return <Editor {...props} store={store} />;
}

function MaintainerGate({ runtime, base, actorId, onReload, loadError }: Omit<EditorProps, "onAccessLost">) {
  const [attempt, setAttempt] = useState(0);
  const access = useRun(runtime, `maintainer:${base.projectId}:${actorId}:${attempt}`, () => maintainerCheck(base.projectId, actorId), "Project access could not be checked. Retry.");
  const retry = () => setAttempt((count) => count + 1);
  if (access === undefined || access.status === "running")
    return (
      <Frame>
        <Waiting>Checking access…</Waiting>
      </Frame>
    );
  const check = access.status === "failed" ? { kind: "Failed" as const, message: access.message } : access.value;
  if (check.kind === "Allowed") return <ProjectEditor key={`${base.projectId}:${actorId}`} runtime={runtime} base={base} actorId={actorId} onAccessLost={retry} onReload={onReload} loadError={loadError} />;
  return (
    <Frame>
      {check.kind === "Failed" ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        >
          {check.message}
        </Alert>
      ) : (
        <p role="status" className="flex items-center gap-2">
          <Lock aria-hidden className="size-4" /> Maintainers only
        </p>
      )}
    </Frame>
  );
}

/** Manage project: the current revision edited and published directly by a current maintainer, with its setup status, added repositories and removal. */
export function UpdatePage({ runtime, route }: PageProps) {
  const segment = route.projectId;
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<CurrentRevision>();
  const read = useRun(runtime, `revision:${segment}:${reloads}`, () => currentRevision(segment), revisionUnreadable, {
    settle: (value) => {
      if (value !== undefined) setLoaded(value);
    },
  });
  const shown = useSession(runtime);
  if (shown === undefined || shown.view.status === "checking")
    return (
      <Frame>
        <Waiting>Checking access…</Waiting>
      </Frame>
    );
  if (shown.view.status !== "signedIn")
    return (
      <Frame>
        <SignInPanel view={shown.view} href={loginHrefFor(shown, `/projects/${segment}/manage`)} purpose={signInPurposes.ManageProject} />
      </Frame>
    );
  const base = loaded ?? (read?.status === "done" ? read.value : undefined);
  if (base === undefined) {
    if (read?.status === "done") return <NotFound title="Project not found" />;
    return (
      <Frame>
        {read?.status === "failed" ? (
          <Alert
            variant="destructive"
            action={
              <Button variant="outline" size="sm" onClick={() => setReloads((count) => count + 1)}>
                Retry
              </Button>
            }
          >
            {read.message}
          </Alert>
        ) : (
          <Waiting>Loading project…</Waiting>
        )}
      </Frame>
    );
  }
  return <MaintainerGate key={shown.view.session.githubId} runtime={runtime} base={base} actorId={shown.view.session.githubId} onReload={() => setReloads((count) => count + 1)} loadError={read?.status === "failed" ? read.message : undefined} />;
}
