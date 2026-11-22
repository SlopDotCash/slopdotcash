// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/security/privacy.md, "A scanner evidence grant is redeemed once, and a download needs exactly one grant cookie, a same-origin GET and no range"; spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"
import type { ObjectView } from "@repo/security/client";
import { Alert, Button, Field, Input, Status, Textarea } from "@repo/ui";
import { CircleCheck, Download, Eye } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import type { EvidenceRun } from "../../flows/projects/vetting.vibe";
import { inspectEvidence } from "./actions.vibe";
import { act, Chip, Fact, Facts, Identifier } from "./parts.tsx";
import { evidenceStateLabel } from "./vetting.ts";

export type EvidenceObjectView = ObjectView;

const binaryType = "application/octet-stream";

type ReadStatus = "" | "downloading" | "verified-download" | "verified-text";

const readStatuses = { download: "downloading", bytes: "verified-download", text: "verified-text" } as const satisfies Record<string, ReadStatus>;

function ShownStatus({ status }: { status: Exclude<ReadStatus, ""> }) {
  if (status === "downloading") return <>Downloading. Do not execute.</>;
  return (
    <>
      <Chip tone="Positive" icon={<CircleCheck aria-hidden />}>
        Verified
      </Chip>
      {status === "verified-download" ? " Do not execute" : null}
    </>
  );
}

function startDownload(href: string, name: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

export type EvidenceItemProps = {
  runtime: PageRuntime;
  run: EvidenceRun;
  object: EvidenceObjectView;
  actorId: string;
};

/** One retained object: its exact identity, and a read or download that needs a reason, a fresh grant and bytes that match the inventory's length and digest. */
export function EvidenceItem({ runtime, run, object, actorId }: EvidenceItemProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ReadStatus>("");
  const [text, setText] = useState<string | null>(null);
  const attempts = useRef(0);
  const headingId = useId();
  const verifiedCopy = useRef<string | null>(null);
  const download = object.streamed || object.contentType === binaryType;
  const inspect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const attempt = ++attempts.current;
    if (verifiedCopy.current) URL.revokeObjectURL(verifiedCopy.current);
    verifiedCopy.current = null;
    setText(null);
    setStatus("");
    setError(null);
    setBusy(true);
    const acted = await act(runtime, inspectEvidence(actorId, run, object, reason), () => false, "Evidence read failed");
    if (attempt !== attempts.current) return;
    setBusy(false);
    if (!acted.ok) return setError(acted.message);
    const read = acted.value;
    setStatus(readStatuses[read.kind]);
    if (read.kind === "text") return setText(read.text);
    if (read.kind === "download") return startDownload(read.href, `${object.sha256}.bin`);
    verifiedCopy.current = URL.createObjectURL(new Blob([read.bytes.slice()], { type: binaryType }));
    startDownload(verifiedCopy.current, `${object.sha256}.bin`);
  };
  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="font-semibold text-foreground">{object.label}</h3>
        <Status presentation={{ tone: "Caution", icon: "Lock", label: evidenceStateLabel(object.state) }} />
      </header>
      <Facts>
        <Fact term="Type">
          {object.kind} · {object.contentType}
        </Fact>
        <Fact term="Size">{object.sizeBytes.toLocaleString()} bytes</Fact>
        <Fact term="SHA-256">
          <Identifier label={`${object.label} digest`} value={object.sha256} />
        </Fact>
      </Facts>
      <form className="flex flex-col gap-4" onSubmit={(event) => void inspect(event)}>
        <Field label="Reason">
          <Input required minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" className="self-start" aria-busy={busy} aria-label={`${download ? "Download" : "Read"} ${object.label}`} loading={busy} disabled={busy || object.state !== "stored-unverified"}>
          {busy ? null : download ? <Download aria-hidden /> : <Eye aria-hidden />}
          {download ? "Download" : "Read"}
        </Button>
      </form>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {status ? (
        <p role="status" className="flex flex-wrap items-center gap-1 text-sm">
          <ShownStatus status={status} />
        </p>
      ) : null}
      {text === null ? null : <Textarea aria-label={`${object.label} verified content`} readOnly rows={12} className="font-mono text-xs" value={text} />}
    </article>
  );
}
