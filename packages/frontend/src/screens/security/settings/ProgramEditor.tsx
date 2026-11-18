// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { isFullAwardSplit } from "@repo/security/client";
import { Alert, Button, Disclosure, Field, Input, Select, Textarea } from "@repo/ui";
import { Result, Schema } from "effect";
import { type FormEvent, useState } from "react";
import { RewardAssetFields } from "../../setup/fields/RewardAssetFields.tsx";
import { SecurityOffer } from "../program/SecurityOffer.tsx";
import { ProgramTerms } from "../program/terms.schema.ts";
import {
  type EditorForm,
  type EditorProject,
  type TextField,
  afterApproval,
  amountCurrency,
  amountPreview,
  boundVault,
  contacts,
  editorSplit,
  fieldProblem,
  initialForm,
  programProblem,
  proposedProgram,
  responseFields,
  responseGroup,
  textFields,
  textGroups,
  textLimits,
} from "./editor.ts";

export type Publish = (manifest: Readonly<Record<string, unknown>>) => Promise<string | null>;

export type ProgramEditorProps = {
  project: EditorProject;
  actor: { readonly githubId: string; readonly githubLogin: string };
  /** Publishes the manifest with the new terms at the editor's revision; answers why it was refused, or null once published. */
  onPublish: Publish;
};

const decodeTerms = Schema.decodeUnknownResult(ProgramTerms);

const statusLabels: ReadonlyArray<readonly [EditorForm["status"], string]> = [
  ["draft", "Draft"],
  ["pending-approval", "Pending"],
  ["paused", "Paused"],
  ["open", "Open"],
  ["closed", "Closed"],
];

type Opened = { open: boolean; onOpenChange: (open: boolean) => void };

function TextGroup({ title, keys, form, busy, set, opened }: { title: string; keys: ReadonlyArray<TextField>; form: EditorForm; busy: boolean; set: (key: TextField, value: string) => void; opened: Opened }) {
  return (
    <Disclosure summary={title} {...opened}>
      <fieldset disabled={busy} className="flex flex-col gap-4 pt-2">
        <legend className="sr-only">{title}</legend>
        {textFields
          .filter(([key]) => keys.includes(key))
          .map(([key, label]) => {
            const limits = textLimits(key);
            return (
              <Field key={key} label={label}>
                <Textarea rows={3} required={limits.required} minLength={limits.minLength} maxLength={limits.maxLength} value={form.text[key]} onChange={(event) => set(key, event.target.value)} />
              </Field>
            );
          })}
      </fieldset>
    </Disclosure>
  );
}

function Review({ project, form, actor }: Pick<ProgramEditorProps, "project" | "actor"> & { form: EditorForm }) {
  const proposed = decodeTerms({ ...proposedProgram(project, form, actor), status: "open" });
  return (
    <section aria-label="Review bounty terms" className="flex flex-col gap-3">
      <h3 className="font-semibold text-foreground">Review before publishing</h3>
      <p>Proposed status: {form.status}. Changes apply to future reports only.</p>
      {Result.isSuccess(proposed) ? <SecurityOffer terms={proposed.success} amountPreview={amountPreview(project, form)} /> : null}
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="font-medium text-muted-foreground">Covered revision</dt>
          <dd>{form.commit}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Covered assets</dt>
          <dd className="whitespace-pre-line">{form.text.includedAssets}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Safe testing</dt>
          <dd>{form.text.testingPermission}</dd>
        </div>
      </dl>
    </section>
  );
}

/** The owner's public bounty terms: edited, reviewed, then published as a new revision against the current one. */
export function ProgramEditor({ project, actor, onPublish }: ProgramEditorProps) {
  const [form, setForm] = useState<EditorForm>(() => initialForm(project));
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const opened = (group: string): Opened => ({
    open: open.has(group),
    onOpenChange: (next) => setOpen((current) => new Set(next ? [...current, group] : [...current].filter((entry) => entry !== group))),
  });
  const existing = project.existing?.terms;
  const fullAward = isFullAwardSplit(editorSplit(project));
  const later = afterApproval(project);
  const preview = amountPreview(project, form);
  const update = (change: Partial<EditorForm>) => setForm((current) => ({ ...current, ...change }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const field = fieldProblem(form);
    if (field !== undefined) {
      opened(field.group).onOpenChange(true);
      return setError(field.message);
    }
    const problem = programProblem(project, form);
    if (problem !== undefined) return setError(problem);
    setError(null);
    if (!reviewing) return setReviewing(true);
    const program = proposedProgram(project, form, actor);
    setBusy(true);
    void onPublish({ ...project.manifest, securityBounty: program }).then((refused) => {
      setBusy(false);
      setReviewing(false);
      setError(refused);
    });
  };
  const statuses = statusLabels.filter(([value]) => (value !== "draft" && value !== "pending-approval") || existing?.status === value);
  return (
    <section aria-labelledby="owner-security-title" className="flex flex-col gap-4">
      <h2 id="owner-security-title" className="text-xl font-semibold text-foreground">
        Security bounty
      </h2>
      <p className="text-muted-foreground">
        {fullAward ? "You decide each award. The researcher receives the whole award and Slop takes no share." : "You decide each award: 75% to the researcher, 25% to Slop."} Changes apply to future reports only.
      </p>
      {existing ? (
        <p>
          <a href={`/projects/${project.slug}/security`} className="text-primary underline underline-offset-4 hover:decoration-2">
            View public terms
          </a>{" "}
          ·{" "}
          <a href="/security" className="text-primary underline underline-offset-4 hover:decoration-2">
            Open private cases
          </a>
        </p>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div hidden={reviewing} className="flex flex-col gap-4">
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <legend className="text-sm font-medium text-foreground">Offer</legend>
            <Field label="Status">
              <Select value={form.status} onChange={(event) => update({ status: statuses.find(([value]) => value === event.target.value)?.[0] ?? form.status })}>
                {statuses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Published gross award (${amountCurrency(project, form)})`}>
              <Input inputMode="decimal" required value={form.amount} onChange={(event) => update({ amount: event.target.value })} />
            </Field>
            {preview ? (
              <dl aria-label="Award split preview" className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Gross award</dt>
                  <dd>{preview.gross}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Researcher · {fullAward ? "100%" : "75%"}</dt>
                  <dd>{preview.researcher}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Slop · {fullAward ? "0%" : "25%"}</dt>
                  <dd>{preview.slop}</dd>
                </div>
              </dl>
            ) : null}
            <p>A discretionary award, not a promised payment.</p>
            {existing?.amount.currency === "USD" && !existing.amount.asset ? (
              <p>USD</p>
            ) : (
              <RewardAssetFields
                compact
                namePrefix="bounty"
                choice={form.asset}
                error={() => undefined}
                networkFixed={boundVault(project)}
                onChange={(field, value) => setForm((current) => ({ ...current, assetChanged: true, asset: { ...current.asset, [field]: value } }))}
              />
            )}
            <Field label="Planned awards" hint={later ? "Leave blank to review each first qualifying finding separately." : undefined}>
              <Input type="number" min="1" max="1000" required={!later} value={form.awards} onChange={(event) => update({ awards: event.target.value })} />
            </Field>
            <Field label={`Source commit (${existing?.scope.sourceRevisions[0]?.repository ?? project.repository})`}>
              <Input required minLength={40} maxLength={40} pattern="[0-9a-f]{40}" value={form.commit} onChange={(event) => update({ commit: event.target.value })} />
            </Field>
          </fieldset>
          {textGroups.map(([title, keys]) => (
            <TextGroup key={title} title={title} keys={keys} form={form} busy={busy} opened={opened(title)} set={(key, value) => setForm((current) => ({ ...current, text: { ...current.text, [key]: value } }))} />
          ))}
          <Disclosure summary={responseGroup} {...opened(responseGroup)}>
            <fieldset disabled={busy} className="flex flex-col gap-4 pt-2">
              <legend className="sr-only">Response targets</legend>
              {responseFields.map(([key, label, max]) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    min="1"
                    max={max}
                    required
                    value={form.response[key]}
                    onChange={(event) => setForm((current) => ({ ...current, response: { ...current.response, [key]: Number(event.target.value) } }))}
                  />
                </Field>
              ))}
              <p>Project contacts: {contacts(project, actor)}.</p>
            </fieldset>
          </Disclosure>
        </div>
        {reviewing ? (
          <>
            <Review project={project} form={form} actor={actor} />
            <Button variant="outline" className="self-start" disabled={busy} onClick={() => setReviewing(false)}>
              Edit bounty terms
            </Button>
          </>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Publishing…" : reviewing ? "Publish bounty terms" : "Review bounty terms"}
        </Button>
      </form>
    </section>
  );
}
