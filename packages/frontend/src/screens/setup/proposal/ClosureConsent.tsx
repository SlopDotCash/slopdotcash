// spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import { Checkbox, Label } from "@repo/ui";

export type ClosureConsentProps = {
  /** The saved setting: only `"true"` checks the box. */
  value: string;
  onChange: (value: "true" | "false") => void;
  compact?: boolean;
};

/** Consent to Slopbot closing Slop-skill pull requests, unchecked unless the saved setting is exactly yes. */
export function ClosureConsent({ value, onChange, compact = false }: ClosureConsentProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Checkbox
          id="automatic-closure"
          name="automaticClosure"
          checked={value === "true"}
          aria-describedby={compact ? undefined : "automatic-closure-hint"}
          onCheckedChange={(checked) => onChange(checked === true ? "true" : "false")}
        />
        <Label htmlFor="automatic-closure">{compact ? "Allow Slopbot to close Slop-skill PRs; authors can appeal." : "Allow automatic closure by Slopbot"}</Label>
      </div>
      {compact ? null : (
        <p id="automatic-closure-hint" className="text-sm text-muted-foreground">
          Only Slop-skill pull requests can be closed, and authors can appeal. You can turn this off at any time.
        </p>
      )}
    </div>
  );
}
