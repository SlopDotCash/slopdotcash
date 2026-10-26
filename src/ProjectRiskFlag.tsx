/**
 * Contributor flag for a malicious-code or injection risk in a project (PRD
 * sections 4 and 8). A signed-in member files one flag with evidence; two
 * distinct members' flags pause the project at once, and a clean fresh scan
 * reinstates it. The member sees only their own flag.
 */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { FlagCategory } from "../backend/vetting/flags";
import { errorMessage } from "./lib/errors";
import {
  currentProjectSession,
  ProjectApiError,
  projectApiRequest,
} from "./lib/project-api";
import type { RestrictionState } from "./lib/project-contracts";
import { useAction } from "./lib/use-action";
import { loginHref } from "./Points";
import { formatDateTime } from "./Presentation";

/** A label for every category the flag API accepts, in picker order. */
const CATEGORY_LABELS: Record<FlagCategory, string> = {
  "wallet-drainer": "Wallet drainer or key theft",
  "credential-theft": "Credential or password theft",
  "secret-exfiltration": "Sends secrets or data elsewhere",
  "unsafe-execution": "Unsafe install or build-time execution",
  "prompt-injection": "Instructions that try to redirect an agent",
  other: "Other malicious behavior",
};

type OwnFlag = {
  id: string;
  category: FlagCategory;
  evidence: string;
  evidenceUrl: string | null;
  createdAt: string;
  expiresAt: string;
};
type FlagStatus = {
  flag: OwnFlag | null;
  restriction: RestrictionState;
  pausedByFlags: boolean;
  paused?: boolean;
};
type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; value: FlagStatus };

const UNAVAILABLE =
  "Flag status is unavailable. Nothing was filed. Please retry.";

function categoryLabel(category: FlagCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function ProjectRiskFlag({ projectId }: { projectId: string }) {
  const path = `project-flags/${encodeURIComponent(projectId)}`;
  const [state, setState] = useState<State>({ status: "loading" });
  const [category, setCategory] = useState<FlagCategory>("credential-theft");
  const [evidence, setEvidence] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const { busy, error, run } = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    currentProjectSession()
      .then((session) =>
        session === null ? null : projectApiRequest<FlagStatus>("GET", path),
      )
      .then(
        (value) => {
          if (active)
            setState(
              value === null
                ? { status: "signed-out" }
                : { status: "ready", value },
            );
        },
        (caught: unknown) => {
          if (!active) return;
          setState(
            caught instanceof ProjectApiError && caught.status === 401
              ? { status: "signed-out" }
              : { status: "error", message: UNAVAILABLE },
          );
        },
      );
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => load(), [load]);

  const act = (
    request: Promise<FlagStatus>,
    done: (value: FlagStatus) => string,
  ) => {
    setNotice(null);
    void run(
      async () => {
        try {
          const value = await request;
          setState({ status: "ready", value });
          setNotice(done(value));
        } catch (caught) {
          if (!(caught instanceof ProjectApiError) || caught.status !== 401)
            throw caught;
          setState({ status: "signed-out" });
        }
      },
      (caught) => errorMessage(caught, "The request failed."),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    act(
      projectApiRequest<FlagStatus>("POST", path, {
        category,
        evidence: evidence.trim(),
        evidenceUrl: evidenceUrl.trim() || null,
      }),
      (value) => {
        setEvidence("");
        setEvidenceUrl("");
        return value.paused
          ? "Flag recorded. A second member had flagged this project, so it is now paused and moderators were notified. A clean fresh scan reinstates it."
          : "Flag recorded. Your flag counts for 90 days, until you withdraw it, or until a later clean scan resolves it.";
      },
    );
  };

  const withdraw = () =>
    act(
      projectApiRequest<FlagStatus>("POST", `${path}/withdraw`, {}),
      () =>
        "Flag withdrawn. It no longer counts toward a pause; a pause already in place stays until a clean scan.",
    );

  return (
    <details className="project-risk-flag">
      <summary>Report malicious code in this project</summary>
      <p>
        Stop work and flag code or instructions that steal wallets, credentials
        or secrets, run unsafe downloads, or redirect your agent. Flags from two
        members pause the project. Flagging requires a GitHub account at least
        30 days old and one accepted Slop contribution. Report ordinary
        vulnerabilities privately through the project&apos;s security policy.
      </p>
      {state.status === "loading" ? (
        <p role="status">Loading your flag status…</p>
      ) : state.status === "signed-out" ? (
        <p>
          <a href={loginHref(window.location.pathname)}>Sign in with GitHub</a>{" "}
          to flag this project.
        </p>
      ) : state.status === "error" ? (
        <p className="form-error" role="alert">
          {state.message}{" "}
          <button className="button" onClick={load} type="button">
            Retry
          </button>
        </p>
      ) : state.value.flag ? (
        <div className="security-form">
          <p>
            You flagged this project on{" "}
            {formatDateTime(state.value.flag.createdAt)} for{" "}
            <strong>{categoryLabel(state.value.flag.category)}</strong>. It
            counts until {formatDateTime(state.value.flag.expiresAt)}.
            {state.value.restriction === "clear"
              ? " The project is not paused."
              : state.value.pausedByFlags
                ? " The project is paused until a clean fresh scan."
                : ` The project is ${state.value.restriction}; a moderator decides.`}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={withdraw}
            type="button"
          >
            {busy ? "Withdrawing…" : "Withdraw my flag"}
          </button>
        </div>
      ) : (
        <form className="security-form" onSubmit={submit}>
          <label>
            Risk
            <select
              onChange={(event) =>
                setCategory(event.target.value as FlagCategory)
              }
              value={category}
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evidence
            <textarea
              maxLength={4000}
              minLength={20}
              onChange={(event) => setEvidence(event.target.value)}
              required
              rows={4}
              value={evidence}
            />
            <small className="field-hint">
              Name the file, line or command and what it does. Do not paste
              secrets, keys or private data.
            </small>
          </label>
          <label>
            GitHub link (optional)
            <input
              inputMode="url"
              onChange={(event) => setEvidenceUrl(event.target.value)}
              pattern="https://github\.com/.+"
              placeholder="https://github.com/owner/repo/blob/…"
              type="url"
              value={evidenceUrl}
            />
          </label>
          <button
            className="button primary-button"
            disabled={busy}
            type="submit"
          >
            {busy ? "Flagging…" : "Flag this project"}
          </button>
        </form>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}
