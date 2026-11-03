// Issue #1930: Slopbot told contributors that a pinned 64-character SHA-256
// digest "is not a sha256 hex value" and that ordinary Python `0x` integer
// literals were "undefined names". Both readings are deterministic misreads of
// the reviewed text, so a finding that rests on one is withdrawn before it is
// published (issue #1930 "Possible fixes": drop or downgrade the finding when
// the check passes).
//
// The check is deliberately narrow, and it fails open: a finding is only
// withdrawn when the sentence *rejects the very value it quotes*. If the
// rejected value cannot be identified, or the claim is about a different token
// than the literal in the same sentence, nothing is withdrawn and the original
// finding stands. A missed withdrawal is a published finding a maintainer can
// still reject; a wrong withdrawal silently discards a legitimate finding.

export type LiteralKind = "sha256" | "md5" | "literal";

export type RefutedLiteralClaim = {
  kind: LiteralKind;
  /** The literal exactly as the verdict wrote it, so the caller can log it. */
  value: string;
  reason: string;
};

// A run of hex digits with an optional `0x` prefix. The lookarounds keep a
// longer alphanumeric run (an identifier such as `slot_0xF4`) from matching a
// part of itself. Bare runs shorter than MIN_BARE_HEX are ignored because
// ordinary English words ("added", "decade", "beef") are hex runs too: a real
// value in prose is a digest (32 or 64 hex characters) or a `0x` literal.
const HEX_RUN =
  /(?<![0-9A-Za-z_])(?<prefix>0[xX])?(?<hex>[0-9a-fA-F]+)(?![0-9A-Za-z_])/g;
const MIN_BARE_HEX = 16;
const HEX_INTEGER_TOKEN = /^0[xX][0-9A-Fa-f]+$/;
// The same literal inside a larger quotation, e.g. `SLOT_TOKEN_SIDE=0xF4`.
const HEX_INTEGER_IN_TEXT =
  /(?<![0-9A-Za-z_])0[xX][0-9A-Fa-f]+(?![0-9A-Za-z_])/;

// A quoted span: Markdown code, a Python `'...'`/`"..."` name as it appears in
// a traceback (`NameError: name '0xF4' is not defined`), or a prose quotation.
// An apostrophe inside a word ("doesn't") is not an opening quote.
const QUOTED_SPAN =
  /`([^`\n]+)`|(?<![0-9A-Za-z_'’])'([^'\n]{1,120})'(?![0-9A-Za-z_])|"([^"\n]{1,120})"/g;

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
// literal, so such a claim is wrong whenever the token it is *about* is one.
const UNDEFINED_NAME: RegExp[] = [
  /\bundefined\s+name\b/i,
  /\bNameError\b/i,
  /\bnot\s+defined\b/i,
  /\bunknown\s+(?:name|identifier)\b/i,
  /\b(?:name|identifier)\b[^.]{0,40}\bdoes\s+not\s+exist\b/i,
];

// Claims that a quoted token is absent from the reviewed text.
const ABSENT: RegExp[] = [
  /\b(?:does|do|did)(?:n't|\s+not)\s+(?:appear|occur|exist)\b/i,
  /\bnot\s+(?:present|found)\b/i,
  /\bis\s+missing\b/i,
  /\bno\s+such\b/i,
];

// How far the rejected subject may sit from the rejection phrase. A quoted
// span is allowed more room because the clause continues inside it
// ("`SLOT_TOKEN_SIDE=0xF4` assigns … to an undefined name"); a bare token in
// prose must be adjacent ("0xF4 is not defined"), otherwise the claim is about
// something else in the sentence.
const QUOTED_SUBJECT_GAP = 40;
const BARE_SUBJECT_GAP = 16;
// "the digest `<x>` is not a valid sha256" — the value comes first, with at
// most a short clause between the value and the rejection.
const DIGEST_SUBJECT_GAP = 24;
// "the digest `<x>` does not appear" — the value comes first.
const ABSENT_SUBJECT_GAP = 40;
// "no such `<x>`", "is missing: `<x>`" — the value comes right after.
const ABSENT_TRAILING_GAP = 4;

type Phrase = { start: number; end: number };

type Token = {
  start: number;
  end: number;
  value: string;
  hex: string;
  prefixed: boolean;
};

type Candidate = {
  start: number;
  end: number;
  /** `name` marks a quoted identifier, which shows the claim is about it. */
  kind: LiteralKind | "name";
  value: string;
  quoted: boolean;
};

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** The earliest match of any pattern, or null when `text` makes no claim. */
function firstPhrase(patterns: RegExp[], text: string): Phrase | null {
  let best: Phrase | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const phrase = { start: match.index, end: match.index + match[0].length };
    if (best === null || phrase.start < best.start) best = phrase;
  }
  return best;
}

function tokenHits(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(HEX_RUN)) {
    const hex = match.groups?.hex ?? "";
    const prefix = match.groups?.prefix ?? "";
    if (prefix === "" && hex.length < MIN_BARE_HEX) continue;
    const start = match.index ?? 0;
    tokens.push({
      start,
      end: start + match[0].length,
      value: match[0],
      hex,
      prefixed: prefix !== "",
    });
  }
  return tokens;
}

function digestKind(hex: string, prefixed: boolean): LiteralKind | null {
  if (hex.length === 64) return "sha256";
  // A bare 32-character hex string is an MD5 digest. With a 0x prefix it is
  // an integer or bytes16, not an MD5 digest, so it is only handled as a
  // literal below.
  if (hex.length === 32 && !prefixed) return "md5";
  return null;
}

function digestReason(value: string, kind: LiteralKind): string {
  return `the verdict rejects the form of ${value}, which is a well-formed ${kind === "sha256" ? "SHA-256" : "MD5"} digest`;
}

/**
 * The token a claim is about: the one closest to the claim phrase. Quoted
 * spans keep their own bounds so an assignment such as `NAME=0xF4` is measured
 * as one quoted value.
 */
function candidates(sentence: string): Candidate[] {
  const found: Candidate[] = [];
  const spans: Phrase[] = [];
  for (const match of sentence.matchAll(QUOTED_SPAN)) {
    const inner = match[1] ?? match[2] ?? match[3] ?? "";
    const start = (match.index ?? 0) + 1;
    spans.push({ start, end: start + inner.length });
    const trimmed = inner.trim();
    const literal = trimmed.match(HEX_INTEGER_IN_TEXT);
    if (literal) {
      found.push({
        start,
        end: start + inner.length,
        kind: "literal",
        value: literal[0],
        quoted: true,
      });
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) {
      found.push({
        start,
        end: start + inner.length,
        kind: "name",
        value: trimmed,
        quoted: true,
      });
    }
  }
  // Bare `0x` literals carry the Python traceback and prose forms. Literals
  // already inside a quoted span are measured by the span, not by the token.
  for (const token of tokenHits(sentence)) {
    if (!token.prefixed) continue;
    if (
      spans.some((span) => token.start >= span.start && token.end <= span.end)
    )
      continue;
    found.push({
      start: token.start,
      end: token.end,
      kind: "literal",
      value: token.value,
      quoted: false,
    });
  }
  return found;
}

function distance(candidate: Phrase, phrase: Phrase): number {
  if (candidate.end <= phrase.start) return phrase.start - candidate.end;
  if (candidate.start >= phrase.end) return candidate.start - phrase.end;
  return 0;
}

function nearestCandidate(
  sentence: string,
  phrase: Phrase,
): { candidate: Candidate; gap: number } | null {
  let best: { candidate: Candidate; gap: number } | null = null;
  for (const candidate of candidates(sentence)) {
    const gap = distance(candidate, phrase);
    if (best === null || gap < best.gap) best = { candidate, gap };
  }
  return best;
}

function refutedDigest(sentence: string): RefutedLiteralClaim | null {
  const phrase = firstPhrase(REJECTS_DIGEST_FORM, sentence);
  if (!phrase) return null;
  // Only the digest the verdict actually rejects counts. A sentence that
  // rejects a malformed value ("0xDEAD is not a sha256 hex value") while
  // naming the correct digest later ("use 8190d3f7… instead") is a legitimate
  // finding, not a misread (#2201 review).
  let best: { token: Token; gap: number } | null = null;
  for (const token of tokenHits(sentence)) {
    const gap = distance(token, phrase);
    if (best === null || gap < best.gap) best = { token, gap };
  }
  if (best === null) return null;
  if (best.gap > DIGEST_SUBJECT_GAP) return null;
  const kind = digestKind(best.token.hex, best.token.prefixed);
  if (kind === null) return null;
  return {
    kind,
    value: best.token.value,
    reason: digestReason(best.token.value, kind),
  };
}

function refutedLiteral(sentence: string): RefutedLiteralClaim | null {
  const phrase = firstPhrase(UNDEFINED_NAME, sentence);
  if (!phrase) return null;
  // The claim must be about the `0x` literal itself. When the nearest token is
  // a quoted name (`TOKEN_SIDE`), the undefined-name claim is about that name
  // and the literal in the sentence is something else — often the suggested
  // fix (#2201 review).
  const nearest = nearestCandidate(sentence, phrase);
  if (nearest === null) return null;
  if (nearest.candidate.kind !== "literal") return null;
  const limit = nearest.candidate.quoted
    ? QUOTED_SUBJECT_GAP
    : BARE_SUBJECT_GAP;
  if (nearest.gap > limit) return null;
  const token = nearest.candidate.value;
  return {
    kind: "literal",
    value: token,
    reason: `the verdict calls ${token} an undefined name, but it is a numeric literal`,
  };
}

/**
 * The reviewed text without removed diff lines. A unified diff marks a removal
 * with `-`, so a token that survives only on a removed line is genuinely gone
 * from the result and an absence claim about it is not contradicted.
 */
function reviewedText(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^-[^-]/.test(line))
    .join("\n");
}

function containsToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9A-Za-z_])${escaped}(?![0-9A-Za-z_])`).test(text);
}

function absenceKind(token: string): LiteralKind {
  if (HEX_INTEGER_TOKEN.test(token)) return "literal";
  if (token.length === 64) return "sha256";
  if (token.length === 32) return "md5";
  return "literal";
}

function refutedAbsence(
  sentence: string,
  source: string,
): RefutedLiteralClaim | null {
  const phrase = firstPhrase(ABSENT, sentence);
  if (!phrase) return null;
  const text = reviewedText(source);
  let best: { value: string; gap: number } | null = null;
  for (const token of tokenHits(sentence)) {
    // Only a literal can be checked against the reviewed text; `is missing`
    // about an ordinary identifier ("the check for `admin` is missing") says
    // nothing about whether the identifier appears.
    if (!HEX_INTEGER_TOKEN.test(token.value) && token.hex.length < MIN_BARE_HEX)
      continue;
    const before =
      token.end <= phrase.start ? phrase.start - token.end : Infinity;
    const after =
      token.start >= phrase.end ? token.start - phrase.end : Infinity;
    const gap = Math.min(before, after);
    if (gap > (before <= after ? ABSENT_SUBJECT_GAP : ABSENT_TRAILING_GAP))
      continue;
    if (best === null || gap < best.gap) best = { value: token.value, gap };
  }
  if (best === null) return null;
  if (!containsToken(text, best.value)) return null;
  return {
    kind: absenceKind(best.value),
    value: best.value,
    reason: `the verdict says ${best.value} is absent, but it appears in the reviewed text`,
  };
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
