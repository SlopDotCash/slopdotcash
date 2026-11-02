// Deterministic publish guard for Slopbot low_quality misreads (PRD section 5,
// issue #1930). A well-formed SHA-256 digest is valid hex. A 0x integer
// literal is not an undefined name. Those claims are encoding facts.
//
// Remove only the contradicted claim and the evidence line that states it.
// A nearby digest or literal does not prove any other claim false. "undeclared"
// names the same defect as "undefined". A follow-on sentence falls away only
// when it does not name another identifier and does not state a failure of its
// own subject. Limitations stay. Category becomes none only when no claim remains.

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
  "undefined",
  "value",
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
  String.raw`\b(?:${UNDECLARED})\s+name\s*[,:]?\s*${QUOTED_NAME}`,
  String.raw`\b(?:${UNDECLARED})\s+(?:global|variable|identifier|symbol)\s+${QUOTED_NAME}`,
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

/**
 * The piece states a failure of its own subject. A NameError follow-on about
 * the contradicted token does not. "raises NameError" alone stays a
 * continuation; "never runs" or "before assignment" does not.
 */
function predicatesOwnSubjectFailure(piece: string): boolean {
  return /\b(?:never\s+(?:runs?|ran|replaced|reaches)|silently skipped|before assignment)\b/iu.test(
    piece,
  );
}

function isMisreadContinuation(piece: string): boolean {
  if (!CONTINUATION.test(piece)) return false;
  if (namedUndefined(piece).some((name) => !HEX_LITERAL.test(name)))
    return false;
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

function encodingMisread(text: string, corpus: string): boolean {
  if (!ENCODING_ASSERTION.test(text) || MISMATCH_QUALIFIER.test(text))
    return false;
  const local = digestShape(text);
  if (local === "one") return true;
  if (local === "other") return false;
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
 * Split a sentence only where a separator isolates a direct misread from
 * another clause. An ordinary "and" stays intact so a real finding is not
 * chopped into fragments that look like separate claims.
 */
function claimPieces(sentence: string, corpus: string): string[] {
  const segments = sentence.split(/\s+but\s+|;\s+/iu);
  const pieces: string[] = [];
  for (const segment of segments) {
    const andParts = segment.split(/\s+and\s+/iu).map((part) => part.trim());
    const misread = andParts.map((part) => directMisread(part, corpus));
    if (
      andParts.length > 1 &&
      misread.some(Boolean) &&
      misread.some((part) => !part)
    ) {
      pieces.push(...andParts.filter((part) => part.length > 0));
    } else if (segment.trim().length > 0) pieces.push(segment.trim());
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

function reduceSentence(
  sentence: string,
  corpus: string,
  hasMisread: boolean,
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
    if (directMisread(piece, corpus) || isSupportQuote(piece)) {
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
): string | null {
  const kept = splitSentences(text)
    .map((sentence) => reduceSentence(sentence, corpus, hasMisread))
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

  const summary = reduceText(verdict.summary, corpus, true);
  const evidence = verdict.evidence
    .map((line) => reduceText(line, corpus, true))
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
