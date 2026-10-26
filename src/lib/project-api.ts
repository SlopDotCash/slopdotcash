/**
 * Browser client for the slop.cash project registry API. Requests ride the
 * site sign-in cookie from /login; the API decides authority on every call.
 */

import { useEffect, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import type {
  PublicProjectApplication as ProjectApplication,
  WebSession as ProjectSession,
  ProjectSetupStatus,
} from "./project-contracts";
import type { ProjectDefinition } from "./projects.mjs";

export type {
  AdminProject,
  EnforcementAction,
  EnforcementPreview,
  PublicProjectApplication as ProjectApplication,
} from "./project-contracts";

/** Above the largest admin and security list the API returns. */
const MAX_PROJECT_API_BYTES = 16 * 1024 * 1024;

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
  }: { body?: unknown; signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(`/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
}

export async function projectApiRequest<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithDeadline(`/api/v1/${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
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
    parsed = await readBoundedJson(
      response,
      MAX_PROJECT_API_BYTES,
      "The project API",
    );
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
    const error = parsed as { error?: unknown; message?: unknown };
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
  return (
    await projectApiRequest<{ session: ProjectSession | null }>(
      "GET",
      "project-session",
    )
  ).session;
}

export type ProjectSummary = {
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
): Promise<{
  project: { id: string; revision: number; referrer: unknown };
  setup: ProjectSetupStatus;
}> {
  return projectApiRequest("POST", "projects", {
    manifest,
    ...(referrer === null ? {} : { referrer }),
    ...(monthlyAmount === null ? {} : { monthlyAmount }),
  });
}

/** Runs the setup checks; a passing project activates as part of the check. */
export function checkProjectSetup(
  projectId: string,
  requestScan = false,
): Promise<{ setup: ProjectSetupStatus }> {
  return projectApiRequest(
    "POST",
    `project-setup/${encodeURIComponent(projectId)}/check`,
    requestScan ? { requestScan: true } : {},
  );
}

/** The signed-in account's projects and its stored applications. */
export function listProjectSetup(): Promise<{
  projects: ProjectSummary[];
  applications: ProjectApplication[];
}> {
  return projectApiRequest("GET", "project-setup");
}

/** Publishes an application stored before self-service setup. */
export function publishStoredApplication(
  applicationId: string,
): Promise<{ project: { id: string }; setup: ProjectSetupStatus }> {
  return projectApiRequest(
    "POST",
    `project-applications/${encodeURIComponent(applicationId)}/publish`,
    {},
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
): Promise<RevisionResult> {
  return projectApiRequest("PUT", `projects/${encodeURIComponent(projectId)}`, {
    manifest,
    expectedRevision,
    ...(note.trim() ? { reason: note.trim() } : {}),
    ...(monthlyAmount === null ? {} : { monthlyAmount }),
  });
}

export type ProjectSessionState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "signed-in"; session: ProjectSession };

/** Reads the site sign-in session once per mount. */
export function useProjectSession(): ProjectSessionState {
  const [state, setState] = useState<ProjectSessionState>({
    status: "checking",
  });
  useEffect(() => {
    let active = true;
    currentProjectSession().then(
      (session) => {
        if (!active) return;
        setState(
          session === null
            ? { status: "signed-out" }
            : { status: "signed-in", session },
        );
      },
      (error: unknown) => {
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Something went wrong.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}
