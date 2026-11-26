import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { type ProjectRunReceipt, markerOf, signingPayload } from "@repo/contributor/client";
import { repository } from "../u5/github.ts";

const provider = "anthropic";
const model = "claude-opus-4-1";
const client = "claude-code";
const skillRevision = `${repository}@${"a".repeat(40)}:skills/widgets/SKILL.md`;
export const traceSha256 = "e".repeat(64);
export const declaredIdentifier = `${provider}/${model}`;

/** @throws {never} */
function signedByFreshDevice(unsigned: Omit<ProjectRunReceipt, "devicePublicKey" | "deviceKeyId" | "deviceSignature">): ProjectRunReceipt {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const receipt: ProjectRunReceipt = { ...unsigned, devicePublicKey: der.toString("base64url"), deviceKeyId: createHash("sha256").update(der).digest("hex"), deviceSignature: "pending" };
  return { ...receipt, deviceSignature: sign(null, Buffer.from(signingPayload(receipt), "utf8"), privateKey).toString("base64url") };
}

/** @throws {never} */
function footer(marker: string): string {
  return [
    `AI provider/model: ${provider} / ${model}`,
    `Client / agent tooling: ${client}`,
    `Contribution skill revision: ${skillRevision}`,
    "Attribution status: self-reported",
    "— [widgets-agent]",
    `<!-- slop-contribution-attribution:v1 ${marker} -->`,
  ].join("\n");
}

/** @throws {never} */
export function tracedBody(at: string): string {
  const receipt = signedByFreshDevice({
    schemaVersion: "1",
    runId: `run_${"0".repeat(25)}1`,
    projectId: "widgets",
    repositoryId: repository,
    startedAt: at,
    completedAt: at,
    provider,
    model,
    client,
    skillRevision,
    skillSha256: "b".repeat(64),
    usage: { source: "none", confidence: "unavailable", inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, costMicroUsd: "0", sessionCount: 0 },
    trajectorySha256: traceSha256,
    traceUpload: { authority: "https://api.slop.cash", serverRunId: "srv_widgets_fixture", objectId: `sha256:${traceSha256}`, sha256: traceSha256 },
    signatureAlgorithm: "ed25519",
  });
  return `Pairs the widget change.\n\n${footer(JSON.stringify(markerOf(receipt)))}`;
}

export const malformedBody = "Bulk widget change.\n\n<!-- slop-contribution-attribution:v1 {malformed -->";

/** @throws {never} */
export function ratificationBody(record: { readonly pullRequestNodeId: string; readonly headSha: string; readonly workUnitId: string; readonly reason: string }): string {
  return ["```slop-score", JSON.stringify({
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId: "widgets",
    pullRequestNodeId: record.pullRequestNodeId,
    headSha: record.headSha,
    workUnitId: record.workUnitId,
    tier: "micro",
    scoreThirds: 1,
    proposalReviewNodeIds: [],
    coRatifierNodeIds: [],
    reason: record.reason,
    supersedes: null,
  }), "```"].join("\n");
}
