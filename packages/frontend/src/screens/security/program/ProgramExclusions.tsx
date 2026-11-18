// spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"
import { SECURITY_DEFAULT_EXCLUSIONS, programExclusions } from "@repo/security/client";

export type ProgramExclusionsProps = {
  scope: { readonly excludedFindings?: ReadonlyArray<string> };
};

function ExclusionList({ id, title, lines }: { id: string; title: string; lines: ReadonlyArray<string> }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 id={id} className="font-semibold text-foreground">
        {title}
      </h3>
      <ul aria-labelledby={id} className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Slop's default lines that never qualify, then the program owner's own lines when the terms list any. */
export function ProgramExclusions({ scope }: ProgramExclusionsProps) {
  const owner = programExclusions(scope);
  return (
    <>
      <ExclusionList id="security-exclusions" title="Does not qualify" lines={SECURITY_DEFAULT_EXCLUSIONS} />
      {owner.length > 0 ? <ExclusionList id="security-program-exclusions" title="Also does not qualify for this program" lines={owner} /> : null}
    </>
  );
}
