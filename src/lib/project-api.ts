/**
 * Browser client for the slop.cash project registry API. Requests ride the
 * site sign-in cookie from /login; the API decides authority on every call.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchWithDeadline } from "./browser-json";
import type {
  PublicProjectApplication as ProjectApplication,
  WebSession as ProjectSession,
  ProjectSetupStatus,
} from "./project-contracts";
import type { ProjectDefinition } from "./projects.mjs";
import { isRecord } from "./record-validation.mjs";

export type {
  AdminProject,
  EnforcementAction,
  EnforcementPreview,
  PublicProjectApplication as ProjectApplication,
} from "./project-contracts";

export class ProjectApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One same-origin JSON request to the API with its own deadline. A body makes
 * it a POST. Callers read the bounded response and map statuses to their copy.
 */
export function apiRequest(
  path: string,
  {
    body,
    signal,
    timeoutMs,
    headers,
  }: {
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs: number;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(`/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
}

export async function projectApiRequest<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  options?: { expectedActorGithubId?: string },
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithDeadline(`/api/v1/${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options?.expectedActorGithubId === undefined
          ? {}
          : { "x-slop-expected-github-id": options.expectedActorGithubId }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ProjectApiError(
      0,
      "network_error",
      error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
        ? "The request timed out. Try again."
        : "The network request failed. Try again.",
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new ProjectApiError(
        0,
        "network_error",
        "The request timed out. Try again.",
      );
    throw new ProjectApiError(
      response.status,
      "invalid_response",
      "The server returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const error = (
      typeof parsed === "object" && parsed !== null ? parsed : {}
    ) as { error?: unknown; message?: unknown };
    throw new ProjectApiError(
      response.status,
      typeof error.error === "string" ? error.error : "request_failed",
      typeof error.message === "string"
        ? error.message
        : `The request failed with HTTP ${response.status}.`,
    );
  }
  return parsed as T;
}

/** Resolves null when the visitor is not signed in. */
export async function currentProjectSession(): Promise<ProjectSession | null> {
  const body = await projectApiRequest<unknown>("GET", "project-session");
  const session = isRecord(body) ? body.session : undefined;
  if (session === null) return null;
  if (
    !isRecord(session) ||
    typeof session.githubId !== "string" ||
    !/^[1-9][0-9]*$/u.test(session.githubId) ||
    typeof session.githubLogin !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(
      session.githubLogin,
    ) ||
    (session.admin !== undefined && typeof session.admin !== "boolean")
  ) {
    throw new ProjectApiError(
      200,
      "invalid_response",
      "The server returned an invalid project session. Retry sign-in.",
    );
  }
  return {
    githubId: session.githubId,
    githubLogin: session.githubLogin,
    admin: session.admin === true,
  };
}

type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
  status: ProjectDefinition["status"];
  listingTier: ProjectDefinition["listingTier"];
  revision: number;
};

/** Creates the project at once; the response carries its setup status. */
/**
 * `monthlyAmount` is a decimal number of whole reward-asset units. The
 * server stores it in the asset's base units after it reads the decimals.
 */
export function createProject(
  manifest: ProjectDefinition,
  referrer: string | null,
  monthlyAmount: string | null,
  bountyAmount: string | null = null,
  expectedActorGithubId?: string,
): Promise<{
  project: { id: string; revision: number; referrer: unknown };
  setup: ProjectSetupStatus;
}> {
  return projectApiRequest(
    "POST",
    "projects",
    {
      manifest,
      ...(referrer === null ? {} : { referrer }),
      ...(monthlyAmount === null ? {} : { monthlyAmount }),
      ...(bountyAmount === null ? {} : { bountyAmount }),
    },
    { expectedActorGithubId },
  );
}

/** Runs the setup checks; a passing project activates as part of the check. */
export function checkProjectSetup(
  projectId: string,
  requestScan = false,
  expectedActorGithubId?: string,
): Promise<{ setup: ProjectSetupStatus }> {
  return projectApiRequest(
    "POST",
    `project-setup/${encodeURIComponent(projectId)}/check`,
    requestScan ? { requestScan: true } : {},
    { expectedActorGithubId },
  );
}

/** The signed-in account's projects and its stored applications. */
export function listProjectSetup(expectedActorGithubId?: string): Promise<{
  projects: ProjectSummary[];
  applications: ProjectApplication[];
}> {
  return projectApiRequest("GET", "project-setup", undefined, {
    expectedActorGithubId,
  });
}

/** Publishes an application stored before self-service setup. */
export function publishStoredApplication(
  applicationId: string,
  expectedActorGithubId?: string,
): Promise<{ project: { id: string }; setup: ProjectSetupStatus }> {
  return projectApiRequest(
    "POST",
    `project-applications/${encodeURIComponent(applicationId)}/publish`,
    {},
    { expectedActorGithubId },
  );
}

export type RevisionResult = {
  project: {
    id: string;
    revision: number;
    status: string;
    manifest: ProjectDefinition;
  };
  changes: {
    presentation: string[];
    executable: string[];
    financial: string[];
  };
  setup: ProjectSetupStatus;
};

/** Publishes an owner revision against the revision the owner read. */
export function publishProjectRevision(
  projectId: string,
  manifest: ProjectDefinition,
  expectedRevision: number,
  note: string,
  monthlyAmount: string | null,
  bountyAmount: string | null = null,
  expectedActorGithubId?: string,
): Promise<RevisionResult> {
  return projectApiRequest(
    "PUT",
    `projects/${encodeURIComponent(projectId)}`,
    {
      manifest,
      expectedRevision,
      ...(note.trim() ? { reason: note.trim() } : {}),
      ...(monthlyAmount === null ? {} : { monthlyAmount }),
      ...(bountyAmount === null ? {} : { bountyAmount }),
    },
    { expectedActorGithubId },
  );
}

export type ProjectSessionState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "signed-in"; session: ProjectSession };

let sessionChangeRevision = 0;
const sessionChangeListeners = new Set<() => void>();

/** Publish only a completed, explicit session change in this browser tab. */
export function notifyProjectSessionChanged(): void {
  sessionChangeRevision += 1;
  for (const listener of sessionChangeListeners) listener();
}

export function subscribeProjectSessionChange(
  listener: () => void,
): () => void {
  sessionChangeListeners.add(listener);
  return () => {
    sessionChangeListeners.delete(listener);
  };
}

/** Revalidate on mount, caller revision, explicit signout and tab return. */
export function useProjectSession(
  revision: number | string = 0,
  enabled = true,
): ProjectSessionState {
  const [snapshot, setSnapshot] = useState<{
    revision: number | string;
    sessionRevision: number;
    state: ProjectSessionState;
  }>({
    revision,
    sessionRevision: sessionChangeRevision,
    state: { status: "checking" },
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      const sessionRevision = sessionChangeRevision;
      setSnapshot({ revision, sessionRevision, state: { status: "checking" } });
      currentProjectSession().then(
        (session) => {
          if (
            !active ||
            current !== generation ||
            sessionRevision !== sessionChangeRevision
          )
            return;
          setSnapshot({
            revision,
            sessionRevision,
            state:
              session === null
                ? { status: "signed-out" }
                : { status: "signed-in", session },
          });
        },
        (error: unknown) => {
          if (
            !active ||
            current !== generation ||
            sessionRevision !== sessionChangeRevision
          )
            return;
          setSnapshot({
            revision,
            sessionRevision,
            state: {
              status: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Something went wrong.",
            },
          });
        },
      );
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    const unsubscribe = subscribeProjectSessionChange(refresh);
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => {
      active = false;
      generation += 1;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", restored);
    };
  }, [revision, enabled]);
  // Never show the old actor while a requested identity check is pending.
  return enabled &&
    snapshot.revision === revision &&
    snapshot.sessionRevision === sessionChangeRevision
    ? snapshot.state
    : { status: "checking" };
}

/** Show owner controls only after the API verifies current repository authority. */
export function useProjectMaintainer(projectId: string) {
  const [attempt, setAttempt] = useState(0);
  const session = useProjectSession(attempt);
  const [verified, setVerified] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  // The identity whose maintainer check has answered, allowed or not, so a
  // signed-in visitor sees "checking" rather than a refusal while it runs.
  const [settled, setSettled] = useState<string | null>(null);
  const actorId =
    session.status === "signed-in" ? session.session.githubId : null;
  const identity = actorId === null ? null : `${projectId}:${actorId}`;
  useEffect(() => {
    let active = true;
    setVerified(null);
    setSettled(null);
    setFailure(null);
    if (identity && actorId) {
      void (async () => {
        let problem: unknown;
        try {
          const result = await projectApiRequest<{
            viewer: { githubId: string };
          }>(
            "GET",
            `project-setup/${encodeURIComponent(projectId)}`,
            undefined,
            { expectedActorGithubId: actorId },
          );
          if (result?.viewer?.githubId !== actorId)
            problem = new ProjectApiError(
              409,
              "actor_changed",
              "Your account changed. Retry the access check.",
            );
        } catch (error) {
          problem = error;
        }
        if (!active) return;
        try {
          const current = await currentProjectSession();
          if (!active) return;
          if (current?.githubId !== actorId)
            throw new ProjectApiError(
              409,
              "actor_changed",
              "Your account changed. Retry the access check.",
            );
          if (problem !== undefined) throw problem;
          setVerified(identity);
          setSettled(identity);
        } catch (error) {
          if (!active) return;
          setVerified(null);
          setSettled(identity);
          if (!(error instanceof ProjectApiError && error.status === 403))
            setFailure({
              identity,
              message:
                error instanceof Error
                  ? error.message
                  : "Project access could not be checked. Retry.",
            });
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [projectId, actorId, identity]);
  return {
    allowed: identity !== null && verified === identity,
    checking:
      session.status === "checking" ||
      (identity !== null && settled !== identity),
    error:
      identity !== null && failure?.identity === identity
        ? failure.message
        : null,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
    session,
  };
}
