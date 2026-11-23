// spec/security/admission.md, "Story: Review every acquired item before granting admission"
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { Request as WorkerRequest } from "miniflare";
import { type ProviderFake, providerFake } from "@repo/platform/testing/providers";
import { type WorkingRepository, workingRepository } from "../git/fixtures.ts";

export const origin = "https://slop.test";
export const projectId = "scan-fixture";
export const assessmentId = `vet_${"a".repeat(32)}`;
const repositoryId = "fixture/repo";
const githubId = "101";
const nodeId = "R_kgDOfixture";

export interface ServiceCall {
  readonly method: string;
  readonly path: string;
  readonly signed: boolean;
  readonly body: string;
}

export type PublicationMode = "answer" | "lose";
export type IdentityMode = "answer" | "limited" | "offline";
export type TemplateMode = "committed" | "uncommitted";

export interface ScanWorld {
  readonly key: string;
  readonly remote: string;
  readonly provider: ProviderFake;
  readonly calls: ReadonlyArray<ServiceCall>;
  readonly journal: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly published: ReadonlyArray<unknown>;
  /** @throws {never} */
  publication(mode: PublicationMode): void;
  /** @throws {never} */
  identity(mode: IdentityMode): void;
  /** @throws {never} */
  template(mode: TemplateMode): void;
  /** @throws {never} */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

/** @throws {never} */
function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** @throws {Error} */
export function smallFixture(root: string): { readonly repository: WorkingRepository; readonly commit: string } {
  const repository = workingRepository(root, "small");
  repository.write("README.md", "# Fixture\n\nA harmless library.\n");
  repository.write("src/index.js", "export function add(a, b) {\n  return a + b;\n}\n");
  repository.git(["add", "-A"]);
  return { repository, commit: repository.commit("Small fixture") };
}

/** @throws {Error} */
export function largeSourceFixture(root: string): { readonly repository: WorkingRepository; readonly commit: string } {
  const repository = workingRepository(root, "large");
  for (let index = 0; index < 1100; index += 1) repository.write(`src/module-${String(index).padStart(4, "0")}.js`, `export const value${index} = ${index};\n`);
  for (let index = 0; index < 20; index += 1) repository.write(`copies/same-${String(index).padStart(2, "0")}.js`, "export const shared = true;\n");
  repository.git(["add", "-A"]);
  return { repository, commit: repository.commit("Past one review") };
}

const templates = { contributor: { sourcePath: "contributor", files: [{ path: "SKILL.md", content: "# Contributor skill\n" }] }, reviewer: { sourcePath: "reviewer", files: [{ path: "SKILL.md", content: "# Reviewer skill\n" }] } };
const renderer = [{ path: "render.mjs", content: "export const render = (text) => text;\n" }];

/** @throws {never} */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** @throws {Error} */
export function scanWorld(input: { readonly repositoryPath: string; readonly commit: string }): ScanWorld {
  const pair = generateKeyPairSync("ed25519");
  const jwk = pair.privateKey.export({ format: "jwk" });
  const publicKey = pair.publicKey;
  const rawPublic = Buffer.from(String(pair.publicKey.export({ format: "jwk" }).x), "base64url");
  const keyId = sha256(rawPublic);
  const provider = providerFake();
  const calls: ServiceCall[] = [];
  const journal = new Map<string, string[]>();
  const published: unknown[] = [];
  let publication: PublicationMode = "answer";
  let identity: IdentityMode = "answer";
  let template: TemplateMode = "committed";
  const manifestText = JSON.stringify({ id: projectId, repositories: [{ id: repositoryId, githubUrl: `https://github.com/${repositoryId}` }], authority: { repositoryId: githubId, repositoryNodeId: nodeId } });
  const manifestSha256 = sha256(manifestText);
  const group = (entry: (typeof templates)["contributor"]) => ({ sourcePath: entry.sourcePath, files: entry.files.map((file) => ({ path: file.path, sha256: sha256(file.content) })) });
  const templateInputs = { contributor: group(templates.contributor), reviewer: group(templates.reviewer), rendererSources: renderer.map((file) => ({ path: file.path, sha256: sha256(file.content) })), acceptedRevisions: ["2026-11-01"] };
  const templateSha256 = sha256(JSON.stringify(templateInputs));
  const templateCommit = "c".repeat(40);
  const queued = {
    assessmentId,
    projectId,
    revision: 1,
    manifestSha256,
    repository: repositoryId,
    commitSha: input.commit,
    templateSha256,
    manifestUrl: `${origin}/api/v1/project-revisions/${projectId}/1`,
    templateIndexUrl: `${origin}/skill-templates/index.json`,
    requestedAt: "2026-11-17T00:00:00.000Z",
  };
  const signedBy = (method: string, path: string, headers: Headers, body: Uint8Array) => {
    const timestamp = headers.get("x-slop-vetting-timestamp") ?? "";
    const signature = Buffer.from(headers.get("x-slop-vetting-signature") ?? "", "base64");
    const message = Buffer.from(["slop-vetting:v1", method, path, timestamp, sha256(body)].join("\n"));
    return headers.get("x-slop-vetting-key") === keyId && signature.length === 64 && verify(null, message, publicKey, signature);
  };
  const service = (method: string, path: string, body: string): Response => {
    if (path === "/api/v1/vetting/refresh") return json({ queued: [], reinstated: [], skipped: [] });
    if (path === "/api/v1/vetting/requests") return json({ schemaVersion: "slop-vetting-queue-v1", assessments: published.length > 0 && publication === "answer" ? [] : [queued] });
    if (path === "/api/v1/vetting/reuse") return json({ schemaVersion: "slop-vetting-reuse-v1", result: null });
    if (path === "/api/v1/vetting/journal") {
      const request = JSON.parse(body) as { operation: string; assessmentId: string };
      const entries = journal.get(request.assessmentId) ?? [];
      if (request.operation === "has") return json({ schemaVersion: "slop-vetting-journal-v1", present: entries.length > 0 });
      journal.set(request.assessmentId, [...entries, request.operation]);
      return json(request.operation === "reserve" ? { schemaVersion: "slop-vetting-journal-v1", reserved: true } : { schemaVersion: "slop-vetting-journal-v1", recorded: true });
    }
    if (path.startsWith("/api/v1/vetting/evidence/")) return method === "POST" && path.split("/").length === 7 ? json({ stored: [] }) : json({ ok: true });
    if (path === "/api/v1/vetting/results") {
      const result = JSON.parse(body) as { assessmentId: string; revision: number; disposition: string; policyVersion: string; assessed: { commitSha: string; templateSha256: string } };
      published.push(result);
      if (publication === "lose") return new Response("upstream reset", { status: 502 });
      return json({ setup: null, assessment: { id: result.assessmentId, revision: result.revision, state: result.disposition, commitSha: result.assessed.commitSha, templateSha256: result.assessed.templateSha256, policyVersion: result.policyVersion, resultSha256: sha256(body) } });
    }
    return json({ error: "not_found" }, 404);
  };
  const files = new Map<string, string>([
    ...[templates.contributor, templates.reviewer].flatMap((entry) => entry.files.map((file) => [`${origin}/skill-templates/${entry.sourcePath}/${file.path}`, file.content] as const)),
    ...renderer.map((file) => [`https://raw.githubusercontent.com/slopdotcash/templates/${templateCommit}/${file.path}`, file.content] as const),
  ]);
  const fetch = async (request: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const incoming = request instanceof Request ? request : new Request(request, init);
    const url = new URL(incoming.url);
    const body = new Uint8Array(await incoming.arrayBuffer());
    if (url.origin === "https://api.surplusintelligence.ai") {
      const answered = await provider.handler(new WorkerRequest(incoming.url, { method: incoming.method, headers: Object.fromEntries(incoming.headers), body }));
      return new Response(await answered.arrayBuffer(), { status: answered.status, headers: Object.fromEntries(answered.headers) });
    }
    if (url.href === `https://api.github.com/repos/${repositoryId}` && identity === "limited") return new Response("API rate limit exceeded for installation", { status: 403 });
    if (url.href === `https://api.github.com/repos/${repositoryId}` && identity === "offline") throw new TypeError(`connect ECONNREFUSED 10.0.0.1:443 ${repositoryId}`);
    if (url.href === `https://api.github.com/repos/${repositoryId}`) return json({ id: Number(githubId), node_id: nodeId, full_name: repositoryId, private: false });
    const file = files.get(url.href);
    if (file !== undefined) return new Response(file);
    if (url.href === `${origin}/skill-templates/index.json`) {
      return json({ schemaVersion: "1", templateSha256, revisionStatus: template, commit: templateCommit, repository: "slopdotcash/templates", contributor: templateInputs.contributor, reviewer: templateInputs.reviewer, renderer: { revisionStatus: "committed", sources: templateInputs.rendererSources }, acceptedRevisions: templateInputs.acceptedRevisions });
    }
    if (url.href === `${origin}/api/v1/project-revisions/${projectId}/1`) return json({ projectId, revision: 1, manifestSha256, manifestText });
    if (url.origin === origin && url.pathname.startsWith("/api/v1/vetting/")) {
      const path = `${url.pathname}${url.search}`;
      const text = new TextDecoder().decode(body);
      const signed = signedBy(incoming.method, path, incoming.headers, body);
      calls.push({ method: incoming.method, path, signed, body: text });
      return signed ? service(incoming.method, url.pathname, text) : json({ error: "invalid_signature" }, 401);
    }
    return json({ error: "unexpected" }, 599);
  };
  return {
    key: JSON.stringify(jwk),
    remote: `file://${input.repositoryPath}`,
    provider,
    calls,
    journal,
    published,
    publication: (mode) => {
      publication = mode;
    },
    identity: (mode) => {
      identity = mode;
    },
    template: (mode) => {
      template = mode;
    },
    fetch,
  };
}

/** @throws {never} */
export function cleanReview(partial: ReadonlyArray<string> = []): string {
  const coverage = Object.fromEntries(["wallet-drainer", "credential-theft", "secret-exfiltration", "unsafe-execution", "prompt-injection"].map((area) => [area, partial.includes(area) ? "partial" : "complete"]));
  return JSON.stringify({ verdict: "no-findings", confidence: 0.9, coverage, findings: [] });
}

/** @throws {Error} */
export function reviewedItemIds(evidence: string): ReadonlyArray<string> {
  const bundle = JSON.parse(evidence) as { items: { id: string }[]; sameBytesAs?: Record<string, string[]> };
  return [...bundle.items.map((item) => item.id), ...Object.values(bundle.sameBytesAs ?? {}).flat()];
}
