// Operator receipts are evidence, not model output or contributor test claims.
// The signing key and approved VM profile are configured outside repositories.

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readRecord, timestamp } from "../../src/lib/record-validation.mjs";
import type { RuleRef } from "./contracts";
import type { GitHubClient } from "./github";

export const QUALITY_MARKER = "<!-- slopbot:quality-evidence:v1 -->";
export const QUALITY_EFFECTIVE_AT = Date.parse("2026-11-01T00:00:00Z");
export type QualityTrust = {
  SLOPBOT_QUALITY_VERIFIER_KEY?: string;
  SLOPBOT_QUALITY_PROFILE_SHA256?: string;
  // Set only after a separate reviewed qualification. Never derived from a receipt.
  SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256?: string;
};
export type QualitySubject = {
  repositoryId: number;
  nodeId: string;
  headSha: string;
  baseSha: string;
  policyDigest: string;
  itemText: string;
  policy: { path: string; text: string; truncated: boolean }[];
};
export type QualityEvidence = {
  id: string;
  kind: "removed_behavior" | "reproduced_regression" | "contradicted_claim";
  profile: string;
  expiresAt: string;
  rule: RuleRef;
  evidence: string;
  repair: string;
  description: string;
  sourceUrl: string;
};
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length >= 8;
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/u.test(v);
function requireFact(ok: unknown): asserts ok {
  if (!ok) throw new Error("Unverified quality evidence");
}
function bytes(value: string, length: number) {
  const result = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  requireFact(result.length === length);
  return result;
}
function safePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((p) => p !== "" && p !== "." && p !== "..")
  );
}
function scalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v))
  );
}

/** Verify the signature first, then check each supported objective predicate.
 * The approved collector must attest semantic facts and isolation outside the
 * guest. A signature from an arbitrary key or an incomplete VM run is not proof.
 */
export async function verifyQualityReceipt(
  envelope: string,
  trust: QualityTrust,
  subject: QualitySubject,
  github: Pick<GitHubClient, "fileText" | "request">,
  owner: string,
  repo: string,
  now = Date.now(),
): Promise<QualityEvidence | null> {
  try {
    requireFact(
      trust.SLOPBOT_QUALITY_VERIFIER_KEY &&
        digest(trust.SLOPBOT_QUALITY_PROFILE_SHA256),
    );
    const outer = readRecord(JSON.parse(envelope), "envelope");
    requireFact(
      typeof outer.payload === "string" &&
        outer.payload.length <= 32_768 &&
        typeof outer.signature === "string",
    );
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(trust.SLOPBOT_QUALITY_VERIFIER_KEY, 32),
      "Ed25519",
      false,
      ["verify"],
    );
    requireFact(
      await crypto.subtle.verify(
        "Ed25519",
        key,
        bytes(outer.signature, 64),
        new TextEncoder().encode(`${QUALITY_MARKER}\n${outer.payload}`),
      ),
    );
    const r = readRecord(JSON.parse(outer.payload), "receipt");
    requireFact(
      r.version === 1 &&
        r.status === "verified" &&
        r.isolation === "approved-vm" &&
        Array.isArray(r.visibilityGaps) &&
        r.visibilityGaps.length === 0 &&
        r.profileSha256 === trust.SLOPBOT_QUALITY_PROFILE_SHA256 &&
        r.repositoryId === subject.repositoryId &&
        r.nodeId === subject.nodeId &&
        sha(r.headSha) &&
        r.headSha === subject.headSha &&
        sha(r.baseSha) &&
        r.baseSha === subject.baseSha &&
        r.policyDigest === subject.policyDigest &&
        r.itemDigest === (await sha256Hex(subject.itemText)),
    );
    const verifiedAt = timestamp(r.verifiedAt, "verifiedAt");
    const expiresAt = timestamp(r.expiresAt, "expiresAt");
    requireFact(
      Date.parse(verifiedAt) <= now &&
        Date.parse(expiresAt) > now &&
        Date.parse(expiresAt) - Date.parse(verifiedAt) <= 86_400_000,
    );
    const rule = readRecord(r.rule, "rule");
    requireFact(
      typeof rule.source === "string" &&
        text(rule.quote) &&
        subject.policy.some(
          (f) =>
            !f.truncated &&
            f.path === rule.source &&
            f.text.includes(rule.quote as string),
        ),
    );
    requireFact(
      text(r.evidence) &&
        subject.itemText.includes(r.evidence) &&
        text(r.repair),
    );
    const proof = readRecord(r.proof, "proof");
    let description: string;
    let sourceUrl: string;
    const read = async (path: string, ref: string) => {
      const file = await github.fileText(owner, repo, path, ref, 120_000);
      requireFact(file === null || !file.truncated);
      if (file === null) {
        const commit = await github.request<{ sha: string }>(
          "GET",
          `/repos/${owner}/${repo}/git/commits/${ref}`,
        );
        const absent = await github.request(
          "GET",
          `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
        );
        requireFact(
          commit.status === 200 &&
            commit.data?.sha === ref &&
            absent.status === 404,
        );
      }
      return file;
    };
    const permalink = (path: string, ref: string) =>
      `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
    if (r.kind === "removed_behavior") {
      requireFact(
        safePath(proof.path) &&
          text(proof.requiredBehavior) &&
          text(proof.removedLines) &&
          proof.scopeChangeApproved === false &&
          proof.behaviorAbsent === true &&
          digest(proof.baselineSha256),
      );
      const baseline = await read(proof.path, subject.baseSha);
      const candidate = await read(proof.path, subject.headSha);
      requireFact(
        baseline !== null &&
          (await sha256Hex(baseline.text)) === proof.baselineSha256 &&
          baseline.text.includes(proof.removedLines),
      );
      requireFact(
        candidate === null
          ? proof.candidateSha256 === null
          : digest(proof.candidateSha256) &&
              (await sha256Hex(candidate.text)) === proof.candidateSha256 &&
              !candidate.text.includes(proof.removedLines),
      );
      // Absence of text alone is not absence of behavior: the trusted collector
      // explicitly attests behaviorAbsent and the unchanged requirement above.
      sourceUrl = permalink(proof.path, subject.baseSha);
      description = `Required behavior removed: ${proof.requiredBehavior}. Source: ${proof.path}.`;
    } else if (r.kind === "reproduced_regression") {
      requireFact(
        text(proof.command) &&
          digest(proof.environmentSha256) &&
          digest(proof.harnessSha256) &&
          proof.workflowUnchanged === true &&
          proof.patchCaused === true &&
          proof.externalFailure === false,
      );
      const baseline = readRecord(proof.baseline, "baseline");
      const candidate = readRecord(proof.candidate, "candidate");
      requireFact(
        baseline.sourceSha === subject.baseSha &&
          candidate.sourceSha === subject.headSha &&
          baseline.exitCode === 0 &&
          Number.isSafeInteger(candidate.exitCode) &&
          Number(candidate.exitCode) > 0 &&
          Number(candidate.exitCode) < 126 &&
          digest(baseline.reportSha256) &&
          digest(candidate.reportSha256) &&
          baseline.reportSha256 !== candidate.reportSha256 &&
          baseline.harnessSha256 === proof.harnessSha256 &&
          candidate.harnessSha256 === proof.harnessSha256 &&
          baseline.environmentSha256 === proof.environmentSha256 &&
          candidate.environmentSha256 === proof.environmentSha256,
      );
      sourceUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${subject.headSha}`;
      description = `Reproduced regression: ${proof.command}. Baseline exit 0; candidate exit ${candidate.exitCode}. Environment ${proof.environmentSha256}; harness ${proof.harnessSha256}; reports ${baseline.reportSha256}, ${candidate.reportSha256}.`;
    } else if (r.kind === "contradicted_claim") {
      requireFact(
        text(proof.claim) &&
          subject.itemText.includes(proof.claim) &&
          proof.claim === r.evidence &&
          safePath(proof.path) &&
          sha(proof.commit) &&
          digest(proof.sha256) &&
          typeof proof.pointer === "string" &&
          proof.pointer.startsWith("/") &&
          scalar(proof.claimed) &&
          scalar(proof.observed) &&
          proof.claimed !== proof.observed,
      );
      sourceUrl = permalink(proof.path, proof.commit);
      // The contribution must actually cite this immutable artifact.
      requireFact(subject.itemText.includes(sourceUrl));
      const artifact = await read(proof.path, proof.commit);
      requireFact(
        artifact !== null && (await sha256Hex(artifact.text)) === proof.sha256,
      );
      let actual: unknown = JSON.parse(artifact.text);
      for (const part of proof.pointer.slice(1).split("/")) {
        const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
        requireFact(
          actual !== null &&
            typeof actual === "object" &&
            Object.hasOwn(actual, key),
        );
        actual = (actual as Record<string, unknown>)[key];
      }
      requireFact(actual === proof.observed);
      description = `Claim contradicted by cited artifact at ${proof.pointer}: claimed ${JSON.stringify(proof.claimed)}, recorded ${JSON.stringify(proof.observed)}.`;
    } else return null;
    return {
      id: await sha256Hex(outer.payload),
      kind: r.kind,
      profile: r.profileSha256 as string,
      expiresAt,
      rule: { source: rule.source, quote: rule.quote },
      evidence: r.evidence,
      repair: r.repair,
      description,
      sourceUrl,
    };
  } catch {
    // Malformed, unavailable, stale, forged and incomplete evidence is label-only.
    return null;
  }
}

export async function loadQualityEvidence(
  github: GitHubClient,
  trust: QualityTrust,
  subject: QualitySubject,
  owner: string,
  repo: string,
  number: number,
  commentId?: number,
): Promise<QualityEvidence[]> {
  if (
    !trust.SLOPBOT_QUALITY_VERIFIER_KEY ||
    !trust.SLOPBOT_QUALITY_PROFILE_SHA256
  )
    return [];
  try {
    const result: QualityEvidence[] = [];
    // Bounded intake, never an exhaustive claim: omitted evidence cannot close.
    const comments =
      (await github.get<{ body: string | null }[]>(
        `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
      )) ?? [];
    if (commentId !== undefined) {
      const direct = await github.get<{ body: string | null }>(
        `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      );
      if (direct !== null) comments.push(direct);
    }
    for (const comment of comments) {
      if (!comment?.body?.startsWith(`${QUALITY_MARKER}\n`)) continue;
      const proof = await verifyQualityReceipt(
        comment.body.slice(QUALITY_MARKER.length + 1),
        trust,
        subject,
        github,
        owner,
        repo,
      );
      if (proof !== null && !result.some((r) => r.id === proof.id))
        result.push(proof);
    }
    return result;
  } catch {
    return [];
  }
}
