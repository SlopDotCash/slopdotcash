// spec/security/enforcement.md, "An administrator records an audited exemption only for a current authorized steward"; spec/security/enforcement.md, "Revocation is its own audited record and restores ordinary admission"
import { History } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { Fact, Facts, Identifier, Reference, Subsection } from "./parts.tsx";
import type { Exemption } from "./vetting.ts";

const nullTime = (value: string | null) => (value === null ? "—" : formatDateTime(value));

export type ExemptionHistoryProps = {
  /** Every grant of the project, active or revoked. */
  exemptions: ReadonlyArray<Exemption>;
};

/** Every grant and revocation of the project, each with its owner decision, repository identity and approved manifest digest. */
export function ExemptionHistory({ exemptions }: ExemptionHistoryProps) {
  if (exemptions.length === 0) return null;
  return (
    <Subsection icon={<History aria-hidden />} title="Exemption history">
      {exemptions.map((exemption) => (
        <Facts key={exemption.id}>
          <Fact term="Grant">
            Revision {exemption.revision} · @{exemption.grantedBy.githubLogin} · {nullTime(exemption.grantedAt)} · {exemption.revokedAt ? "Revoked" : "Active"}
          </Fact>
          <Fact term="Reason">{exemption.reason}</Fact>
          <Fact term="Owner decision">
            <Reference value={exemption.decisionReference} />
          </Fact>
          <Fact term="Repository identity">
            <span className="flex flex-col gap-1">
              <Identifier label="GitHub repository ID" value={exemption.repositoryId} />
              <Identifier label="GitHub repository node ID" value={exemption.repositoryNodeId} />
            </span>
          </Fact>
          <Fact term="Approved manifest">
            <Identifier label="approved manifest digest" value={exemption.manifestSha256} />
          </Fact>
          {exemption.revokedAt ? (
            <Fact term="Revocation">
              @{exemption.revokedBy?.githubLogin ?? "unknown"} · {nullTime(exemption.revokedAt)} · {exemption.revocationReason}
              {exemption.revocationDecisionReference ? ` · ${exemption.revocationDecisionReference}` : ""}
            </Fact>
          ) : null}
        </Facts>
      ))}
    </Subsection>
  );
}
