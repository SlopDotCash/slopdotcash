/**
 * Contributor flag for a malicious-code or injection risk in a project (PRD
 * sections 4 and 8). A signed-in member files one flag with evidence; two
 * distinct members' flags pause the project at once, and a clean fresh scan
 * reinstates it. The member sees only their own flag.
 */

import { Flag, Info, LoaderCircle } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { FlagCategory } from "../backend/vetting/flags";
import { loginHref } from "./lib/browser-deployment";
import { errorMessage } from "./lib/errors";
import {
  currentProjectSession,
  ProjectApiError,
  projectApiRequest,
} from "./lib/project-api";
import type { RestrictionState } from "./lib/project-contracts";
import { useAction } from "./lib/use-action";
import { formatDateTime, StatusBadge } from "./Presentation";

/** A label for every category the flag API accepts, in picker order. */
const CATEGORY_LABELS: Record<FlagCategory, string> = {
  "wallet-drainer": "Wallet drainer",
  "credential-theft": "Credential theft",
  "secret-exfiltration": "Data exfiltration",
  "unsafe-execution": "Unsafe install or build",
  "prompt-injection": "Prompt injection",
  other: "Other",
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

const UNAVAILABLE = "Flag status is unavailable.";

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
          ? "Flag recorded. This project is now paused."
          : "Flag recorded.";
      },
    );
  };

  const withdraw = () =>
    act(
      projectApiRequest<FlagStatus>("POST", `${path}/withdraw`, {}),
      () => "Flag withdrawn.",
    );

  return (
    <details className="project-risk-flag">
      <summary>
        <Flag size={16} aria-hidden="true" /> Report
      </summary>
      {state.status === "loading" ? (
        <p role="status" aria-label="Loading your flag status">
          <LoaderCircle className="wallet-spin" aria-hidden="true" />
        </p>
      ) : state.status === "signed-out" ? (
        <p>
          <a
            className="button secondary-button"
            href={loginHref(window.location.pathname)}
          >
            Sign in with GitHub
          </a>
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
            <StatusBadge icon={<Flag size={14} />}>
              {categoryLabel(state.value.flag.category)}
            </StatusBadge>{" "}
            until {formatDateTime(state.value.flag.expiresAt)}{" "}
            {state.value.restriction === "clear" ? (
              <StatusBadge tone="success">Active</StatusBadge>
            ) : state.value.pausedByFlags ? (
              <StatusBadge tone="warning">Paused</StatusBadge>
            ) : (
              <StatusBadge tone="danger">
                {state.value.restriction === "banned"
                  ? "Banned"
                  : "Quarantined"}
              </StatusBadge>
            )}
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={withdraw}
            type="button"
          >
            {busy ? "Withdrawing…" : "Withdraw"}
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
              placeholder="File, line or command. No secrets."
              required
              rows={4}
              value={evidence}
            />
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
          <p>
            <button
              className="button primary-button"
              disabled={busy}
              type="submit"
            >
              {busy ? "Flagging…" : "Flag"}
            </button>{" "}
            <span
              aria-label="Needs 30-day account and one accepted contribution"
              role="img"
              title="Needs 30-day account and one accepted contribution"
            >
              <Info size={16} aria-hidden="true" />
            </span>
          </p>
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
