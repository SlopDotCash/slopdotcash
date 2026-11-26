// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/projectDrafts.md, "An administrator's manifest draft is cleared only after its exact submitted text was accepted or on discard"
import { contributionFields } from "@repo/contributor/render/fields";
import { isChain } from "@repo/settlement/kernels/networks";
import { Alert, Button, Checkbox, CompareChange, Field, Input, Label, Select, Textarea } from "@repo/ui";
import { ArrowUpRight, CircleCheck, Globe, Save, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { formatDateTime } from "../../app/format.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { adminMessages, discardManifestDraft, restoredManifestDraft, saveManifestDraft, submitManifest } from "../../flows/projects/admin.vibe";
import { isAdminActionAccessLoss } from "../../session/adminAccess.vibe";
import { contributionLabels } from "../setup/fields/contribution.ts";
import { RewardAssetFields } from "../setup/fields/RewardAssetFields.tsx";
import { useRun } from "../setup/proposal/run.ts";
import { ActivationClearance } from "./ActivationClearance.tsx";
import { type AssetDraft, builtManifest, changedFields, changeLabel, detailFields, draftText, editorMessages, initialDraft, type ManifestDraft, projectFieldsOf, skillBound, skillErrors, withAsset, withProjectField } from "./editor.ts";
import { act, Chip, openWithin, Waiting } from "./parts.tsx";
import { type AdminProject, adminHref } from "./projects.ts";

export type ProjectEditorProps = {
  runtime: PageRuntime;
  project: AdminProject;
  actorId: string;
  onAccessLost: () => void;
  onSaved: (note: string) => void;
  onCancel: () => void;
};

const fieldset = "flex flex-col gap-4 rounded-md border border-border p-4";
const legend = "px-1 text-sm font-semibold text-foreground";

function ChangedValue({ value, empty }: { value: unknown; empty: string }) {
  if (value === undefined || value === null) return <>{empty}</>;
  if (typeof value !== "object") return <>{String(value)}</>;
  return <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
}

type EditorProps = ProjectEditorProps & { start: ManifestDraft };

function Editor({ runtime, project, actorId, onAccessLost, onSaved, onCancel, start }: EditorProps) {
  const [draft, setDraft] = useState(start);
  const [draftError, setDraftError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef(start);
  const inFlightRef = useRef(false);
  const change = (next: ManifestDraft) => {
    latestRef.current = next;
    setDraft(next);
    void runtime.runPromise(saveManifestDraft(project.id, project.revision, draftText(next))).then((saved) => setDraftError(!saved));
  };
  const update = (patch: Partial<ManifestDraft>) => change({ ...latestRef.current, ...patch });
  const updateAsset = (patch: Partial<AssetDraft>) => update({ asset: withAsset(latestRef.current.asset, patch), assetSelected: true });
  const fields = projectFieldsOf(draft.text);
  const errors = skillErrors(draft.skill);
  const built = builtManifest(project, draft);
  const changed = built.kind === "manifest" ? changedFields(project.raw, built.manifest) : [];
  const stored = project.manifest.rewardAsset;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current) return;
    if (built.kind === "invalid") return setError(built.message);
    const submitted = draftText(draft);
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    const acted = await act(runtime, submitManifest({ projectId: project.id, revision: project.revision, manifest: built.manifest, reason: draft.reason, draft: submitted, actorGithubId: actorId }), isAdminActionAccessLoss, "The revision could not be confirmed.");
    inFlightRef.current = false;
    setBusy(false);
    if (!acted.ok) return acted.accessLost ? onAccessLost() : setError(acted.message);
    if (draftText(latestRef.current) !== submitted) return setError(editorMessages.newerEdits);
    onSaved(adminMessages.saved);
  };

  const discard = async () => {
    const discarded = await runtime.runPromise(discardManifestDraft(project.id, project.revision));
    if (discarded) onCancel();
    else setError(editorMessages.discardFailed);
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void save(event)}>
      <h3 className="sr-only">Edit project</h3>
      <fieldset className={fieldset} disabled={fields === undefined}>
        <legend className={legend}>Project details</legend>
        {detailFields.map(([field, label, maxLength]) => (
          <Field key={field} label={label}>
            <Textarea rows={field === "description" ? 3 : 1} maxLength={maxLength} value={typeof fields?.[field] === "string" ? fields[field] : ""} onChange={(event) => fields && update({ text: withProjectField(fields, field, event.target.value) })} />
          </Field>
        ))}
      </fieldset>
      <fieldset className={fieldset}>
        <legend className={legend}>Status</legend>
        <ActivationClearance runtime={runtime} actorId={actorId} projectId={project.id} revision={project.revision} onAccessLost={onAccessLost} />
        <Field label="Project status">
          <Select value={draft.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="paused">Paused</option>
            <option value="active">Active</option>
          </Select>
        </Field>
        <a href={adminHref(project.id, "security")} onClick={openWithin(adminHref(project.id, "security"))} className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4 [&_svg]:size-4">
          <ShieldCheck aria-hidden /> Security vetting <ArrowUpRight aria-hidden />
        </a>
      </fieldset>
      <fieldset className={fieldset}>
        <legend className={legend}>Discovery</legend>
        <div className="flex items-center gap-3">
          <Checkbox
            id="admin-featured"
            checked={(fields?.listingTier ?? project.manifest.listingTier) === "featured"}
            disabled={busy || fields === undefined || project.enforcement.state !== "clear"}
            onCheckedChange={(checked) => fields && update({ text: withProjectField(fields, "listingTier", checked === true ? "featured" : "community") })}
          />
          <Label htmlFor="admin-featured">Featured</Label>
        </div>
      </fieldset>
      <fieldset className={fieldset}>
        <legend className={legend}>Contribution fields</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {contributionFields.map((field) => {
            const label = contributionLabels[field].label;
            const bound = skillBound(field);
            return (
              <div key={field} className="flex flex-col gap-1">
                <Field label={label} error={errors[field] ? <span title={bound.full}>{bound.short}</span> : undefined}>
                  <Textarea aria-label={label} rows={field === "securityContact" ? 1 : 3} value={draft.skill[field]} onChange={(event) => update({ skill: { ...latestRef.current.skill, [field]: event.target.value } })} />
                </Field>
                {errors[field] ? null : (
                  <small aria-hidden title={bound.full} className="text-xs text-muted-foreground">
                    {draft.skill[field].trim().length} / 2000
                  </small>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      <fieldset className={fieldset}>
        <legend className={legend}>Reward asset</legend>
        {draft.assetSelected ? null : (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => update({ assetSelected: true })}>
            Set asset
          </Button>
        )}
        <RewardAssetFields
          namePrefix="admin"
          networkFixed={false}
          choice={{ network: draft.asset.network, assetKind: draft.asset.kind, tokenAddress: draft.asset.address, tokenSymbol: draft.asset.symbol }}
          error={() => undefined}
          onChange={(field, value) => {
            if (field === "network" && isChain(value)) updateAsset({ network: value });
            if (field === "assetKind" && (value === "stablecoin" || value === "native" || value === "token")) updateAsset({ kind: value });
            if (field === "tokenAddress") updateAsset({ address: value });
            if (field === "tokenSymbol") updateAsset({ symbol: value });
          }}
        />
        {stored ? (
          <p>
            <Chip tone="Positive" icon={<CircleCheck aria-hidden />} {...(stored.verifiedAt ? { title: `Verified ${formatDateTime(stored.verifiedAt)}` } : {})}>
              {stored.symbol} · {stored.decimals} dp
            </Chip>
          </p>
        ) : null}
      </fieldset>
      <fieldset className={fieldset}>
        <legend className={legend}>Advanced</legend>
        <Field label="Manifest JSON">
          <Textarea className="min-h-80 font-mono text-xs" spellCheck={false} value={draft.text} onChange={(event) => update({ text: event.target.value })} />
        </Field>
      </fieldset>
      <section aria-label="Revision changes" className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-foreground">Review changes</h3>
        {built.kind === "invalid" ? (
          <p role="status" className="text-sm">
            {built.message}
          </p>
        ) : changed.length === 0 ? (
          <p className="text-sm">No changes.</p>
        ) : (
          <CompareChange changes={changed.map((field) => ({ label: changeLabel(field), current: <ChangedValue value={project.raw[field]} empty="Not set" />, proposed: <ChangedValue value={built.manifest[field]} empty="Removed" /> }))} />
        )}
      </section>
      <Field
        label={
          <span className="inline-flex items-center gap-2">
            Reason
            <Chip icon={<Globe aria-hidden />} title="Shown publicly">
              Public
            </Chip>
          </span>
        }
      >
        <Input maxLength={1000} required value={draft.reason} onChange={(event) => update({ reason: event.target.value })} />
      </Field>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy} disabled={busy || draft.reason.trim() === "" || built.kind === "invalid" || changed.length === 0}>
          <Save aria-hidden />
          {busy ? "Saving…" : `Save revision ${project.revision + 1}`}
        </Button>
        {draftError ? (
          <span role="status" className="self-center">
            <Chip tone="Caution" icon={<TriangleAlert aria-hidden />}>
              Draft not stored
            </Chip>
          </span>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          <X aria-hidden />
          Close
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
          <Trash2 aria-hidden />
          Discard draft
        </Button>
      </div>
    </form>
  );
}

/** Edits one project revision: the structured skill, reward asset and status fields have one editable source, the advanced JSON holds only the other keys, and the draft of this exact revision survives a reload of the tab. */
export function ProjectEditor(props: ProjectEditorProps) {
  const { runtime, project } = props;
  const restored = useRun(runtime, `admin-draft:${project.id}:${project.revision}`, () => restoredManifestDraft(project.id, project.revision), "The saved draft could not be read.");
  if (restored === undefined || restored.status === "running") return <Waiting>Loading saved draft…</Waiting>;
  return <Editor {...props} start={initialDraft(project, restored.status === "done" ? restored.value : undefined)} />;
}
