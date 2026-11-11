import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import {
  cancelProjectApplication,
  currentProjectSession,
  listProjectSetup,
  ProjectApiError,
  type ProjectApplication,
  type ProjectSessionState,
  publishStoredApplication,
} from "./lib/project-api";
import { SLOPBOT_INSTALL_URL } from "./lib/project-contracts";
import { SetupStateBadge } from "./ProjectSetupStatus";

type Publication =
  | { status: "idle" | "submitting" | "cancelling" | "cancelled" }
  | {
      status: "error";
      action: "publish" | "cancel";
      message: string;
      install: boolean;
    }
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
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isRevision = application.expectedRevision !== undefined;
  async function act(action: "publish" | "cancel") {
    if (!mounted.current || inFlight.current) return;
    if (
      action === "cancel" &&
      !window.confirm(
        `Cancel the application for ${application.manifest.name}? It will not be published.`,
      )
    )
      return;
    inFlight.current = true;
    setPublication({
      status: action === "cancel" ? "cancelling" : "submitting",
    });
    try {
      await requireApplicationActor(actorId);
      if (!mounted.current) return;
      const result =
        action === "cancel"
          ? await cancelProjectApplication(application.id, actorId)
          : await publishStoredApplication(application.id, actorId);
      if (!mounted.current) return;
      await requireApplicationActor(actorId);
      if (!mounted.current) return;
      if ("application" in result) {
        setPublication({ status: "cancelled" });
      } else {
        setPublication({ status: "published", result });
      }
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
        if (mounted.current) onAccountLost("Session check failed. Reload.");
        return;
      }
      if (!mounted.current) return;
      setPublication({
        status: "error",
        action,
        message: errorMessage(
          cause,
          action === "cancel"
            ? "Cancellation could not be confirmed. Try again."
            : "The saved application could not be published.",
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
        {publication.status === "published" ? (
          <a
            aria-label={`Manage ${application.manifest.name}`}
            href={`/projects/${publication.result.project.id}/manage`}
          >
            <SetupStateBadge state={publication.result.setup.state} />
          </a>
        ) : publication.status === "cancelled" ? null : (
          <>
            {application.publishable === false ? null : (
              <button
                className="button secondary-button"
                type="button"
                disabled={
                  publication.status === "submitting" ||
                  publication.status === "cancelling"
                }
                onClick={() => void act("publish")}
              >
                {publication.status === "submitting"
                  ? isRevision
                    ? "Publishing…"
                    : "Creating…"
                  : publication.status === "error" &&
                      publication.action === "publish"
                    ? "Retry"
                    : isRevision
                      ? "Publish"
                      : "Create"}
              </button>
            )}
            <button
              className="button secondary-button"
              type="button"
              disabled={
                publication.status === "submitting" ||
                publication.status === "cancelling"
              }
              onClick={() => void act("cancel")}
            >
              {publication.status === "cancelling"
                ? "Cancelling…"
                : "Cancel application"}
            </button>
          </>
        )}
      </div>
      {publication.status === "cancelled" ? (
        <p role="status">Application cancelled.</p>
      ) : null}
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
