// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { isFullAwardSplit } from "@repo/security/client";
import { Alert, Button, Field, Input, Select, Status, type StatusProps, Textarea, cn, focusRing } from "@repo/ui";
import { ChevronDown } from "lucide-react";
import { Result, Schema } from "effect";
import { type FormEvent, type ReactNode, useState } from "react";
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
  initialForm,
  programProblem,
  proposedProgram,
  responseFields,
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

const reviewTones: Readonly<Record<EditorForm["status"], StatusProps["presentation"]>> = {
  draft: { tone: "Caution", icon: "Dot", label: "draft" },
  "pending-approval": { tone: "Caution", icon: "Clock", label: "pending-approval" },
  paused: { tone: "Caution", icon: "Pause", label: "paused" },
  open: { tone: "Positive", icon: "Check", label: "open" },
  closed: { tone: "Neutral", icon: "Ban", label: "closed" },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group flex flex-col gap-2">
      <summary className={cn(focusRing, "inline-flex cursor-pointer list-none items-center gap-1 self-start rounded-sm font-medium text-foreground hover:text-primary [&::-webkit-details-marker]:hidden")}>
        <ChevronDown aria-hidden className="size-4 -rotate-90 group-open:rotate-0 motion-safe:transition-transform motion-safe:duration-fast" />
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-4">{children}</div>
    </details>
  );
}

function TextGroup({ title, keys, form, busy, set }: { title: string; keys: ReadonlyArray<TextField>; form: EditorForm; busy: boolean; set: (key: TextField, value: string) => void }) {
  return (
    <Group title={title}>
      <fieldset disabled={busy} className="flex flex-col gap-4">
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
    </Group>
  );
}

function Review({ project, form, actor }: Pick<ProgramEditorProps, "project" | "actor"> & { form: EditorForm }) {
  const proposed = decodeTerms({ ...proposedProgram(project, form, actor), status: "open" });
  return (
    <section aria-label="Review bounty terms" className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-semibold text-foreground">
        Review <Status presentation={reviewTones[form.status]} />
      </h3>
      <p>
        <Status presentation={{ tone: "Neutral", icon: "Clock", label: "Future reports only" }} />
      </p>
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

function openGroups(event: FormEvent) {
  let group = (event.target as HTMLElement).closest("details");
  while (group !== null) {
    group.open = true;
    group = group.parentElement?.closest("details") ?? null;
  }
}

/** The owner's public bounty terms: edited, reviewed, then published as a new revision against the current one. */
export function ProgramEditor({ project, actor, onPublish }: ProgramEditorProps) {
  const [form, setForm] = useState<EditorForm>(() => initialForm(project));
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = project.existing?.terms;
  const fullAward = isFullAwardSplit(editorSplit(project));
  const later = afterApproval(project);
  const preview = amountPreview(project, form);
  const update = (change: Partial<EditorForm>) => setForm((current) => ({ ...current, ...change }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
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
      <p className="text-muted-foreground">{fullAward ? "100% to researcher" : "75% researcher · 25% Slop"}</p>
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
      <form className="flex flex-col gap-4" onInvalidCapture={openGroups} onSubmit={submit}>
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
            <Field
              label={
                <>
                  Award ({amountCurrency(project, form)}) <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Discretionary" }} />
                </>
              }
            >
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
            <Field label="Planned awards" hint={later ? "Blank = each finding reviewed separately" : undefined}>
              <Input type="number" min="1" max="1000" required={!later} placeholder={later ? "No limit" : undefined} value={form.awards} onChange={(event) => update({ awards: event.target.value })} />
            </Field>
            <Field label={`Source commit (${existing?.scope.sourceRevisions[0]?.repository ?? project.repository})`}>
              <Input required minLength={40} maxLength={40} pattern="[0-9a-f]{40}" value={form.commit} onChange={(event) => update({ commit: event.target.value })} />
            </Field>
          </fieldset>
          {textGroups.map(([title, keys]) => (
            <TextGroup key={title} title={title} keys={keys} form={form} busy={busy} set={(key, value) => setForm((current) => ({ ...current, text: { ...current.text, [key]: value } }))} />
          ))}
          <Group title="Response targets">
            <fieldset disabled={busy} className="flex flex-col gap-4">
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
            </fieldset>
            <p className="flex flex-wrap items-center gap-2">
              Contacts:{" "}
              {contacts(project, actor).map((login) => (
                <Status key={login} presentation={{ tone: "Neutral", icon: "Dot", label: `@${login}` }} />
              ))}
            </p>
          </Group>
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
