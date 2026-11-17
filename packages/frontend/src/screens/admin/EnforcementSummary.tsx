// spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/security/enforcement.md, "The steward, the listing account, a banned account or a moderator files one open project appeal"
import type { EnforcementPreview } from "@repo/backend/client";
import { Alert } from "@repo/ui";
import { History } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { actionLabel, appealLabel, resultLabel, stateLabel } from "./enforcement.ts";
import { Accounts, Fact, Facts, Reference, Subsection } from "./parts.tsx";
import type { Enforcement } from "./projects.ts";

export type EnforcementSummaryProps = {
  enforcement: Enforcement;
  revision: number;
  status: string;
  listingTier: string;
};

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
          <Fact term="Restricted by · cannot decide appeal">
            <Accounts accounts={enforcement.restrictedBy} />
          </Fact>
        ) : null}
      </Facts>
      {enforcement.decisionRequired ? (
        <Alert variant="destructive" announcement="Polite">
          Confirmed malicious result. Reinstatement requires the owner's appeal, a fresh clean scan and a moderator decision.
        </Alert>
      ) : null}
      {enforcement.revisionPending ? (
        <Alert variant="warn" announcement="Polite">
          Restriction active; revision {revision} is still {status} and {listingTier}. Delist to pause and retire it.
        </Alert>
      ) : null}
      {enforcement.records.length > 0 ? (
        <Subsection icon={<History aria-hidden />} title={`Enforcement history · ${enforcement.records.length}`}>
          <ol className="flex flex-col gap-3 text-sm">
            {enforcement.records.map((record) => (
              <li key={record.id} className="flex flex-col gap-1">
                <p>
                  <strong>{actionLabel(record.action, record.maintainerBans !== undefined)}</strong> by {record.actor ? `@${record.actor.githubLogin}` : "the signed security vetting service"} ({record.actorRole}, {record.decisionSource}) on {formatDateTime(record.createdAt)}. Revision {record.beforeRevision}
                  {record.afterRevision === null ? "" : ` → ${record.afterRevision}`}: {resultLabel(record.result)}.
                </p>
                <p>Reason: {record.reason}</p>
                <p>
                  Evidence: <Reference value={record.evidenceReference} />
                </p>
                {record.maintainerBans ? (
                  <p>
                    Banned maintainers: <Accounts accounts={record.maintainerBans} />
                  </p>
                ) : null}
                {record.accountReinstatements?.length ? (
                  <p>
                    Reinstated accounts: <Accounts accounts={record.accountReinstatements} />
                  </p>
                ) : null}
              </li>
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
          <Fact term="Maintainer accounts banned">
            <Accounts accounts={preview.maintainerBans} />
          </Fact>
        ) : null}
        {preview.accountReinstatements.length > 0 ? (
          <Fact term="Accounts reinstated">
            <Accounts accounts={preview.accountReinstatements} />. The project restriction and other account bans stay in place.
          </Fact>
        ) : null}
      </Facts>
      {preview.pendingReason ? (
        <Alert variant="warn" announcement="Polite">
          Restriction applies now; revision not appended yet: {preview.pendingReason}
        </Alert>
      ) : null}
    </>
  );
}
