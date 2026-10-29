/** Explicit opt-in to the signed-in account's verified email destination (NOT-01). */

import { useCallback, useEffect, useRef, useState } from "react";
import { localBackendOrigin, loginHref } from "./lib/browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";

type Preference =
  | {
      enabled: boolean;
      availability: "verified";
      email: string;
      destinationVersion: string;
    }
  | { enabled: boolean; availability: "unverified" | "unavailable" };
type State =
  | { status: "loading" | "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; value: Preference; actor: string | null };
const PATH = "/api/v1/notifications/email";

function preference(value: unknown): Preference {
  const body = value as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.enabled !== "boolean" ||
    !["verified", "unverified", "unavailable"].includes(
      String(body.availability),
    ) ||
    (body.availability === "verified" &&
      (typeof body.email !== "string" ||
        body.email.length === 0 ||
        body.email.length > 254 ||
        typeof body.destinationVersion !== "string" ||
        !/^[a-f0-9]{64}$/u.test(body.destinationVersion)))
  )
    throw new Error("The email service returned an invalid preference.");
  return body as Preference;
}

export function InboxEmail({ headingId }: { headingId?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const { busy, error, run } = useAction();
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const session = await currentProjectSession().catch(() => null);
        const response = await fetchWithDeadline(PATH, {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers:
            session === null
              ? undefined
              : { "x-slop-expected-github-id": session.githubId },
          signal: controller.signal,
        });
        if (generation.current !== current) return;
        if (response.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (response.status === 403)
          throw new Error("The inbox account changed. Retry.");
        if (!response.ok) throw new Error("Email preferences are unavailable.");
        const value = preference(
          await readBoundedJson(response, 4096, "email preference"),
        );
        if (generation.current === current)
          setState({
            status: "ready",
            value,
            actor: session?.githubId ?? null,
          });
      } catch (caught) {
        if (!controller.signal.aborted && generation.current === current)
          setState({ status: "error", message: errorMessage(caught) });
      }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);

  function save() {
    if (busy || state.status !== "ready") return;
    const previous = state.value;
    // Send the actor captured when this view was rendered, not a fresh
    // session: if the account changed since load, the server refuses with
    // 403 actor_changed instead of writing to the newly signed-in account.
    const actor = state.actor;
    const enabled = !previous.enabled;
    if (enabled && previous.availability !== "verified") return;
    void run(
      async () => {
        const response = await fetchWithDeadline(PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            ...(actor === null ? {} : { "x-slop-expected-github-id": actor }),
          },
          body: JSON.stringify(
            enabled && previous.availability === "verified"
              ? { enabled, destinationVersion: previous.destinationVersion }
              : { enabled: false },
          ),
        });
        if (response.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (response.status === 403) {
          load();
          throw new Error("The inbox account changed. Retry.");
        }
        if (response.status === 409) {
          load();
          throw new Error(
            "Your verified destination changed. Review it before turning on email.",
          );
        }
        if (!response.ok)
          throw new Error("Your preference could not be saved. Please retry.");
        const result = (await readBoundedJson(
          response,
          4096,
          "saved email preference",
        )) as { enabled?: unknown } | null;
        if (result?.enabled !== enabled)
          throw new Error(
            "The saved preference could not be verified. Please retry.",
          );
        setState({
          status: "ready",
          value: { ...previous, enabled },
          actor,
        });
      },
      (cause) => errorMessage(cause, "Your preference could not be saved."),
    );
  }

  const ready = state.status === "ready" ? state.value : null;
  const verified = ready?.availability === "verified";
  const on = ready?.enabled === true;
  const canRetry =
    state.status === "error" || ready?.availability === "unavailable";
  // Opting in needs a verified address; turning off is always allowed. The
  // switch stays enabled while saving so keyboard focus is not lost.
  const switchDisabled = ready === null || (!on && !verified);
  // The verified address is shown before consent (NOT-01), not once email is on.
  const detail = busy
    ? "Saving…"
    : state.status === "loading"
      ? "Loading…"
      : state.status === "error"
        ? `Email preferences could not be loaded: ${state.message}`
        : ready?.availability === "verified"
          ? on
            ? null
            : `${localBackendOrigin ? "Preview address" : "Sent to"} ${ready.email}`
          : ready?.availability === "unverified"
            ? "No verified email address is on file. Notices still appear in this inbox."
            : "We could not check your email address, so activity email cannot be turned on yet.";

  return (
    <section
      aria-labelledby={headingId ? undefined : "inbox-email-heading"}
      className="inbox-email-settings email-card"
    >
      {headingId ? null : <h2 id="inbox-email-heading">Email preferences</h2>}
      {state.status === "signed-out" ? (
        <p>
          Your session expired.{" "}
          <a href={loginHref("/account#notifications")}>Sign in with GitHub</a>.
        </p>
      ) : (
        <>
          <div className="email-row">
            <div className="email-text">
              <strong id="email-activity-label">Activity email</strong>
              {detail ? (
                <span
                  className="email-detail"
                  id="email-activity-detail"
                  role={
                    state.status === "error"
                      ? "alert"
                      : state.status === "loading"
                        ? "status"
                        : undefined
                  }
                >
                  {detail}
                </span>
              ) : null}
            </div>
            <button
              aria-busy={busy}
              aria-checked={on}
              aria-describedby={detail ? "email-activity-detail" : undefined}
              aria-labelledby="email-activity-label"
              className="email-switch"
              disabled={switchDisabled}
              onClick={save}
              role="switch"
              type="button"
            />
          </div>
          {canRetry ? (
            <div>
              <button
                className="button secondary-button button-small"
                type="button"
                disabled={busy}
                onClick={load}
              >
                Retry email preferences
              </button>
            </div>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
