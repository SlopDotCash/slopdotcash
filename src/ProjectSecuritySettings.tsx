import { useEffect, useState } from "react";
import { errorMessage } from "./lib/errors";
import { type ProjectSessionState, projectApiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { OwnerBountyVault } from "./OwnerBountyVault";
import { SecurityProgramEditor } from "./SecurityProgramEditor";

type Revision = { revision: number; project: ProjectDefinition };

/** Existing owner controls, loaded only after opening the Security workspace. */
export function ProjectSecuritySettings({
  project,
  onProjectChange,
  onPublishedRevision,
  session,
}: {
  project: ProjectDefinition;
  onProjectChange: (project: ProjectDefinition) => void;
  onPublishedRevision: (revision: number) => void;
  session: ProjectSessionState;
}) {
  const [opened, setOpened] = useState(
    () => window.location.hash === "#security-settings",
  );
  const [open, setOpen] = useState(opened);
  const [permitted, setPermitted] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [permissionAttempt, setPermissionAttempt] = useState(0);
  const actorId =
    session.status === "signed-in" ? session.session.githubId : null;
  useEffect(() => {
    let active = true;
    setPermitted(null);
    setPermissionError(null);
    if (actorId && opened)
      projectApiRequest<{
        viewer: { githubId: string };
        canManageBounty: boolean;
      }>(
        "GET",
        `project-setup/${encodeURIComponent(project.id)}?attempt=${permissionAttempt}`,
      ).then(
        (result) => {
          if (!active) return;
          if (result.viewer.githubId === actorId && result.canManageBounty)
            setPermitted(`${project.id}:${actorId}`);
          else
            setPermissionError(
              "Only the current project steward or a repository administrator can manage this bounty.",
            );
        },
        (error: unknown) => {
          if (active)
            setPermissionError(
              errorMessage(
                error,
                "Current project access could not be checked.",
              ),
            );
        },
      );
    return () => {
      active = false;
    };
  }, [actorId, project.id, opened, permissionAttempt]);
  if (session.status !== "signed-in") return null;
  return (
    <details
      className="proposal-advanced"
      id="security-settings"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setOpened(true);
      }}
      open={open}
    >
      <summary>Manage security bounty</summary>
      {opened && permitted !== `${project.id}:${actorId}` ? (
        permissionError ? (
          <div role="alert">
            <p>{permissionError}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => setPermissionAttempt((value) => value + 1)}
            >
              Retry management access
            </button>
          </div>
        ) : (
          <p role="status">Checking current project access…</p>
        )
      ) : null}
      {opened && permitted === `${project.id}:${actorId}` ? (
        <SecuritySettingsEditor
          actor={session.session}
          key={`${project.id}:${session.session.githubId}`}
          onProjectChange={onProjectChange}
          onPublishedRevision={onPublishedRevision}
          project={project}
        />
      ) : null}
    </details>
  );
}

function SecuritySettingsEditor({
  actor,
  project,
  onProjectChange,
  onPublishedRevision,
}: {
  actor: { githubId: string; githubLogin: string };
  project: ProjectDefinition;
  onProjectChange: (project: ProjectDefinition) => void;
  onPublishedRevision: (revision: number) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; value: Revision }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    projectApiRequest<Revision>(
      "GET",
      `projects/${encodeURIComponent(project.id)}?reload=${attempt}`,
    ).then(
      (value) => {
        if (!active) return;
        setState({ status: "ready", value });
        onProjectChange(value.project);
      },
      (error: unknown) => {
        if (active)
          setState({
            status: "error",
            message: errorMessage(error, "Cannot read the current revision."),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [project.id, attempt, onProjectChange]);
  if (state.status === "loading")
    return <p role="status">Loading current security settings…</p>;
  if (state.status === "error")
    return (
      <div className="form-error" role="alert">
        <p>{state.message}</p>
        <button
          className="button secondary-button"
          onClick={() => setAttempt((value) => value + 1)}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  const current = state.value;
  const update = (value: Revision) => {
    setState({ status: "ready", value });
    onProjectChange(value.project);
  };
  return (
    <div className="security-owner-settings">
      <SecurityProgramEditor
        embedded
        actor={actor}
        key={`${current.project.id}:${current.revision}`}
        onPublished={(result) => {
          update({
            project: result.project.manifest,
            revision: result.project.revision,
          });
          onPublishedRevision(result.project.revision);
        }}
        project={current.project}
        revision={current.revision}
      />
      {current.project.securityBounty ? (
        <OwnerBountyVault key={current.project.id} project={current.project} />
      ) : null}
    </div>
  );
}
