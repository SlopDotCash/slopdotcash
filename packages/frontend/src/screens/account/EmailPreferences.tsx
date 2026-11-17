// spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"; spec/backend/email.md, "A verification request records the requested consent and is idempotent per request key"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
import { Alert, Button, Checkbox, Field, Input, Label, Switch } from "@repo/ui";
import { type FormEvent, useState } from "react";
import { type ConsentField, type EmailPanel, type Enrollment, enrollmentOf } from "../../flows/account/email.vibe";

export type EmailPreferencesProps = {
  /** The email consent of the signed-in account, as the email flow publishes it. */
  panel: EmailPanel;
  /** Where "Sign in with GitHub" goes once the session has expired. */
  signInHref: string;
  /** The local backend's mailbox, only while signing in against a local backend. */
  localMailHref?: string;
  /** Turns one consent category on or off. */
  onToggle: (field: ConsentField) => void;
  /** Opens the address form, or records that its text changed. */
  onEdit: () => void;
  /** Asks for a verification email to the address, with the consent to record once it is verified. */
  onRequest: (enrollment: Enrollment) => void;
  /** Reads the preferences again. */
  onRetry: () => void;
};

const pendingLabels: Record<string, string> = { expired: "Verification expired", unknown: "Verification delivery not confirmed", sent: "Verification sent" };

function detailOf(panel: EmailPanel, preview: boolean): string | undefined {
  const { state } = panel;
  if (panel.busy) return "Saving…";
  if (state.status === "loading") return "Loading…";
  if (state.status === "failed") return `Email preferences could not be loaded: ${state.message}`;
  if (state.status !== "ready") return undefined;
  const value = state.value;
  if (value.availability === "verified") return value.enabled && value.securityEnabled ? undefined : `${preview ? "Preview address" : "Sent to"} ${value.email ?? ""}`;
  if (value.availability === "unverified") return "No verified email address is on file. Notices still appear in this inbox.";
  return "We could not check your email address, so activity email cannot be turned on yet.";
}

type EnrollmentFormProps = {
  initial: Enrollment;
  busy: boolean;
  blocked: boolean;
  editing: boolean;
  onEdit: () => void;
  onRequest: (enrollment: Enrollment) => void;
  onCancel: () => void;
};

function EnrollmentForm({ initial, busy, blocked, editing, onEdit, onRequest, onCancel }: EnrollmentFormProps) {
  const [draft, setDraft] = useState(initial);
  const change = (next: Enrollment) => {
    setDraft(next);
    onEdit();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && !blocked) onRequest(draft);
  };
  return (
    <form className="flex flex-col items-start gap-4" onSubmit={submit}>
      <Field label="Email address" className="w-full max-w-md">
        <Input type="email" autoComplete="email" required maxLength={254} disabled={busy} value={draft.email} onChange={(event) => change({ ...draft, email: event.target.value })} />
      </Field>
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">After verification</legend>
        <Label>
          <Checkbox checked={draft.enabled} onCheckedChange={(checked) => change({ ...draft, enabled: checked === true })} />
          Activity email
        </Label>
        <Label>
          <Checkbox checked={draft.securityEnabled} onCheckedChange={(checked) => change({ ...draft, securityEnabled: checked === true })} />
          Security email
        </Label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={busy} disabled={blocked}>
          {busy ? "Requesting…" : "Send verification"}
        </Button>
        {editing ? (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Activity and security email consent for the signed-in account, and the verified address they are sent to. */
export function EmailPreferences({ panel, signInHref, localMailHref, onToggle, onEdit, onRequest, onRetry }: EmailPreferencesProps) {
  const [cancelled, setCancelled] = useState(false);
  const { state, busy, checking, problem } = panel;
  if (state.status === "signedOut") {
    return (
      <p>
        Your session expired.{" "}
        <a className="text-primary underline underline-offset-4" href={signInHref}>
          Sign in with GitHub
        </a>
        .
      </p>
    );
  }
  const ready = state.status === "ready" ? state.value : undefined;
  const verified = ready?.availability === "verified";
  const on = ready?.enabled === true;
  const securityOn = ready?.securityEnabled === true;
  const editing = panel.editing && !cancelled;
  const enrollmentOpen = ready !== undefined && ready.enrollmentAvailable && (editing || (ready.availability === "unverified" && ready.pending === null));
  const detail = detailOf(panel, localMailHref !== undefined);
  const failed = state.status === "failed";
  const canRetry = failed || ready?.availability === "unavailable";
  const edit = () => {
    setCancelled(false);
    onEdit();
  };
  return (
    <div className="flex flex-col gap-4">
      {!enrollmentOpen ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span id="email-activity-label" className="font-medium text-foreground">
                Activity email
              </span>
              {detail ? (
                <span id="email-activity-detail" role={failed ? "alert" : state.status === "loading" ? "status" : undefined} className="text-sm text-muted-foreground">
                  {detail}
                </span>
              ) : null}
            </div>
            <Switch
              aria-labelledby="email-activity-label"
              aria-describedby={detail ? "email-activity-detail" : undefined}
              aria-busy={busy || checking}
              checked={on}
              loading={busy}
              disabled={checking || ready === undefined || (!on && !verified)}
              onCheckedChange={() => onToggle("enabled")}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span id="email-security-label" className="font-medium text-foreground">
              Security email
            </span>
            <Switch
              aria-labelledby="email-security-label"
              aria-busy={busy || checking}
              checked={securityOn}
              loading={busy}
              disabled={checking || ready === undefined || (!securityOn && !verified)}
              onCheckedChange={() => onToggle("securityEnabled")}
            />
          </div>
        </>
      ) : null}
      {ready?.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {pendingLabels[ready.pending.state] ?? "Verification requested"}: {ready.pending.email}
          {localMailHref ? (
            <>
              {" "}
              <a className="text-primary underline underline-offset-4" href={localMailHref}>
                Open local mail
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {enrollmentOpen && ready ? (
        <EnrollmentForm initial={enrollmentOf(ready)} busy={busy} blocked={checking} editing={editing} onEdit={onEdit} onRequest={onRequest} onCancel={() => setCancelled(true)} />
      ) : ready?.enrollmentAvailable ? (
        <Button variant="link" disabled={busy} onClick={edit} className="self-start">
          {ready.pending ? "Change email" : "Add or change email"}
        </Button>
      ) : null}
      {canRetry ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRetry} className="self-start">
          Retry email preferences
        </Button>
      ) : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
    </div>
  );
}
