import { useEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  currentProjectSession,
  listProjectSetup,
  ProjectApiError,
  type ProjectApplication,
  type ProjectSessionState,
  publishStoredApplication,
} from "./lib/project-api";
import { SLOPBOT_INSTALL_URL } from "./lib/project-contracts";
import { ProjectSetupStatusPanel } from "./ProjectSetupStatus";

type Publication =
  | { status: "idle" | "submitting" }
  | { status: "error"; message: string; install: boolean }
  | {
      status: "published";
      result: Awaited<ReturnType<typeof publishStoredApplication>>;
    };

const ACCOUNT_CHANGED = "Your account changed. Reload your saved applications.";

async function requireApplicationActor(actorId: string) {
  const session = await currentProjectSession();
  if (session?.githubId !== actorId)
    throw new ProjectApiError(409, "account_changed", ACCOUNT_CHANGED);
}

function lostApplicationAccess(cause: unknown) {
  return (
    cause instanceof ProjectApiError &&
    (cause.code === "account_changed" ||
      [401, 403, 404, 410].includes(cause.status))
  );
}

function PendingApplication({
  application,
  actorId,
  onAccountLost,
}: {
  application: ProjectApplication;
  actorId: string;
  onAccountLost: (message: string) => void;
}) {
  const [publication, setPublication] = useState<Publication>({
    status: "idle",
  });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isRevision = application.expectedRevision !== undefined;
  async function publish() {
    if (!mounted.current || inFlight.current) return;
    inFlight.current = true;
    setPublication({ status: "submitting" });
    try {
      await requireApplicationActor(actorId);
      if (!mounted.current) return;
      const result = await publishStoredApplication(application.id, actorId);
      if (!mounted.current) return;
      await requireApplicationActor(actorId);
      if (!mounted.current) return;
      setPublication({ status: "published", result });
    } catch (cause) {
      if (!mounted.current) return;
      if (lostApplicationAccess(cause)) {
        onAccountLost(
          cause instanceof ProjectApiError &&
            ["account_changed", "actor_changed"].includes(cause.code)
            ? ACCOUNT_CHANGED
            : errorMessage(
                cause,
                "Saved applications are unavailable. Reload them.",
              ),
        );
        return;
      }
      try {
        await requireApplicationActor(actorId);
      } catch {
        if (mounted.current)
          onAccountLost(
            "Your private session could not be checked. Reload your saved applications.",
          );
        return;
      }
      if (!mounted.current) return;
      setPublication({
        status: "error",
        message: errorMessage(
          cause,
          "The saved application could not be published.",
        ),
        install:
          cause instanceof ProjectApiError && cause.code === "slopbot_required",
      });
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <article
      className="setup-pending-application"
      aria-label={`Pending application: ${application.manifest.name}`}
      data-testid={`pending-application-${application.id}`}
    >
      <div className="setup-pending-application-action">
        {publication.status === "published" ? (
          <a href={`/projects/${publication.result.project.id}/manage`}>
            {application.manifest.name}
          </a>
        ) : (
          <strong>{application.manifest.name}</strong>
        )}
        {publication.status === "published" ? null : (
          <button
            className="button secondary-button"
            type="button"
            disabled={publication.status === "submitting"}
            onClick={() => void publish()}
          >
            {publication.status === "submitting"
              ? isRevision
                ? "Publishing…"
                : "Creating…"
              : publication.status === "error"
                ? "Retry"
                : isRevision
                  ? "Publish this change"
                  : "Create this project"}
          </button>
        )}
      </div>
      {publication.status === "error" ? (
        <p role="alert" className="field-error">
          {publication.message}
          {publication.install ? (
            <>
              {" "}
              <a href={SLOPBOT_INSTALL_URL} target="_blank" rel="noreferrer">
                Install Slopbot
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {publication.status === "published" ? (
        <ProjectSetupStatusPanel
          actorId={actorId}
          compact
          projectId={publication.result.project.id}
          initial={publication.result.setup}
          showProjectLink={false}
        />
      ) : null}
    </article>
  );
}

function PendingApplicationsForAccount({ actorId }: { actorId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<
    | { status: "loading" }
    | { status: "ready"; applications: ProjectApplication[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the inventory request.
  useEffect(() => {
    let active = true;
    setLoad({ status: "loading" });
    void listProjectSetup(actorId)
      .then(async ({ applications }) => {
        if (!active) return;
        await requireApplicationActor(actorId);
        if (active)
          setLoad({
            status: "ready",
            applications: applications.filter(
              (application) => application.status === "pending",
            ),
          });
      })
      .catch((cause) => {
        if (active)
          setLoad({
            status: "error",
            message: errorMessage(cause, "Saved applications could not load."),
          });
      });
    return () => {
      active = false;
    };
  }, [attempt, actorId]);
  if (
    load.status === "loading" ||
    (load.status === "ready" && load.applications.length === 0)
  )
    return null;
  return (
    <section
      className="setup-pending-applications"
      aria-label="Pending applications"
    >
      {load.status === "error" ? (
        <div>
          <p role="alert" className="field-error">
            {load.message}
          </p>
          <button
            className="text-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : (
        load.applications.map((application) => (
          <PendingApplication
            key={application.id}
            application={application}
            actorId={actorId}
            onAccountLost={(message) => setLoad({ status: "error", message })}
          />
        ))
      )}
    </section>
  );
}

/** Keep saved applications available without an inventory of existing projects. */
export function PendingProjectApplications({
  projectSession,
}: {
  projectSession: ProjectSessionState;
}) {
  return projectSession.status === "signed-in" ? (
    <PendingApplicationsForAccount
      key={projectSession.session.githubId}
      actorId={projectSession.session.githubId}
    />
  ) : null;
}
