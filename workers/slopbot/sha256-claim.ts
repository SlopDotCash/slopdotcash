import type { Verdict } from "./contracts";

// Claim-level suppression of the digest misread in issue #1930 (part 1).
// A model finding called a 64-character hex string "not a sha256 hex value"
// on four pumpfun-source pull requests. That sentence makes a format claim,
// and the value itself contradicts it: exactly 64 hex characters is the
// format of a SHA-256 hex digest. The check judges format only — it says
// nothing about whether the digest matches any file, and a wording that
// names a comparison target ("does not match the sha256 of the file", "the
// real digest differs") is a correctness claim this check cannot settle, so
// it never matches.
//
// PR #2260 answered this by discarding the whole verdict, and was closed
// for it: other claims in the same summary were lost with the false one.
// A Verdict carries its claims only as sentences of its summary — there is
// no claim list in the data model — so the smallest honest unit is one
// summary sentence. This module removes only the sentence that states the
// contradicted claim. The verdict, its category, confidence, rule refs,
// evidence and limitations are never modified, in any category: a scam
// verdict that happens to contain the false sentence keeps its full force
// and loses only that sentence. When the contradicted sentence is the
// summary's only sentence, it is replaced in place by a note recording the
// removal, so the summary never goes empty and the verdict is not
// discarded either.

const SHA256_HEX = /\b[0-9a-fA-F]{64}\b/g;

// Denials of a value's validity as a SHA-256, each tied to the word sha256
// itself or to a format noun beside it. A bare "is not valid" / "is not a
// valid sha256" with no format noun is ambiguous: in ordinary wording it
// routinely means the digest does not match the file (a correctness claim),
// which a format check cannot settle — so only phrasings that name the
// format ("hex value", "hex digest", "hex string", "64 characters") count
// (review on PR #2260). A correctness claim ("does not match the sha256 of
// the file") and a negation of something else ("not a placeholder; it is
// the sha256") match none of these.
const SHA256_FORMAT_DENIALS: readonly RegExp[] = [
  /\bnot\s+(?:a\s+|an\s+)?valid\s+sha-?256\s+(?:hex\s+)?(?:value|digest|hash|string|characters)\b/i,
  /\bnot\s+(?:a\s+|an\s+)?sha-?256\s+(?:hex\s+)?(?:value|digest|hash|string|characters)\b/i,
  /\bisn'?t\s+(?:a\s+|an\s+)?(?:valid\s+)?sha-?256\s+(?:hex\s+)?(?:value|digest|hash|string|characters)\b/i,
  /\b(?:invalid|malformed)\s+sha-?256\s+(?:hex\s+)?(?:value|digest|hash|string|characters)\b/i,
  // The gap must span the named value itself ("the recorded sha256 `…` is
  // not valid"), which is up to 64 characters plus its quoting — and the
  // denial must name the format on one side of it.
  /\bsha-?256\b[^.!?\n]{0,100}?\b(?:hex\s+)?(?:value|digest|hash|string|characters)\b[^.!?\n]{0,40}?\b(?:invalid|malformed|not\s+valid)\b/i,
  /\bsha-?256\b[^.!?\n]{0,100}?\b(?:invalid|malformed|not\s+valid)\b[^.!?\n]{0,40}?\b(?:hex\s+)?(?:value|digest|hash|string|characters)\b/i,
];

// Wording that names a comparison target rather than the format: the digest
// is being judged against a file, a version or another value, so the denial
// is a correctness claim the format check cannot settle.
const COMPARISON_TARGET =
  /\b(does\s+not\s+match|doesn'?t\s+match|differs?\b|real\s+digest|changed\s+since|can\s+never\s+pass|for\s+v\d)/i;

// A second, independent defect stated inside the same sentence ("…and the
// test never asserts the comparison helper runs"). Sentences are the unit
// of removal, so a sentence that mixes the contradicted claim with an
// independent one is left whole for the maintainer; the independent claim
// is never collateral damage. (An independent claim in its own sentence
// needs no such guard: it is simply kept, verbatim.)
const OTHER_DEFECT_CLAIM =
  /\b(?:never\s+(?:assert|check|verif|exercis|run)\w*|would\s+pass\s+silently|no\s+test\s+exercises)\b/i;

// A hex-like literal that is not 64 characters (e.g. a truncated 40-hex
// constant). When one shares a sentence with a valid 64-hex digest, a
// denial in that sentence may be aimed at the short value, not the digest —
// so the sentence cannot prove the digest was misread. Any quoting counts —
// backticked, single- or double-quoted, `0x`-prefixed or bare — and the run
// must be at least 8 hex characters, so ordinary words ("a", "dead") are
// not mistaken for short constants.
const HEX_LIKE = /[`'"]?(?:0x)?[0-9a-fA-F]{8,}[`'"]?/g;

function hasOtherHexLiteral(text: string): boolean {
  return (text.match(HEX_LIKE) ?? []).some((lit) => {
    const bare = lit.replace(/^[`'"]?(?:0x)?/, "").replace(/[`'"]$/, "");
    return bare.length !== 64;
  });
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isFormatDenial(sentence: string): boolean {
  return SHA256_FORMAT_DENIALS.some((p) => p.test(sentence));
}

/**
 * Indexes of the summary sentences that state the contradicted claim. A
 * sentence qualifies when the denial and a 64-hex value share it, or when
 * the denial stands in its own sentence ("That value is not a sha256 hex
 * value") and the summary names exactly one candidate value, so the denial
 * cannot belong to a different value.
 */
function refutedSentenceIndexes(parts: string[]): number[] {
  const found: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!isFormatDenial(part)) continue;
    if (COMPARISON_TARGET.test(part)) continue;
    if (OTHER_DEFECT_CLAIM.test(part)) continue;
    if (part.match(SHA256_HEX)) {
      if (!hasOtherHexLiteral(part)) found.push(i);
      continue;
    }
    // Denial in its own sentence: it cites no value, so attribute it only
    // when the whole summary names exactly one 64-hex value and no other
    // hex-like literal anywhere.
    const whole = parts.join(" ");
    const tokens = [...new Set(whole.match(SHA256_HEX) ?? [])];
    if (
      tokens.length === 1 &&
      !hasOtherHexLiteral(whole) &&
      !part.match(HEX_LIKE)
    )
      found.push(i);
  }
  return found;
}

function removalNote(token: string): string {
  return `This finding's only claim was removed by a deterministic check before publication: it called \`${token}\` not a sha256 hex value, but the value is exactly 64 hex characters, which is the format of a SHA-256 hex digest. The check judges format only, not whether the digest matches any file. The verdict itself is unchanged.`;
}

/**
 * The summary with only the contradicted claim sentence(s) removed, or null
 * when no sentence states the claim. Remaining sentences keep their exact
 * wording. When the contradicted claim was the summary's only sentence, a
 * note recording the removal takes its place.
 */
export function removeRefutedSha256Claim(summary: string): string | null {
  const parts = sentences(summary);
  const refuted = refutedSentenceIndexes(parts);
  if (refuted.length === 0) return null;
  const kept = parts.filter((_, i) => !refuted.includes(i));
  if (kept.length > 0) return kept.join(" ");
  const token = summary.match(SHA256_HEX)?.[0];
  return token ? removalNote(token) : null;
}

/**
 * The verdict with the contradicted claim removed from its summary, or
 * null when the summary states no such claim. Only `summary` can differ
 * from the input: category, confidence, rule refs, evidence, limitations
 * and objective_defect are carried over untouched, whatever the category.
 */
export function suppressRefutedSha256Claim(verdict: Verdict): Verdict | null {
  const summary = removeRefutedSha256Claim(verdict.summary);
  if (summary === null) return null;
  return { ...verdict, summary };
}
