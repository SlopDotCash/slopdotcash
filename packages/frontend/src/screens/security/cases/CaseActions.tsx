// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Button, Disclosure, Field, Select } from "@repo/ui";
import { useState } from "react";
import { ActionForm, type ActionFormProps } from "./ActionForm.tsx";
import { actionSpec, orderedActions, primaryActions } from "./actionSpec.ts";
import type { SecurityCase } from "./case.schema.ts";
import { disclosureRelevant } from "./labels.ts";

export type CaseActionsProps = {
  record: SecurityCase;
  /** Sends one action of this case. */
  onSend: (action: string, ...sent: Parameters<ActionFormProps["onSend"]>) => ReturnType<ActionFormProps["onSend"]>;
};

/** The actions the case allows its viewer, one form shown at a time, common decisions first. */
export function CaseActions({ record, onSend }: CaseActionsProps) {
  const actions = orderedActions(record, disclosureRelevant(record));
  const [selected, setSelected] = useState(actions[0] ?? "");
  const active = actions.includes(selected) ? selected : (actions[0] ?? "");
  if (active === "") return null;
  const title = (action: string) => actionSpec(action, record)?.title ?? action;
  const primary = actions.filter((action) => primaryActions.includes(action));
  const others = actions.some((action) => !primaryActions.includes(action));
  return (
    <section aria-label="Case actions" className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Review actions</legend>
        {primary.map((action) => (
          <Button key={action} variant="outline" size="sm" aria-pressed={active === action} data-case-action-selector={action} onClick={() => setSelected(action)}>
            {title(action)}
          </Button>
        ))}
      </fieldset>
      {others ? (
        <Disclosure summary="Other case actions" defaultOpen={!primaryActions.includes(active)}>
          <Field label={<span className="sr-only">Action</span>}>
            <Select value={active} onChange={(event) => setSelected(event.target.value)}>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {title(action)}
                </option>
              ))}
            </Select>
          </Field>
        </Disclosure>
      ) : null}
      {actions.map((action) => (
        <div hidden={action !== active} key={`${action}-${record.revision}`}>
          <ActionForm action={action} record={record} onSend={(fields, key) => onSend(action, fields, key)} />
        </div>
      ))}
    </section>
  );
}
