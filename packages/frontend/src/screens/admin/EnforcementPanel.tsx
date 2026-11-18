// spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/security/enforcement.md, "The steward, the listing account, a banned account or a moderator files one open project appeal"; spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"
import { Alert, Button, Field, Input, Select, Status, Textarea } from "@repo/ui";
import { Lock } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { decideEnforcement, enforcementRequest, previewEnforcement, type Reviewed } from "../../flows/projects/admin.vibe";
import { isAdminActionAccessLoss } from "../../session/adminAccess.vibe";
import { actionLabel, availableActions, type EnforcementAction, isEnforcementAction, namesAccounts, restrictionPresentation } from "./enforcement.ts";
import { EnforcementPreviewFacts, EnforcementSummary } from "./EnforcementSummary.tsx";
import { act, Chip } from "./parts.tsx";
import type { AdminProject } from "./projects.ts";

const requestChanged = "The request changed. Preview the current action again.";

export type EnforcementPanelProps = {
  runtime: PageRuntime;
  project: AdminProject;
  actorId: string;
  onAccessLost: () => void;
  onDone: (note: string) => void;
};

type Review = { readonly reviewed: Reviewed; readonly key: string };

/** Quarantine, ban and reinstatement of one project: each needs a reason and an evidence reference, shows the server's preview and records only on confirm. */
export function EnforcementPanel({ runtime, project, actorId, onAccessLost, onDone }: EnforcementPanelProps) {
  const enforcement = project.enforcement;
  const actions = availableActions(enforcement);
  const headingId = useId();
  const [action, setAction] = useState<EnforcementAction>(actions[0] ?? "quarantine");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [responsible, setResponsible] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = enforcementRequest({ action, reason, evidence, revision: project.revision, nextSequence: enforcement.nextSequence, decisionRequired: enforcement.decisionRequired, responsible });
  const requestKey = JSON.stringify({ actorId, projectId: project.id, request });
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const preview = review?.key === requestKey ? review.reviewed.preview : null;

  const showPreview = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const key = requestKey;
    inFlight.current = true;
    setBusy("preview");
    setError(null);
    const acted = await act(runtime, previewEnforcement(project.id, actorId, request), (failure) => failure._tag !== "PreviewMismatch" && isAdminActionAccessLoss(failure), "The preview could not be prepared.");
    inFlight.current = false;
    setBusy(null);
    if (!acted.ok) {
      if (acted.accessLost) return onAccessLost();
      if (latestKey.current === key) setError(acted.message);
      return;
    }
    if (latestKey.current !== key) return setError(requestChanged);
    setReview({ reviewed: acted.value, key });
  };

  const confirm = async () => {
    if (inFlight.current || review === null || preview === null) return;
    const submitted = review;
    inFlight.current = true;
    setBusy("apply");
    setError(null);
    const acted = await act(runtime, decideEnforcement(project.id, actorId, submitted.reviewed), isAdminActionAccessLoss, "The decision could not be confirmed.");
    inFlight.current = false;
    setBusy(null);
    if (!acted.ok) {
      if (acted.accessLost) return onAccessLost();
      if (latestKey.current === submitted.key) {
        setReview(null);
        setError(acted.message);
      }
      return;
    }
    if (latestKey.current !== submitted.key) return;
    onDone("Recorded.");
  };

  const locked = preview !== null;
  const destructive = preview !== null && (preview.action === "quarantine" || preview.action === "ban");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h4 id={headingId} className="text-base font-semibold text-foreground">
          Enforcement
        </h4>
        <Status presentation={restrictionPresentation(enforcement.state)} />
      </header>
      <EnforcementSummary enforcement={enforcement} revision={project.revision} status={project.status} listingTier={project.manifest.listingTier} />
      {enforcement.moderation === "unconfigured" ? (
        <p>
          <Chip>Unavailable</Chip>
        </p>
      ) : enforcement.moderation === "not-moderator" ? (
        <p>
          <Chip icon={<Lock aria-hidden />}>Moderators only</Chip>
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void showPreview(event)}>
          <Field label="Action">
            <Select disabled={locked} value={action} onChange={(event) => isEnforcementAction(event.target.value) && setAction(event.target.value)}>
              {actions.map((value) => (
                <option key={value} value={value}>
                  {actionLabel(value, enforcement.decisionRequired)}
                </option>
              ))}
            </Select>
          </Field>
          {namesAccounts(action, enforcement.decisionRequired) ? (
            <Field
              label={
                action === "reinstate_accounts" ? (
                  "Accounts"
                ) : (
                  <span className="inline-flex items-center gap-2">
                    Responsible accounts <Chip>optional</Chip>
                  </span>
                )
              }
            >
              <Input placeholder="@a, @b" value={responsible} readOnly={locked} onChange={(event) => setResponsible(event.target.value)} />
            </Field>
          ) : null}
          <Field label="Reason">
            <Textarea maxLength={1000} required readOnly={locked} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field label="Evidence">
            <Input maxLength={500} placeholder="URL or case ID" required readOnly={locked} spellCheck={false} value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          </Field>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {preview === null ? (
            <Button type="submit" variant="secondary" className="self-start" aria-busy={busy === "preview"} loading={busy === "preview"} disabled={busy !== null || reason.trim() === "" || evidence.trim() === ""}>
              Preview
            </Button>
          ) : (
            <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Preview</legend>
              <EnforcementPreviewFacts preview={preview} />
              <div className="flex flex-wrap gap-3">
                <Button variant={destructive ? "destructive" : "primary"} loading={busy === "apply"} disabled={busy !== null} onClick={() => void confirm()}>
                  {busy === "apply" ? "Recording…" : `Confirm: ${actionLabel(preview.action, preview.maintainerBans.length > 0)}`}
                </Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setReview(null)}>
                  Cancel
                </Button>
              </div>
            </fieldset>
          )}
        </form>
      )}
    </section>
  );
}
