// spec/contributor/evidence.md, "A signed receipt binds the exact disclosure and either no trace or the stored trace"; spec/contributor/evidence.md, "A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key"; spec/contributor/workflow.md, "The attribution marker uses the published identity record, refuses placeholder identity and keeps legacy markers readable"
import { Schema } from "effect";
import { isExactClientIdentifier, isExactModelIdentifier, isExactProviderIdentifier } from "../identity/model.schema.ts";
import { CanonicalUint, Count, ExactUtc, Sha256 } from "./formats.schema.ts";
import { type Disclosure, type JoinVerdict, type UsageVerdict, policyJoin, usageVerdict } from "./policy.ts";
import { DevicePublicKey, DeviceSignature, PolicyRevision, type ProjectRunReceipt, RunId, type RunMarker, ServerRunId, SkillRevision, TRACE_AUTHORITY } from "./receipt.schema.ts";

export interface ReceiptProject {
  readonly id: string;
  readonly repositories: ReadonlyArray<string>;
  readonly skillSourcePath: string;
}

export type ReceiptRegistry = ReadonlyArray<ReceiptProject>;

export interface ReceiptPolicyProject {
  readonly id: string;
  readonly terms: {
    readonly revision: string;
    readonly receiptPolicy:
      | { readonly state: "pending-authority-activation"; readonly activatedAt: null; readonly bindings: readonly [] }
      | {
        readonly state: "active";
        readonly activatedAt: string;
        readonly bindings: ReadonlyArray<{
          readonly policyRevision: string;
          readonly licenseSha256: string;
          readonly inboundTermsSha256: string | null;
          readonly prizeRulesSha256: string | null;
          readonly activatedAt: string;
        }>;
      };
    readonly repositoryLicense: { readonly fileSha256: string | null };
    readonly inbound: { readonly fileSha256: string | null };
    readonly externalPrize: { readonly rulesSha256: string | null } | null;
  };
}

export type Parsed<A> = { readonly kind: "valid"; readonly value: A } | { readonly kind: "invalid"; readonly reason: string };

class Refusal {
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

function parsed<A>(parse: () => A): Parsed<A> {
  try {
    return { kind: "valid", value: parse() };
  } catch (error) {
    if (error instanceof Refusal) return { kind: "invalid", reason: error.reason };
    throw error;
  }
}

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Fields, keys: ReadonlyArray<string>, field: string) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) refuse(`${field} has unexpected or missing fields`);
}

function checked<A>(schema: Schema.Schema<A>, value: unknown, reason: string): A {
  return Schema.is(schema)(value) ? value : refuse(reason);
}

const isoTimestamp = (value: unknown, path: string) => checked(ExactUtc, value, `${path} must be a canonical UTC ISO timestamp`);
const digest = (value: unknown, path: string) => checked(Sha256, value, `${path} must be a lowercase SHA-256 digest`);
const optionalDigest = (value: unknown, path: string) => (value === null ? null : digest(value, path));
const count = (value: unknown, path: string) => checked(Count, value, `${path} must be a non-negative safe integer`);
const declared = (valid: (value: unknown) => value is string, value: unknown, path: string) =>
  valid(value) ? value : refuse(`${path} must be an exact non-placeholder identifier`);

function projectNamed(registry: ReceiptRegistry, id: unknown) {
  return typeof id === "string" ? registry.findLast((project) => project.id === id) : undefined;
}

function projectOfRepository(registry: ReceiptRegistry, repositoryId: unknown) {
  if (typeof repositoryId !== "string") return undefined;
  const key = repositoryId.toLowerCase();
  return registry.findLast((project) => project.repositories.some((repository) => repository.toLowerCase() === key));
}

const USAGE_REFUSALS: Record<Exclude<UsageVerdict, "Consistent">, string> = {
  UnavailableNotZero: "unavailable usage must contain zero values",
  AvailableEmpty: "available usage must contain tokens and sessions",
};

function markerOrRefusal(value: unknown, registry: ReceiptRegistry): RunMarker {
  if (!isRecord(value)) refuse("run marker must be an object");
  exactKeys(value, ["client", "model", "provider", "run", "skill_revision"], "run marker");
  const run = value.run;
  if (!isRecord(run)) refuse("run marker.run must be an object");
  const hasTraceUpload = Object.hasOwn(run, "trace_upload");
  const hasPolicyAcknowledgement = Object.hasOwn(run, "policy_acknowledgement");
  exactKeys(run, [
    "completed_at", "device_key_id", "device_public_key", "device_signature", "project",
    ...(hasPolicyAcknowledgement ? ["policy_acknowledgement"] : []),
    "repository", "run_id", "schema_version", "signature_algorithm", "skill_sha256", "started_at", "trajectory_sha256",
    ...(hasTraceUpload ? ["trace_upload"] : []),
    "usage",
  ], "run marker.run");
  const usage = run.usage;
  if (!isRecord(usage)) refuse("run marker.run.usage must be an object");
  exactKeys(usage, [
    "cache_creation_tokens", "cache_read_tokens", "confidence", "cost_micro_usd", "input_tokens", "output_tokens",
    "session_count", "source", "total_tokens",
  ], "run marker.run.usage");

  const project = projectNamed(registry, run.project) ?? refuse("run marker project is not registered");
  if (projectOfRepository(registry, run.repository)?.id !== project.id) refuse("run marker repository does not belong to the project");
  const schemaVersion = run.schema_version === "1" || run.schema_version === "2" ? run.schema_version : refuse("run marker schema_version is unsupported");
  if ((schemaVersion === "2") !== hasPolicyAcknowledgement) refuse("run marker policy acknowledgement does not match its schema");
  const runId = checked(RunId, run.run_id, "run marker run_id is invalid");
  const startedAt = isoTimestamp(run.started_at, "run marker.started_at");
  const completedAt = isoTimestamp(run.completed_at, "run marker.completed_at");
  if (Date.parse(completedAt) < Date.parse(startedAt)) refuse("run marker completed_at precedes started_at");
  const client = declared(isExactClientIdentifier, value.client, "run marker.client");
  const provider = declared(isExactProviderIdentifier, value.provider, "run marker.provider");
  const model = declared(isExactModelIdentifier, value.model, "run marker.model");
  const skillRevision = Schema.is(SkillRevision)(value.skill_revision) && value.skill_revision.endsWith(`:${project.skillSourcePath}`)
    ? value.skill_revision
    : refuse("run marker skill_revision is not the project skill");
  const { source: declaredSource, confidence: declaredConfidence } = usage;
  const source = declaredSource === "ccusage-session-v20" || declaredSource === "none" ? declaredSource : refuse("run marker usage source is unsupported");
  const confidence = declaredConfidence === "bounded" || declaredConfidence === "exact" || declaredConfidence === "unavailable"
    ? declaredConfidence
    : refuse("run marker usage confidence is invalid");
  if (run.signature_algorithm !== "ed25519") refuse("run marker signature algorithm is unsupported");
  const figures: RunMarker["run"]["usage"] = {
    source,
    confidence,
    input_tokens: count(usage.input_tokens, "run marker.usage.input_tokens"),
    output_tokens: count(usage.output_tokens, "run marker.usage.output_tokens"),
    cache_creation_tokens: count(usage.cache_creation_tokens, "run marker.usage.cache_creation_tokens"),
    cache_read_tokens: count(usage.cache_read_tokens, "run marker.usage.cache_read_tokens"),
    total_tokens: count(usage.total_tokens, "run marker.usage.total_tokens"),
    cost_micro_usd: checked(CanonicalUint, usage.cost_micro_usd, "run marker.usage.cost_micro_usd must be canonical integer minor units"),
    session_count: count(usage.session_count, "run marker.usage.session_count"),
  };
  const verdict = usageVerdict({
    measured: source === "ccusage-session-v20",
    available: confidence !== "unavailable",
    inputTokens: figures.input_tokens,
    outputTokens: figures.output_tokens,
    cacheCreationTokens: figures.cache_creation_tokens,
    cacheReadTokens: figures.cache_read_tokens,
    totalTokens: figures.total_tokens,
    costIsZero: figures.cost_micro_usd === "0",
    sessionCount: figures.session_count,
  });
  if (verdict !== "Consistent") refuse(USAGE_REFUSALS[verdict]);

  const trajectorySha256 = optionalDigest(run.trajectory_sha256, "run marker.trajectory_sha256");
  const traceUpload = hasTraceUpload ? traceUploadOf(run.trace_upload, trajectorySha256) : undefined;
  const policyAcknowledgement = hasPolicyAcknowledgement ? acknowledgementOf(run.policy_acknowledgement, startedAt, completedAt) : undefined;
  const skillSha256 = digest(run.skill_sha256, "run marker.skill_sha256");
  const devicePublicKey = checked(DevicePublicKey, run.device_public_key, "run marker.device_public_key must be unpadded base64url");
  const deviceKeyId = digest(run.device_key_id, "run marker.device_key_id");
  const deviceSignature = checked(DeviceSignature, run.device_signature, "run marker.device_signature must be unpadded base64url");

  return {
    provider,
    model,
    client,
    skill_revision: skillRevision,
    run: {
      schema_version: schemaVersion,
      run_id: runId,
      project: project.id,
      repository: run.repository as string,
      started_at: startedAt,
      completed_at: completedAt,
      skill_sha256: skillSha256,
      ...(policyAcknowledgement ? { policy_acknowledgement: policyAcknowledgement } : {}),
      usage: figures,
      trajectory_sha256: trajectorySha256,
      ...(traceUpload ? { trace_upload: traceUpload } : {}),
      signature_algorithm: "ed25519",
      device_public_key: devicePublicKey,
      device_key_id: deviceKeyId,
      device_signature: deviceSignature,
    },
  };
}

function traceUploadOf(value: unknown, trajectorySha256: string | null) {
  if (!isRecord(value)) refuse("run marker.trace_upload must be an object");
  exactKeys(value, ["authority", "object_id", "server_run_id", "sha256"], "run marker.trace_upload");
  const sha256 = digest(value.sha256, "run marker.trace_upload.sha256");
  const serverRunId = checked(ServerRunId, value.server_run_id, "run marker.trace_upload.server_run_id must be a concrete identifier");
  if (value.authority !== TRACE_AUTHORITY || value.object_id !== `sha256:${sha256}` || trajectorySha256 !== sha256) {
    refuse("run marker trace upload evidence does not match");
  }
  return { authority: TRACE_AUTHORITY, server_run_id: serverRunId, object_id: `sha256:${sha256}`, sha256 } as const;
}

function acknowledgementOf(value: unknown, startedAt: string, completedAt: string) {
  if (!isRecord(value)) refuse("run marker.policy_acknowledgement must be an object");
  exactKeys(value, ["acknowledged_at", "inbound_terms_sha256", "license_sha256", "policy_revision", "prize_rules_sha256"], "run marker.policy_acknowledgement");
  const acknowledgement = {
    policy_revision: checked(PolicyRevision, value.policy_revision, "run marker.policy_acknowledgement.policy_revision must be a concrete identifier"),
    license_sha256: optionalDigest(value.license_sha256, "run marker.policy_acknowledgement.license_sha256"),
    inbound_terms_sha256: optionalDigest(value.inbound_terms_sha256, "run marker.policy_acknowledgement.inbound_terms_sha256"),
    prize_rules_sha256: optionalDigest(value.prize_rules_sha256, "run marker.policy_acknowledgement.prize_rules_sha256"),
    acknowledged_at: isoTimestamp(value.acknowledged_at, "run marker.policy_acknowledgement.acknowledged_at"),
  };
  const acknowledgedAt = Date.parse(acknowledgement.acknowledged_at);
  if (acknowledgedAt < Date.parse(startedAt) || acknowledgedAt > Date.parse(completedAt)) {
    refuse("run marker policy acknowledgement must fall within the run");
  }
  return acknowledgement;
}

function markerFromPublished(value: unknown): unknown {
  if (!isRecord(value)) refuse("run receipt must be an object");
  const hasTraceUpload = Object.hasOwn(value, "traceUpload");
  const hasPolicyAcknowledgement = Object.hasOwn(value, "policyAcknowledgement");
  exactKeys(value, [
    "client", "completedAt", "deviceKeyId", "devicePublicKey", "deviceSignature", "model",
    ...(hasPolicyAcknowledgement ? ["policyAcknowledgement"] : []),
    "projectId", "provider", "repositoryId", "runId", "schemaVersion", "signatureAlgorithm", "skillRevision", "skillSha256",
    "startedAt", "trajectorySha256",
    ...(hasTraceUpload ? ["traceUpload"] : []),
    "usage",
  ], "run receipt");
  const usage = value.usage;
  if (!isRecord(usage)) refuse("run receipt.usage must be an object");
  exactKeys(usage, [
    "cacheCreationTokens", "cacheReadTokens", "confidence", "costMicroUsd", "inputTokens", "outputTokens", "sessionCount",
    "source", "totalTokens",
  ], "run receipt.usage");
  const acknowledgement = value.policyAcknowledgement;
  const traceUpload = value.traceUpload;
  return {
    provider: value.provider,
    model: value.model,
    client: value.client,
    skill_revision: value.skillRevision,
    run: {
      schema_version: value.schemaVersion,
      run_id: value.runId,
      project: value.projectId,
      repository: value.repositoryId,
      started_at: value.startedAt,
      completed_at: value.completedAt,
      skill_sha256: value.skillSha256,
      ...(hasPolicyAcknowledgement && isRecord(acknowledgement)
        ? {
          policy_acknowledgement: {
            policy_revision: acknowledgement.policyRevision,
            license_sha256: acknowledgement.licenseSha256,
            inbound_terms_sha256: acknowledgement.inboundTermsSha256,
            prize_rules_sha256: acknowledgement.prizeRulesSha256,
            acknowledged_at: acknowledgement.acknowledgedAt,
          },
        }
        : {}),
      usage: {
        source: usage.source,
        confidence: usage.confidence,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_creation_tokens: usage.cacheCreationTokens,
        cache_read_tokens: usage.cacheReadTokens,
        total_tokens: usage.totalTokens,
        cost_micro_usd: usage.costMicroUsd,
        session_count: usage.sessionCount,
      },
      trajectory_sha256: value.trajectorySha256,
      ...(hasTraceUpload && isRecord(traceUpload)
        ? {
          trace_upload: {
            authority: traceUpload.authority,
            server_run_id: traceUpload.serverRunId,
            object_id: traceUpload.objectId,
            sha256: traceUpload.sha256,
          },
        }
        : {}),
      signature_algorithm: value.signatureAlgorithm,
      device_public_key: value.devicePublicKey,
      device_key_id: value.deviceKeyId,
      device_signature: value.deviceSignature,
    },
  };
}

/** @throws {never} */
export function receiptOf(marker: RunMarker): ProjectRunReceipt {
  const { run } = marker;
  const acknowledgement = run.policy_acknowledgement;
  const upload = run.trace_upload;
  return {
    schemaVersion: run.schema_version,
    runId: run.run_id,
    projectId: run.project,
    repositoryId: run.repository,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    provider: marker.provider,
    model: marker.model,
    client: marker.client,
    skillRevision: marker.skill_revision,
    skillSha256: run.skill_sha256,
    ...(acknowledgement
      ? {
        policyAcknowledgement: {
          policyRevision: acknowledgement.policy_revision,
          licenseSha256: acknowledgement.license_sha256,
          inboundTermsSha256: acknowledgement.inbound_terms_sha256,
          prizeRulesSha256: acknowledgement.prize_rules_sha256,
          acknowledgedAt: acknowledgement.acknowledged_at,
        },
      }
      : {}),
    usage: {
      source: run.usage.source,
      confidence: run.usage.confidence,
      inputTokens: run.usage.input_tokens,
      outputTokens: run.usage.output_tokens,
      cacheCreationTokens: run.usage.cache_creation_tokens,
      cacheReadTokens: run.usage.cache_read_tokens,
      totalTokens: run.usage.total_tokens,
      costMicroUsd: run.usage.cost_micro_usd,
      sessionCount: run.usage.session_count,
    },
    trajectorySha256: run.trajectory_sha256,
    traceUpload: upload ? { authority: upload.authority, serverRunId: upload.server_run_id, objectId: upload.object_id, sha256: upload.sha256 } : null,
    signatureAlgorithm: run.signature_algorithm,
    devicePublicKey: run.device_public_key,
    deviceKeyId: run.device_key_id,
    deviceSignature: run.device_signature,
  };
}

/** @throws {never} */
export function markerOf(receipt: ProjectRunReceipt): RunMarker {
  const acknowledgement = receipt.policyAcknowledgement;
  const upload = receipt.traceUpload;
  return {
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    skill_revision: receipt.skillRevision,
    run: {
      schema_version: receipt.schemaVersion,
      run_id: receipt.runId,
      project: receipt.projectId,
      repository: receipt.repositoryId,
      started_at: receipt.startedAt,
      completed_at: receipt.completedAt,
      skill_sha256: receipt.skillSha256,
      ...(acknowledgement
        ? {
          policy_acknowledgement: {
            policy_revision: acknowledgement.policyRevision,
            license_sha256: acknowledgement.licenseSha256,
            inbound_terms_sha256: acknowledgement.inboundTermsSha256,
            prize_rules_sha256: acknowledgement.prizeRulesSha256,
            acknowledged_at: acknowledgement.acknowledgedAt,
          },
        }
        : {}),
      usage: {
        source: receipt.usage.source,
        confidence: receipt.usage.confidence,
        input_tokens: receipt.usage.inputTokens,
        output_tokens: receipt.usage.outputTokens,
        cache_creation_tokens: receipt.usage.cacheCreationTokens,
        cache_read_tokens: receipt.usage.cacheReadTokens,
        total_tokens: receipt.usage.totalTokens,
        cost_micro_usd: receipt.usage.costMicroUsd,
        session_count: receipt.usage.sessionCount,
      },
      trajectory_sha256: receipt.trajectorySha256,
      ...(upload ? { trace_upload: { authority: upload.authority, server_run_id: upload.serverRunId, object_id: upload.objectId, sha256: upload.sha256 } } : {}),
      signature_algorithm: receipt.signatureAlgorithm,
      device_public_key: receipt.devicePublicKey,
      device_key_id: receipt.deviceKeyId,
      device_signature: receipt.deviceSignature,
    },
  };
}

/** @throws {never} */
export function parseRunMarker(value: unknown, registry: ReceiptRegistry): Parsed<ProjectRunReceipt> {
  return parsed(() => receiptOf(markerOrRefusal(value, registry)));
}

/** @throws {never} */
export function parseRunReceipt(value: unknown, registry: ReceiptRegistry): Parsed<ProjectRunReceipt> {
  return parsed(() => receiptOf(markerOrRefusal(markerFromPublished(value), registry)));
}

/** @throws {never} */
export function signingPayload(receipt: ProjectRunReceipt): string {
  const { provider, model, client, skill_revision, run: { device_signature: _signature, ...run } } = markerOf(receipt);
  return JSON.stringify({ provider, model, client, skill_revision, run });
}

const JOIN_REFUSALS: Record<Exclude<JoinVerdict, "Joined">, string> = {
  OtherProject: "run receipt policy project does not match",
  LegacyAfterActivation: "v1 run receipt is not allowed after project policy activation",
  DisclosureMismatch: "run receipt policy acknowledgement does not match the disclosed project policy",
  StartedBeforeActivation: "v2 run receipt started before project policy activation",
  PinnedMismatch: "run receipt policy acknowledgement does not match the pinned project policy",
};

const disclosure = (
  policyRevision: string,
  licenseSha256: string | null,
  inboundTermsSha256: string | null,
  prizeRulesSha256: string | null,
): Disclosure => ({
  policyRevision,
  licenseSha256: licenseSha256 ?? "",
  inboundTermsSha256: inboundTermsSha256 ?? "",
  prizeRulesSha256: prizeRulesSha256 ?? "",
});

/** @throws {never} */
export function joinPolicy(receipt: ProjectRunReceipt, project: ReceiptPolicyProject): Parsed<ProjectRunReceipt> {
  const { terms } = project;
  const activation = terms.receiptPolicy;
  const acknowledgement = receipt.policyAcknowledgement;
  const verdict = policyJoin({
    sameProject: receipt.projectId === project.id,
    legacy: receipt.schemaVersion === "1",
    acknowledged: acknowledgement !== undefined,
    acknowledgement: acknowledgement
      ? disclosure(acknowledgement.policyRevision, acknowledgement.licenseSha256, acknowledgement.inboundTermsSha256, acknowledgement.prizeRulesSha256)
      : disclosure("", null, null, null),
    startedAt: Date.parse(receipt.startedAt),
    completedAt: Date.parse(receipt.completedAt),
    active: activation.state === "active",
    activatedAt: activation.state === "active" ? Date.parse(activation.activatedAt) : 0,
    disclosed: disclosure(terms.revision, terms.repositoryLicense.fileSha256, terms.inbound.fileSha256, terms.externalPrize?.rulesSha256 ?? null),
    bindings: activation.bindings.map((binding) => ({
      disclosure: disclosure(binding.policyRevision, binding.licenseSha256, binding.inboundTermsSha256, binding.prizeRulesSha256),
      activatedAt: Date.parse(binding.activatedAt),
    })),
  });
  return verdict === "Joined" ? { kind: "valid", value: receipt } : { kind: "invalid", reason: JOIN_REFUSALS[verdict] };
}
