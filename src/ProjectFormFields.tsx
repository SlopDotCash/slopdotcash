import type { ReactNode } from "react";

export function TextField({
  label,
  name,
  value,
  error,
  hint,
  multiline = false,
  onChange,
  ...input
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  hint?: ReactNode;
  multiline?: boolean;
  onChange: (value: string) => void;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  type?: string;
}) {
  const id = `field-${name}`;
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  const shared = {
    "aria-describedby": described || undefined,
    "aria-invalid": error ? true : undefined,
    id,
    name,
    value,
  };
  return (
    <div
      className={`form-field${!multiline && ["name", "stewardLogin", "integrationBranch", "licenseSpdx", "rewardAssetSymbol", "monthlyPool"].includes(name) ? " field-compact" : ""}${error ? " form-field-invalid" : ""}`}
    >
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...shared}
          onChange={(event) => onChange(event.target.value)}
          placeholder={input.placeholder}
        />
      ) : (
        <input
          {...shared}
          {...input}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? (
        <small className="field-hint" id={`${id}-hint`}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  value,
  error,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = `field-${name}`;
  return (
    <div
      className={`form-field field-compact${error ? " form-field-invalid" : ""}`}
    >
      <label htmlFor={id}>{label}</label>
      <select
        disabled={disabled}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {error ? (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

export function ChoiceField({
  label,
  name,
  value,
  options,
  error,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: [string, string][];
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset
      className="setup-choice"
      aria-describedby={error ? `field-${name}-error` : undefined}
    >
      <legend>{label}</legend>
      <div className="setup-choice-options">
        {options.map(([optionValue, optionLabel], index) => (
          <label key={optionValue}>
            <input
              id={index === 0 ? `field-${name}` : undefined}
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
      {error ? (
        <small className="field-error" id={`field-${name}-error`}>
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}
