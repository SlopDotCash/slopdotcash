import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "./lib/errors";
import { projectApiRequest } from "./lib/project-api";
import type { AppealState, RestrictionState } from "./lib/project-contracts";
import { findProject } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";

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
  const restricted = appeals ?? [];
  // Nothing to appeal: show the section only for a restriction or a failed read.
  if (!error && restricted.length === 0) return null;
  return (
    <section id="appeals" aria-labelledby="account-appeals-heading">
      <h2 id="account-appeals-heading">Appeals</h2>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      ) : (
        <>
          <p>A ban stops new participation. Funded awards are kept.</p>
          {restricted.map((appeal) => (
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
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await projectApiRequest("POST", "project-appeals", {
        projectId: appeal.projectId,
        appealScope: "account",
        reason: reason.trim(),
        evidenceReference: evidence.trim(),
      });
      setSent(true);
      onSent();
    });
  };
  return (
    <form
      className="admin-actions"
      onSubmit={submit}
      aria-label={`Account appeal for ${appeal.projectId}`}
    >
      <h3>{findProject(appeal.projectId)?.name ?? appeal.projectId}</h3>
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
          <p>Do not enter passwords or keys.</p>
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
