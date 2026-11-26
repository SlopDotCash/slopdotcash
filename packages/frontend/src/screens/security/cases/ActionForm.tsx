// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { SECURITY_FULL_AWARD_SPLIT, SECURITY_SPLIT, bountyShares, isFullAwardSplit } from "@repo/security/client";
import { Alert, Button, Checkbox, Field, Input, Label, Select, Status, Textarea } from "@repo/ui";
import { Eye, LockKeyhole } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { decimalToMinor } from "./amount.ts";
import type { SecurityCase } from "./case.schema.ts";
import { type FieldSpec, type FieldValues, actionFields, actionSpec, fieldShown, initialValues } from "./actionSpec.ts";
import { badge, money } from "./labels.ts";

export type Sent = { readonly key: string | null; readonly error: string | null };

export type ActionFormProps = {
  action: string;
  record: SecurityCase;
  /** Sends the action with the request key a retry of this form keeps; answers the refusal's message, or null once saved. */
  onSend: (fields: Readonly<Record<string, unknown>>, key: string | null) => Promise<Sent>;
};

function SharePreview({ record, value, decimals }: { record: SecurityCase; value: string; decimals: number }) {
  const minor = decimalToMinor(value, decimals);
  if (minor === undefined || record.terms === null) return null;
  const terms = record.terms;
  const full = isFullAwardSplit(terms.split);
  const split = bountyShares(minor, full ? SECURITY_FULL_AWARD_SPLIT : SECURITY_SPLIT);
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {split.kind === "split"
        ? full
          ? `100% researcher ${money(split.shares.researcherMinor, terms)}`
          : `75% researcher ${money(split.shares.researcherMinor, terms)} | 25% Slop ${money(split.shares.slopMinor, terms)}`
        : "Not divisible 75/25"}
    </p>
  );
}

function Marked({ label, mark }: { label: string; mark?: "Private" | "Fixed" }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      {mark ? (
        <span role="img" aria-label={mark} title={mark} className="inline-flex text-muted-foreground">
          <LockKeyhole aria-hidden className="size-3.5" />
        </span>
      ) : null}
    </span>
  );
}

function FormField({ field, record, values, set }: { field: FieldSpec; record: SecurityCase; values: FieldValues; set: (value: string | boolean) => void }) {
  const id = useId();
  const value = values[field.name] ?? "";
  switch (field.kind) {
    case "checkbox":
      return (
        <div className="flex items-start gap-3">
          <Checkbox id={id} checked={value === true} onCheckedChange={(checked) => set(checked === true)} />
          <Label htmlFor={id} className="inline-flex items-center gap-1">
            {field.publicNotice ? <Eye aria-hidden className="size-3.5" /> : null}
            {field.label}
            {field.info ? ` · ${field.info}` : null}
          </Label>
        </div>
      );
    case "select": {
      const only = field.name === "network" && field.options.length === 1 ? field.options[0] : undefined;
      if (only)
        return (
          <p>
            <Status title={field.label} presentation={badge(only[1])} />
          </p>
        );
      return (
        <Field label={field.label}>
          <Select required value={String(value)} onChange={(event) => set(event.target.value)}>
            {field.options.map(([option, label]) => (
              <option key={option} value={option}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
    case "utc":
      return (
        <Field label={field.label}>
          <Input required type="datetime-local" value={String(value)} onChange={(event) => set(event.target.value)} />
        </Field>
      );
    case "amount":
      return (
        <div className="flex flex-col gap-2">
          <Field label={<Marked label={field.label} mark={field.readOnly ? "Fixed" : undefined} />} hint={field.chip ? <Status presentation={badge(field.chip)} /> : undefined}>
            <Input autoComplete="off" inputMode="decimal" readOnly={field.readOnly} required value={String(value)} onChange={(event) => set(event.target.value)} />
          </Field>
          <SharePreview record={record} value={String(value)} decimals={field.decimals} />
        </div>
      );
    case "textarea":
    case "text": {
      const required = !field.optional || (field.requiredWhen?.values.includes(String(values[field.requiredWhen.field])) ?? false);
      const label = <Marked label={field.label} mark={field.private ? "Private" : undefined} />;
      return field.kind === "textarea" ? (
        <Field label={label}>
          <Textarea required={required} placeholder={field.placeholder} rows={3} value={String(value)} onChange={(event) => set(event.target.value)} />
        </Field>
      ) : (
        <Field label={label}>
          <Input autoComplete="off" required={required} placeholder={field.placeholder} spellCheck={false} value={String(value)} onChange={(event) => set(event.target.value)} />
        </Field>
      );
    }
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/** One case action as a private form; the action's own answer, never a model, decides it. */
export function ActionForm({ action, record, onSend }: ActionFormProps) {
  const spec = actionSpec(action, record);
  const [values, setValues] = useState<FieldValues>(() => (spec ? initialValues(spec) : {}));
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  if (spec === null) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const built = actionFields(action, spec, values);
    if (!built.ok) return setError(built.message);
    setBusy(true);
    setError(null);
    void onSend(built.fields, key).then((sent) => {
      setKey(sent.key);
      setBusy(false);
      setError(sent.error);
    });
  };
  return (
    <form aria-labelledby={titleId} data-case-action={action} className="flex flex-col gap-4" onSubmit={submit}>
      <h4 id={titleId} className="font-semibold text-foreground">
        {spec.title}
      </h4>
      {spec.fields
        .filter((field) => fieldShown(field, values))
        .map((field) => (
          <FormField key={field.name} field={field} record={record} values={values} set={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
        ))}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button type="submit" variant="outline" className="self-start" loading={busy}>
        {busy ? "Saving…" : spec.submit}
      </Button>
    </form>
  );
}
