/** The member's own name for their referral link (PRD section 11, "Referral program"). */

import { type FormEvent, useEffect, useRef, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import {
  REFERRAL_CODE_API,
  REFERRAL_CODE_RULE,
  referralCodeAccount,
  referralLink,
  validReferralCode,
} from "./lib/referral-code";
import { useAction } from "./lib/use-action";
import { useCopyFeedback } from "./lib/use-copy-feedback";

async function saveReferralCode(
  githubId: string | null,
  code: string,
  signal: AbortSignal,
) {
  const response = await fetchWithDeadline(REFERRAL_CODE_API, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(githubId === null ? {} : { "x-slop-expected-github-id": githubId }),
    },
    body: JSON.stringify({ code }),
    signal,
  });
  const body = await readBoundedJson(response, 4096, "Referral link");
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? (body as { message?: unknown }).message
        : undefined;
    throw new Error(
      response.status < 500 && typeof message === "string"
        ? message
        : "Your referral link could not be saved. Retry.",
    );
  }
  return referralCodeAccount(body).code;
}

function ReferralLink({ value }: { value: string }) {
  const { feedback, copy } = useCopyFeedback(value);
  return (
    <p className="referral-link">
      <code>{value}</code>
      <button type="button" onClick={copy}>
        Copy link
      </button>
      {feedback !== "idle" ? (
        <span role="status">
          {feedback === "copied"
            ? "Copied."
            : "Copy failed. Select and copy the text."}
        </span>
      ) : null}
    </p>
  );
}

/**
 * `code` is the name in use from the member record. The section is keyed by
 * the account, so an account change remounts it and retires a save in flight.
 */
export function ReferralCode({
  githubId,
  code,
  onSaved,
}: {
  githubId: string | null;
  code: string | null;
  onSaved: (code: string) => void;
}) {
  const [name, setName] = useState(code ?? "");
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();
  const unmounted = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const signal = unmounted.current?.signal;
    if (!signal || signal.aborted) return;
    setSaved(false);
    const chosen = name.trim();
    if (!validReferralCode(chosen)) {
      setError(REFERRAL_CODE_RULE);
      return;
    }
    void run(async () => {
      const stored = await saveReferralCode(githubId, chosen, signal);
      if (signal.aborted || stored === null) return;
      setName(stored);
      setSaved(true);
      onSaved(stored);
    });
  };
  return (
    <form className="email-enrollment" onSubmit={save}>
      <p>A project listed through your link names you as its referrer.</p>
      {code ? (
        <ReferralLink value={referralLink(window.location.origin, code)} />
      ) : null}
      <label>
        Link name
        <input
          type="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={32}
          disabled={busy}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      {code ? <p>Saving a new name stops your current link.</p> : null}
      <div className="handoff-actions">
        <button
          className="button secondary-button"
          disabled={busy || name.trim() === (code ?? "")}
          type="submit"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {saved ? <p role="status">Saved.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
