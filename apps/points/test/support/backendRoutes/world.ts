// spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"; spec/security/enforcement.md, "An independent moderator reinstates only after fresh clean scans of every repository"; spec/security/enforcement.md, "Retained evidence is checked when clearance relies on it"
import { Effect, Redacted } from "effect";
import { type Request, Response } from "miniflare";
import { base64url, sha256Hex, utf8, webCrypto } from "@repo/platform/crypto";
import { signedHeaders } from "@repo/platform/signed";
import type { Handler } from "@repo/platform/testing";

const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const publicKey = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

export const serviceKeys = "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";
export const templateSha256 = "7".repeat(64);

/** @throws {never} */
function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** @throws {never} */
export function answeringAfter(steps: Array<() => Promise<unknown>>, answer: (request: Request) => Response): Handler {
  return async (request) => {
    const step = steps.shift();
    if (step !== undefined) await step();
    return answer(request);
  };
}

/** @throws {never} */
export function skillTemplates(request: Request): Response {
  return new URL(request.url).pathname === "/skill-templates/index.json"
    ? new Response(JSON.stringify({ templateSha256 }), { headers: { "content-type": "application/json" } })
    : new Response("static asset", { status: 404 });
}

export interface Signed {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export async function vettingRequest(method: string, path: string, body: Uint8Array): Promise<Signed> {
  const key = Redacted.make(JSON.stringify({ kty: "OKP", crv: "Ed25519", d: base64url(bytesOf(seed)), x: base64url(bytesOf(publicKey)) }));
  const headers = await Effect.runPromise(Effect.provide(signedHeaders({ key, method, path, body }), webCrypto));
  return { body, headers: { ...headers, "content-type": "application/octet-stream" } };
}

export async function signingKeySha256(): Promise<string> {
  return Effect.runPromise(Effect.provide(sha256Hex(bytesOf(publicKey)), webCrypto));
}

export interface EvidenceObject {
  readonly text: string;
  readonly sha256: string;
  readonly kind: "trace" | "manifest";
}

export async function evidenceObject(text: string, kind: EvidenceObject["kind"]): Promise<EvidenceObject> {
  return { text, kind, sha256: await Effect.runPromise(Effect.provide(sha256Hex(utf8(text)), webCrypto)) };
}

/** @throws {never} */
export function declaredRun(report: EvidenceObject, inventory: EvidenceObject): string {
  const declared = (object: EvidenceObject, label: string) => ({ sha256: object.sha256, sizeBytes: utf8(object.text).length, kind: object.kind, label, contentType: "text/plain" });
  return JSON.stringify({ traceSha256: report.sha256, objects: [declared(report, "report"), declared(inventory, "inventory")] });
}

export interface QueuedRow {
  readonly id: string;
  readonly project_id: string;
  readonly revision: number;
  readonly manifest_sha256: string;
  readonly commit_sha: string;
  readonly template_sha256: string;
  readonly repository_id: string;
}

/** @throws {never} */
export function scanResult(row: QueuedRow, disposition: "clean" | "incomplete", report: EvidenceObject, inventory: EvidenceObject, runId: string, at: string): string {
  const review = { provider: "surplus", model: "fixture-model", promptPolicyRevision: "fixture-prompts", inputManifestSha256: inventory.sha256, runId: `${runId}-primary`, status: "completed", verdict: "no-findings", risk: "low", findingCount: 0 };
  const complete = (items: number) => ({ state: disposition === "clean" ? "complete" : "partial", items });
  return JSON.stringify({
    schemaVersion: "slop-vetting-result-v2",
    assessmentId: row.id,
    projectId: row.project_id,
    revision: row.revision,
    manifestSha256: row.manifest_sha256,
    disposition,
    policyVersion: "fixture",
    assessed: { repository: row.repository_id, commitSha: row.commit_sha, templateSha256: row.template_sha256, inputManifestSha256: inventory.sha256, dependencyLocks: [] },
    scan: { runId, startedAt: at, completedAt: at, reportSha256: report.sha256 },
    coverage: { source: complete(3), manifests: complete(1), dependencies: complete(0), installScripts: complete(0), downloads: complete(0), agentInstructions: complete(1) },
    checks: { "wallet-drainer": "passed", "credential-theft": "passed", "secret-exfiltration": "passed", "unsafe-execution": "passed", "prompt-injection": "passed" },
    visibilityGaps: [],
    execution: null,
    reusedAssessmentId: null,
    primaryReview: review,
    specialistReview: null,
    artifacts: [],
    findings: [],
    confirmation: null,
  });
}
