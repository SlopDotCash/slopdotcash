// Issue #1930: Slopbot told contributors that a pinned 64-character SHA-256
// digest "is not a sha256 hex value" and that ordinary Python `0x` integer
// literals were "undefined names". Both readings are deterministic misreads of
// the reviewed text, so a finding that rests on one is withdrawn before it is
// published (issue #1930 "Possible fixes": drop or downgrade the finding when
// the check passes).
//
// The check is deliberately narrow: it only fires when the verdict itself
// rejects the *form* of a value that is well formed, or claims that a quoted
// value is absent while it is present in the reviewed text. Prose that merely
// mentions hex, digests or a literal is not refuted.

export type LiteralKind = "sha256" | "md5" | "literal";

export type RefutedLiteralClaim = {
  kind: LiteralKind;
  /** The literal exactly as the verdict wrote it, so the caller can log it. */
  value: string;
  reason: string;
};

// 64 hex characters are a SHA-256 digest; 32 are an MD5 digest. A leading 0x is
// accepted for 64-character digests because `bytes32` values are often written
// that way. The lookarounds keep a longer hex run (a 40-character commit sha,
// a 65-character blob) from matching a prefix of itself.
const DIGEST_TOKEN =
  /(?<![0-9A-Za-z])(?<prefix>0[xX])?(?<hex>[0-9a-fA-F]{64}|[0-9a-fA-F]{32})(?![0-9A-Za-z])/g;
const CODE_SPAN = /`([^`]+)`/g;
const HEX_INTEGER = /(?<![0-9A-Za-z_])0[xX][0-9A-Fa-f]+(?![0-9A-Za-z_])/;

// Phrases that reject the form of a value. Each one needs an explicit
// algorithm or numeral system ("sha256", "md5", "hex"), or an explicit
// validity adjective before "digest"/"hash", so a substantive claim
// ("the digest is pinned for the wrong artifact") is never refuted.
const REJECTS_DIGEST_FORM: RegExp[] = [
  /\b(?:is|are|was|were)(?:n't|\s+not)\s+(?:a\s+|an\s+)?(?:valid\s+|well[- ]formed\s+|proper\s+|real\s+)?(?:sha-?256|sha2-?256|md5|hex(?:adecimal)?)\b/i,
  /\b(?:is|are)(?:n't|\s+not)\s+(?:a\s+|an\s+)?(?:valid\s+|well[- ]formed\s+|proper\s+)(?:digest|hash|value)\b/i,
  /\b(?:invalid|malformed)\s+(?:sha-?256|sha2-?256|md5|hex(?:adecimal)?|digest|hash)\b/i,
  /\b(?:does|do)(?:n't|\s+not)\s+(?:look|appear)\s+like\s+(?:a\s+)?(?:valid\s+)?(?:sha-?256|sha2-?256|md5|hex(?:adecimal)?)\b/i,
  /\bcan(?:'t|not)\s+be\s+(?:a\s+)?(?:valid\s+)?(?:sha-?256|sha2-?256|md5|hex(?:adecimal)?)\b/i,
];

// Claims that a quoted token is not a name at all. A `0x` token is always a
// literal, so such a claim is wrong whenever the token is quoted as code.
const UNDEFINED_NAME =
  /\bundefined\s+name\b|\bNameError\b|\bnot\s+defined\b|\bunknown\s+(?:name|identifier)\b|\b(?:name|identifier)\b[^.]{0,40}\bdoes\s+not\s+exist\b/i;

// Claims that a quoted token is absent from the reviewed text.
const ABSENT =
  /\b(?:does|do|did)(?:n't|\s+not)\s+(?:appear|occur|exist)\b|\bnot\s+(?:present|found)\b|\bis\s+missing\b|\bno\s+such\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function rejectsDigestForm(sentence: string): boolean {
  return REJECTS_DIGEST_FORM.some((pattern) => pattern.test(sentence));
}

function digestKind(hex: string, prefixed: boolean): LiteralKind | null {
  if (hex.length === 64) return "sha256";
  // A bare 32-character hex string is an MD5 digest. With a 0x prefix it is
  // an integer or bytes16, not an MD5 digest, so it is only handled as a
  // literal below.
  if (hex.length === 32 && !prefixed) return "md5";
  return null;
}

function refutedDigest(sentence: string): RefutedLiteralClaim | null {
  if (!rejectsDigestForm(sentence)) return null;
  for (const match of sentence.matchAll(DIGEST_TOKEN)) {
    const hex = match.groups?.hex ?? "";
    const prefixed = (match.groups?.prefix ?? "") !== "";
    const kind = digestKind(hex, prefixed);
    if (kind === null) continue;
    const value = `${match.groups?.prefix ?? ""}${hex}`;
    return {
      kind,
      value,
      reason: `the verdict rejects the form of ${value}, which is a well-formed ${kind === "sha256" ? "SHA-256" : "MD5"} digest`,
    };
  }
  return null;
}

function refutedLiteral(sentence: string): RefutedLiteralClaim | null {
  if (!UNDEFINED_NAME.test(sentence)) return null;
  // Only a quoted code span counts: a bare 0x token in prose can belong to a
  // different part of the claim.
  for (const span of sentence.matchAll(CODE_SPAN)) {
    const token = span[1].match(HEX_INTEGER)?.[0];
    if (!token) continue;
    return {
      kind: "literal",
      value: token,
      reason: `the verdict calls ${token} an undefined name, but it is a numeric literal`,
    };
  }
  return null;
}

function refutedAbsence(
  sentence: string,
  source: string,
): RefutedLiteralClaim | null {
  if (!ABSENT.test(sentence)) return null;
  for (const span of sentence.matchAll(CODE_SPAN)) {
    const token = span[1].trim();
    // Ignore prose spans and anything too short to be an identifier.
    if (token.length < 4) continue;
    if (!source.includes(token)) continue;
    const kind: LiteralKind = HEX_INTEGER.test(token)
      ? "literal"
      : /^0[xX][0-9a-fA-F]{64}$/.test(token) || /^[0-9a-fA-F]{64}$/.test(token)
        ? "sha256"
        : /^[0-9a-fA-F]{32}$/.test(token)
          ? "md5"
          : "literal";
    return {
      kind,
      value: token,
      reason: `the verdict says ${token} is absent, but it appears in the reviewed text`,
    };
  }
  return null;
}

/**
 * Returns the misread literal claim in `text`, or null when the text makes no
 * deterministically refutable claim about a hex digest or a numeric literal.
 *
 * `source` is the reviewed text (the diff or item body). When supplied, a
 * verdict that calls a quoted token absent while the token is present is also
 * refuted.
 */
export function refutedLiteralClaim(
  text: string,
  source?: string,
): RefutedLiteralClaim | null {
  for (const sentence of sentences(text)) {
    const digest = refutedDigest(sentence);
    if (digest) return digest;
    const literal = refutedLiteral(sentence);
    if (literal) return literal;
    if (source !== undefined) {
      const absent = refutedAbsence(sentence, source);
      if (absent) return absent;
    }
  }
  return null;
}
