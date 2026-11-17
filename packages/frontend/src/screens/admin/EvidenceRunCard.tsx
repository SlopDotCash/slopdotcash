// spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import type { RunView } from "@repo/security/client";
import { Disclosure, Status } from "@repo/ui";
import type { ReactNode } from "react";
import type { EvidenceObjectView } from "./EvidenceItem.tsx";
import { Fact, Facts, Identifier } from "./parts.tsx";
import { evidenceStateLabel } from "./vetting.ts";

export type EvidenceRunView = typeof RunView.Type;

/** @throws {never} */
function retentionText(run: EvidenceRunView): string {
  if (run.permanentAdmissionEvidence) return "Admission evidence is retained permanently. Each read requires a short-lived operator grant.";
  return run.expiresAt === null ? "Case open. Evidence is retained until 90 days after closure." : `Access expires: ${run.expiresAt}.`;
}

export type EvidenceRunCardProps = {
  run: EvidenceRunView;
  policyVersion: string;
  selected: string | null;
  onSelect: (sha256: string) => void;
  item: (object: EvidenceObjectView) => ReactNode;
};

/** One run's inventory: its identity and retention, how its assembly was kept, and each retained object to choose. */
export function EvidenceRunCard({ run, policyVersion, selected, onSelect, item }: EvidenceRunCardProps) {
  return (
    <section className="flex flex-col gap-4 rounded-md border border-border p-4">
      <h2 className="text-lg font-semibold text-foreground">Evidence inventory</h2>
      <Disclosure summary="Run details and retention">
        <div className="flex flex-col gap-3">
          <Facts>
            <Fact term="Run">
              <Identifier label="run ID" value={run.runId} />
            </Fact>
            <Fact term="Assessment">
              <Identifier label="assessment ID" value={run.assessmentId} />
            </Fact>
            <Fact term="Storage inventory SHA-256">
              <Identifier label="storage inventory digest" value={run.manifestSha256} />
            </Fact>
            <Fact term="Policy">{policyVersion}</Fact>
          </Facts>
          <p className="text-sm text-muted-foreground">{retentionText(run)}</p>
        </div>
      </Disclosure>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Status presentation={run.assembly.retained ? { tone: "Notice", icon: "Lock", label: "Evidence assembly: Retained" } : { tone: "Caution", icon: "Alert", label: "Evidence assembly: Not verified" }} />
        <span>{run.assembly.reason} Clean admission is unavailable.</span>
      </p>
      {run.objects.length === 0 ? (
        <p className="text-sm">No retained objects.</p>
      ) : (
        <ul aria-label="Retained objects" className="flex flex-col gap-2">
          {run.objects.map((object) => (
            <li key={object.sha256}>
              <button
                type="button"
                aria-label={`Select ${object.label}, ${object.sha256.slice(0, 12)}`}
                aria-pressed={selected === object.sha256}
                onClick={() => onSelect(object.sha256)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-border px-4 py-2 text-left hover:bg-accent aria-pressed:border-primary"
              >
                <span className="flex min-w-0 flex-col">
                  <strong className="text-sm">{object.label}</strong>
                  <span className="text-xs text-muted-foreground">
                    {object.kind} · {object.sizeBytes.toLocaleString()} bytes
                  </span>
                </span>
                {object.state !== "stored-unverified" ? <Status presentation={{ tone: "Caution", icon: "Alert", label: evidenceStateLabel(object.state) }} /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {run.objects.filter((object) => object.sha256 === selected).map(item)}
    </section>
  );
}
