// spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"; spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"
import { ExternalLink, Status, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { FileSearch } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { Fact, Facts, Identifier, Subsection } from "./parts.tsx";
import { type Assessment, type AssessmentResult, assessmentPresentation, checkRows, coverageRows, evidenceHref, evidenceRunOf, resultOf, scanLabel, visibilityText } from "./vetting.ts";

const passing = new Set(["passed", "not-found"]);

function ScanTables({ result }: { result: AssessmentResult }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="overflow-x-auto" role="region" aria-label="Scanned surfaces table" tabIndex={0}>
        <Table label="Scanned surfaces">
          <TableCaption>Surfaces</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Surface</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead>Items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverageRows(result).map(([surface, entry]) => (
              <TableRow key={surface}>
                <TableHead scope="row">{scanLabel(surface)}</TableHead>
                <TableCell>
                  <Status presentation={{ tone: entry.state === "complete" ? "Positive" : "Caution", icon: entry.state === "complete" ? "Check" : "Alert", label: scanLabel(entry.state) }} />
                </TableCell>
                <TableCell>{entry.items}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Scan checks table" tabIndex={0}>
        <Table label="Scan checks">
          <TableCaption>Threat checks</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checkRows(result).map(([threat, check]) => (
              <TableRow key={threat}>
                <TableHead scope="row">{scanLabel(threat)}</TableHead>
                <TableCell>
                  <Status presentation={{ tone: passing.has(check) ? "Positive" : "Caution", icon: passing.has(check) ? "Check" : "Alert", label: scanLabel(check) }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export type AssessmentDetailsProps = {
  /** One recorded assessment of the project. */
  assessment: Assessment;
};

/** One recorded assessment: who queued it and why, what it scanned and found, and where its retained evidence is. */
export function AssessmentDetails({ assessment }: AssessmentDetailsProps) {
  const read = resultOf(assessment);
  const result = read.kind === "read" ? read.result : undefined;
  const run = result ? evidenceRunOf(assessment, result) : undefined;
  const at = assessment.completedAt ?? assessment.requestedAt;
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <header className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold text-foreground">Revision {assessment.revision}</h4>
        <Status presentation={assessmentPresentation(assessment.state)} />
        <time dateTime={at} className="text-sm text-muted-foreground">
          {formatDateTime(at)}
        </time>
      </header>
      <Facts>
        <Fact term="Queued by">
          <ExternalLink href={`https://github.com/${encodeURIComponent(assessment.requestedBy.githubLogin)}`}>@{assessment.requestedBy.githubLogin}</ExternalLink> — {assessment.requestReason}
        </Fact>
        <Fact term="Assigned commit">
          <Identifier label="assigned commit" value={assessment.commitSha} />
        </Fact>
        <Fact term="Skill template">
          <Identifier label="skill template digest" value={assessment.templateSha256} />
        </Fact>
        <Fact term="Policy version">{assessment.policyVersion ?? "—"}</Fact>
        <Fact term="Model reviews">{assessment.modelRuns.length === 0 ? "—" : assessment.modelRuns.map((model) => `${model.reviewer}: ${model.provider}/${model.model}`).join(", ")}</Fact>
        {run ? (
          <Fact term="Retained evidence">
            <a href={evidenceHref(run)} className="inline-flex items-center gap-2 text-primary underline underline-offset-4 [&_svg]:size-4">
              <FileSearch aria-hidden /> Evidence
            </a>
          </Fact>
        ) : null}
        {result?.coverage && result.checks ? (
          <Fact term="Scan coverage">
            <ScanTables result={result} />
            {result.reusedAssessmentId ? ` · Reused clean scan ${result.reusedAssessmentId} (identical content)` : ""}
          </Fact>
        ) : null}
        {result ? <Fact term="Visibility">{visibilityText(result)}</Fact> : null}
        {result?.confirmation ? (
          <Fact term="Confirmation">
            {result.confirmation.basis} under {result.confirmation.rule}
          </Fact>
        ) : null}
        {read.kind === "unreadable" ? <Fact term="Result">The recorded result could not be read.</Fact> : null}
      </Facts>
      {result && result.findings.length > 0 ? (
        <Subsection title="Findings">
          <ul className="flex flex-col gap-2 text-sm">
            {result.findings.map((finding) => (
              <li key={`${finding.category}-${finding.summary}`} className="flex flex-wrap items-baseline gap-2">
                <Status presentation={{ tone: finding.severity === "critical" || finding.severity === "high" ? "Negative" : "Caution", icon: "Alert", label: finding.severity }} />
                <span>
                  <strong>{finding.category}</strong> — {finding.summary}
                </span>
              </li>
            ))}
          </ul>
        </Subsection>
      ) : null}
      {result && result.artifacts.length > 0 ? (
        <Subsection title="Artifact quarantine">
          <ul className="flex flex-col gap-3 text-sm">
            {result.artifacts.map((artifact) => (
              <li key={`${artifact.sha256}-${artifact.path}`} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="break-all">{artifact.path}</strong>
                  <Status presentation={{ tone: "Neutral", icon: "Lock", label: artifact.state }} />
                </div>
                <p className="text-muted-foreground">
                  {artifact.type} · {artifact.analysis}
                </p>
                <Identifier label={`${artifact.path} digest`} value={artifact.sha256} />
              </li>
            ))}
          </ul>
        </Subsection>
      ) : null}
    </section>
  );
}
