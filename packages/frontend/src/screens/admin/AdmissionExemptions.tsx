// spec/security/enforcement.md, "An administrator records an audited exemption only for a current authorized steward"; spec/security/enforcement.md, "Revocation is its own audited record and restores ordinary admission"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import { Alert, Button, Checkbox, Field, Input, Label, Select, Textarea } from "@repo/ui";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { grantAdmissionExemption, minimumExemptionReason, revokeAdmissionExemption } from "../../flows/projects/vetting.vibe";
import { isAdminActionAccessLoss } from "../../session/adminAccess.vibe";
import { act, Subsection } from "./parts.tsx";
import type { Exemption, VettedProject } from "./vetting.ts";

export type ExemptionContext = {
  runtime: PageRuntime;
  actorId: string;
  project: VettedProject;
  onAccessLost: () => void;
};

type ExemptionFormProps = ExemptionContext & {
  exemption: Exemption | undefined;
  repository?: string;
  repositoryField?: ReactNode;
  onSaved: () => void;
};

/** Records an owner-approved exemption, or revokes the active one, only with a reason, the owner's decision reference and the confirmation. */
function ExemptionForm({ runtime, actorId, project, onAccessLost, exemption, repository, repositoryField, onSaved }: ExemptionFormProps) {
  const confirmId = useId();
  const [reason, setReason] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const revoke = exemption !== undefined;
  const complete = confirmed && reason.trim().length >= minimumExemptionReason && decisionReference.trim() !== "";
  const save = async () => {
    if (inFlight.current) return;
    const decision = { reason, decisionReference, confirmed };
    const work = exemption ? revokeAdmissionExemption(actorId, exemption.id, decision) : grantAdmissionExemption(actorId, { projectId: project.id, revision: project.revision, ...(repository === undefined ? {} : { repository }) }, decision);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const acted = await act(runtime, work, (failure) => failure._tag !== "VettingIncomplete" && isAdminActionAccessLoss(failure), "The exemption could not be confirmed.");
    inFlight.current = false;
    setBusy(false);
    if (acted.ok) return onSaved();
    setError(acted.message);
    if (acted.accessLost) onAccessLost();
  };
  return (
    <Subsection icon={<ShieldCheck aria-hidden />} title="Owner-approved exemption">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {repositoryField}
        <Field label="Reason">
          <Textarea aria-label="Exemption reason" minLength={minimumExemptionReason} maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="Decision link">
          <Input maxLength={500} required value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} />
        </Field>
        <div className="flex items-start gap-3">
          <Checkbox id={confirmId} required checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
          <Label htmlFor={confirmId}>Owner authorized this</Label>
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button type="submit" variant="secondary" className="self-start" loading={busy} disabled={busy || !complete}>
          {revoke ? <ShieldOff aria-hidden /> : <ShieldCheck aria-hidden />}
          {busy ? "Saving…" : revoke ? "Revoke exemption" : "Record exemption"}
        </Button>
      </form>
    </Subsection>
  );
}

export type AdmissionExemptionsProps = ExemptionContext & {
  exemptions: ReadonlyArray<Exemption>;
  onSaved: (revoked: boolean) => void;
};

/** The exemption form of the project, or of one chosen repository of a project with more than one; a grant always names the revision and repository it covers. */
export function AdmissionExemptions({ exemptions, onSaved, ...context }: AdmissionExemptionsProps) {
  const repositories = context.project.repositories;
  const [repository, setRepository] = useState(repositories?.[0]?.id ?? "");
  const githubId = repositories?.find((entry) => entry.id === repository)?.githubId;
  const active = exemptions.find((exemption) => exemption.revokedAt === null && (repositories === undefined || exemption.repositoryId === githubId));
  const repositoryField =
    repositories === undefined ? undefined : (
      <Field label="Repository">
        <Select value={repository} onChange={(event) => setRepository(event.target.value)}>
          {repositories.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </Select>
      </Field>
    );
  return (
    <ExemptionForm
      key={`${context.project.revision}:${repository}:${active?.id ?? "grant"}`}
      {...context}
      exemption={active}
      {...(repositories === undefined ? {} : { repository })}
      repositoryField={repositoryField}
      onSaved={() => onSaved(active !== undefined)}
    />
  );
}
