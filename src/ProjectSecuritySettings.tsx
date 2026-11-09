import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { errorMessage } from "./lib/errors";
import { type ProjectSessionState, projectApiRequest } from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { OwnerBountyVault } from "./OwnerBountyVault";
import {
  checkedSecuritySettingsFailure,
  isSecuritySettingsAccessLoss,
  isSecuritySettingsIdentityChange,
  requireSecuritySettingsActor,
  SecurityProgramEditor,
} from "./SecurityProgramEditor";

type Revision = { revision: number; project: ProjectDefinition };

/** Existing owner controls, loaded only after opening the Security workspace. */
export function ProjectSecuritySettings({
  project,
  onProjectChange,
  onPublishedRevision,
  onIdentityChange,
  session,
}: {
  project: ProjectDefinition;
  onProjectChange: (project: ProjectDefinition) => void;
  onPublishedRevision: (revision: number) => void;
  onIdentityChange: () => void;
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
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [actorId, project.id],
  );
  const onAccessLost = useCallback(
    (message: string, identityChanged = false) => {
      generation.current += 1;
      setPermitted(null);
      setPermissionError(message);
      if (identityChanged) onIdentityChange();
    },
    [onIdentityChange],
  );
  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    const owns = () => active && generation.current === current;
    setPermitted(null);
    setPermissionError(null);
    if (actorId && opened)
      void (async () => {
        try {
          await requireSecuritySettingsActor(actorId);
          if (!owns()) return;
          const result = await projectApiRequest<{
            viewer: { githubId: string };
            canManageBounty: boolean;
          }>(
            "GET",
            `project-setup/${encodeURIComponent(project.id)}?attempt=${permissionAttempt}`,
            undefined,
            { expectedActorGithubId: actorId },
          );
          if (!owns()) return;
          await requireSecuritySettingsActor(actorId);
          if (!owns()) return;
          if (result.viewer.githubId !== actorId) {
            onAccessLost(
              "Your account changed. Retry management access.",
              true,
            );
            return;
          }
          if (result.canManageBounty) setPermitted(`${project.id}:${actorId}`);
          else {
            onAccessLost(
              "Only the current project steward or a repository administrator can manage this bounty.",
            );
          }
        } catch (cause) {
          if (!owns()) return;
          const failure = await checkedSecuritySettingsFailure(cause, actorId);
          if (!owns()) return;
          onAccessLost(
            errorMessage(
              failure,
              "Current project access could not be checked.",
            ),
            isSecuritySettingsIdentityChange(failure),
          );
        }
      })();
    return () => {
      active = false;
    };
  }, [actorId, project.id, opened, permissionAttempt, onAccessLost]);
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
          onAccessLost={onAccessLost}
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
  onAccessLost,
  onProjectChange,
  onPublishedRevision,
}: {
  actor: { githubId: string; githubLogin: string };
  project: ProjectDefinition;
  onAccessLost: (message: string, identityChanged?: boolean) => void;
  onProjectChange: (project: ProjectDefinition) => void;
  onPublishedRevision: (revision: number) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; value: Revision }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    const owns = () =>
      mounted.current && active && generation.current === current;
    const actorId = actor.githubId;
    setState({ status: "loading" });
    void (async () => {
      try {
        await requireSecuritySettingsActor(actorId);
        if (!owns()) return;
        const value = await projectApiRequest<Revision>(
          "GET",
          `projects/${encodeURIComponent(project.id)}?reload=${attempt}`,
          undefined,
          { expectedActorGithubId: actorId },
        );
        if (!owns()) return;
        await requireSecuritySettingsActor(actorId);
        if (!owns()) return;
        setState({ status: "ready", value });
        onProjectChange(value.project);
      } catch (cause) {
        if (!owns()) return;
        if (isSecuritySettingsAccessLoss(cause)) {
          onAccessLost(
            errorMessage(cause),
            isSecuritySettingsIdentityChange(cause),
          );
          return;
        }
        const failure = await checkedSecuritySettingsFailure(cause, actorId);
        if (!owns()) return;
        if (isSecuritySettingsAccessLoss(failure)) {
          onAccessLost(
            errorMessage(failure),
            isSecuritySettingsIdentityChange(failure),
          );
          return;
        }
        setState({
          status: "error",
          message: errorMessage(failure, "Cannot read the current revision."),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [actor.githubId, project.id, attempt, onAccessLost, onProjectChange]);
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
    if (!mounted.current) return;
    setState({ status: "ready", value });
    onProjectChange(value.project);
  };
  return (
    <div className="security-owner-settings">
      <SecurityProgramEditor
        actor={actor}
        key={`${current.project.id}:${current.revision}`}
        onAccessLost={onAccessLost}
        onPublished={(result) => {
          if (!mounted.current) return;
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
