// spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"; spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"
import { FORWARDED_TOO_LONG, MAX_FORWARDED_DESCRIPTION, MAX_PROOF_BYTES, PROOF_FILE_EXTENSIONS, type ReportProof, forwardedDescription, proofBytes } from "@repo/security/client";
import { Alert, FileField, buttonVariants, cn } from "@repo/ui";
import { Cause, Effect, Exit } from "effect";
import { Download, FileUp } from "lucide-react";
import { useId, useState } from "react";
import { byteCount, descriptionAccept, descriptionOf, proofOf } from "../../../flows/security/reportFile.vibe";

function refusal(cause: Cause.Cause<unknown>): string {
  const error: unknown = Cause.squash(cause);
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "The file must be text, not a binary file.";
}

function useFileRead<A>(read: (file: File) => Effect.Effect<A, unknown>, onRead: (value: A) => void) {
  const [error, setError] = useState<string | null>(null);
  const choose = async (files: File[]) => {
    const file = files[0];
    if (file === undefined) return;
    setError(null);
    const exit = await Effect.runPromiseExit(read(file));
    if (Exit.isSuccess(exit)) onRead(exit.value);
    else setError(refusal(exit.cause));
  };
  return { error, setError, choose };
}

function Refusal({ message }: { message: string | null }) {
  return message === null ? null : <Alert variant="destructive">{message}</Alert>;
}

function LoadDescriptionButton({ disabled, onLoad }: { disabled: boolean; onLoad: (text: string) => void }) {
  const { error, choose } = useFileRead(descriptionOf, onLoad);
  return (
    <div className="flex flex-col gap-2">
      <FileField accept={descriptionAccept} aria-label="Load report from file" chooseLabel="Load report from file" icon={<FileUp aria-hidden className="size-3.5" />} disabled={disabled} onFiles={(files) => void choose(files)} />
      <Refusal message={error} />
    </div>
  );
}

function ProofFileField({ description, fileName, text, disabled, onChange }: { description: string; fileName: string; text: string; disabled: boolean; onChange: (fileName: string, text: string) => void }) {
  const legendId = useId();
  const { error, setError, choose } = useFileRead(proofOf, (chosen: ReportProof) => onChange(chosen.fileName, chosen.patch));
  const proof = fileName !== "" && text !== "" ? { fileName, patch: text } : null;
  const tooLong = proof !== null && forwardedDescription(description.trim(), proof).length > MAX_FORWARDED_DESCRIPTION;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={legendId} className="text-sm font-semibold text-foreground">
        Proof of concept
      </legend>
      <p className="text-sm text-muted-foreground">Optional. A patch that adds a test, or a test file, up to {byteCount(MAX_PROOF_BYTES)}.</p>
      <FileField
        accept={PROOF_FILE_EXTENSIONS.join(",")}
        aria-labelledby={legendId}
        chooseLabel={proof ? "Replace file" : "Choose file"}
        icon={<FileUp aria-hidden className="size-3.5" />}
        disabled={disabled}
        file={proof ? `${proof.fileName} · ${byteCount(proofBytes(proof.patch))}` : undefined}
        removeLabel="Remove"
        removeVisible
        onFiles={(files) => void choose(files)}
        onRemove={() => {
          setError(null);
          onChange("", "");
        }}
      />
      <Refusal message={error} />
      <Refusal message={tooLong ? FORWARDED_TOO_LONG : null} />
    </fieldset>
  );
}

export type ReportProofFieldsProps = {
  description: string;
  proofName: string;
  proofText: string;
  disabled: boolean;
  onDescription: (description: string) => void;
  onProof: (proofName: string, proofText: string) => void;
};

/** The report's files, read in the browser: a Markdown or text file that fills the Description, and the optional proof-of-concept file, a patch or a test file checked before and after it is read. */
export function ReportProofFields({ description, proofName, proofText, disabled, onDescription, onProof }: ReportProofFieldsProps) {
  return (
    <>
      <LoadDescriptionButton disabled={disabled} onLoad={onDescription} />
      <ProofFileField description={description} disabled={disabled} fileName={proofName} text={proofText} onChange={onProof} />
    </>
  );
}

export type ProofFileViewProps = {
  proof: ReportProof;
  labelledBy?: string;
};

/** A saved proof file: its name, a download of its exact text, and the text in a named scroll region. */
export function ProofFileView({ proof, labelledBy }: ProofFileViewProps) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-2">
      <h5 id={headingId} className="font-semibold text-foreground">
        Proof of concept: {proof.fileName}
      </h5>
      <p>
        <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))} download={proof.fileName} href={`data:text/plain;charset=utf-8,${encodeURIComponent(proof.patch)}`}>
          <Download aria-hidden className="size-4" /> Download {byteCount(proofBytes(proof.patch))}
        </a>
      </p>
      <pre
        role="region"
        aria-labelledby={labelledBy ? `${labelledBy} ${headingId}` : headingId}
        tabIndex={0}
        className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-4 font-mono text-sm whitespace-pre-wrap text-foreground"
      >
        {proof.patch}
      </pre>
    </div>
  );
}
