import {
  bindProvenanceSource,
  parseProvenanceReport,
} from "../../workers/vetting/provenance-report";

/** Separate private vetting evidence. Its terms are fixed in source as EVIDENCE_POLICY. */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { WebSession } from "../../src/lib/project-contracts";
import {
  assemblyAssessment,
  assemblyRecord,
  parseAssemblyManifest,
} from "../../workers/vetting/assembly-manifest";
import { assertFilesystemReferences } from "../../workers/vetting/filesystem-capture";
import { parseIsolatedArtifactEvidence } from "../../workers/vetting/isolated-evidence";
import {
  type ApiError,
  apiErrorResponse,
  fail,
  isSameOriginJsonWrite,
  JSON_HEADERS,
  json as jsonResponse,
} from "../http";
import type { ProjectD1Database } from "../projects/cloudflare-persistence";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import { isRecord, readJsonObject } from "../trace/validation";
import {
  chunkKey,
  chunkLayout,
  EVIDENCE_CHUNK_BYTES,
  type EvidenceChunk,
  evidenceLocation,
  evidenceObjectKey,
  verifiedPart,
  verifyParts,
} from "./evidence-chunks";
import { PERMANENT_ADMISSION_EVIDENCE_SQL } from "./evidence-retention";
import type { VettingResult } from "./result";
import {
  isScanResult,
  type RecordedVettingResult,
  SCAN_SURFACES,
  type VettingScanResult,
} from "./scan-result";

const HEX = /^[a-f0-9]{64}$/u;
/**
 * Largest report or inventory the intake parses whole inside one Worker
 * request (128 MB memory). It bounds JSON documents only, never evidence.
 */
const MAX_PARSED_EVIDENCE_BYTES = 32 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,100}$/u;
const KINDS = new Set([
  "trace",
  "stdout",
  "stderr",
  "network",
  "artifact",
  "lineage",
  "manifest",
  "disk-diff",
]);
/**
 * The approved evidence policy owner and readers (PRD section 9, "Moderation
 * and evidence"; owner decision on #909): lalalune (18633264) owns the
 * policy, and lalalune and drew-dot-com (202660855) are the only evidence
 * readers.
 */
export const EVIDENCE_POLICY_AUTHORITY_GITHUB_ID = "18633264";
export const EVIDENCE_OPERATOR_GITHUB_IDS: readonly string[] = [
  "18633264",
  "202660855",
];
/**
 * The approved scanner-evidence terms (#909 owner decisions, PRD section 9).
 * They are fixed in source: a change needs a reviewed pull request, not
 * deployment configuration. Each run stores a copy of the terms it used.
 */
export const EVIDENCE_POLICY = {
  version: "slop-scanner-evidence-2026-10-28",
  policyAuthorityGithubId: EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
  operatorGithubIds: [...EVIDENCE_OPERATOR_GITHUB_IDS],
  postClosureRetentionSeconds: 90 * 86400,
  admissionEvidenceRetention: "permanent",
  readGrantDurationSeconds: 900,
  // Owner decision, 28 October 2026: no object or run size limit. Each
  // request still carries at most one 8 MiB part, and the signed 1 MiB
  // registration bounds a run's inventory to 1,024 objects.
  objectStorage: "content-addressed",
  maxPartBytes: EVIDENCE_CHUNK_BYTES,
  maxObjects: 1024,
  accessPolicyReference:
    "https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6379712530",
  retentionPolicyReference:
    "https://github.com/SlopDotCash/slopdotcash/issues/1467#issuecomment-6438784205",
  recoveryPolicyReference:
    "https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6380038965",
} as const;
function hasKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join() === keys.sort().join();
}
function validClassifications(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let previousPath = "";
  for (const row of value) {
    if (
      !isRecord(row) ||
      !hasKeys(row, ["path", "surfaces"]) ||
      !isText(row.path, 1024) ||
      row.path <= previousPath ||
      !Array.isArray(row.surfaces)
    )
      return false;
    const surfaces = row.surfaces;
    if (
      surfaces.length === 0 ||
      surfaces.some(
        (surface, index) =>
          !SCAN_SURFACES.includes(surface) ||
          (index > 0 && surface <= surfaces[index - 1]),
      )
    )
      return false;
    previousPath = row.path;
  }
  return true;
}
function isText(value: unknown, max = 500): value is string {
  return (
    typeof value === "string" && value.trim() !== "" && value.length <= max
  );
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (!hasKeys(value, keys))
    fail(400, "invalid_request", "Unexpected evidence fields");
}
function text(value: unknown, max = 500): string {
  if (!isText(value, max))
    fail(400, "invalid_request", "Invalid evidence text");
  return value;
}
export type EvidenceDependencies = {
  db: ProjectD1Database;
  bucket: R2Bucket | undefined;
  session?: (request: Request) => Promise<WebSession | null>;
  now: () => Date;
  randomId: () => string;
  signed?: (
    request: Request,
    maximum: number,
  ) => Promise<{ body: Uint8Array; keySha256: string }>;
};
type Run = {
  assessment_id: string;
  run_id: string;
  trace_sha256: string;
  assembly_sha256: string | null;
  manifest_sha256: string;
  manifest: string;
  permanent_admission?: number;
  policy: string;
  created_at: string;
  expires_at: string | null;
};
type ObjectRow = {
  assessment_id: string;
  run_id: string;
  sha256: string;
  size_bytes: number;
  kind: string;
  label: string;
  content_type: string;
  object_key: string;
  chunks: string | null;
  /** "content" since migration 0107; earlier rows are run-scoped. */
  storage?: string | null;
};
const headers = { ...JSON_HEADERS, "x-robots-tag": "noindex" };
const json = (status: number, body: unknown) =>
  jsonResponse(status, body, { headers: { "x-robots-tag": "noindex" } });
export class VettingEvidence {
  constructor(readonly deps: EvidenceDependencies) {}
  private signed(request: Request, maximum: number) {
    if (!this.deps.signed)
      fail(
        503,
        "service_unavailable",
        "Vetting evidence upload is unavailable",
      );
    return this.deps.signed(request, maximum);
  }
  ready() {
    return Boolean(this.deps.bucket);
  }
  configuration() {
    if (!this.deps.bucket)
      fail(
        503,
        "evidence_unavailable",
        "Vetting evidence storage is not bound",
      );
    return { policy: EVIDENCE_POLICY, bucket: this.deps.bucket };
  }
  async audit(
    actor: string,
    action: string,
    assessment: string,
    run: string | null = null,
    sha: string | null = null,
    reason: string | null = null,
  ) {
    await this.deps.db
      .prepare(
        "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        this.deps.randomId(),
        actor,
        action,
        assessment,
        run,
        sha,
        reason,
        this.deps.now().toISOString(),
      )
      .run();
  }
  async operator(request: Request) {
    const actor = await this.deps.session?.(request);
    if (!actor) fail(401, "unauthorized", "Sign in with GitHub");
    const { policy } = this.configuration();
    if (!policy.operatorGithubIds.includes(actor.githubId))
      fail(403, "forbidden", "Designated vetting operator access is required");
    return actor;
  }
  async run(assessment: string, run: string): Promise<Run> {
    const row = await this.deps.db
      .prepare(
        `SELECT r.*, c.closed_at AS case_closed_at,
          CASE WHEN ${PERMANENT_ADMISSION_EVIDENCE_SQL} THEN 1 ELSE 0 END AS permanent_admission
         FROM vetting_evidence_runs r
         JOIN vetting_assessments a ON a.id=r.assessment_id
         LEFT JOIN vetting_evidence_case_closures c ON c.assessment_id=r.assessment_id
         WHERE r.assessment_id=? AND r.run_id=?`,
      )
      .bind(assessment, run)
      .first<Run & { case_closed_at: string | null }>();
    if (!row) fail(404, "evidence_missing", "Evidence run is missing");
    // The old upload-based expiry remains in the immutable manifest history.
    // The approved case lifecycle now determines access for retained evidence.
    row.expires_at =
      row.permanent_admission === 1 || row.case_closed_at === null
        ? null
        : new Date(
            Date.parse(row.case_closed_at) + 90 * 86400_000,
          ).toISOString();
    return row;
  }
  async closeCase(request: Request, assessment: string) {
    const actor = await this.operator(request);
    const { policy } = this.configuration();
    if (actor.githubId !== policy.policyAuthorityGithubId)
      fail(
        403,
        "forbidden",
        "Only the evidence policy owner may close an exception case",
      );
    const body = await readJsonObject(request);
    exact(body, ["reason"]);
    const reason = text(body.reason, 1000);
    const state = await this.deps.db
      .prepare("SELECT state FROM vetting_assessments WHERE id=?")
      .bind(assessment)
      .first<{ state: string }>();
    if (!state) fail(404, "not_found", "Assessment not found");
    if (state.state !== "incomplete" && state.state !== "malicious")
      fail(
        409,
        "case_not_exception",
        "Only a finished exception case can be closed manually",
      );
    const at = this.deps.now().toISOString();
    await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_case_closures(assessment_id,closed_at,closed_by,reason) VALUES(?,?,?,?) ON CONFLICT(assessment_id) DO NOTHING",
        )
        .bind(assessment, at, actor.githubId, reason),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,reason,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          this.deps.randomId(),
          actor.githubId,
          "close-case",
          assessment,
          reason,
          at,
        ),
    ]);
    const closure = await this.deps.db
      .prepare(
        "SELECT closed_at FROM vetting_evidence_case_closures WHERE assessment_id=?",
      )
      .bind(assessment)
      .first<{ closed_at: string }>();
    if (!closure)
      fail(500, "evidence_failure", "Case closure was not recorded");
    return json(200, {
      assessmentId: assessment,
      closedAt: closure.closed_at,
      expiresAt: new Date(
        Date.parse(closure.closed_at) + 90 * 86400_000,
      ).toISOString(),
    });
  }
  async object(
    assessment: string,
    run: string,
    sha: string,
  ): Promise<ObjectRow> {
    const row = await this.deps.db
      .prepare(
        "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? AND sha256=?",
      )
      .bind(assessment, run, sha)
      .first<ObjectRow>();
    if (!row) fail(404, "evidence_missing", "Evidence object is missing");
    return row;
  }
  private readable(run: Run) {
    const { bucket } = this.configuration();
    if (
      run.expires_at !== null &&
      Date.parse(run.expires_at) <= this.deps.now().getTime()
    )
      fail(
        410,
        "evidence_expired",
        "Evidence access expired; physical retention is governed separately",
      );
    return bucket;
  }
  private layout(row: ObjectRow): EvidenceChunk[] | null {
    if (row.chunks === null) return null;
    try {
      return chunkLayout(JSON.parse(row.chunks), row.size_bytes);
    } catch {
      fail(409, "evidence_corrupt", "Stored evidence chunk layout changed");
    }
  }
  async bytes(row: ObjectRow, run: Run): Promise<Uint8Array> {
    const bucket = this.readable(run);
    if (row.size_bytes > EVIDENCE_CHUNK_BYTES)
      fail(
        413,
        "evidence_oversize",
        "Large evidence requires a streamed download",
      );
    return verifiedPart(
      bucket,
      evidenceLocation(row),
      row.sha256,
      row.size_bytes,
    );
  }
  async verify(row: ObjectRow, run: Run, requireComplete = true) {
    const bucket = this.readable(run),
      chunks = this.layout(row);
    if (!chunks) {
      await this.bytes(row, run);
      return;
    }
    if (
      requireComplete &&
      !(await this.deps.db
        .prepare(
          "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
        )
        .bind(row.assessment_id, row.run_id, row.sha256)
        .first())
    )
      fail(
        409,
        "evidence_pending",
        "Chunked evidence has not completed whole-file verification",
      );
    await verifyParts(bucket, evidenceLocation(row), chunks, row.sha256);
  }
  /**
   * The complete bytes of a JSON report or inventory that the intake must
   * parse, assembled from verified parts when chunked. Only these structural
   * documents are held whole, bounded by Worker memory; evidence size itself
   * is unbounded and artifacts are verified part by part.
   */
  async document(row: ObjectRow, run: Run): Promise<Uint8Array> {
    const chunks = this.layout(row);
    if (!chunks) return this.bytes(row, run);
    if (row.size_bytes > MAX_PARSED_EVIDENCE_BYTES)
      fail(
        413,
        "evidence_oversize",
        "A structural evidence document is too large to parse in one request",
      );
    if (
      !(await this.deps.db
        .prepare(
          "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
        )
        .bind(row.assessment_id, row.run_id, row.sha256)
        .first())
    )
      fail(
        409,
        "evidence_pending",
        "Chunked evidence has not completed whole-file verification",
      );
    const bucket = this.readable(run);
    const whole = new Uint8Array(row.size_bytes);
    let offset = 0;
    for (const chunk of chunks) {
      whole.set(
        await verifiedPart(
          bucket,
          chunkKey(evidenceLocation(row), chunk),
          chunk.sha256,
          chunk.sizeBytes,
        ),
        offset,
      );
      offset += chunk.sizeBytes;
    }
    if ((await sha256Hex(whole)) !== row.sha256)
      fail(409, "evidence_corrupt", "Complete evidence digest changed");
    return whole;
  }
  /** Verify retained closure without changing the canonical scan state or authority. */
  async assemblyClosure(assessment: string, runId: string) {
    const run = await this.run(assessment, runId);
    if (!run.assembly_sha256)
      fail(
        409,
        "assembly_missing",
        "No canonical assembly is bound to this storage run",
      );
    const objects =
      (
        await this.deps.db
          .prepare(
            "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=?",
          )
          .bind(assessment, runId)
          .all<ObjectRow>()
      ).results ?? [];
    const inventory = new Map(objects.map((row) => [row.sha256, row]));
    const required = (digest: unknown, bytes?: unknown) => {
      const row =
        typeof digest === "string" ? inventory.get(digest) : undefined;
      if (!row || (bytes !== undefined && bytes !== row.size_bytes))
        fail(
          409,
          "assembly_incomplete",
          "A canonical assembly reference is absent or has a different length",
        );
      return row;
    };
    const read = async (digest: unknown) =>
      assemblyRecord(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await this.bytes(required(digest), run),
          ),
        ),
      );
    const assembly = parseAssemblyManifest(await read(run.assembly_sha256));
    const persisted = await this.deps.db
      .prepare(
        "SELECT id AS assessmentId,project_id AS projectId,revision,manifest_sha256 AS manifestSha256,commit_sha AS commitSha,template_sha256 AS templateSha256 FROM vetting_assessments WHERE id=?",
      )
      .bind(assessment)
      .first();
    const sameAssessment = (value: unknown) =>
      JSON.stringify(assemblyAssessment(value)) ===
      JSON.stringify(assembly.assessment);
    if (
      !sameAssessment(persisted) ||
      assembly.assessment.assessmentId !== assessment
    )
      fail(
        409,
        "assembly_mismatch",
        "Canonical assembly does not bind the stored assessment",
      );
    const roles = new Map(assembly.files.map((file) => [file.role, file]));
    for (const file of assembly.files) required(file.sha256, file.bytes);
    const role = (name: string, digest?: unknown) => {
      const file = roles.get(name);
      if (!file || (digest !== undefined && file.sha256 !== digest))
        fail(
          409,
          "assembly_incomplete",
          "A required canonical evidence role is missing or changed",
        );
      return file;
    };
    role("queue", assembly.queuedInputsSha256);
    role("runtime-overlay", assembly.runtimeOverlaySha256);
    const queue = await read(assembly.queuedInputsSha256);
    if (
      queue.schema !== "slop-queued-inputs-v1" ||
      queue.state !== "quarantined" ||
      !sameAssessment(queue.assessment) ||
      typeof queue.manifestText !== "string" ||
      (await sha256Hex(new TextEncoder().encode(queue.manifestText))) !==
        assembly.assessment.manifestSha256
    )
      fail(
        409,
        "assembly_mismatch",
        "Retained queue evidence does not bind the exact assessment manifest",
      );
    role("source-inventory", queue.sourceInventorySha256);
    const source = await read(queue.sourceInventorySha256);
    if (
      source.schema !== "slop-source-inventory-v1" ||
      source.state !== "quarantined" ||
      source.commitSha !== assembly.assessment.commitSha ||
      !Array.isArray(source.records) ||
      !Array.isArray(queue.inputs)
    )
      fail(
        409,
        "assembly_mismatch",
        "Retained source inventory does not bind the assessed commit",
      );
    for (const item of [...source.records, ...queue.inputs]) {
      const entry = assemblyRecord(item);
      if (entry.type === "commit" && entry.sha256 === null) continue;
      required(entry.sha256, entry.bytes);
    }
    if (
      roles.has("source-release-comparison") ||
      roles.has("provenance-source-archive") ||
      roles.has("provenance-release-archive")
    ) {
      try {
        const report = parseProvenanceReport(
          await read(role("source-release-comparison").sha256),
        );
        bindProvenanceSource(
          report,
          source,
          String(queue.sourceInventorySha256),
        );
        for (const descriptor of report.inputs) {
          required(descriptor.sha256, descriptor.bytes);
          role(
            descriptor.role === "source-inventory"
              ? descriptor.role
              : `provenance-${descriptor.role}`,
            descriptor.sha256,
          );
        }
      } catch {
        fail(
          409,
          "assembly_mismatch",
          "Source and release comparison does not bind retained inputs",
        );
      }
    }
    const vm = await read(role("offline-vm").sha256);
    if (
      vm.schema !== "slop-offline-vm-evidence-v1" ||
      vm.state !== "incomplete" ||
      typeof vm.serialSha256 !== "string" ||
      !HEX.test(vm.serialSha256) ||
      vm.overlaySha256 !== assembly.runtimeOverlaySha256
    )
      fail(
        409,
        "assembly_mismatch",
        "Retained VM receipt does not bind the exact overlay",
      );
    role(
      roles.has("raw-vm-serial") ? "raw-vm-serial" : "untrusted-vm-serial",
      vm.serialSha256,
    );
    if (typeof vm.diskMapSha256 === "string")
      role("block-allocation-map", vm.diskMapSha256);
    else if (vm.diskMapSha256 !== null)
      fail(409, "assembly_mismatch", "VM disk-map reference is invalid");
    const guestFile = roles.get("guest-receipt");
    if (guestFile) {
      const guest = await read(guestFile.sha256);
      const profileFile = role("approved-fixture-profile");
      const profile = await read(profileFile.sha256);
      if (
        guest.schema !== "slop-guest-syscall-evidence-v1" ||
        guest.state !== "incomplete" ||
        guest.fixtureOnly !== true ||
        guest.providerCallsAuthorized !== false ||
        guest.publicationAuthorized !== false ||
        guest.sourceInventorySha256 !== queue.sourceInventorySha256 ||
        guest.vmEvidenceSha256 !== role("offline-vm").sha256 ||
        guest.serialSha256 !== vm.serialSha256 ||
        guest.profileSha256 !== profileFile.sha256 ||
        guest.seedSha256 !== vm.seedSha256 ||
        !Array.isArray(guest.sourceSha256) ||
        profile.schema !== "slop-harmless-guest-profile-v1" ||
        profile.fixtureOnly !== true ||
        profile.sourceInventorySha256 !== queue.sourceInventorySha256
      )
        fail(
          409,
          "assembly_mismatch",
          "Guest receipt does not bind the captured source, profile and VM",
        );
      for (const digest of guest.sourceSha256) required(digest);
      for (const [name, digest] of [
        ["untrusted-trace", guest.traceSha256],
        ["untrusted-output", guest.outputSha256],
      ] as const) {
        required(digest);
        role(name, digest);
      }
      if (guest.filesystemSha256 !== undefined) {
        if (guest.filesystemEncoding !== "json-utf8")
          fail(409, "assembly_mismatch", "Unknown filesystem transport");
        role("raw-filesystem-capture", guest.filesystemSha256);
        const capture = await read(guest.filesystemSha256);
        if (
          capture.schema !== "slop-filesystem-capture-v1" ||
          capture.state !== "incomplete" ||
          capture.executionAuthorized !== false ||
          capture.root !== "/tmp/slop-quarantine"
        )
          fail(
            409,
            "assembly_mismatch",
            "Invalid captured filesystem inventory",
          );
        const objects = assemblyRecord(capture.objects);
        if (Object.keys(objects).length > 256)
          fail(
            409,
            "assembly_mismatch",
            "Filesystem object count exceeds bound",
          );
        const descriptors: { sha256: string; bytes: number }[] = [];
        let total = 0;
        for (const [sha, encoded] of Object.entries(objects)) {
          if (
            !HEX.test(sha) ||
            typeof encoded !== "string" ||
            encoded.length > 1024 * 1024
          )
            fail(
              409,
              "assembly_mismatch",
              "Invalid filesystem content reference",
            );
          let binary: string;
          try {
            binary = atob(encoded);
          } catch {
            fail(
              409,
              "assembly_mismatch",
              "Invalid filesystem content encoding",
            );
          }
          if (btoa(binary) !== encoded)
            fail(
              409,
              "assembly_mismatch",
              "Noncanonical filesystem content encoding",
            );
          const bytes = Uint8Array.from(binary, (character) =>
            character.charCodeAt(0),
          );
          total += bytes.length;
          if (total > 672 * 1024 || (await sha256Hex(bytes)) !== sha)
            fail(
              409,
              "assembly_mismatch",
              "Filesystem bytes differ or exceed bound",
            );
          required(sha, bytes.length);
          role(`captured-filesystem-object:${sha}`, sha);
          descriptors.push({ sha256: sha, bytes: bytes.length });
        }
        try {
          assertFilesystemReferences(
            capture,
            new Map(descriptors.map((item) => [item.sha256, item.bytes])),
          );
        } catch {
          fail(
            409,
            "assembly_incomplete",
            "Filesystem entries do not bind retained content",
          );
        }
        const summary = await read(
          role("untrusted-filesystem-inventory").sha256,
        );
        if (
          JSON.stringify(summary) !==
          JSON.stringify({ ...capture, objects: descriptors })
        )
          fail(
            409,
            "assembly_mismatch",
            "Filesystem review metadata differs from capture",
          );
      }
      if (
        guest.kernelArtifactGate !== undefined ||
        profile.kernelPolicySha256 !== undefined
      ) {
        const gate = assemblyRecord(guest.kernelArtifactGate);
        if (gate.policySha256 !== profile.kernelPolicySha256)
          fail(409, "assembly_mismatch", "Guest kernel profile differs");
        required(gate.postCollectorOutputSha256);
        role("untrusted-post-collector-probe", gate.postCollectorOutputSha256);
      }
    }
    if (roles.has("syscall-review") || roles.has("syscall-index")) {
      const summary = await read(role("syscall-review").sha256);
      const indexFile = role("syscall-index", summary.indexSha256);
      required(summary.indexSha256, summary.indexBytes);
      const index = await read(indexFile.sha256);
      const raw = role("untrusted-trace");
      if (
        summary.schema !== "slop-syscall-review-v1" ||
        index.schema !== "slop-syscall-index-v1" ||
        summary.rawSha256 !== raw.sha256 ||
        index.rawSha256 !== raw.sha256 ||
        summary.rawBytes !== raw.bytes ||
        index.rawBytes !== raw.bytes ||
        summary.state !== "incomplete" ||
        index.state !== "incomplete" ||
        summary.providerCallsAuthorized !== false ||
        index.providerCallsAuthorized !== false ||
        summary.publicationAuthorized !== false ||
        index.publicationAuthorized !== false
      )
        fail(
          409,
          "assembly_mismatch",
          "Structured observations do not bind the retained trace",
        );
    }
    const dependency = roles.get("dependency-inventory");
    if (dependency) {
      const record = await read(dependency.sha256);
      if (
        record.schema !== "slop-dependency-inventory-v1" ||
        record.state !== "quarantined" ||
        record.executionAuthorized !== false ||
        typeof record.profileSha256 !== "string" ||
        !HEX.test(record.profileSha256) ||
        record.sourceInventorySha256 !== queue.sourceInventorySha256 ||
        !Array.isArray(record.records)
      )
        fail(
          409,
          "assembly_mismatch",
          "Dependency inventory does not bind the captured source",
        );
      role("dependency-profile", record.profileSha256);
      for (const value of record.records) {
        const entry = assemblyRecord(value);
        required(entry.sha256, entry.bytes);
        required(entry.inspectionSha256);
      }
    }
    for (const file of assembly.files.filter(
      (file) =>
        file.role.startsWith("artifact:") ||
        file.role.startsWith("dependency-artifact:"),
    )) {
      const record = await read(file.sha256);
      if (!Array.isArray(record.records))
        fail(409, "assembly_incomplete", "Artifact lineage is missing");
      for (const value of record.records) {
        const entry = assemblyRecord(value);
        required(entry.sha256, entry.bytes);
        if (entry.parentSha256) required(entry.parentSha256);
      }
    }
    const review = await read(assembly.reviewInputSha256);
    if (
      !Array.isArray(review.items) ||
      !Array.isArray(review.visibilityGaps) ||
      JSON.stringify([...review.visibilityGaps].sort()) !==
        JSON.stringify([...assembly.visibilityGaps].sort())
    )
      fail(
        409,
        "assembly_mismatch",
        "Review input must preserve canonical visibility gaps",
      );
    for (const value of review.items) {
      const item = assemblyRecord(value);
      if (typeof item.text !== "string")
        fail(409, "assembly_incomplete", "Review input bytes are missing");
      const bytes = new TextEncoder().encode(item.text);
      if ((await sha256Hex(bytes)) !== item.sha256)
        fail(409, "assembly_mismatch", "Review input digest changed");
      required(item.sha256, bytes.length);
    }
    for (const row of objects) await this.verify(row, run);
    return {
      ...assembly,
      retained: true as const,
      storageRunId: runId,
      runtimeRunIdentity: "not-asserted-by-current-vm-format" as const,
    };
  }
  /**
   * The v1 canonical assembler is explicitly incomplete and grants no
   * authority (`parseAssemblyManifest` accepts only unauthorized assemblies),
   * so retained v1 evidence never clears a result. Retaining every byte
   * cannot change that contract.
   */
  async complete(_result: VettingResult): Promise<boolean> {
    return false;
  }
  /**
   * A bounded scan's retained evidence: the private report, the exact
   * inventory it read, the dependency locks and every named artifact,
   * registered under the scan run and still readable with their digests.
   * A reused scan points at the original run of the cached assessment.
   */
  async scanRetained(
    result: VettingScanResult,
    assessmentId = result.assessmentId,
  ) {
    const runId = result.scan.runId;
    try {
      const run = await this.run(assessmentId, runId);
      if (run.trace_sha256 !== result.scan.reportSha256) return false;
      const objects =
        (
          await this.deps.db
            .prepare(
              "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=?",
            )
            .bind(assessmentId, runId)
            .all<ObjectRow>()
        ).results ?? [];
      const bySha = new Map(objects.map((object) => [object.sha256, object]));
      const required = new Set([
        result.scan.reportSha256,
        result.assessed.inputManifestSha256,
        ...(result.assessed.sourceInventorySha256
          ? [result.assessed.sourceInventorySha256]
          : []),
        ...result.assessed.dependencyLocks.map((lock) => lock.sha256),
        ...result.artifacts.flatMap((artifact) => [
          artifact.sha256,
          ...(artifact.parentSha256 ? [artifact.parentSha256] : []),
        ]),
      ]);
      if (result.assessed.sourceInventorySha256) {
        const reportRow = bySha.get(result.scan.reportSha256);
        const sourceRow = bySha.get(result.assessed.sourceInventorySha256);
        const finalRow = bySha.get(result.assessed.inputManifestSha256);
        if (
          reportRow?.kind !== "trace" ||
          sourceRow?.kind !== "manifest" ||
          finalRow?.kind !== "manifest"
        )
          return false;
        const bytes = await this.document(reportRow, run);
        let report: unknown;
        try {
          report = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          return false;
        }
        if (
          !isRecord(report) ||
          !hasKeys(report, [
            "schemaVersion",
            "assessmentId",
            "sourceInventorySha256",
            "inventorySha256",
            "findings",
            "downloads",
            "execution",
            "executionEvidenceSha256s",
            "visibilityGaps",
            "reviews",
          ]) ||
          report.schemaVersion !== "slop-scan-report-v2" ||
          report.assessmentId !== assessmentId ||
          report.sourceInventorySha256 !==
            result.assessed.sourceInventorySha256 ||
          report.inventorySha256 !== result.assessed.inputManifestSha256 ||
          JSON.stringify(report.execution) !==
            JSON.stringify(result.execution) ||
          !Array.isArray(report.executionEvidenceSha256s) ||
          report.executionEvidenceSha256s.length > 500 ||
          (result.execution !== null &&
            report.executionEvidenceSha256s.length === 0)
        )
          return false;
        const executionDigests = new Set<string>();
        const executionItems: { id: string; text: string; sha256: string }[] =
          [];
        const requestedArtifacts = new Set(
          result.artifacts
            .filter((artifact) => artifact.requestedExecution)
            .map((artifact) => artifact.sha256),
        );
        const coveredArtifacts = new Set<string>();
        const executionRuns = new Set<string>();
        for (const sha of report.executionEvidenceSha256s) {
          const executionRow =
            typeof sha === "string" ? bySha.get(sha) : undefined;
          if (
            typeof sha !== "string" ||
            !HEX.test(sha) ||
            executionDigests.has(sha) ||
            executionRow?.kind !== "trace"
          )
            return false;
          executionDigests.add(sha);
          required.add(sha);
          // Failed/opaque output is valid retained evidence for an incomplete
          // result. Only clean admission requires the exact review-item graph.
          if (result.disposition !== "clean") continue;
          const executionBytes = await this.bytes(executionRow, run);
          try {
            const execution = parseIsolatedArtifactEvidence(executionBytes, {
              artifactSha256s: requestedArtifacts,
              // The bounded scanner currently detonates Linux native binaries.
              interpreter: "binary",
            });
            if (
              !result.execution ||
              execution.imageSha256 !== result.execution.imageSha256 ||
              execution.sourceSha === null ||
              !execution.outputComplete ||
              execution.exitCode !== 0 ||
              executionRuns.has(execution.runId) ||
              Date.parse(execution.startedAt) <
                Date.parse(result.execution.startedAt) ||
              Date.parse(execution.completedAt) >
                Date.parse(result.execution.completedAt)
            )
              return false;
            coveredArtifacts.add(execution.artifactSha256);
            executionRuns.add(execution.runId);
            const output = (value: string) => {
              const binary = atob(value);
              if (binary.length > 65536 || btoa(binary) !== value)
                throw new Error("Invalid execution output");
              return new TextDecoder("utf-8", { fatal: true }).decode(
                Uint8Array.from(binary, (character) => character.charCodeAt(0)),
              );
            };
            const text = JSON.stringify({
              ...execution,
              stdout: output(execution.stdoutBase64),
              stderr: output(execution.stderrBase64),
            });
            executionItems.push({
              id: `execution:${execution.runId}`,
              text,
              sha256: await sha256Hex(new TextEncoder().encode(text)),
            });
          } catch {
            return false;
          }
        }
        if (result.disposition === "clean") {
          if ([...requestedArtifacts].some((sha) => !coveredArtifacts.has(sha)))
            return false;
          const sourceBytes = await this.document(sourceRow, run);
          const finalBytes =
            finalRow === sourceRow
              ? sourceBytes
              : await this.document(finalRow, run);
          try {
            const source: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes),
            );
            const final: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(finalBytes),
            );
            const inventoryKeys = [
              "schemaVersion",
              "items",
              "artifacts",
              "visibilityGaps",
            ];
            const classified =
              isRecord(source) && Object.hasOwn(source, "classifications");
            if (classified) inventoryKeys.push("classifications");
            if (
              !isRecord(source) ||
              !isRecord(final) ||
              !hasKeys(source, inventoryKeys) ||
              !hasKeys(final, inventoryKeys) ||
              (classified &&
                (!validClassifications(source.classifications) ||
                  JSON.stringify(source.classifications) !==
                    JSON.stringify(final.classifications))) ||
              source.schemaVersion !== "slop-scan-inventory-v2" ||
              final.schemaVersion !== source.schemaVersion ||
              !Array.isArray(source.items) ||
              !Array.isArray(final.items) ||
              JSON.stringify(final.items) !==
                JSON.stringify([...source.items, ...executionItems]) ||
              !Array.isArray(source.artifacts) ||
              !Array.isArray(final.artifacts) ||
              source.artifacts.length !== result.artifacts.length ||
              source.artifacts.some(
                (artifact, index) =>
                  !isRecord(artifact) ||
                  (
                    [
                      "sha256",
                      "parentSha256",
                      "origin",
                      "path",
                      "type",
                    ] as const
                  ).some(
                    (field) =>
                      artifact[field] !== result.artifacts[index]?.[field],
                  ),
              ) ||
              JSON.stringify(source.artifacts) !==
                JSON.stringify(final.artifacts) ||
              !Array.isArray(source.visibilityGaps) ||
              !Array.isArray(final.visibilityGaps) ||
              final.visibilityGaps.length !== 0 ||
              JSON.stringify(
                final.visibilityGaps.slice(0, source.visibilityGaps.length),
              ) !== JSON.stringify(source.visibilityGaps)
            )
              return false;
          } catch {
            return false;
          }
        }
      }
      for (const sha of required) {
        const row = bySha.get(sha);
        if (!row) return false;
        await this.verify(row, run);
      }
      return true;
    } catch (error) {
      // A refusal (missing, pending, corrupt, expired or unconfigured
      // evidence) means "not retained"; a failed read is not a refusal.
      if (typeof (error as Partial<ApiError> | null)?.status === "number")
        return false;
      throw error;
    }
  }
  /** Retained evidence for either recorded schema; v1 keeps its closure rule. */
  async retained(result: RecordedVettingResult) {
    return isScanResult(result)
      ? this.scanRetained(
          result,
          result.reusedAssessmentId ?? result.assessmentId,
        )
      : this.complete(result);
  }
  async register(request: Request, assessment: string, runId: string) {
    const { policy } = this.configuration();
    const { body, keySha256 } = await this.signed(request, 1024 * 1024);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
    } catch {
      fail(
        400,
        "invalid_request",
        "Evidence manifest must be valid UTF-8 JSON",
      );
    }
    if (!isRecord(input))
      fail(400, "invalid_request", "Evidence manifest must be an object");
    exact(input, [
      "traceSha256",
      "objects",
      ...(Object.hasOwn(input, "assemblySha256") ? ["assemblySha256"] : []),
    ]);
    if (
      Object.hasOwn(input, "assemblySha256") &&
      (typeof input.assemblySha256 !== "string" ||
        !HEX.test(input.assemblySha256))
    )
      fail(400, "invalid_request", "Invalid canonical assembly digest");
    if (
      typeof input.traceSha256 !== "string" ||
      !HEX.test(input.traceSha256) ||
      !Array.isArray(input.objects) ||
      !input.objects.length ||
      input.objects.length > policy.maxObjects
    )
      fail(400, "invalid_request", "Invalid evidence manifest");
    const exists = await this.deps.db
      .prepare("SELECT id FROM vetting_assessments WHERE id=?")
      .bind(assessment)
      .first();
    if (!exists) fail(404, "not_found", "Assessment not found");
    const seen = new Set<string>();
    const objects = input.objects
      .map((value) => {
        if (!isRecord(value))
          fail(400, "invalid_request", "Invalid evidence object");
        exact(value, [
          "sha256",
          "sizeBytes",
          "kind",
          "label",
          "contentType",
          ...(Object.hasOwn(value, "chunks") ? ["chunks"] : []),
        ]);
        const sha = text(value.sha256, 64),
          kind = text(value.kind, 20),
          label = text(value.label, 200),
          contentType = text(value.contentType, 80);
        if (
          !HEX.test(sha) ||
          seen.has(sha) ||
          !KINDS.has(kind) ||
          ![
            "text/plain",
            "application/x-ndjson",
            "application/json",
            "application/octet-stream",
          ].includes(contentType) ||
          !Number.isSafeInteger(value.sizeBytes) ||
          Number(value.sizeBytes) < 0
        )
          fail(400, "invalid_request", "Invalid or duplicate evidence object");
        let chunks: EvidenceChunk[] | undefined;
        if (
          Number(value.sizeBytes) > EVIDENCE_CHUNK_BYTES ||
          Object.hasOwn(value, "chunks")
        ) {
          try {
            chunks = chunkLayout(value.chunks, Number(value.sizeBytes));
          } catch {
            fail(
              400,
              "invalid_request",
              "Large evidence requires an exact ordered bounded chunk layout",
            );
          }
        }
        seen.add(sha);
        return {
          sha256: sha,
          sizeBytes: Number(value.sizeBytes),
          kind,
          label,
          contentType,
          ...(chunks ? { chunks } : {}),
        };
      })
      .sort((a, b) => a.sha256.localeCompare(b.sha256));
    if (
      !objects.some((o) => o.kind === "trace" && o.sha256 === input.traceSha256)
    )
      fail(400, "invalid_request", "The exact trace object must be declared");
    if (
      input.assemblySha256 &&
      !objects.some(
        (o) => o.sha256 === input.assemblySha256 && o.kind === "manifest",
      )
    )
      fail(
        400,
        "invalid_request",
        "The exact canonical assembly manifest must be declared",
      );
    const manifest = JSON.stringify({
        traceSha256: input.traceSha256,
        ...(input.assemblySha256
          ? { assemblySha256: input.assemblySha256 }
          : {}),
        objects,
      }),
      digest = await sha256Hex(new TextEncoder().encode(manifest));
    const previous = await this.deps.db
      .prepare(
        "SELECT manifest_sha256 FROM vetting_evidence_runs WHERE assessment_id=? AND run_id=?",
      )
      .bind(assessment, runId)
      .first<{ manifest_sha256: string }>();
    if (previous) {
      if (previous.manifest_sha256 !== digest)
        fail(
          409,
          "evidence_conflict",
          "Evidence run already binds different bytes",
        );
      return json(200, {
        manifestSha256: digest,
        replayed: true,
        stored: await this.stored(objects),
      });
    }
    const at = this.deps.now();
    try {
      await this.deps.db.batch([
        this.deps.db
          .prepare(
            "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at,assembly_sha256) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            assessment,
            runId,
            input.traceSha256,
            digest,
            manifest,
            JSON.stringify(policy),
            at.toISOString(),
            new Date(
              at.getTime() + policy.postClosureRetentionSeconds * 1000,
            ).toISOString(),
            input.assemblySha256 ?? null,
          ),
        ...objects.map((o) =>
          this.deps.db
            .prepare(
              "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks,storage) VALUES(?,?,?,?,?,?,?,?,?,'content')",
            )
            .bind(
              assessment,
              runId,
              o.sha256,
              o.sizeBytes,
              o.kind,
              o.label,
              o.contentType,
              `vetting/${assessment}/${runId}/${o.sha256}`,
              o.chunks ? JSON.stringify(o.chunks) : null,
            ),
        ),
        this.deps.db
          .prepare(
            "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            this.deps.randomId(),
            `service:${keySha256}`,
            "register",
            assessment,
            runId,
            at.toISOString(),
          ),
      ]);
    } catch (error) {
      if (String(error).includes("evidence cleanup in progress"))
        fail(
          409,
          "evidence_cleanup",
          "Evidence cleanup is in progress; retry registration",
        );
      throw error;
    }
    return json(201, {
      manifestSha256: digest,
      stored: await this.stored(objects),
    });
  }
  /**
   * Digests whose content-addressed bytes (every part, for a chunked object)
   * are already present and hash correctly, so the service may reference
   * them instead of uploading again. A hint only:
   * retention still rereads and hashes every byte, and a chunked object
   * still needs this run's finalization.
   */
  private async stored(
    objects: { sha256: string; sizeBytes: number; chunks?: EvidenceChunk[] }[],
  ): Promise<string[]> {
    const { bucket } = this.configuration();
    // Reread and hash each part (one part buffered at a time), so a missing
    // or corrupt copy is uploaded again instead of referenced.
    const present = (key: string, sha: string, size: number) =>
      verifiedPart(bucket, key, sha, size).then(
        () => true,
        () => false,
      );
    const stored: string[] = [];
    for (const object of objects) {
      const key = evidenceObjectKey(object.sha256);
      let complete = true;
      for (const part of object.chunks ?? [
        { index: -1, sha256: object.sha256, sizeBytes: object.sizeBytes },
      ])
        if (
          !(await present(
            part.index === -1 ? key : chunkKey(key, part),
            part.sha256,
            part.sizeBytes,
          ))
        ) {
          complete = false;
          break;
        }
      if (complete) stored.push(object.sha256);
    }
    return stored;
  }
  /**
   * Create-only write of bytes already checked against `sha`, then a full
   * reread. A content-addressed key holds only the bytes its digest names, so
   * when the existing copy is missing or fails verification it is replaced
   * with these verified bytes; a valid copy is never overwritten. Run-scoped
   * keys keep the strict create-only rule.
   */
  private async store(
    bucket: R2Bucket,
    key: string,
    body: Uint8Array,
    sha: string,
    contentType: string,
    content: boolean,
  ) {
    const options = {
      httpMetadata: { contentType },
      customMetadata: { sha256: sha },
    };
    await bucket.put(key, body, {
      ...options,
      onlyIf: { etagDoesNotMatch: "*" },
    });
    try {
      await verifiedPart(bucket, key, sha, body.byteLength);
    } catch (error) {
      if (!content) throw error;
      // The one deliberate overwrite: verified bytes replace a missing or
      // corrupt copy at the key their own digest names.
      await bucket.put(
        key,
        body,
        options as unknown as Parameters<R2Bucket["put"]>[2],
      );
      await verifiedPart(bucket, key, sha, body.byteLength);
    }
  }
  async upload(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    const { bucket } = this.configuration();
    const { body, keySha256 } = await this.signed(
      request,
      EVIDENCE_CHUNK_BYTES,
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (
      run.expires_at !== null &&
      Date.parse(run.expires_at) <= this.deps.now().getTime()
    )
      fail(410, "evidence_expired", "Evidence upload expired");
    if (
      body.byteLength !== object.size_bytes ||
      (await sha256Hex(body)) !== sha
    )
      fail(
        422,
        "digest_mismatch",
        "Upload must match the complete declared bytes",
      );
    await this.store(
      bucket,
      evidenceLocation(object),
      body,
      sha,
      object.content_type,
      object.storage === "content",
    );
    await this.bytes(object, run);
    await this.audit(`service:${keySha256}`, "upload", assessment, runId, sha);
    return json(200, { sha256: sha, sizeBytes: body.byteLength });
  }
  async uploadChunk(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    index: number,
  ) {
    const { bucket } = this.configuration();
    const { body, keySha256 } = await this.signed(
      request,
      EVIDENCE_CHUNK_BYTES,
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    this.readable(run);
    const chunk = this.layout(object)?.[index];
    if (!chunk) fail(404, "not_found", "Declared chunk not found");
    if (
      body.byteLength !== chunk.sizeBytes ||
      (await sha256Hex(body)) !== chunk.sha256
    )
      fail(
        422,
        "digest_mismatch",
        "Upload must match the exact declared chunk bytes",
      );
    const key = chunkKey(evidenceLocation(object), chunk);
    await this.store(
      bucket,
      key,
      body,
      chunk.sha256,
      "application/octet-stream",
      object.storage === "content",
    );
    await this.audit(
      `service:${keySha256}`,
      "upload-chunk",
      assessment,
      runId,
      sha,
      `Chunk ${index}`,
    );
    return json(200, {
      sha256: chunk.sha256,
      index,
      sizeBytes: body.byteLength,
    });
  }
  async finalize(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    const { body, keySha256 } = await this.signed(request, 2);
    if (new TextDecoder().decode(body) !== "{}")
      fail(
        400,
        "invalid_request",
        "Finalization requires an empty JSON object",
      );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (!this.layout(object))
      fail(
        400,
        "invalid_request",
        "Only chunked evidence requires finalization",
      );
    await this.verify(object, run, false);
    // No partial completion state: concurrent/repeated finalization has one immutable receipt.
    const at = this.deps.now().toISOString();
    const [recorded] = await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT OR IGNORE INTO vetting_evidence_completions(assessment_id,run_id,sha256,completed_at) VALUES(?,?,?,?)",
        )
        .bind(assessment, runId, sha, at),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,created_at) SELECT ?,?,'finalize',?,?,?,? WHERE changes()=1",
        )
        .bind(
          this.deps.randomId(),
          `service:${keySha256}`,
          assessment,
          runId,
          sha,
          at,
        ),
    ]);
    return json(200, {
      sha256: sha,
      sizeBytes: object.size_bytes,
      replayed: recorded.meta?.changes !== 1,
    });
  }
  async overview(request: Request) {
    const actor = await this.operator(request);
    const query = new URL(request.url).searchParams;
    const assessment = query.get("assessmentId"),
      runId = query.get("runId");
    const runs: Run[] = [];
    if (assessment !== null || runId !== null) {
      if (!ID.test(assessment ?? "") || !ID.test(runId ?? ""))
        fail(
          400,
          "invalid_request",
          "Enter the exact assessment and run identity",
        );
      runs.push(await this.run(String(assessment), String(runId)));
    }
    const { bucket, policy } = this.configuration();
    const result = [];
    for (const run of runs) {
      const rows =
        (
          await this.deps.db
            .prepare(
              "SELECT * FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? ORDER BY kind,sha256",
            )
            .bind(run.assessment_id, run.run_id)
            .all<ObjectRow>()
        ).results ?? [];
      const objects = [];
      for (const row of rows) {
        const chunks = this.layout(row);
        const head = chunks
          ? await this.deps.db
              .prepare(
                "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
              )
              .bind(run.assessment_id, run.run_id, row.sha256)
              .first<{ completed_at: string }>()
          : await bucket.head(evidenceLocation(row));
        const state =
          run.expires_at !== null &&
          Date.parse(run.expires_at) <= this.deps.now().getTime()
            ? "expired"
            : !head
              ? chunks
                ? "pending"
                : "missing"
              : !chunks &&
                  (("size" in head && head.size !== row.size_bytes) ||
                    ("customMetadata" in head &&
                      (
                        head.customMetadata as
                          | Record<string, string>
                          | undefined
                      )?.sha256 !== row.sha256))
                ? "corrupt"
                : "stored-unverified";
        objects.push({
          sha256: row.sha256,
          sizeBytes: row.size_bytes,
          kind: row.kind,
          label: row.label,
          contentType: row.content_type,
          streamed: row.size_bytes > EVIDENCE_CHUNK_BYTES,
          state,
        });
      }
      let assembly: {
        retained: boolean;
        state: string;
        scanReady: false;
        reason: string;
      };
      try {
        const closure = await this.assemblyClosure(
          run.assessment_id,
          run.run_id,
        );
        assembly = {
          retained: true,
          state: closure.state,
          scanReady: false,
          reason: "Runtime image and toolchain pins are not retained here.",
        };
      } catch {
        assembly = {
          retained: false,
          state: "unavailable",
          scanReady: false,
          reason:
            "Captured evidence is missing, invalid, mismatched or expired.",
        };
      }
      result.push({
        assembly,
        assessmentId: run.assessment_id,
        runId: run.run_id,
        traceSha256: run.trace_sha256,
        manifestSha256: run.manifest_sha256,
        createdAt: run.created_at,
        expiresAt: run.expires_at,
        permanentAdmissionEvidence: run.permanent_admission === 1,
        policy: JSON.parse(run.policy),
        objects,
      });
    }
    await this.audit(
      actor.githubId,
      "list",
      "*",
      null,
      null,
      "Inspect registered vetting evidence",
    );
    return json(200, {
      runs: result,
      policy,
      retentionBoundary:
        "Access expiry is enforced here. Backups, raw-evidence deletion and legal holds are separate from this console; it does not verify or execute them.",
    });
  }
  async grant(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    download = false,
  ) {
    const actor = await this.operator(request),
      body = await readJsonObject(request);
    exact(body, ["reason"]);
    const reason = text(body.reason);
    if (reason.trim().length < 8)
      fail(
        400,
        "invalid_request",
        "Explain why access is needed (8 to 500 characters)",
      );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    if (!download && object.size_bytes > EVIDENCE_CHUNK_BYTES)
      fail(
        413,
        "evidence_oversize",
        "Large evidence requires a native streamed download grant",
      );
    // Do not grant access to absent, expired, oversized or changed evidence.
    await this.verify(object, run);
    const { readGrantDurationSeconds } = this.configuration().policy;
    const token = crypto.randomUUID() + crypto.randomUUID(),
      hash = await sha256Hex(new TextEncoder().encode(token));
    await this.deps.db.batch([
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_grants(token_hash,assessment_id,run_id,sha256,operator_github_id,reason,expires_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          hash,
          assessment,
          runId,
          sha,
          actor.githubId,
          reason,
          new Date(
            this.deps.now().getTime() + readGrantDurationSeconds * 1000,
          ).toISOString(),
        ),
      this.deps.db
        .prepare(
          "INSERT INTO vetting_evidence_audit(id,actor,action,assessment_id,run_id,sha256,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.deps.randomId(),
          actor.githubId,
          "grant",
          assessment,
          runId,
          sha,
          reason,
          this.deps.now().toISOString(),
        ),
    ]);
    if (download) {
      const response = json(201, {
        expiresInSeconds: readGrantDurationSeconds,
      });
      response.headers.set(
        "set-cookie",
        this.downloadCookie(
          assessment,
          runId,
          sha,
          token,
          readGrantDurationSeconds,
        ),
      );
      return response;
    }
    return json(201, {
      grant: token,
      expiresInSeconds: readGrantDurationSeconds,
    });
  }
  private async consume(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
    token: string,
  ) {
    const actor = await this.operator(request);
    if (token.length > 100) fail(403, "grant_invalid", "Invalid read grant");
    const hash = await sha256Hex(new TextEncoder().encode(token)),
      at = this.deps.now().toISOString();
    const grant = await this.deps.db
      .prepare(
        "UPDATE vetting_evidence_grants SET consumed_at=? WHERE token_hash=? AND assessment_id=? AND run_id=? AND sha256=? AND operator_github_id=? AND consumed_at IS NULL AND expires_at>? RETURNING reason",
      )
      .bind(at, hash, assessment, runId, sha, actor.githubId, at)
      .first<{ reason: string }>();
    if (!grant)
      fail(
        403,
        "grant_invalid",
        "Read grant is expired, used or belongs to another operator or object",
      );
    await this.audit(
      actor.githubId,
      "read-attempt",
      assessment,
      runId,
      sha,
      grant.reason,
    );
    return { actor, reason: grant.reason };
  }
  async read(request: Request, assessment: string, runId: string, sha: string) {
    const { actor, reason } = await this.consume(
      request,
      assessment,
      runId,
      sha,
      request.headers.get("x-vetting-read-grant") ?? "",
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha),
      bytes = await this.bytes(object, run);
    await this.audit(actor.githubId, "read", assessment, runId, sha, reason);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        ...headers,
        "content-type": object.content_type,
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="${sha}.bin"`,
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }
  private downloadCookie(
    assessment: string,
    runId: string,
    sha: string,
    token = "",
    maxAge = 0,
  ) {
    const path = `/api/v1/operator/vetting-evidence/${assessment}/${runId}/${sha}/download`;
    return `__Secure-vetting-read-grant=${token}; Path=${path}; Max-Age=${token ? maxAge : 0}; Secure; HttpOnly; SameSite=Strict`;
  }
  async download(
    request: Request,
    assessment: string,
    runId: string,
    sha: string,
  ) {
    if (
      request.headers.get("sec-fetch-site") !== "same-origin" ||
      request.headers.has("range")
    )
      fail(
        403,
        "origin_forbidden",
        "Downloads require a fresh same-origin browser request without ranges",
      );
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Secure-vetting-read-grant="));
    if (cookies.length !== 1)
      fail(403, "grant_invalid", "Exactly one download grant is required");
    const token = cookies[0].slice("__Secure-vetting-read-grant=".length);
    const { actor, reason } = await this.consume(
      request,
      assessment,
      runId,
      sha,
      token,
    );
    const run = await this.run(assessment, runId),
      object = await this.object(assessment, runId, sha);
    this.readable(run);
    const chunks = this.layout(object);
    if (
      chunks &&
      !(await this.deps.db
        .prepare(
          "SELECT completed_at FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=? AND sha256=?",
        )
        .bind(assessment, runId, sha)
        .first())
    )
      fail(409, "evidence_pending", "Whole-file verification is incomplete");
    let index = 0,
      started = false,
      ended = false;
    const audit = (action: string) =>
      this.audit(actor.githubId, action, assessment, runId, sha, reason);
    await audit("download-authorized");
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            const bucket = this.readable(run);
            if (index >= (chunks?.length ?? 1)) {
              await audit("download-finished");
              if (ended) return;
              ended = true;
              controller.close();
              return;
            }
            const part = chunks?.[index];
            const bytes = part
              ? await verifiedPart(
                  bucket,
                  chunkKey(evidenceLocation(object), part),
                  part.sha256,
                  part.sizeBytes,
                )
              : await this.bytes(object, run);
            if (ended) return;
            if (!started) {
              await audit("download-started");
              started = true;
            }
            if (ended) return;
            index++;
            controller.enqueue(bytes);
          } catch (error) {
            if (ended) return;
            ended = true;
            try {
              await audit("download-failed");
            } finally {
              controller.error(error);
            }
          }
        },
        cancel: async () => {
          if (!ended) {
            ended = true;
            await audit("download-cancelled");
          }
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, {
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(object.size_bytes),
        "content-disposition": `attachment; filename="${sha}.bin"`,
        "content-security-policy": "default-src 'none'; sandbox",
        "accept-ranges": "none",
      },
    });
  }
  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname
      .split("/")
      .filter(Boolean)
      .slice(2);
    const service = path[0] === "vetting" && path[1] === "evidence",
      operator = path[0] === "operator" && path[1] === "vetting-evidence";
    if (!service && !operator) return null;
    try {
      if (
        operator &&
        request.method !== "GET" &&
        !isSameOriginJsonWrite(request)
      )
        fail(403, "origin_forbidden", "Requests must come from this site");
      if (operator && path.length === 2 && request.method === "GET")
        return await this.overview(request);
      const [, , assessment, run, sha, action] = path;
      if (
        operator &&
        path.length === 4 &&
        run === "close" &&
        request.method === "POST" &&
        ID.test(assessment ?? "")
      )
        return await this.closeCase(request, assessment);
      if (!ID.test(assessment ?? "") || !ID.test(run ?? ""))
        fail(404, "not_found", "Evidence route not found");
      if (service && path.length === 4 && request.method === "POST")
        return await this.register(request, assessment, run);
      if (!HEX.test(sha ?? ""))
        fail(404, "not_found", "Evidence route not found");
      if (service && path.length === 5 && request.method === "PUT")
        return await this.upload(request, assessment, run, sha);
      if (
        service &&
        path.length === 7 &&
        action === "chunks" &&
        // Any declared part index; the layout bounds it, not a size cap.
        /^(?:0|[1-9][0-9]{0,8})$/u.test(path[6]) &&
        request.method === "PUT"
      )
        return await this.uploadChunk(
          request,
          assessment,
          run,
          sha,
          Number(path[6]),
        );
      if (
        service &&
        path.length === 6 &&
        action === "finalize" &&
        request.method === "POST"
      )
        return await this.finalize(request, assessment, run, sha);
      if (
        operator &&
        path.length === 6 &&
        action === "download-grant" &&
        request.method === "POST"
      )
        return await this.grant(request, assessment, run, sha, true);
      if (operator && path.length === 6 && action === "download") {
        let response: Response;
        try {
          if (request.method !== "GET")
            fail(405, "method_not_allowed", "Native downloads require GET");
          response = await this.download(request, assessment, run, sha);
        } catch (error) {
          response = apiErrorResponse(error, {
            label: "vetting evidence API failure",
            respond: json,
          });
        }
        response.headers.set(
          "set-cookie",
          this.downloadCookie(assessment, run, sha),
        );
        return response;
      }
      if (
        operator &&
        path.length === 6 &&
        action === "grant" &&
        request.method === "POST"
      )
        return await this.grant(request, assessment, run, sha);
      if (
        operator &&
        path.length === 6 &&
        action === "body" &&
        request.method === "GET"
      )
        return await this.read(request, assessment, run, sha);
      return json(404, { error: "not_found" });
    } catch (error) {
      return apiErrorResponse(error, {
        label: "vetting evidence API failure",
        respond: json,
        // Unavailable-evidence refusals tell the caller what to configure.
        publicMessage: (status) => status === 503,
      });
    }
  }
}
