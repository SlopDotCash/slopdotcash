// Deterministic publish guard for Slopbot low_quality misreads (PRD section 5,
// issue #1930). A well-formed SHA-256 digest is valid hex. A 0x integer
// literal is not an undefined name. Those claims are encoding facts.
//
// Remove only the contradicted claim and the evidence line that states it.
// A nearby digest or literal does not prove any other claim false. A piece
// stays when it names a non-hex identifier or says its own subject never
// does something. An unrelated digest is not the token a concrete name cites.
// Evidence is removed only when it quotes a token from a removed claim.
// Limitations stay. Category becomes none only when no claim remains.

import type { Verdict } from "./contracts";

const HEX_LITERAL = /^0x[0-9A-Fa-f]+$/u;
const NAME = "(?:0x[0-9A-Fa-f]+|[A-Za-z_][A-Za-z0-9_]*)";
const QUOTED_NAME = `(${NAME})`;

function plain(text: string): string {
  return text.replace(/["'`]/gu, "");
}

/** Words that sit next to "undefined name" but are not the cited token. */
const NAME_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "appears",
  "but",
  "instead",
  "intended",
  "is",
  "it",
  "its",
  "name",
  "or",
  "raise",
  "raises",
  "should",
  "that",
  "the",
  "this",
  "to",
  "global",
  "identifier",
  "symbol",
  "undefined",
  "value",
  "variable",
  "was",
  "where",
  "which",
]);

/**
 * The model says a cited value is not hex. "as not …" reports what code
 * does, which is a different finding.
 */
const ENCODING_ASSERTION =
  /(?<!\bas\s)(?:not\s+a\s+(?:valid\s+)?sha-?256\s+hex(?:\s+value)?|not\s+a\s+(?:valid\s+)?hex(?:adecimal)?(?:\s+value)?|invalid\s+sha-?256\s+hex(?:\s+value)?|invalid\s+hex(?:adecimal)?(?:\s+value)?|malformed\s+hex(?:adecimal)?|invalid\s+encoding|not\s+hexadecimal|not\s+(?:a\s+)?valid\s+hex(?:adecimal)?(?:\s+value)?)/iu;

/**
 * A wrong pin for an artifact is a real defect. These words keep the claim
 * even when a well-formed digest sits in the same clause.
 */
const MISMATCH_QUALIFIER =
  /\b(?:for|of|against|expected|actual|differs|match(?:es)?|mismatch|verification|tarball|release)\b/iu;

/**
 * Sentences that only elaborate a misread already identified in the verdict.
 * They do not name a separate defect.
 */
const CONTINUATION =
  /\b(?:NameError|that line|placeholder|replace the (?:name|placeholder|constant)|rerun|regenerat\w*|could not run|cannot come from|conflicts with the reported|passing tests|hash assertion|assertion (?:should|would|will) fail)\b/iu;

const COURTESY =
  /^(?:thank you\b|this is a carefully\b|the packet is (?:scoped|careful|detailed|well scoped)\b)/iu;

const NO_FINDING_SUMMARY =
  "No finding is published. A deterministic check contradicted the encoding or hex-literal claim, and no other claim remained.";

const UNDECLARED = "undefined|undeclared";
const EXPLICIT_NAME_SOURCES = [
  // "undefined name, TOKEN" and "undeclared TOKEN", either noun order.
  String.raw`\b(?:${UNDECLARED})(?:\s+(?:global|variable|identifier|symbol|name))?\s*[,:]?\s*${QUOTED_NAME}`,
  // "TOKEN, an undeclared variable" — the name comes first.
  String.raw`\b${QUOTED_NAME}\s*,\s*(?:an?\s+)?(?:${UNDECLARED})(?:\s+(?:variable|name|global|identifier|symbol))?\b`,
  String.raw`\bNameError:\s*name\s+${QUOTED_NAME}`,
  String.raw`\bname\s+${QUOTED_NAME}\s+is\s+not\s+(?:defined|declared)\b`,
  String.raw`\b${QUOTED_NAME}\s+is\s+(?:an\s+)?(?:undefined|undeclared)(?:\s+name)?\b`,
  String.raw`\bleaves\s+${QUOTED_NAME}\s+(?:undefined|undeclared)\b`,
  String.raw`\b${QUOTED_NAME}\s+was\s+called\s+an\s+(?:undefined|undeclared)\s+name\b`,
  String.raw`\b(?:calls?|treats?|treating|using|uses)\s+${QUOTED_NAME}\s+as\s+an\s+(?:undefined|undeclared)\s+name\b`,
];

type DigestShape = "one" | "other" | "absent";

function captures(text: string, source: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(new RegExp(source, "giu"))) {
    const token = match[1];
    if (token !== undefined && !NAME_STOPWORDS.has(token.toLowerCase()))
      found.push(token);
  }
  return found;
}

/** The token a clause says is undefined, not every literal in the clause. */
function namedUndefined(text: string): string[] {
  const source = plain(text);
  const explicit = EXPLICIT_NAME_SOURCES.flatMap((pattern) =>
    captures(source, pattern),
  );
  if (explicit.length > 0) return explicit;
  if (
    new RegExp(
      String.raw`\b(?:${UNDECLARED})\s+name\s*[,:]?\s*${QUOTED_NAME}`,
      "iu",
    ).test(source)
  )
    return [];
  return captures(
    source,
    String.raw`\bassigns?\s+${QUOTED_NAME}\s+to\s+an\s+(?:undefined|undeclared)\s+name\b`,
  );
}

const NOT_DEFECT_IDENTIFIERS = new Set([
  "hexadecimal",
  "nameerror",
  "placeholder",
  "sha256",
  "undefined",
  "undeclared",
]);

/** A code name in this piece: camelCase, snake_case, or a backtick ident. Paths do not count. */
function hasOwnCodeIdentifier(text: string): boolean {
  const withoutPaths = text
    .replace(/\b[\w.-]*\/[\w./-]+/gu, " ")
    .replace(/\b[\w.-]+\.(?:py|ts|js|mjs|cjs|json|md|sh|yml|yaml)\b/giu, " ");
  const accept = (token: string) => {
    if (HEX_LITERAL.test(token)) return false;
    const lower = token.toLowerCase();
    return !NAME_STOPWORDS.has(lower) && !NOT_DEFECT_IDENTIFIERS.has(lower);
  };
  for (const match of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/gu)) {
    if (accept(match[1] ?? "")) return true;
  }
  for (const match of withoutPaths.matchAll(
    /\b([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/gu,
  )) {
    if (accept(match[1] ?? "")) return true;
  }
  return false;
}

/**
 * The piece predicates a failure of its own subject. Any "never <verb>"
 * counts; the verb is not a fixed list. A NameError follow-on about the
 * contradicted token has no "never <verb>" of its own.
 */
function predicatesOwnSubjectFailure(piece: string): boolean {
  return /\bnever\s+[A-Za-z][A-Za-z'-]*/iu.test(piece);
}

function isMisreadContinuation(piece: string): boolean {
  if (!CONTINUATION.test(piece)) return false;
  if (namedUndefined(piece).some((name) => !HEX_LITERAL.test(name)))
    return false;
  if (hasOwnCodeIdentifier(piece)) return false;
  if (predicatesOwnSubjectFailure(piece)) return false;
  return true;
}

function digestShape(text: string): DigestShape {
  const exact = new Set<string>();
  let other = false;
  const runs = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{16,}(?![0-9A-Fa-f])/gu;
  for (const match of text.matchAll(runs)) {
    if (match[0].length === 64) exact.add(match[0].toLowerCase());
    else other = true;
  }
  if (other || exact.size > 1) return "other";
  if (exact.size === 1) return "one";
  return "absent";
}

/** A cited token that is not itself a digest or 0x literal. */
function citesConcreteNonDigest(text: string): boolean {
  for (const match of text.matchAll(/`([^`]+)`/gu)) {
    const token = match[1]?.trim() ?? "";
    if (token.length === 0) continue;
    if (/^[0-9A-Fa-f]{64}$/u.test(token) || HEX_LITERAL.test(token)) continue;
    return true;
  }
  return /\b[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]+\b/u.test(text);
}

function encodingMisread(text: string, corpus: string): boolean {
  if (!ENCODING_ASSERTION.test(text) || MISMATCH_QUALIFIER.test(text))
    return false;
  const local = digestShape(text);
  if (local === "one") return true;
  if (local === "other") return false;
  // An unrelated digest elsewhere is not the token this piece cites.
  if (citesConcreteNonDigest(text)) return false;
  if (!/\b(?:digest|checksum|hash)\b/iu.test(text)) return false;
  return digestShape(corpus) === "one";
}

function literalMisread(text: string): boolean {
  const names = namedUndefined(text);
  return names.length > 0 && names.every((name) => HEX_LITERAL.test(name));
}

function directMisread(text: string, corpus: string): boolean {
  return encodingMisread(text, corpus) || literalMisread(text);
}

function isTokenOnly(text: string): boolean {
  const stripped = plain(text).trim();
  return (
    /^[0-9A-Fa-f]{64}$/u.test(stripped) ||
    HEX_LITERAL.test(stripped) ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*0x[0-9A-Fa-f]+$/u.test(stripped) ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*[0-9A-Fa-f]{64}$/u.test(stripped)
  );
}

/**
 * A quote that only shows the contradicted token. It is not its own finding.
 * `packet[0xF4]` is support. A remaining defect sentence is not.
 */
function isSupportQuote(text: string): boolean {
  if (isTokenOnly(text)) return true;
  const residue = plain(text)
    .replace(/0x[0-9A-Fa-f]+/gu, " ")
    .replace(/(?<![0-9A-Fa-f])[0-9A-Fa-f]{16,}(?![0-9A-Fa-f])/gu, " ")
    .replace(/[^A-Za-z_]+/gu, " ")
    .trim();
  if (residue.length === 0) return true;
  const words = residue.split(/\s+/u);
  return words.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(words[0] ?? "");
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0
    ? parts
    : [text.trim()].filter((part) => part.length > 0);
}

/**
 * A comma clause is its own claim when it is long enough to state one and
 * it is not a quote of the contradicted token. The verb is not an allowlist:
 * "omits", "leaks", and "never validates" are the same kind of claim.
 * An ordinary "and" stays intact so a real finding is not chopped into
 * fragments that look like separate claims.
 */
function isSeparateClaim(part: string): boolean {
  if (isSupportQuote(part)) return false;
  return part.trim().split(/\s+/u).length >= 4;
}

function hexTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/\b0x[0-9A-Fa-f]+\b/giu))
    tokens.push(match[0].toLowerCase());
  for (const match of text.matchAll(
    /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/gu,
  ))
    tokens.push(match[0].toLowerCase());
  return tokens;
}

/** Split on commas only when one side is a misread and the other is its own claim. */
function commaClauses(segment: string, corpus: string): string[] {
  const parts = segment
    .split(/,\s+(?=[A-Za-z`])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2)
    return [segment.trim()].filter((part) => part.length > 0);
  const misread = parts.map((part) => directMisread(part, corpus));
  const misreadTokens = new Set<string>();
  for (const [index, part] of parts.entries()) {
    if (!misread[index]) continue;
    for (const token of hexTokens(part)) misreadTokens.add(token);
  }
  // A clause that repeats the misread token is still that claim.
  const separate = parts.map(
    (part, index) =>
      !misread[index] &&
      isSeparateClaim(part) &&
      !hexTokens(part).some((token) => misreadTokens.has(token)),
  );
  if (misread.some(Boolean) && separate.some(Boolean)) return parts;
  return [segment.trim()].filter((part) => part.length > 0);
}

function claimPieces(sentence: string, corpus: string): string[] {
  const segments = sentence.split(/\s+but\s+|;\s+/iu);
  const pieces: string[] = [];
  for (const segment of segments) {
    const andParts = segment
      .split(/\s+and\s+/iu)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const misread = andParts.map((part) => directMisread(part, corpus));
    const units =
      andParts.length > 1 &&
      misread.some(Boolean) &&
      misread.some((part) => !part)
        ? andParts
        : [segment.trim()].filter((part) => part.length > 0);
    for (const unit of units) pieces.push(...commaClauses(unit, corpus));
  }
  return pieces;
}

function sentenceIsCourtesy(sentence: string): boolean {
  return (
    COURTESY.test(sentence) &&
    !/\b(?:undefined|undeclared|NameError|bypass|duplicate|crash|sha-?256)\b/iu.test(
      sentence,
    )
  );
}

function sentenceIsContinuation(sentence: string, corpus: string): boolean {
  if (!isMisreadContinuation(sentence)) return false;
  const pieces = claimPieces(sentence, corpus);
  const hasOtherClaim = pieces.some(
    (piece) =>
      !directMisread(piece, corpus) &&
      !isMisreadContinuation(piece) &&
      !sentenceIsCourtesy(piece) &&
      !isSupportQuote(piece),
  );
  return !hasOtherClaim;
}

function asSentence(clause: string): string {
  const trimmed = clause.replace(/[;.]+$/u, "").trim();
  if (trimmed.length === 0) return "";
  const headed = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/u.test(headed) ? headed : `${headed}.`;
}

function mentionsToken(text: string, tokens: ReadonlySet<string>): boolean {
  const lower = text.toLowerCase();
  for (const token of tokens) if (lower.includes(token)) return true;
  return false;
}

function contradictedTokens(texts: string[], corpus: string): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      for (const piece of claimPieces(sentence, corpus)) {
        if (!directMisread(piece, corpus)) continue;
        for (const name of namedUndefined(piece)) {
          if (HEX_LITERAL.test(name)) tokens.add(name.toLowerCase());
        }
        for (const match of piece.matchAll(
          /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/gu,
        )) {
          tokens.add(match[0].toLowerCase());
        }
      }
    }
  }
  return tokens;
}

function reduceSentence(
  sentence: string,
  corpus: string,
  hasMisread: boolean,
  contradicted: ReadonlySet<string>,
): string | null {
  if (
    hasMisread &&
    (sentenceIsCourtesy(sentence) || sentenceIsContinuation(sentence, corpus))
  )
    return null;
  const pieces = claimPieces(sentence, corpus);
  const kept: string[] = [];
  let removed = false;
  for (const piece of pieces) {
    const support = isSupportQuote(piece) && mentionsToken(piece, contradicted);
    if (directMisread(piece, corpus) || support) {
      removed = true;
      continue;
    }
    if (
      hasMisread &&
      (sentenceIsCourtesy(piece) || isMisreadContinuation(piece))
    ) {
      removed = true;
      continue;
    }
    kept.push(piece);
  }
  if (kept.length === 0) return null;
  if (!removed) return sentence;
  return kept
    .map((piece) => asSentence(piece))
    .filter((piece) => piece.length > 0)
    .join(" ");
}

function reduceText(
  text: string,
  corpus: string,
  hasMisread: boolean,
  contradicted: ReadonlySet<string>,
): string | null {
  const kept = splitSentences(text)
    .map((sentence) =>
      reduceSentence(sentence, corpus, hasMisread, contradicted),
    )
    .filter(
      (sentence): sentence is string =>
        sentence !== null && sentence.length > 0,
    );
  if (kept.length === 0) return null;
  return kept.join(" ");
}

function textHasMisread(text: string, corpus: string): boolean {
  return splitSentences(text).some((sentence) =>
    claimPieces(sentence, corpus).some((piece) => directMisread(piece, corpus)),
  );
}

function verdictCorpus(verdict: Verdict): string {
  return [verdict.summary, ...verdict.evidence].join("\n");
}

/**
 * Publish a low_quality verdict after contradicted hex and 0x claims are
 * removed. Other claims, evidence and limitations are unchanged. The result
 * is category none only when every claim was that misread.
 */
export function suppressHexMisreads(verdict: Verdict): Verdict {
  if (verdict.category !== "low_quality" || verdict.objective_defect)
    return verdict;
  const corpus = verdictCorpus(verdict);
  const hasMisread =
    textHasMisread(verdict.summary, corpus) ||
    verdict.evidence.some((line) => textHasMisread(line, corpus));
  if (!hasMisread) return verdict;

  const contradicted = contradictedTokens(
    [verdict.summary, ...verdict.evidence],
    corpus,
  );
  const summary = reduceText(verdict.summary, corpus, true, contradicted);
  const evidence = verdict.evidence
    .map((line) => reduceText(line, corpus, true, contradicted))
    .filter((line): line is string => line !== null);
  if (summary === null && evidence.length === 0) {
    return {
      ...verdict,
      category: "none",
      evidence: [],
      summary: NO_FINDING_SUMMARY,
    };
  }
  const nextSummary = summary ?? evidence.join(" ");
  const summaryUnchanged = nextSummary === verdict.summary;
  const evidenceUnchanged =
    evidence.length === verdict.evidence.length &&
    evidence.every((line, index) => line === verdict.evidence[index]);
  if (summaryUnchanged && evidenceUnchanged) return verdict;
  return {
    ...verdict,
    category: "low_quality",
    summary: nextSummary,
    evidence,
  };
}
