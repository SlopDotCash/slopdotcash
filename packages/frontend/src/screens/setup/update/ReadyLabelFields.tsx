// spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
import { Checkbox, Label } from "@repo/ui";
import { TextField } from "../fields/ProjectFields.tsx";
import type { ReadyDraft, ReadyField } from "./readyLabel.ts";

export type ReadyLabelFieldsProps = {
  value: ReadyDraft;
  /** The field's error once a publish was attempted. */
  shown: (field: ReadyField) => string | undefined;
  onChange: (field: ReadyField, value: string) => void;
};

const counts = [
  ["readyApprovals", "Approvals required"],
  ["readyMaxLines", "Most changed lines"],
  ["readyMaxFiles", "Most changed files"],
] as const satisfies ReadonlyArray<readonly [ReadyField, string]>;

/** The slopbot:ready label, off unless the owner turns it on; its bounds and extra protected paths show only while it is on. */
export function ReadyLabelFields({ value, shown, onChange }: ReadyLabelFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Checkbox id="ready-label" name="readyLabel" checked={value.readyLabel === "true"} aria-describedby="ready-label-hint" onCheckedChange={(checked) => onChange("readyLabel", checked === true ? "true" : "false")} />
          <Label htmlFor="ready-label">Label pull requests that are ready to merge</Label>
        </div>
        <p id="ready-label-hint" className="text-sm text-muted-foreground">
          Slopbot adds <code className="font-mono">slopbot:ready</code> when checks pass, its review has no finding, maintainers approved the latest commit, the change is small and it touches no protected path such as CI, dependencies, contracts or policy files. Slopbot never merges.
        </p>
      </div>
      {value.readyLabel === "true" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {counts.map(([field, label]) => (
              <TextField key={field} label={label} name={field} inputMode="numeric" value={value[field]} error={shown(field)} onChange={(entry) => onChange(field, entry)} />
            ))}
          </div>
          <TextField
            label="Extra protected paths"
            name="readyProtectedPaths"
            multiline
            hint="One per line, for example docs/legal/ or *.sql. These add to the built-in list."
            value={value.readyProtectedPaths}
            error={shown("readyProtectedPaths")}
            onChange={(entry) => onChange("readyProtectedPaths", entry)}
          />
        </>
      ) : null}
    </div>
  );
}
