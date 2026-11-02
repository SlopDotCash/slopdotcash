// Deterministic guard for Slopbot low_quality misreads (PRD section 5, #1930).
// A model can call a well-formed digest "not a sha256 hex value", or a Python
// hex integer literal an undefined name. Those claims are encoding facts, so
// code checks them before a finding is published.

import type { Verdict } from "./contracts";

/** 64 hex characters, either case. This is a SHA-256 digest encoding. */
const SHA256_HEX_TOKEN = /^[0-9a-fA-F]{64}$/u;
/** A long hex run that may be the digest a claim is about. */
const HEX_LOOKING_DIGEST = /\b[0-9a-fA-F]{16,}\b/gu;
/** A 0x integer literal. It is not a name. */
const HEX_INTEGER_LITERAL = /\b0x[0-9A-Fa-f]+\b/gu;
/** A name or a 0x literal, used to see which token a claim targets. */
const IDENTIFIER_OR_HEX = /\b(?:0x[0-9A-Fa-f]+|[A-Za-z_][A-Za-z0-9_]*)\b/gu;
/**
 * The model says a cited digest is not valid hex.
 * "as not a …" is a report of what code does, not the model's own claim.
 */
const INVALID_HEX_CLAIM =
  /\b(?:(?<!\bas\s)not\s+a\s+(?:valid\s+)?(?:sha-?256(?:\s+hex(?:\s+value)?)?|hex(?:adecimal)?(?:\s+value)?)|(?:sha-?256|hex(?:adecimal)?)\s+(?:digest\s+)?(?:is\s+)?(?:invalid|malformed|not\s+valid)|invalid\s+(?:sha-?256|hex(?:adecimal)?))\b/giu;
/** The model says a token is an undefined name. */
const UNDEFINED_HEX_NAME_CLAIM =
  /\b(?:undefined\s+name|NameError|assigns?\b[\s\S]{0,80}?\bundefined)\b/giu;
/** prefix…suffix or prefix...suffix, a shortened digest quote. */
const TRUNCATED_DIGEST_QUOTE =
  /\b([0-9a-fA-F]{4,})\s*(?:…|\.\.\.)\s*([0-9a-fA-F]{2,})\b/gu;
const ANAPHORIC_VALUE = /\b(?:that|this|the)\s+value\b/iu;
/** How far from a claim its target token may be. */
const CLAIM_TOKEN_WINDOW = 80;
const CLAIM_SUBJECT_STOPWORDS = new Set([
  "undefined",
  "name",
  "nameerror",
  "assigns",
  "assign",
  "the",
  "a",
  "an",
  "to",
  "that",
  "value",
  "is",
  "was",
  "are",
  "and",
  "or",
  "of",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "from",
  "should",
  "raise",
  "raises",
  "uses",
  "use",
  "used",
  "where",
  "appears",
  "intended",
  "slice",
  "this",
  "it",
  "its",
  "be",
  "been",
  "being",
  "not",
  "no",
  "at",
  "call",
  "site",
  "leaves",
  "leave",
  "left",
  "but",
  "config",
  "constant",
  "expected",
  "slot",
  "id",
  "runtime",
  "before",
  "after",
  "defined",
  // Verbs that sit between a cited 0x literal and the claim.
  "called",
  "treated",
  "considered",
  "described",
  "reported",
  "labeled",
  "flagged",
]);

function withGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function verdictReviewText(verdict: Verdict): string {
  return [verdict.summary, ...verdict.evidence, ...verdict.limitations].join(
    "\n",
  );
}

/**
 * Replace a shortened digest quote with the full 64-hex token elsewhere in
 * the same text, when the prefix and suffix match that token.
 */
function expandTruncatedDigests(text: string): string {
  return text.replace(
    withGlobal(TRUNCATED_DIGEST_QUOTE),
    (full: string, prefix: string, suffix: string) => {
      const prefixLower = String(prefix).toLowerCase();
      const suffixLower = String(suffix).toLowerCase();
      for (const match of text.matchAll(withGlobal(HEX_LOOKING_DIGEST))) {
        const token = match[0];
        const lower = token.toLowerCase();
        if (
          SHA256_HEX_TOKEN.test(token) &&
          lower.startsWith(prefixLower) &&
          lower.endsWith(suffixLower)
        ) {
          return token;
        }
      }
      return full;
    },
  );
}

/** Nearest match to an anchor, inside a bounded window. */
function nearestMatchInWindow(
  text: string,
  anchorIndex: number,
  anchorLength: number,
  pattern: RegExp,
  windowSize: number,
  exclude?: (token: string) => boolean,
): string | null {
  const center = anchorIndex + anchorLength / 2;
  const start = Math.max(0, anchorIndex - windowSize);
  const end = Math.min(text.length, anchorIndex + anchorLength + windowSize);
  const slice = text.slice(start, end);
  let best: { token: string; dist: number } | null = null;
  for (const match of slice.matchAll(withGlobal(pattern))) {
    const token = match[0];
    if (exclude?.(token)) continue;
    const absIndex = start + (match.index ?? 0);
    const dist = Math.abs(absIndex + token.length / 2 - center);
    if (best === null || dist < best.dist) best = { token, dist };
  }
  return best?.token ?? null;
}

function precedingHexLiteral(
  text: string,
  claimIndex: number,
  windowSize: number,
): boolean {
  const start = Math.max(0, claimIndex - windowSize);
  return withGlobal(HEX_INTEGER_LITERAL).test(text.slice(start, claimIndex));
}

/**
 * True when this low_quality finding calls a well-formed SHA-256 digest
 * invalid, or calls a 0x integer literal an undefined name.
 * Each claim is tied to the nearest target token in a bounded window, so a
 * valid token somewhere else does not hide a real finding.
 */
export function hexMisreadFinding(verdict: Verdict): boolean {
  if (verdict.category !== "low_quality") return false;
  const text = expandTruncatedDigests(verdictReviewText(verdict));

  for (const claim of text.matchAll(withGlobal(INVALID_HEX_CLAIM))) {
    const nearest = nearestMatchInWindow(
      text,
      claim.index ?? 0,
      claim[0].length,
      HEX_LOOKING_DIGEST,
      CLAIM_TOKEN_WINDOW,
    );
    if (nearest !== null && SHA256_HEX_TOKEN.test(nearest)) return true;
  }

  for (const claim of text.matchAll(withGlobal(UNDEFINED_HEX_NAME_CLAIM))) {
    const claimText = claim[0];
    const claimIndex = claim.index ?? 0;
    // "assigns … undefined": the name inside that span is the target.
    // "that value" points at the 0x literal just before the claim.
    if (/^assigns?\b/iu.test(claimText)) {
      if (withGlobal(HEX_INTEGER_LITERAL).test(claimText)) return true;
      if (
        ANAPHORIC_VALUE.test(claimText) &&
        precedingHexLiteral(text, claimIndex, CLAIM_TOKEN_WINDOW)
      ) {
        return true;
      }
      continue;
    }
    const nearest = nearestMatchInWindow(
      text,
      claimIndex,
      claim[0].length,
      IDENTIFIER_OR_HEX,
      CLAIM_TOKEN_WINDOW,
      (token) => CLAIM_SUBJECT_STOPWORDS.has(token.toLowerCase()),
    );
    if (nearest !== null && /^0x[0-9A-Fa-f]+$/u.test(nearest)) return true;
  }
  return false;
}

/** Replace a contradicted low_quality finding with an explicit no-finding. */
export function dropHexMisreadFinding(verdict: Verdict): Verdict {
  return {
    category: "none",
    confidence: verdict.confidence,
    rule_refs: [],
    evidence: [],
    summary:
      "The low_quality finding said a SHA-256 digest or a hex integer literal was invalid or undefined. A deterministic check shows the cited token is a 64-character hex digest or a 0x integer literal, so this review publishes no finding.",
    limitations: [
      "Dropped the low_quality finding after a deterministic hex digest or 0x literal check.",
    ],
    objective_defect: null,
  };
}

/** Keep the verdict, or downgrade it when the hex check passes. */
export function guardHexMisread(verdict: Verdict): Verdict {
  return hexMisreadFinding(verdict) ? dropHexMisreadFinding(verdict) : verdict;
}
