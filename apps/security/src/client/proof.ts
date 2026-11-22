//@ backend dafny
// spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"; spec/security/reportNotices.md, "Report bodies stay out of every record and never reach a public issue"

export interface ReportProof {
  fileName: string;
  patch: string;
}

export const PROOF_FILE_EXTENSIONS: string[] = [".patch", ".diff", ".sol", ".ts", ".js", ".rs", ".py", ".go"];

export const MAX_PROOF_FILE_NAME = 200;
export const MAX_PROOF_BYTES = 60000;
export const MAX_FORWARDED_DESCRIPTION = 65000;

export const FORWARDED_TOO_LONG = "The description and proof file together must fit in 65,000 characters for GitHub. Shorten the description.";

/** @throws {never} */
//@ pure
export function isNameStart(code: number): boolean {
  return (48 <= code && code <= 57) || (65 <= code && code <= 90) || (97 <= code && code <= 122);
}

/** @throws {never} */
//@ pure
export function isNameCode(code: number): boolean {
  return isNameStart(code) || code === 46 || code === 95 || code === 45;
}

/** @throws {never} */
//@ pure
export function isTrimmedSpace(code: number): boolean {
  return (9 <= code && code <= 13) || code === 32 || code === 160 || code === 5760 || (8192 <= code && code <= 8202) || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

/** @throws {never} */
//@ pure
export function isHighSurrogate(code: number): boolean {
  return 55296 <= code && code <= 56319;
}

/** @throws {never} */
//@ pure
export function isLowSurrogate(code: number): boolean {
  return 56320 <= code && code <= 57343;
}

/** @throws {never} */
export function safeName(fileName: string): boolean {
  //@ ensures \result ==> fileName.length > 0 && isNameStart(fileName.charCodeAt(0))
  //@ ensures \result ==> forall(k, 0 <= k && k < fileName.length ==> isNameCode(fileName.charCodeAt(k)))
  if (fileName.length === 0 || !isNameStart(fileName.charCodeAt(0)) || fileName.includes("..")) return false;
  let i = 0;
  while (i < fileName.length) {
    //@ invariant 0 <= i && i <= fileName.length
    //@ invariant forall(k, 0 <= k && k < i ==> isNameCode(fileName.charCodeAt(k)))
    //@ decreases fileName.length - i
    if (!isNameCode(fileName.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function hasProofEnding(lower: string): boolean {
  let i = 0;
  while (i < PROOF_FILE_EXTENSIONS.length) {
    //@ invariant 0 <= i && i <= PROOF_FILE_EXTENSIONS.length
    //@ decreases PROOF_FILE_EXTENSIONS.length - i
    const ending = PROOF_FILE_EXTENSIONS[i];
    if (lower.endsWith(ending) && lower.length > ending.length) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function proofFileNameProblem(fileName: string): string | null {
  //@ ensures \result === null ==> 1 <= fileName.length && fileName.length <= MAX_PROOF_FILE_NAME
  if (fileName.length < 1 || fileName.length > MAX_PROOF_FILE_NAME) return "The proof file name must be 1 to 200 characters.";
  if (!safeName(fileName)) return "The proof file name may use only letters, digits, dots, hyphens and underscores.";
  if (!hasProofEnding(fileName.toLowerCase())) return "The proof file must end in .patch, .diff, .sol, .ts, .js, .rs, .py, .go.";
  return null;
}

/** @throws {never} */
export function proofBytes(patch: string): number {
  //@ ensures 0 <= \result && \result <= 3 * patch.length
  let bytes = 0;
  let i = 0;
  while (i < patch.length) {
    //@ invariant 0 <= i && i <= patch.length
    //@ invariant 0 <= bytes && bytes <= 3 * i
    //@ decreases patch.length - i
    const unit = patch.charCodeAt(i);
    if (unit < 128) {
      bytes = bytes + 1;
      i = i + 1;
    } else if (unit < 2048) {
      bytes = bytes + 2;
      i = i + 1;
    } else if (isHighSurrogate(unit) && i + 1 < patch.length && isLowSurrogate(patch.charCodeAt(i + 1))) {
      bytes = bytes + 4;
      i = i + 2;
    } else {
      bytes = bytes + 3;
      i = i + 1;
    }
  }
  return bytes;
}

/** @throws {never} */
export function blank(patch: string): boolean {
  //@ ensures \result <==> forall(k, 0 <= k && k < patch.length ==> isTrimmedSpace(patch.charCodeAt(k)))
  let i = 0;
  while (i < patch.length) {
    //@ invariant 0 <= i && i <= patch.length
    //@ invariant forall(k, 0 <= k && k < i ==> isTrimmedSpace(patch.charCodeAt(k)))
    //@ decreases patch.length - i
    if (!isTrimmedSpace(patch.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function binary(patch: string): boolean {
  //@ ensures forall(k, 0 <= k && k < patch.length && patch.charCodeAt(k) === 0 ==> \result)
  let i = 0;
  while (i < patch.length) {
    //@ invariant 0 <= i && i <= patch.length
    //@ invariant forall(k, 0 <= k && k < i ==> patch.charCodeAt(k) !== 0)
    //@ decreases patch.length - i
    const unit = patch.charCodeAt(i);
    if (unit === 0) return true;
    if (isHighSurrogate(unit)) {
      if (i + 1 >= patch.length || !isLowSurrogate(patch.charCodeAt(i + 1))) return true;
      i = i + 2;
    } else {
      if (isLowSurrogate(unit)) return true;
      i = i + 1;
    }
  }
  return false;
}

/** @throws {never} */
export function proofPatchProblem(patch: string): string | null {
  if (blank(patch)) return "The proof file is empty.";
  if (binary(patch)) return "The proof file must be text, not a binary file.";
  if (proofBytes(patch) > MAX_PROOF_BYTES) return "The proof file must be at most 60,000 bytes.";
  return null;
}

/** @throws {never} */
//@ pure
export function backtickRunEndingAt(value: string, end: number): number {
  //@ requires 0 <= end && end <= value.length
  //@ ensures \result >= 0
  //@ decreases end
  if (end === 0) {
    return 0;
  }
  if (value.charCodeAt(end - 1) === 96) {
    return backtickRunEndingAt(value, end - 1) + 1;
  }
  return 0;
}

/** @throws {never} */
export function longestBacktickRun(value: string): number {
  //@ ensures \result >= 0
  //@ ensures forall(j, 0 <= j && j <= value.length ==> backtickRunEndingAt(value, j) <= \result)
  let longest = 0;
  let run = 0;
  let i = 0;
  while (i < value.length) {
    //@ invariant 0 <= i && i <= value.length
    //@ invariant run === backtickRunEndingAt(value, i)
    //@ invariant 0 <= run && run <= longest
    //@ invariant forall(j, 0 <= j && j <= i ==> backtickRunEndingAt(value, j) <= longest)
    //@ decreases value.length - i
    run = value.charCodeAt(i) === 96 ? run + 1 : 0;
    longest = run > longest ? run : longest;
    i = i + 1;
  }
  return longest;
}

/** @throws {never} */
//@ pure
export function fenceWidth(longest: number): number {
  //@ requires longest >= 0
  //@ ensures \result >= 3 && \result > longest
  return longest + 1 > 3 ? longest + 1 : 3;
}

/** @throws {never} */
export function proofFence(patch: string): string {
  //@ ensures forall(j, 0 <= j && j <= patch.length ==> backtickRunEndingAt(patch, j) < \result.length)
  //@ ensures \result.length >= 3
  return "`".repeat(fenceWidth(longestBacktickRun(patch)));
}

/** @throws {never} */
export function proofSection(proof: ReportProof): string {
  const fence = proofFence(proof.patch);
  const lower = proof.fileName.toLowerCase();
  const info = lower.endsWith(".patch") || lower.endsWith(".diff") ? "diff" : "";
  const body = proof.patch.endsWith("\n") ? proof.patch : proof.patch + "\n";
  return "### Proof of concept: " + proof.fileName + "\n\n" + fence + info + "\n" + body + fence;
}

/** @throws {never} */
export function forwardedDescription(description: string, proof: ReportProof | undefined): string {
  //@ ensures proof === undefined ==> \result === description
  if (proof === undefined) return description;
  return description + "\n\n" + proofSection(proof);
}
