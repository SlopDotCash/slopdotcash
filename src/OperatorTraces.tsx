import { type FormEvent, useEffect, useRef, useState } from "react";
import { SignInPanel } from "./Admin";
import { sha256Hex } from "./lib/async-sha256.mjs";
import { fetchWithDeadline } from "./lib/browser-json";
import { projectApiRequest, useProjectSession } from "./lib/project-api";

const MAX_TRACE_BYTES = 8 * 1024 * 1024;

function TraceDownloadForm() {
  const [digest, setDigest] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedDigest = digest.trim().toLowerCase();
    const selectedReason = reason.trim();
    if (!/^[a-f0-9]{64}$/u.test(selectedDigest) || selectedReason.length < 8) {
      setError("Enter a SHA-256 digest and a reason of at least 8 characters.");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    setStatus("Requesting one-use access…");
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      const path = `operator/traces/${selectedDigest}`;
      const granted = await projectApiRequest<{ grant: string }>(
        "POST",
        `${path}/grant`,
        { reason: selectedReason },
      );
      controller.signal.throwIfAborted();
      setStatus("Downloading and checking the exact bytes…");
      const response = await fetchWithDeadline(`/api/v1/${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { "x-trace-read-grant": granted.grant },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401)
          throw new Error("Your session expired. Sign in again, then retry.");
        if (response.status === 403)
          throw new Error(
            "Access was refused or the one-use grant expired. Check your operator access, then request a new download.",
          );
        throw new Error(
          "The trace could not be downloaded. Retry to request a new one-use grant.",
        );
      }
      const length = response.headers.get("content-length");
      if (
        length === null ||
        !/^[1-9][0-9]*$/u.test(length) ||
        Number(length) > MAX_TRACE_BYTES ||
        response.headers.get("x-trace-sha256") !== selectedDigest
      )
        throw new Error("The trace response did not match the requested file.");
      bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.byteLength !== Number(length) ||
        (await sha256Hex(bytes)) !== selectedDigest
      )
        throw new Error("The trace bytes did not match the requested digest.");
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `trace-${selectedDigest}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReason("");
      setStatus(
        "Exact bytes verified. Download requested. Check your browser downloads. Keep the file private and do not execute its contents.",
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setStatus("");
      setError(
        caught instanceof Error
          ? caught.message
          : "Download failed. Retry to request a new one-use grant.",
      );
    } finally {
      bytes?.fill(0);
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form className="admin-card" onSubmit={download} autoComplete="off">
      <label className="form-field">
        Trace SHA-256 digest
        <input
          required
          pattern="[a-fA-F0-9]{64}"
          minLength={64}
          maxLength={64}
          spellCheck={false}
          autoCapitalize="none"
          value={digest}
          onChange={(event) => setDigest(event.target.value)}
          disabled={busy}
          aria-describedby="trace-digest-help"
        />
      </label>
      <p id="trace-digest-help">
        Use the 64-character digest from the receipt.
      </p>
      <label className="form-field">
        Reason for access
        <textarea
          required
          minLength={8}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
          aria-describedby="trace-access-help"
        />
      </label>
      <p id="trace-access-help">
        Slop records your reason and each access. One-use access expires after
        60 seconds. A failed transfer needs a new grant.
      </p>
      <button className="button primary-button" type="submit" disabled={busy}>
        {busy ? "Downloading private trace…" : "Download private trace"}
      </button>
      {status ? <p role="status">{status}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export default function OperatorTracesPage() {
  const state = useProjectSession();
  return (
    <main className="shell route-main admin-page">
      <h1>Private traces</h1>
      <p>
        Only designated trace operators can download a contributor trace. Admin,
        project-owner and moderator roles do not grant access. This page does
        not display or store trace contents.
      </p>
      {state.status !== "signed-in" ? (
        <SignInPanel
          state={state}
          next="/operator/traces"
          purpose="Sign in with your designated operator GitHub account."
        />
      ) : state.session.traceOperator === true ? (
        <TraceDownloadForm key={state.session.githubId} />
      ) : (
        <p className="form-error" role="alert">
          This account is not a designated trace operator. Sign in with the
          designated account or contact a Slop operator.
        </p>
      )}
    </main>
  );
}
