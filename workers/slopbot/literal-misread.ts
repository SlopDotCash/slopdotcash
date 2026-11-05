import type { Verdict } from "./contracts";

// Deterministic refutation of the digest misread in issue #1930. A model
// finding called a 64-character hex string "not a sha256 hex value" on four
// pumpfun-source pull requests; the pinned value is the real SHA-256 of the
// file it names. Whether a string is a SHA-256 hex value is a format fact a
// parser settles, not a judgement call: exactly 64 hex characters. When a
// finding's summary denies that of a value that has that shape, the finding's
// premise is provably wrong and the finding does not publish.

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
// is a correctness claim the format check cannot settle (review on PR #2260).
const COMPARISON_TARGET =
  /\b(does\s+not\s+match|doesn'?t\s+match|differs?\b|real\s+digest|changed\s+since|can\s+never\s+pass|for\s+v\d)/i;

// A second, independent defect stated in another sentence ("the test never
// asserts the comparison helper runs") survives even when one phrase is
// refuted: the refutation is claim-level evidence, the verdict is not
// (review on PR #2260).
const OTHER_DEFECT_CLAIM =
  /\b(never\s+(?:assert|check|verif|exercis|run)|would\s+pass\s+silently|no\s+test\s+exercises)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The 64-hex token a summary wrongly calls not a SHA-256, or null. The token
 * and the denial normally share a sentence; the fallback covers a denial in
 * the next sentence ("pins the digest `…`. That value is not a sha256 hex
 * value") only when the summary names exactly one candidate value, so the
 * denial cannot belong to a different value.
 */
// A hex-like literal that is not 64 characters (e.g. a truncated 40-hex
// constant). When one shares a sentence with a valid 64-hex digest, a denial
// in that sentence may be aimed at the short value, not the digest (review
// on PR #2260) — so the sentence cannot prove the digest was misread. Any
// quoting counts — backticked, single- or double-quoted, `0x`-prefixed or
// bare — and the run must be at least 8 hex characters, so ordinary words
// ("a", "dead") are not mistaken for short constants.
const HEX_LIKE = /[`'"]?(?:0x)?[0-9a-fA-F]{8,}[`'"]?/g;

function hasOtherHexLiteral(text: string): boolean {
  return (text.match(HEX_LIKE) ?? []).some((lit) => {
    const bare = lit.replace(/^[`'"]?(?:0x)?/, "").replace(/[`'"]$/, "");
    return bare.length !== 64;
  });
}

export function refutedSha256Token(summary: string): string | null {
  const parts = sentences(summary);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (hasOtherHexLiteral(part)) continue;
    if (COMPARISON_TARGET.test(part)) continue;
    const token = part.match(SHA256_HEX)?.[0];
    if (token && SHA256_FORMAT_DENIALS.some((p) => p.test(part))) {
      if (parts.some((other, j) => j !== i && OTHER_DEFECT_CLAIM.test(other)))
        return null;
      return token;
    }
  }
  const tokens = [...new Set(summary.match(SHA256_HEX) ?? [])];
  if (
    tokens.length === 1 &&
    !hasOtherHexLiteral(summary) &&
    !COMPARISON_TARGET.test(summary) &&
    !parts.some((part) => OTHER_DEFECT_CLAIM.test(part)) &&
    SHA256_FORMAT_DENIALS.some((p) => parts.some((part) => p.test(part)))
  )
    return tokens[0];
  return null;
}

/**
 * The verdict with a refuted finding removed, or null when the finding
 * stands. The replacement follows the incomplete-review rewrite in the
 * review flow: category none, no cited rules or evidence, and a summary
 * that states the deterministic reason instead of the model's claim.
 */
export function downgradeLiteralMisread(verdict: Verdict): Verdict | null {
  // Issue #1930 concerns low_quality findings only: a format misread in a
  // scam, spam or other-category verdict must not zero the whole verdict
  // (review on PR #2260).
  if (verdict.category !== "low_quality") return null;
  const token = refutedSha256Token(verdict.summary);
  if (token === null) return null;
  return {
    ...verdict,
    category: "none",
    objective_defect: null,
    rule_refs: [],
    evidence: [],
    summary: `A deterministic check removed this finding before publication: the review called \`${token}\` not a sha256 hex value, but the value is 64 hex characters, and a 64-character hex string is a valid SHA-256 hex digest. The finding's premise is a format misread, not a defect in this contribution.`,
  };
}
