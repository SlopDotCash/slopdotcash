import { currentProjectSession, ProjectApiError } from "./project-api";

class AdminAccessLoss extends Error {}

/** An unreadable identity cannot authorize retention of a private Admin view. */
export function isAdminActionAccessLoss(error: unknown): boolean {
  return (
    error instanceof AdminAccessLoss ||
    (error instanceof ProjectApiError &&
      ([401, 403, 404, 410].includes(error.status) ||
        error.code === "actor_changed"))
  );
}

/** A fresh identity observation; each caller still owns its request lifetime. */
export async function requireAdminActionActor(actorId: string): Promise<void> {
  let session;
  try {
    session = await currentProjectSession();
  } catch {
    throw new AdminAccessLoss(
      "Your admin session could not be checked. Retry.",
    );
  }
  if (session?.githubId !== actorId || !session.admin)
    throw new AdminAccessLoss(
      "Your admin account or access changed. Reload this page.",
    );
}

/** Preserve an ordinary error only after the initiating admin is rechecked. */
export async function checkedAdminActionFailure(
  error: unknown,
  actorId: string,
): Promise<unknown> {
  if (isAdminActionAccessLoss(error)) return error;
  try {
    await requireAdminActionActor(actorId);
  } catch (cause) {
    return cause;
  }
  return error;
}
