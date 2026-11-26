/**
 * The member's personal read-only key for private security reads (PRD
 * section 8). The section reads nothing when the page loads: a key is shown
 * once, right after it is created.
 */

import { useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import {
  SECURITY_READ_KEY_API,
  SECURITY_READ_KEY_NOTICE,
  SECURITY_READ_KEY_PATTERN,
} from "./lib/security-read-key";
import { useAction } from "./lib/use-action";
import { useCopyFeedback } from "./lib/use-copy-feedback";

async function changeKey(
  githubId: string | null,
  method: "POST" | "DELETE",
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetchWithDeadline(SECURITY_READ_KEY_API, {
    method,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(githubId === null ? {} : { "x-slop-expected-github-id": githubId }),
    },
    body: "{}",
    signal,
  });
  const body = await readBoundedJson(response, 4096, "Security read key");
  if (!response.ok)
    throw new Error(
      method === "POST"
        ? "Your key could not be created. Retry."
        : "Your key could not be revoked. Retry.",
    );
  if (method === "DELETE") return null;
  const secret =
    typeof body === "object" && body !== null
      ? (body as { secret?: unknown }).secret
      : undefined;
  if (typeof secret !== "string" || !SECURITY_READ_KEY_PATTERN.test(secret))
    throw new Error("Your key could not be created. Retry.");
  return secret;
}

function NewKey({ value }: { value: string }) {
  const { feedback, copy } = useCopyFeedback(value);
  return (
    <>
      <p role="status">
        Copy this key now. Slop does not store it and will not show it again.
      </p>
      <p className="referral-link">
        <code>{value}</code>
        <button type="button" onClick={copy}>
          Copy key
        </button>
        {feedback !== "idle" ? (
          <span role="status">
            {feedback === "copied"
              ? "Copied."
              : "Copy failed. Select and copy the text."}
          </span>
        ) : null}
      </p>
      <p>
        Send it as <code>Authorization: Bearer &lt;key&gt;</code> on a GET
        request to <code>/api/v1/security-cases</code> or{" "}
        <code>/api/v1/security-submissions</code>.
      </p>
    </>
  );
}

/** Keyed by the account, so an account change drops a key on screen. */
export function SecurityReadKey({ githubId }: { githubId: string | null }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const { busy, error, run } = useAction();
  const unmounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);
  const change = (method: "POST" | "DELETE") => {
    const signal = unmounted.current?.signal;
    if (!signal || signal.aborted) return;
    setRevoked(false);
    void run(async () => {
      const created = await changeKey(githubId, method, signal);
      if (signal.aborted) return;
      setSecret(created);
      setRevoked(method === "DELETE");
    });
  };
  return (
    <div className="email-enrollment">
      <p>
        For reviewers who read their private security queue with a script. A
        website sign-in ends after an hour; a key does not.
      </p>
      <p>{SECURITY_READ_KEY_NOTICE}</p>
      {secret ? <NewKey value={secret} /> : null}
      <div className="handoff-actions">
        <button
          className="button secondary-button"
          disabled={busy}
          onClick={() => change("POST")}
          type="button"
        >
          {busy ? "Working…" : "Create a new key"}
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => change("DELETE")}
          type="button"
        >
          Revoke my key
        </button>
      </div>
      {revoked ? <p role="status">Revoked. No key is in use.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
