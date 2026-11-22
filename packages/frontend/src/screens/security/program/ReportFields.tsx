// spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"; spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"
import { Disclosure, Field, Input, Select, Textarea } from "@repo/ui";
import { useState } from "react";
import type { ReportDraft } from "../../../flows/security/private.vibe";
import { descriptionLimit } from "../../../flows/security/reportFile.vibe";
import { ReportProofFields } from "./ReportProofFields.tsx";

export type ReportFieldsProps = {
  draft: ReportDraft;
  onChange: (draft: ReportDraft) => void;
  disabled?: boolean;
};

const severities: ReadonlyArray<readonly [string, string]> = [
  ["", "Not set"],
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

export function ReportFields({ draft, onChange, disabled = false }: ReportFieldsProps) {
  const [classified, setClassified] = useState(draft.severity !== "" || draft.cvss !== "" || draft.cwe !== "");
  const set = (key: keyof ReportDraft) => (value: string) => onChange({ ...draft, [key]: value });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Summary">
        <Input autoComplete="off" disabled={disabled} maxLength={1024} minLength={8} required value={draft.summary} onChange={(event) => set("summary")(event.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea disabled={disabled} maxLength={descriptionLimit} minLength={20} placeholder="Revision, impact, repro steps" required rows={10} value={draft.description} onChange={(event) => set("description")(event.target.value)} />
      </Field>
      <ReportProofFields
        description={draft.description}
        proofName={draft.proofName}
        proofText={draft.proofText}
        disabled={disabled}
        onDescription={(description) => onChange({ ...draft, description })}
        onProof={(proofName, proofText) => onChange({ ...draft, proofName, proofText })}
      />
      <Disclosure summary="Classification" open={classified} onOpenChange={setClassified}>
        <div className="flex flex-col gap-4 pt-2">
          <Field label="Severity">
            <Select disabled={disabled || draft.cvss.trim() !== ""} value={draft.severity} onChange={(event) => set("severity")(event.target.value)}>
              {severities.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CVSS vector">
            <Input autoComplete="off" disabled={disabled} placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" spellCheck={false} value={draft.cvss} onChange={(event) => set("cvss")(event.target.value)} />
          </Field>
          <Field label="CWE IDs">
            <Input autoComplete="off" disabled={disabled} placeholder="CWE-284" spellCheck={false} value={draft.cwe} onChange={(event) => set("cwe")(event.target.value)} />
          </Field>
        </div>
      </Disclosure>
    </div>
  );
}
