/**
 * Requested repos (PRD section 11, "Referral program"): public GitHub
 * repositories that Slop contributors with merged work would work on, by
 * count. Anyone copies a pitch carrying their own referral link. A member
 * flags a repository from `?flag=owner/name`; the click is the operator's OK.
 */

import { useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import {
  type MyRepoRequest,
  pitchLink,
  pitchText,
  REPO_PATH_RULE,
  REPO_REQUESTS_API,
  REQUESTED_PAGE,
  type RepoRequestAction,
  type RepoRequestBoard,
  repoRequestAnswer,
  repoRequestBoard,
  repoUrl,
  validRepoPath,
} from "./lib/repo-requests";
import { useAction } from "./lib/use-action";
import { useCopyFeedback } from "./lib/use-copy-feedback";
import { usePoints } from "./Points";
import {
  ExternalLinkAnchor,
  formatDate,
  SignInPanel,
  Spinner,
} from "./Presentation";

type BoardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; board: RepoRequestBoard };

async function loadBoard(signal: AbortSignal): Promise<RepoRequestBoard> {
  const response = await fetchWithDeadline(REPO_REQUESTS_API, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Requested repos could not load.");
  return repoRequestBoard(
    await readBoundedJson(response, 256 * 1024, "Requested repos"),
  );
}

async function sendRequest(
  githubId: string | null,
  repo: string,
  action: RepoRequestAction,
  signal: AbortSignal,
) {
  const response = await fetchWithDeadline(REPO_REQUESTS_API, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(githubId === null ? {} : { "x-slop-expected-github-id": githubId }),
    },
    body: JSON.stringify({ repo, action }),
    signal,
  });
  const body = await readBoundedJson(response, 4096, "Repo request");
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? (body as { message?: unknown }).message
        : undefined;
    throw new Error(
      typeof message === "string" && message !== "Internal error"
        ? message
        : "Your flag could not be saved. Retry.",
    );
  }
  return repoRequestAnswer(body);
}

function CopyPitch({ text, repo }: { text: string; repo: string }) {
  const { feedback, copy } = useCopyFeedback(text);
  return (
    <>
      <button
        type="button"
        aria-label={`Copy pitch for ${repo}`}
        onClick={copy}
      >
        Copy pitch
      </button>
      {feedback !== "idle" ? (
        <span role="status">
          {feedback === "copied"
            ? " Copied."
            : " Copy failed. Select and copy the text."}
        </span>
      ) : null}
    </>
  );
}

/** The `?flag=` repository of this visit, as typed in the address. */
function flagParameter(): string | null {
  return new URLSearchParams(window.location.search).get("flag");
}

function RequestedRepos({
  githubId,
  viewer,
  session,
}: {
  githubId: string | null;
  viewer: { login: string; referralCode: string | null } | null;
  session: "loading" | "ready" | "error";
}) {
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const unmounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reloads the board.
  useEffect(() => {
    const controller = new AbortController();
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    loadBoard(controller.signal).then(
      (board) => {
        if (!controller.signal.aborted) setState({ status: "ready", board });
      },
      () => {
        // A failed reload keeps the board already on screen.
        if (!controller.signal.aborted)
          setState((current) =>
            current.status === "ready" ? current : { status: "error" },
          );
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const act = (repo: string, action: RepoRequestAction) => {
    const signal = unmounted.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setDone(null);
    void run(async () => {
      const answer = await sendRequest(githubId, repo, action, signal);
      if (signal.aborted) return;
      setDone(
        answer.flagged
          ? `Flagged ${answer.repo} until ${formatDate(answer.expiresAt ?? "")}.`
          : `Withdrawn your flag on ${answer.repo}.`,
      );
      setAttempt((value) => value + 1);
    });
  };

  const requested = flagParameter();
  const link = pitchLink(window.location.origin, viewer);
  const mine: MyRepoRequest[] =
    state.status === "ready" ? (state.board.mine ?? []) : [];

  return (
    <main className="shell route-main">
      <h1>Requested repos</h1>
      <p>
        Repos Slop contributors want to work on. A count is accounts with merged
        work on Slop that flagged the repo in the last 90 days.
      </p>

      {requested !== null ? (
        <section className="points-panel" aria-labelledby="flag-heading">
          <h2 id="flag-heading">Flag a repo</h2>
          {!validRepoPath(requested) ? (
            <p role="alert">{REPO_PATH_RULE}</p>
          ) : session === "loading" ? (
            <Spinner label="Checking sign-in" />
          ) : viewer === null ? (
            <SignInPanel
              state={
                session === "error"
                  ? {
                      status: "error",
                      message: "Sign-in could not be checked. Try again.",
                    }
                  : { status: "signed-out" }
              }
              next={`${REQUESTED_PAGE}?flag=${encodeURIComponent(requested)}`}
              purpose={`Sign in to flag ${requested} as a repo you'd work on.`}
            />
          ) : (
            <>
              <p>
                Flag{" "}
                <ExternalLinkAnchor href={repoUrl(requested)}>
                  {requested}
                </ExternalLinkAnchor>{" "}
                as a repo you'd work on?
              </p>
              <div className="handoff-actions">
                <button
                  className="button primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => act(requested, "flag")}
                >
                  {busy ? "Saving…" : "Flag"}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {done ? <p role="status">{done}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {state.status === "loading" ? (
        <Spinner label="Loading requested repos" />
      ) : state.status === "error" ? (
        <div role="alert">
          <p>Requested repos could not load.</p>
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : state.board.repos.length === 0 ? (
        <p>No repos are flagged yet.</p>
      ) : (
        <div className="plain-table-wrap">
          <table className="plain-table">
            <caption className="visually-hidden">Requested repos</caption>
            <thead>
              <tr>
                <th scope="col">Repo</th>
                <th scope="col">Contributors</th>
                <th scope="col">Last flagged</th>
                <th scope="col">Pitch</th>
              </tr>
            </thead>
            <tbody>
              {state.board.repos.map((row) => (
                <tr key={row.repo}>
                  <th scope="row">
                    <ExternalLinkAnchor href={repoUrl(row.repo)}>
                      {row.repo}
                    </ExternalLinkAnchor>
                  </th>
                  <td>{row.count}</td>
                  <td>{formatDate(row.newestAt)}</td>
                  <td>
                    <CopyPitch
                      repo={row.repo}
                      text={pitchText(row.count, row.repo, link)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewer !== null && state.status === "ready" ? (
        <section className="points-panel" aria-labelledby="mine-heading">
          <h2 id="mine-heading">Your flags</h2>
          {mine.length === 0 ? (
            <p>You have not flagged a repo.</p>
          ) : (
            <ul>
              {mine.map((row) => (
                <li key={row.repo}>
                  <ExternalLinkAnchor href={repoUrl(row.repo)}>
                    {row.repo}
                  </ExternalLinkAnchor>{" "}
                  {row.listedAs !== null
                    ? `· Now on Slop as ${row.listedAs}`
                    : `· Counts until ${formatDate(row.expiresAt)}`}{" "}
                  {row.listedAs === null ? (
                    <button
                      type="button"
                      aria-label={`Renew ${row.repo}`}
                      disabled={busy}
                      onClick={() => act(row.repo, "flag")}
                    >
                      Renew
                    </button>
                  ) : null}{" "}
                  <button
                    type="button"
                    aria-label={`Withdraw ${row.repo}`}
                    disabled={busy}
                    onClick={() => act(row.repo, "withdraw")}
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}

export default function RequestedReposPage() {
  const { me, session } = usePoints();
  const viewer =
    me === null
      ? null
      : { login: me.actor.login, referralCode: me.referralCode ?? null };
  return (
    <RequestedRepos
      key={me?.actor.id ?? "signed-out"}
      githubId={me ? githubUserIdFromNodeId(me.actor.id) : null}
      viewer={viewer}
      session={session}
    />
  );
}
