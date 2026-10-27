/** Explicit opt-in to the signed-in account's verified email destination (NOT-01). */

import { useCallback, useEffect, useRef, useState } from "react";
import { loginHref } from "./lib/browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
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
  | { status: "ready"; value: Preference };
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

export function InboxEmail() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [message, setMessage] = useState("");
  const { busy, error, run } = useAction();
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetchWithDeadline(PATH, {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        if (generation.current !== current) return;
        if (response.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (!response.ok) throw new Error("Email preferences are unavailable.");
        const value = preference(
          await readBoundedJson(response, 4096, "email preference"),
        );
        if (generation.current === current)
          setState({ status: "ready", value });
      } catch (caught) {
        if (!controller.signal.aborted && generation.current === current)
          setState({ status: "error", message: errorMessage(caught) });
      }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);

  function save() {
    if (state.status !== "ready") return;
    const previous = state.value;
    const enabled = !previous.enabled;
    if (enabled && previous.availability !== "verified") return;
    setMessage("");
    void run(
      async () => {
        const response = await fetchWithDeadline(PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "content-type": "application/json" },
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
        setState({ status: "ready", value: { ...previous, enabled } });
        setMessage(
          enabled
            ? "Optional activity email is on."
            : "Optional activity email is off.",
        );
      },
      (cause) => errorMessage(cause, "Your preference could not be saved."),
    );
  }

  return (
    <section
      className="inbox-email-settings"
      aria-labelledby="inbox-email-heading"
    >
      <h2 id="inbox-email-heading">Email preferences</h2>
      <p>Security notices are sent separately.</p>
      {state.status === "loading" ? (
        <p role="status">Loading email preferences…</p>
      ) : null}
      {state.status === "signed-out" ? (
        <p>
          Your session expired.{" "}
          <a href={loginHref("/account#notifications")}>Sign in with GitHub</a>.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert">
          Email preferences could not be loaded: {state.message}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <>
          <p>
            Optional activity email is {state.value.enabled ? "on" : "off"}.
          </p>
          {state.value.availability === "verified" ? (
            <p>Verified destination: {state.value.email}</p>
          ) : (
            <p>
              {state.value.availability === "unverified"
                ? "No verified email address is on file. Notices still appear in this inbox."
                : "Activity email is temporarily unavailable."}
            </p>
          )}
          {state.value.enabled || state.value.availability === "verified" ? (
            <button
              className="button secondary-button"
              type="button"
              disabled={busy}
              onClick={save}
            >
              {busy
                ? "Saving email preference…"
                : state.value.enabled
                  ? "Turn off activity email"
                  : "Turn on activity email"}
            </button>
          ) : null}
        </>
      ) : null}
      {state.status === "error" ||
      (state.status === "ready" &&
        state.value.availability === "unavailable") ? (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={load}
        >
          Retry email preferences
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
