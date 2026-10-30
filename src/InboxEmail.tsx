/** Explicit opt-in to the signed-in account's verified email destination (NOT-01). */

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { localBackendOrigin, loginHref } from "./lib/browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { currentProjectSession, ProjectApiError } from "./lib/project-api";
import { useAction } from "./lib/use-action";

type PendingVerification = {
  email: string;
  expiresAt: string;
  state: "queued" | "sending" | "sent" | "unknown" | "expired";
};
type Preference = {
  enabled: boolean;
  securityEnabled: boolean;
  enrollmentAvailable: boolean;
  pending: PendingVerification | null;
} & (
  | {
      availability: "verified";
      email: string;
      destinationVersion: string;
    }
  | { availability: "unverified" | "unavailable" }
);
type State =
  | { status: "loading" | "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; value: Preference; actor: string };
const PATH = "/api/v1/notifications/email";

function preference(value: unknown): Preference {
  const body = value as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.enabled !== "boolean" ||
    typeof body.securityEnabled !== "boolean" ||
    typeof body.enrollmentAvailable !== "boolean" ||
    (body.pending !== null &&
      (typeof body.pending !== "object" ||
        !body.pending ||
        typeof (body.pending as PendingVerification).email !== "string" ||
        typeof (body.pending as PendingVerification).expiresAt !== "string" ||
        !Number.isFinite(
          Date.parse((body.pending as PendingVerification).expiresAt),
        ) ||
        !["queued", "sending", "sent", "unknown", "expired"].includes(
          (body.pending as PendingVerification).state,
        ))) ||
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
  const [checking, setChecking] = useState(true);
  const { busy, error, setError, run } = useAction();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [choices, setChoices] = useState({
    enabled: false,
    securityEnabled: false,
  });
  const requestKey = useRef<string | null>(null);
  const generation = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const actorRef = useRef<string | null>(null);
  const resetEditor = useCallback(() => {
    setEditing(false);
    setAddress("");
    setChoices({ enabled: false, securityEnabled: false });
    requestKey.current = null;
  }, []);
  const load = useCallback(
    (background = false) => {
      const current = ++generation.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setChecking(true);
      // A focus check must not detach an editor as the user starts typing.
      setState((previous) =>
        background && previous.status === "ready"
          ? previous
          : { status: "loading" },
      );
      setError(null);
      void (async () => {
        try {
          // A failed identity check must not bind the control to no actor:
          // with actor null, save would omit the expected-actor header and the
          // server would write to whoever is signed in at POST time. Only a
          // 401 keeps the signed-out path; any other failure shows the error
          // state with its Retry button instead of a usable switch.
          let session: Awaited<ReturnType<typeof currentProjectSession>>;
          try {
            session = await currentProjectSession();
          } catch (caught) {
            if (caught instanceof ProjectApiError && caught.status === 401)
              session = null;
            else throw new Error("The account check failed.");
          }
          if (generation.current !== current || controller.signal.aborted)
            return;
          if (
            !session ||
            (actorRef.current !== null && actorRef.current !== session.githubId)
          ) {
            resetEditor();
            setState({ status: "loading" });
          }
          actorRef.current = session?.githubId ?? null;
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
          if (!response.ok)
            throw new Error("Email preferences are unavailable.");
          const value = preference(
            await readBoundedJson(response, 4096, "email preference"),
          );
          // A preference read without a bound actor must not enable the
          // switch: the next save would carry no expected-actor header.
          if (session === null) throw new Error("The account check failed.");
          const after = await currentProjectSession();
          if (generation.current !== current) return;
          if (!after) {
            resetEditor();
            actorRef.current = null;
            setState({ status: "signed-out" });
            return;
          }
          if (after.githubId !== session.githubId) {
            resetEditor();
            actorRef.current = null;
            throw new Error("The inbox account changed. Retry.");
          }
          if (generation.current === current)
            setState({
              status: "ready",
              value,
              actor: session.githubId,
            });
        } catch (caught) {
          if (!controller.signal.aborted && generation.current === current)
            setState({ status: "error", message: errorMessage(caught) });
        } finally {
          if (generation.current === current) setChecking(false);
        }
      })();
      return () => controller.abort();
    },
    [resetEditor, setError],
  );
  useEffect(() => {
    load();
    const refresh = () => {
      if (!busyRef.current) load(true);
    };
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      controllerRef.current?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  async function checkActor(actor: string) {
    let current: Awaited<ReturnType<typeof currentProjectSession>>;
    try {
      current = await currentProjectSession();
    } catch {
      setState({ status: "error", message: "The account check failed." });
      throw new Error("The account check failed. Retry before changing email.");
    }
    if (!current) {
      setState({ status: "signed-out" });
      throw new Error("Your session expired.");
    }
    if (current.githubId !== actor) {
      load();
      throw new Error("The inbox account changed. Retry.");
    }
  }

  function save(field: "enabled" | "securityEnabled") {
    if (busy || checking || state.status !== "ready") return;
    const previous = state.value;
    // Send the actor captured when this view was rendered, not a fresh
    // session: if the account changed since load, the server refuses with
    // 403 actor_changed instead of writing to the newly signed-in account.
    // Ready state always carries a concrete actor: load fails closed when
    // the identity check fails, so save never posts without the header.
    const actor = state.actor;
    const enabled = field === "enabled" ? !previous.enabled : previous.enabled;
    const securityEnabled =
      field === "securityEnabled"
        ? !previous.securityEnabled
        : previous.securityEnabled;
    if (!previous[field] && previous.availability !== "verified") return;
    const current = generation.current;
    void run(
      async () => {
        await checkActor(actor);
        if (generation.current !== current) return;
        const response = await fetchWithDeadline(PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-slop-expected-github-id": actor,
          },
          body: JSON.stringify(
            (enabled || securityEnabled) && previous.availability === "verified"
              ? {
                  enabled,
                  securityEnabled,
                  destinationVersion: previous.destinationVersion,
                }
              : { enabled, securityEnabled },
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
        )) as { enabled?: unknown; securityEnabled?: unknown } | null;
        if (
          result?.enabled !== enabled ||
          result?.securityEnabled !== securityEnabled
        )
          throw new Error(
            "The saved preference could not be verified. Please retry.",
          );
        if (generation.current !== current) return;
        await checkActor(actor);
        setState({
          status: "ready",
          value: { ...previous, enabled, securityEnabled },
          actor,
        });
      },
      (cause) => errorMessage(cause, "Your preference could not be saved."),
    );
  }

  function editAddress() {
    if (state.status !== "ready") return;
    setAddress(
      state.value.pending?.email ??
        (state.value.availability === "verified" ? state.value.email : ""),
    );
    setChoices({
      enabled: state.value.enabled,
      securityEnabled: state.value.securityEnabled,
    });
    requestKey.current = null;
    setEditing(true);
    setError(null);
  }

  function requestVerification(event: FormEvent) {
    event.preventDefault();
    if (busy || checking || state.status !== "ready") return;
    const actor = state.actor;
    const current = generation.current;
    requestKey.current ??= crypto.randomUUID();
    const body = {
      email: address.trim(),
      idempotencyKey: requestKey.current,
      ...choices,
    };
    void run(async () => {
      await checkActor(actor);
      if (generation.current !== current) return;
      const response = await fetchWithDeadline(`${PATH}/verification`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-slop-expected-github-id": actor,
        },
        body: JSON.stringify(body),
      });
      const result = await readBoundedJson(
        response,
        4096,
        "email verification",
      );
      if (generation.current !== current) return;
      await checkActor(actor);
      if (response.status === 429) {
        const retryAfter = (result as { retryAfter?: unknown } | null)
          ?.retryAfter;
        const seconds =
          typeof retryAfter === "number" &&
          Number.isFinite(retryAfter) &&
          retryAfter > 0
            ? Math.ceil(retryAfter)
            : null;
        throw new Error(
          seconds === null
            ? "Wait before requesting another verification email."
            : `Try again in ${seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`,
        );
      }
      if (response.status !== 202)
        throw new Error(
          "The verification email could not be requested. Retry.",
        );
      setState({ status: "ready", actor, value: preference(result) });
      setEditing(false);
      requestKey.current = null;
    });
  }

  const ready = state.status === "ready" ? state.value : null;
  const verified = ready?.availability === "verified";
  const on = ready?.enabled === true;
  const securityOn = ready?.securityEnabled === true;
  const canRetry =
    state.status === "error" || ready?.availability === "unavailable";
  // Opting in needs a verified address; turning off is always allowed. The
  // switch stays enabled while saving so keyboard focus is not lost.
  const switchDisabled = checking || ready === null || (!on && !verified);
  const enrollmentOpen = Boolean(
    ready?.enrollmentAvailable &&
      (editing || (ready.availability === "unverified" && !ready.pending)),
  );
  // The verified address is shown before consent (NOT-01), not once email is on.
  const detail = busy
    ? "Saving…"
    : state.status === "loading"
      ? "Loading…"
      : state.status === "error"
        ? `Email preferences could not be loaded: ${state.message}`
        : ready?.availability === "verified"
          ? on && securityOn
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
          {!enrollmentOpen ? (
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
                  aria-busy={busy || checking}
                  aria-checked={on}
                  aria-describedby={
                    detail ? "email-activity-detail" : undefined
                  }
                  aria-labelledby="email-activity-label"
                  className="email-switch"
                  disabled={switchDisabled}
                  onClick={() => save("enabled")}
                  role="switch"
                  type="button"
                />
              </div>
              <div className="email-row">
                <strong id="email-security-label">Security email</strong>
                <button
                  aria-busy={busy || checking}
                  aria-checked={securityOn}
                  aria-labelledby="email-security-label"
                  className="email-switch"
                  disabled={
                    checking || ready === null || (!securityOn && !verified)
                  }
                  onClick={() => save("securityEnabled")}
                  role="switch"
                  type="button"
                />
              </div>
            </>
          ) : null}
          {ready?.pending ? (
            <>
              <p role="status">
                {ready.pending.state === "expired"
                  ? "Verification expired"
                  : ready.pending.state === "unknown"
                    ? "Verification delivery not confirmed"
                    : ready.pending.state === "sent"
                      ? "Verification sent"
                      : "Verification requested"}
                : {ready.pending.email}
              </p>
              {localBackendOrigin ? (
                <a href={`${localBackendOrigin}/__dev/mail`}>Open local mail</a>
              ) : null}
            </>
          ) : null}
          {enrollmentOpen ? (
            <form className="email-enrollment" onSubmit={requestVerification}>
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  disabled={busy}
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    requestKey.current = null;
                  }}
                />
              </label>
              <fieldset disabled={busy}>
                <legend>After verification</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={choices.enabled}
                    onChange={(event) => {
                      setChoices((value) => ({
                        ...value,
                        enabled: event.target.checked,
                      }));
                      requestKey.current = null;
                    }}
                  />{" "}
                  Activity email
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={choices.securityEnabled}
                    onChange={(event) => {
                      setChoices((value) => ({
                        ...value,
                        securityEnabled: event.target.checked,
                      }));
                      requestKey.current = null;
                    }}
                  />{" "}
                  Security email
                </label>
              </fieldset>
              <div className="handoff-actions">
                <button
                  className="button secondary-button"
                  disabled={busy || checking}
                  type="submit"
                >
                  {busy ? "Requesting…" : "Send verification"}
                </button>
                {editing ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    type="button"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : ready?.enrollmentAvailable ? (
            <button
              className="text-button"
              disabled={busy}
              type="button"
              onClick={editAddress}
            >
              {ready.pending ? "Change email" : "Add or change email"}
            </button>
          ) : null}
          {canRetry ? (
            <div>
              <button
                className="button secondary-button button-small"
                type="button"
                disabled={busy}
                onClick={() => load()}
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

type EmailAction = {
  kind: "verify" | "unsubscribe";
  token: string;
  actor: string | null;
  createdAt: number;
};
const ACTION_STORAGE = "slop:email-action:v1";

function validEmailToken(kind: EmailAction["kind"], token: string) {
  return kind === "verify"
    ? /^[a-f0-9]{64}$/u.test(token)
    : /^[a-f0-9]{64}\.[a-f0-9]{64}$/u.test(token);
}

function storeEmailAction(action: EmailAction | null) {
  if (action) sessionStorage.setItem(ACTION_STORAGE, JSON.stringify(action));
  else sessionStorage.removeItem(ACTION_STORAGE);
}

/** Keep bearer tokens out of request URLs, referrers and the OAuth return URL. */
function readEmailAction(): EmailAction | null {
  const fragment = /^#(verify-email|unsubscribe-email)=(.*)$/u.exec(
    window.location.hash,
  );
  if (fragment) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    const kind = fragment[1] === "verify-email" ? "verify" : "unsubscribe";
    const action: EmailAction = {
      kind,
      token: validEmailToken(kind, fragment[2]) ? fragment[2] : "",
      actor: null,
      createdAt: Date.now(),
    };
    try {
      storeEmailAction(action);
    } catch {
      /* The current page can still use the link. */
    }
    return action;
  }
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(ACTION_STORAGE) ?? "null",
    ) as EmailAction | null;
    if (
      saved &&
      ["verify", "unsubscribe"].includes(saved.kind) &&
      (saved.token === "" || validEmailToken(saved.kind, saved.token)) &&
      (saved.actor === null || /^\d+$/u.test(saved.actor)) &&
      Number.isFinite(saved.createdAt) &&
      Date.now() - saved.createdAt < 30 * 60_000 &&
      saved.createdAt <= Date.now()
    )
      return saved;
    storeEmailAction(null);
  } catch {
    /* No recoverable action was stored. */
  }
  return null;
}

/** Opening a mail link never confirms or unsubscribes by itself. */
export function InboxEmailAction() {
  const [action, setAction] = useState<EmailAction | null>(readEmailAction);
  const [actor, setActor] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  const generation = useRef(0);
  useEffect(() => {
    const capture = () => {
      if (!/^#(?:verify-email|unsubscribe-email)=/u.test(window.location.hash))
        return;
      generation.current += 1;
      setAction(readEmailAction());
      setActor(undefined);
      setDone(false);
      setError(null);
    };
    window.addEventListener("hashchange", capture);
    window.addEventListener("popstate", capture);
    return () => {
      generation.current += 1;
      window.removeEventListener("hashchange", capture);
      window.removeEventListener("popstate", capture);
    };
  }, [setError]);
  useEffect(() => {
    if (!action?.token || action.kind === "unsubscribe") return;
    setError(null);
    setActor(undefined);
    let active = true;
    currentProjectSession().then(
      (session) => {
        if (!active) return;
        if (
          session &&
          action.actor !== null &&
          action.actor !== session.githubId
        ) {
          setError(
            "Your account changed. Reopen the email link for this account.",
          );
          return;
        }
        setActor(session?.githubId ?? null);
        if (session) {
          const bound = { ...action, actor: session.githubId };
          try {
            storeEmailAction(bound);
          } catch {
            /* Verification remains available in this page. */
          }
        }
      },
      () => {
        if (active)
          setError("Your account could not be checked. Reload to retry.");
      },
    );
    return () => {
      active = false;
    };
  }, [action, setError]);
  if (!action) return null;
  const discard = () => {
    generation.current += 1;
    try {
      storeEmailAction(null);
    } catch {
      /* The in-memory action is also cleared. */
    }
    setAction(null);
  };
  const submit = () => {
    const current = generation.current;
    void run(async () => {
      try {
        if (action.kind === "verify") {
          const session = await currentProjectSession();
          if (generation.current !== current) return;
          if (!session || session.githubId !== actor)
            throw new Error("Your account changed. Reload before verifying.");
        }
        const response = await fetchWithDeadline(`${PATH}/${action.kind}`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            ...(action.kind === "verify" && actor
              ? { "x-slop-expected-github-id": actor }
              : {}),
          },
          body: JSON.stringify({ token: action.token }),
        });
        if (generation.current !== current) return;
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Sign in to the account that requested this link."
              : "This email link could not be used. It may have expired or already been used.",
          );
        const result = await readBoundedJson(response, 4096, "email action");
        if (generation.current !== current) return;
        if (action.kind === "verify") {
          preference(result);
          const session = await currentProjectSession();
          if (generation.current !== current) return;
          if (!session || session.githubId !== actor)
            throw new Error(
              "Your account changed. Open email preferences to check the result.",
            );
        } else if (
          (result as { enabled?: unknown; securityEnabled?: unknown } | null)
            ?.enabled !== false ||
          (result as { securityEnabled?: unknown } | null)?.securityEnabled !==
            false
        )
          throw new Error(
            "The unsubscribe result could not be verified. Retry.",
          );
        try {
          storeEmailAction(null);
        } catch {
          /* The confirmed token is no longer actionable here. */
        }
        setDone(true);
      } catch (caught) {
        // A replacement link owns its own status, error and retained token.
        if (generation.current === current) throw caught;
      }
    });
  };
  return (
    <section
      className="email-card email-link-action"
      aria-labelledby="email-link-action-heading"
    >
      <h2 id="email-link-action-heading">
        {action.kind === "verify" ? "Verify email" : "Unsubscribe"}
      </h2>
      {!action.token ? (
        <p role="alert">This email link is invalid.</p>
      ) : done ? (
        <>
          <p role="status">
            {action.kind === "verify"
              ? "Email verified."
              : "Email notifications stopped."}
          </p>
          <a href="/account#notifications">Email preferences</a>
        </>
      ) : action.kind === "verify" && actor === undefined ? (
        error ? (
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setAction((value) => (value ? { ...value } : null))}
          >
            Retry account check
          </button>
        ) : (
          <p role="status">Checking your account…</p>
        )
      ) : action.kind === "verify" && actor === null ? (
        <a className="button secondary-button" href={loginHref("/inbox")}>
          Sign in to verify email
        </a>
      ) : (
        <button
          className="button secondary-button"
          type="button"
          disabled={busy}
          onClick={submit}
        >
          {busy
            ? "Saving…"
            : action.kind === "verify"
              ? "Verify email"
              : "Unsubscribe"}
        </button>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={discard}
      >
        Dismiss
      </button>
    </section>
  );
}
