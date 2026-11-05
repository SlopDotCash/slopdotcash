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
// itself or to a format noun beside it. A correctness claim ("does not match
// the sha256 of the file") and a negation of something else ("not a
// placeholder; it is the sha256") match none of these.
const SHA256_FORMAT_DENIALS: readonly RegExp[] = [
  /\bnot\s+(?:a\s+|an\s+)?valid\s+sha-?256\b/i,
  /\bnot\s+(?:a\s+|an\s+)?sha-?256\s+(?:hex\s+)?(?:value|digest|hash|string)\b/i,
  /\bisn'?t\s+(?:a\s+|an\s+)?(?:valid\s+)?sha-?256\b/i,
  /\b(?:invalid|malformed)\s+sha-?256\b/i,
  // The gap must span the named value itself ("the recorded sha256 `…` is
  // not valid"), which is up to 64 characters plus its quoting.
  /\bsha-?256\b[^.!?\n]{0,100}?\b(?:invalid|malformed|not\s+valid)\b/i,
];

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
// A backticked hex-like literal that is not 64 characters (e.g. a truncated
// 40-hex constant). When one shares a sentence with a valid 64-hex digest,
// a denial in that sentence may be aimed at the short value, not the digest
// (review on PR #2260) — so the sentence cannot prove the digest was misread.
const BACKTICKED_HEX = /`[0-9a-fA-F]+`/g;

function hasOtherHexLiteral(text: string): boolean {
  return (text.match(BACKTICKED_HEX) ?? []).some(
    (lit) => lit.length - 2 !== 64,
  );
}

export function refutedSha256Token(summary: string): string | null {
  const parts = sentences(summary);
  for (const part of parts) {
    if (hasOtherHexLiteral(part)) continue;
    const token = part.match(SHA256_HEX)?.[0];
    if (token && SHA256_FORMAT_DENIALS.some((p) => p.test(part))) return token;
  }
  const tokens = [...new Set(summary.match(SHA256_HEX) ?? [])];
  if (
    tokens.length === 1 &&
    !hasOtherHexLiteral(summary) &&
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
  if (verdict.category === "none") return null;
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
