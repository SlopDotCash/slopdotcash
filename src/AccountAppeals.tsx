import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "./lib/errors";
import { projectApiRequest } from "./lib/project-api";
import type { AppealState, RestrictionState } from "./lib/project-contracts";

type AccountAppeal = {
  projectId: string;
  state: RestrictionState;
  appeal: AppealState;
};

export function AccountAppeals() {
  const [appeals, setAppeals] = useState<AccountAppeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry and successful submission refresh the account restrictions.
  useEffect(() => {
    let active = true;
    setError(null);
    projectApiRequest<{ appeals: AccountAppeal[] }>(
      "GET",
      "project-appeals",
    ).then(
      (body) => {
        if (active) setAppeals(body.appeals);
      },
      (caught: unknown) => {
        if (active) setError(errorMessage(caught));
      },
    );
    return () => {
      active = false;
    };
  }, [reload]);
  return (
    <section id="appeals" aria-labelledby="account-appeals-heading">
      <h2 id="account-appeals-heading">Account appeals</h2>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </p>
      ) : appeals === null ? (
        <p role="status">Loading account restrictions…</p>
      ) : appeals.length === 0 ? (
        <p>No account restrictions.</p>
      ) : (
        <>
          <p>
            A ban stops new participation. Funded awards and appeals remain
            available.
          </p>
          {appeals.map((appeal) => (
            <AccountAppealForm
              key={appeal.projectId}
              appeal={appeal}
              onSent={() => setReload((value) => value + 1)}
            />
          ))}
        </>
      )}
    </section>
  );
}

function AccountAppealForm({
  appeal,
  onSent,
}: {
  appeal: AccountAppeal;
  onSent(): void;
}) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await projectApiRequest("POST", "project-appeals", {
        projectId: appeal.projectId,
        reason: reason.trim(),
        evidenceReference: evidence.trim(),
      });
      setSent(true);
      onSent();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="admin-actions"
      onSubmit={submit}
      aria-label={`Account appeal for ${appeal.projectId}`}
    >
      <h3>{appeal.projectId}</h3>
      {sent || appeal.appeal === "requested" ? (
        <p role="status">
          Appeal recorded. The ban stays in place until a moderator clears your
          account.
        </p>
      ) : (
        <>
          <label>
            Reason for appeal
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            Evidence reference
            <input
              required
              maxLength={500}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <p>
            Use a private case reference for sensitive evidence. Do not enter
            passwords or keys.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <button
            className="button secondary-button"
            type="submit"
            disabled={busy || !reason.trim() || !evidence.trim()}
          >
            {busy ? "Sending appeal…" : "Send account appeal"}
          </button>
        </>
      )}
    </form>
  );
}
