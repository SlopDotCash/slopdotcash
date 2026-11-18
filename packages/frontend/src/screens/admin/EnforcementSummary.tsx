// spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/security/enforcement.md, "The steward, the listing account, a banned account or a moderator files one open project appeal"
import type { EnforcementPreview } from "@repo/backend/client";
import { Bot, CircleAlert, ExternalLink, History, Info } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { actionLabel, appealLabel, isWebLink, resultLabel, stateLabel } from "./enforcement.ts";
import { Accounts, Chip, Fact, Facts, Subsection } from "./parts.tsx";
import type { Enforcement } from "./projects.ts";

export type EnforcementSummaryProps = {
  enforcement: Enforcement;
  revision: number;
  status: string;
  listingTier: string;
};

const reinstatementSteps = ["Appeal", "Clean scan", "Moderator"] as const;

type EnforcementRecord = Enforcement["records"][number];

function RecordEvidence({ reference }: { reference: string }) {
  return isWebLink(reference) ? (
    <a href={reference} target="_blank" rel="noreferrer" aria-label="Evidence" title="Evidence" className="inline-flex text-primary [&_svg]:size-4">
      <ExternalLink aria-hidden />
    </a>
  ) : (
    <code title="Evidence" className="font-mono text-xs break-all">
      {reference}
    </code>
  );
}

function RecordEntry({ record }: { record: EnforcementRecord }) {
  return (
    <li className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <Chip>{actionLabel(record.action, record.maintainerBans !== undefined)}</Chip>
        <Chip icon={record.actor ? undefined : <Bot aria-hidden />} title={`${record.actorRole}, ${record.decisionSource}`}>
          {record.actor ? `@${record.actor.githubLogin}` : "Scanner"}
        </Chip>
        <time dateTime={record.createdAt}>{formatDateTime(record.createdAt)}</time>
        <span title={resultLabel(record.result)}>
          rev {record.beforeRevision}
          {record.afterRevision === null ? "" : `→${record.afterRevision}`}
        </span>
        <RecordEvidence reference={record.evidenceReference} />
        {record.maintainerBans?.map((account) => (
          <Chip key={`ban:${account.githubLogin}`} tone="Negative" title="Banned">
            <span className="sr-only">Banned </span>@{account.githubLogin}
          </Chip>
        ))}
        {record.accountReinstatements?.map((account) => (
          <Chip key={`reinstated:${account.githubLogin}`} tone="Positive" title="Reinstated">
            <span className="sr-only">Reinstated </span>@{account.githubLogin}
          </Chip>
        ))}
      </p>
      <p>{record.reason}</p>
    </li>
  );
}

/** A project's restriction, appeals, banned maintainers and the records that made them. */
export function EnforcementSummary({ enforcement, revision, status, listingTier }: EnforcementSummaryProps) {
  return (
    <>
      <Facts>
        {enforcement.appeal !== "none" ? <Fact term="Appeal">{appealLabel(enforcement.appeal)}</Fact> : null}
        {enforcement.since ? <Fact term="Restricted since">{formatDateTime(enforcement.since)}</Fact> : null}
        {enforcement.bannedMaintainers.length > 0 ? (
          <Fact term="Banned maintainers">
            <Accounts accounts={enforcement.bannedMaintainers} />
          </Fact>
        ) : null}
        {enforcement.restrictedBy.length > 0 ? (
          <Fact
            term={
              <span className="inline-flex items-center gap-1">
                Restricted by
                <span role="img" aria-label="Cannot decide the appeal" title="Cannot decide the appeal" className="inline-flex [&_svg]:size-4">
                  <Info aria-hidden />
                </span>
              </span>
            }
          >
            <Accounts accounts={enforcement.restrictedBy} />
          </Fact>
        ) : null}
      </Facts>
      {enforcement.decisionRequired ? (
        <p role="status" className="flex flex-wrap items-center gap-2">
          <Chip tone="Negative" icon={<CircleAlert aria-hidden />}>
            Confirmed malicious
          </Chip>
          {reinstatementSteps.map((step) => (
            <Chip key={step} title="Required for reinstatement">
              {step}
            </Chip>
          ))}
        </p>
      ) : null}
      {enforcement.revisionPending ? (
        <p role="status">
          <Chip tone="Caution" icon={<CircleAlert aria-hidden />} title={`Revision ${revision} is still ${status}, ${listingTier}. Delist to retire it.`}>
            Revision pending
          </Chip>
        </p>
      ) : null}
      {enforcement.records.length > 0 ? (
        <Subsection
          icon={<History aria-hidden />}
          title={
            <>
              History <Chip>{enforcement.records.length}</Chip>
            </>
          }
        >
          <ol className="flex flex-col gap-3 text-sm">
            {enforcement.records.map((record) => (
              <RecordEntry key={record.id} record={record} />
            ))}
          </ol>
        </Subsection>
      ) : null}
    </>
  );
}

/** The server's exact project, record and revision outcome of one previewed action. */
export function EnforcementPreviewFacts({ preview }: { preview: EnforcementPreview }) {
  return (
    <>
      <Facts>
        <Fact term="Project">
          {preview.projectName} ({preview.projectId})
        </Fact>
        <Fact term="Action">
          {actionLabel(preview.action, preview.maintainerBans.length > 0)} · record {preview.sequence}
        </Fact>
        <Fact term="Restriction">
          {stateLabel(preview.stateBefore)} → {stateLabel(preview.stateAfter)}
        </Fact>
        <Fact term="Revision">{preview.revision.after === null ? `Stays at ${preview.revision.before}` : `${preview.revision.before} → ${preview.revision.after}`}</Fact>
        <Fact term="Status and listing">
          {preview.revision.statusBefore}, {preview.revision.listingTierBefore} → {preview.revision.statusAfter}, {preview.revision.listingTierAfter}
        </Fact>
        <Fact term="Result">{resultLabel(preview.result)}</Fact>
        {preview.maintainerBans.length > 0 ? (
          <Fact term="Bans">
            <Accounts accounts={preview.maintainerBans} />
          </Fact>
        ) : null}
        {preview.accountReinstatements.length > 0 ? (
          <Fact term="Accounts reinstated">
            <Accounts accounts={preview.accountReinstatements} />
          </Fact>
        ) : null}
      </Facts>
      {preview.pendingReason ? (
        <p role="status">
          <Chip tone="Caution" icon={<CircleAlert aria-hidden />} title={preview.pendingReason}>
            Revision pending
          </Chip>
        </p>
      ) : null}
    </>
  );
}
