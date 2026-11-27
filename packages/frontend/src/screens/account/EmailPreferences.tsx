// spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"; spec/backend/email.md, "A verification request records the requested consent and is idempotent per request key"; spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"
import { Alert, Button, Checkbox, Field, Input, Label, Spinner, Status, type StatusProps, Switch } from "@repo/ui";
import { LogIn, Mail, Pencil, RotateCcw } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
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

const pendingChips: Readonly<Record<string, StatusProps["presentation"]>> = {
  expired: { tone: "Negative", icon: "Alert", label: "Expired" },
  unknown: { tone: "Caution", icon: "Clock", label: "Unconfirmed" },
  sent: { tone: "Notice", icon: "Check", label: "Sent" },
};

const requested: StatusProps["presentation"] = { tone: "Neutral", icon: "Dot", label: "Pending" };

function detailOf(panel: EmailPanel): ReactNode {
  const { state } = panel;
  if (panel.busy) return <Spinner size="sm" label="Saving" />;
  if (state.status === "loading") return <Spinner size="sm" label="Loading" />;
  if (state.status === "failed") return "Unavailable";
  if (state.status !== "ready") return undefined;
  const value = state.value;
  if (value.availability === "verified") {
    return (
      <span className="inline-flex items-center gap-1">
        <Mail aria-hidden className="size-3.5" /> {value.email ?? ""}
      </span>
    );
  }
  return value.availability === "unverified" ? "No verified email" : "Email check failed";
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
      <fieldset aria-label="After verification" disabled={busy} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="email-enroll-activity" aria-labelledby="email-enroll-activity-label" checked={draft.enabled} onCheckedChange={(checked) => change({ ...draft, enabled: checked === true })} />
          <Label id="email-enroll-activity-label" htmlFor="email-enroll-activity">
            Activity
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="email-enroll-security" aria-labelledby="email-enroll-security-label" checked={draft.securityEnabled} onCheckedChange={(checked) => change({ ...draft, securityEnabled: checked === true })} />
          <Label id="email-enroll-security-label" htmlFor="email-enroll-security">
            Security
          </Label>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={busy} disabled={blocked}>
          Verify
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
      <Button asChild variant="secondary" className="self-start">
        <a href={signInHref}>
          <LogIn aria-hidden className="size-4" /> Sign in
        </a>
      </Button>
    );
  }
  const ready = state.status === "ready" ? state.value : undefined;
  const verified = ready?.availability === "verified";
  const on = ready?.enabled === true;
  const securityOn = ready?.securityEnabled === true;
  const editing = panel.editing && !cancelled;
  const enrollmentOpen = ready !== undefined && ready.enrollmentAvailable && (editing || (ready.availability === "unverified" && ready.pending === null));
  const detail = detailOf(panel);
  const failed = state.status === "failed";
  const canRetry = failed || ready?.availability === "unavailable";
  const edit = () => {
    setCancelled(false);
    onEdit();
  };
  const editButton =
    !enrollmentOpen && ready?.enrollmentAvailable ? (
      ready.pending || verified ? (
        <Button variant="ghost" size="icon" disabled={busy} aria-label="Change email" title="Change email" onClick={edit}>
          <Pencil aria-hidden className="size-3.5" />
        </Button>
      ) : (
        <Button variant="link" disabled={busy} onClick={edit}>
          Add email
        </Button>
      )
    ) : null;
  return (
    <div className="flex flex-col gap-4">
      {!enrollmentOpen ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span id="email-activity-label" className="font-medium text-foreground">
                Activity
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span id="email-activity-detail" role={failed ? "alert" : undefined}>
                  {detail}
                </span>
                {ready?.pending ? null : editButton}
              </span>
            </div>
            <Switch
              aria-labelledby="email-activity-label"
              aria-describedby="email-activity-detail"
              aria-busy={busy || checking}
              checked={on}
              loading={busy}
              disabled={checking || ready === undefined || (!on && !verified)}
              onCheckedChange={() => onToggle("enabled")}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span id="email-security-label" className="font-medium text-foreground">
              Security
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
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {ready.pending.email} <Status presentation={pendingChips[ready.pending.state] ?? requested} /> {editButton}
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
      ) : null}
      {canRetry ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRetry} className="self-start">
          <RotateCcw aria-hidden className="size-3.5" /> Retry
        </Button>
      ) : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
    </div>
  );
}
