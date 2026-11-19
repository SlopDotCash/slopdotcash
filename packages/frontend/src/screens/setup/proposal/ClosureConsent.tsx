// spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import { Checkbox, Label } from "@repo/ui";

export type ClosureConsentProps = {
  /** The saved setting: only `"true"` checks the box. */
  value: string;
  onChange: (value: "true" | "false") => void;
};

/** Consent to Slopbot closing Slop-skill pull requests, unchecked unless the saved setting is exactly yes. */
export function ClosureConsent({ value, onChange }: ClosureConsentProps) {
  return (
    <div className="flex items-center gap-3">
      <Checkbox id="automatic-closure" name="automaticClosure" checked={value === "true"} onCheckedChange={(checked) => onChange(checked === true ? "true" : "false")} />
      <Label htmlFor="automatic-closure">Slopbot may close Slop-skill PRs · authors can appeal</Label>
    </div>
  );
}
