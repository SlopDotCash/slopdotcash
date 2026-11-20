import { Download, FileUp, X } from "lucide-react";
import { type ChangeEvent, useId, useRef, useState } from "react";
import {
  FORWARDED_TOO_LONG,
  forwardedDescription,
  MAX_FORWARDED_DESCRIPTION,
  MAX_PROOF_BYTES,
  PROOF_FILE_EXTENSIONS,
  proofBytes,
  proofFileNameProblem,
  proofPatchProblem,
  type ReportProof,
} from "./lib/report-proof";

const DESCRIPTION_LIMIT = 65_000;

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} bytes`;
}

/** Reads a chosen file as strict UTF-8 text, or explains why it cannot. */
async function readText(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes)
    throw new Error(`The file must be at most ${formatBytes(maxBytes)}.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("The file must be text, not a binary file.");
  }
  if (text.includes("\u0000"))
    throw new Error("The file must be text, not a binary file.");
  return text;
}

/** A button that opens the file picker; the input itself stays hidden. */
function FilePickerButton({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className="button secondary-button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        type="button"
      >
        <FileUp aria-hidden="true" size={14} /> {label}
      </button>
      <input
        accept={accept}
        aria-hidden="true"
        hidden
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
    </>
  );
}

/** Fills the Description from a .md or .txt file in the browser. */
export function LoadDescriptionButton({
  disabled,
  onLoad,
}: {
  disabled: boolean;
  onLoad: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <FilePickerButton
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        disabled={disabled}
        label="Load report from file"
        onFile={(file) => {
          setError(null);
          void readText(file, DESCRIPTION_LIMIT * 4)
            .then((text) => {
              const trimmed = text.trim();
              if (trimmed.length > DESCRIPTION_LIMIT)
                throw new Error(
                  `The description must be at most ${DESCRIPTION_LIMIT.toLocaleString("en-US")} characters.`,
                );
              onLoad(trimmed);
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            );
        }}
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The optional proof-of-concept file: a patch or a test file. */
export function ProofFileField({
  description,
  fileName,
  text,
  disabled,
  onChange,
}: {
  description: string;
  fileName: string;
  text: string;
  disabled: boolean;
  onChange: (fileName: string, text: string) => void;
}) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const proof = fileName && text ? { fileName, patch: text } : null;
  const tooLong =
    proof !== null &&
    forwardedDescription(description.trim(), proof).length >
      MAX_FORWARDED_DESCRIPTION;
  return (
    <fieldset aria-labelledby={labelId} className="report-proof-field">
      <legend id={labelId}>Proof of concept</legend>
      <p className="field-hint">
        Optional. A patch that adds a test, or a test file, up to{" "}
        {formatBytes(MAX_PROOF_BYTES)}.
      </p>
      {proof ? (
        <p>
          {proof.fileName} · {formatBytes(proofBytes(proof.patch))}{" "}
          <button
            className="button secondary-button"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange("", "");
            }}
            type="button"
          >
            <X aria-hidden="true" size={14} /> Remove
          </button>
        </p>
      ) : null}
      <FilePickerButton
        accept={PROOF_FILE_EXTENSIONS.join(",")}
        disabled={disabled}
        label={proof ? "Replace file" : "Choose file"}
        onFile={(file) => {
          setError(null);
          const nameProblem = proofFileNameProblem(file.name);
          if (nameProblem !== null) {
            setError(nameProblem);
            return;
          }
          void readText(file, MAX_PROOF_BYTES)
            .then((patch) => {
              const problem = proofPatchProblem(patch);
              if (problem !== null) throw new Error(problem);
              onChange(file.name, patch);
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            );
        }}
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {tooLong ? (
        <p className="form-error" role="alert">
          {FORWARDED_TOO_LONG}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A saved proof file: its name, a download, and the text. */
export function ProofFileView({
  proof,
  labelledBy,
}: {
  proof: ReportProof;
  labelledBy?: string;
}) {
  const headingId = useId();
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([proof.patch], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = proof.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <div className="report-proof-view">
      <h5 id={headingId}>Proof of concept: {proof.fileName}</h5>
      <p>
        <button
          className="button secondary-button"
          onClick={download}
          type="button"
        >
          <Download aria-hidden="true" size={14} /> Download{" "}
          {formatBytes(proofBytes(proof.patch))}
        </button>
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: This named scroll region must preserve the file's preformatted text. */}
      <pre
        aria-labelledby={labelledBy ? `${labelledBy} ${headingId}` : headingId}
        className="security-report-text"
        role="region"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the complete proof file.
        tabIndex={0}
      >
        {proof.patch}
      </pre>
    </div>
  );
}
