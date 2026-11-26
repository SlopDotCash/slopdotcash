// spec/ui/controls.md, "An invalid field is described by its error, then its hint"
import { describedBy, Input, Label, RadioGroup, type RadioOption, Select, StatusIcon, Textarea } from "@repo/ui";
import type { ReactNode } from "react";

const fieldLabel = "text-xs font-bold";

/** @throws {never} */
export function fieldId(name: string): string {
  return `field-${name}`;
}

function description(name: string, error: ReactNode, hint: ReactNode) {
  const id = fieldId(name);
  const ids = describedBy({ invalid: Boolean(error), hasError: Boolean(error), hasHint: Boolean(hint) }).map((part) => (part === "ErrorText" ? `${id}-error` : `${id}-hint`));
  return {
    control: { id, name, "aria-invalid": error ? true : undefined, "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined },
    messages: (
      <>
        {error ? (
          <p id={`${id}-error`} className="flex items-center gap-2 text-sm text-destructive">
            <StatusIcon icon="Alert" />
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </>
    ),
  };
}

export type TextFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  type?: "text" | "url" | "datetime-local";
};

/** A text field whose control, error and hint keep the ids `field-<name>`, `field-<name>-error` and `field-<name>-hint`. */
export function TextField({ label, name, value, onChange, error, hint, multiline = false, inputMode, placeholder, type = "text" }: TextFieldProps) {
  const { control, messages } = description(name, error, hint);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={control.id} className={fieldLabel}>
        {label}
      </Label>
      {multiline ? (
        <Textarea {...control} className="h-20 min-h-20 px-3 py-2.5 text-sm" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...control} type={type} inputMode={inputMode} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
      {messages}
    </div>
  );
}

export type SelectFieldProps = {
  label: string;
  name: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
};

/** A choice from a list, with the same stable ids as `TextField`. */
export function SelectField({ label, name, value, options, onChange, error, disabled = false }: SelectFieldProps) {
  const { control, messages } = description(name, error, undefined);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={control.id} className={fieldLabel}>
        {label}
      </Label>
      <Select {...control} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </Select>
      {messages}
    </div>
  );
}

export type ChoiceFieldProps = {
  label: ReactNode;
  name: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: ReactNode]>;
  onChange: (value: string) => void;
  error?: string;
};

/** One choice among a few, all visible; the group keeps the id `field-<name>`. */
export function ChoiceField({ label, name, value, options, onChange, error }: ChoiceFieldProps) {
  const choices: RadioOption[] = options.map(([option, text]) => ({ value: option, label: text }));
  return <RadioGroup id={fieldId(name)} name={name} legend={label} options={choices} value={value} error={error} onValueChange={onChange} />;
}

/** Moves focus to a field by its name: the control itself, or the first control of a group. */
export function focusField(name: string): void {
  const target = document.getElementById(fieldId(name));
  const control = target?.matches("input, select, textarea, button, a") ? target : target?.querySelector<HTMLElement>("input, select, textarea, button, [role=radio]");
  control?.focus();
}
