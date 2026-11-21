/**
 * The optional proof-of-concept file of a private security report (PRD
 * section 8, operator decision of 20 November 2026). It is plain text: a
 * unified diff that adds or changes a test, or a whole test file. The
 * browser and the server apply the same rules here, and the GitHub forward
 * appends it to the description as its own fenced section.
 */

export type ReportProof = {
  readonly fileName: string;
  readonly patch: string;
};

/** The file endings a proof file may have. `.t.sol` ends in `.sol`. */
export const PROOF_FILE_EXTENSIONS = [
  ".patch",
  ".diff",
  ".sol",
  ".ts",
  ".js",
  ".rs",
  ".py",
  ".go",
] as const;

export const MAX_PROOF_FILE_NAME = 200;
/** UTF-8 bytes of the proof file. */
export const MAX_PROOF_BYTES = 60_000;
/**
 * The longest description Slop forwards to GitHub, proof section included.
 * It is the bound the description alone already had; the report reference
 * line is appended after it, as before.
 */
export const MAX_FORWARDED_DESCRIPTION = 65_000;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const LONE_SURROGATE = /\p{Cs}/u;
const encoder = new TextEncoder();

export function proofBytes(patch: string): number {
  return encoder.encode(patch).byteLength;
}

/** Why a file name is refused, or null. Never echoes the name. */
export function proofFileNameProblem(fileName: string): string | null {
  if (fileName.length < 1 || fileName.length > MAX_PROOF_FILE_NAME)
    return `The proof file name must be 1 to ${MAX_PROOF_FILE_NAME} characters.`;
  if (!FILE_NAME.test(fileName) || fileName.includes(".."))
    return "The proof file name may use only letters, digits, dots, hyphens and underscores.";
  const lower = fileName.toLowerCase();
  if (
    !PROOF_FILE_EXTENSIONS.some(
      (extension) =>
        lower.endsWith(extension) && lower.length > extension.length,
    )
  )
    return `The proof file must end in ${PROOF_FILE_EXTENSIONS.join(", ")}.`;
  return null;
}

/** Why the file content is refused, or null. Never echoes the content. */
export function proofPatchProblem(patch: string): string | null {
  if (patch.trim().length === 0) return "The proof file is empty.";
  if (patch.includes("\u0000") || LONE_SURROGATE.test(patch))
    return "The proof file must be text, not a binary file.";
  if (proofBytes(patch) > MAX_PROOF_BYTES)
    return `The proof file must be at most ${MAX_PROOF_BYTES.toLocaleString("en-US")} bytes.`;
  return null;
}

/** A fence of backticks longer than any backtick run inside the text. */
export function proofFence(patch: string): string {
  let longest = 0;
  for (const run of patch.match(/`+/gu) ?? [])
    longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** The proof as its own section at the end of a forwarded description. */
export function proofSection(proof: ReportProof): string {
  const fence = proofFence(proof.patch);
  const lower = proof.fileName.toLowerCase();
  const info =
    lower.endsWith(".patch") || lower.endsWith(".diff") ? "diff" : "";
  const body = proof.patch.endsWith("\n") ? proof.patch : `${proof.patch}\n`;
  return `### Proof of concept: ${proof.fileName}\n\n${fence}${info}\n${body}${fence}`;
}

/** The description Slop sends to GitHub, before the report reference line. */
export function forwardedDescription(
  description: string,
  proof: ReportProof | null | undefined,
): string {
  return proof ? `${description}\n\n${proofSection(proof)}` : description;
}

/** The refusal when description and proof together exceed GitHub's room. */
export const FORWARDED_TOO_LONG = `The description and proof file together must fit in ${MAX_FORWARDED_DESCRIPTION.toLocaleString("en-US")} characters for GitHub. Shorten the description.`;
