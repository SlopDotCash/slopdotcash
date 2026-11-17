// spec/contributor/evidence.md, "A signed receipt binds the exact disclosure and either no trace or the stored trace"; spec/contributor/evidence.md, "A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key"
import { Schema } from "effect";
import { ClientIdentifier, ModelIdentifier, ProviderIdentifier } from "../identity/model.schema.ts";
import { CanonicalUint, Count, ExactUtc, Sha256, base64url, concreteIdentifier } from "./formats.schema.ts";

export const TRACE_AUTHORITY = "https://api.slop.cash";

export const SchemaVersion = Schema.Literals(["1", "2"]);

export const UsageSource = Schema.Literals(["ccusage-session-v20", "none"]);

export const UsageConfidence = Schema.Literals(["bounded", "exact", "unavailable"]);

export const RunId = Schema.String.check(Schema.isPattern(/^run_[0-9A-HJKMNP-TV-Z]{26}$/));

export const SkillRevision = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+@[0-9a-fA-F]{40}:[^\s`]+$/));

export const PolicyRevision = concreteIdentifier(80);

export const ServerRunId = concreteIdentifier(160);

export const TraceObjectId = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));

export const DevicePublicKey = base64url(40);

export const DeviceSignature = base64url(64);

export const RunUsage = Schema.Struct({
  source: UsageSource,
  confidence: UsageConfidence,
  inputTokens: Count,
  outputTokens: Count,
  cacheCreationTokens: Count,
  cacheReadTokens: Count,
  totalTokens: Count,
  costMicroUsd: CanonicalUint,
  sessionCount: Count,
});

export const PolicyAcknowledgement = Schema.Struct({
  policyRevision: PolicyRevision,
  licenseSha256: Schema.NullOr(Sha256),
  inboundTermsSha256: Schema.NullOr(Sha256),
  prizeRulesSha256: Schema.NullOr(Sha256),
  acknowledgedAt: ExactUtc,
});

export const TraceUpload = Schema.Struct({
  authority: Schema.Literal(TRACE_AUTHORITY),
  serverRunId: ServerRunId,
  objectId: TraceObjectId,
  sha256: Sha256,
});

export const ProjectRunReceipt = Schema.Struct({
  schemaVersion: SchemaVersion,
  runId: RunId,
  projectId: Schema.String,
  repositoryId: Schema.String,
  startedAt: ExactUtc,
  completedAt: ExactUtc,
  provider: ProviderIdentifier,
  model: ModelIdentifier,
  client: ClientIdentifier,
  skillRevision: SkillRevision,
  skillSha256: Sha256,
  policyAcknowledgement: Schema.optionalKey(PolicyAcknowledgement),
  usage: RunUsage,
  trajectorySha256: Schema.NullOr(Sha256),
  traceUpload: Schema.NullOr(TraceUpload),
  signatureAlgorithm: Schema.Literal("ed25519"),
  devicePublicKey: DevicePublicKey,
  deviceKeyId: Sha256,
  deviceSignature: DeviceSignature,
});

export type ProjectRunReceipt = typeof ProjectRunReceipt.Type;

export const RunMarker = Schema.Struct({
  provider: ProviderIdentifier,
  model: ModelIdentifier,
  client: ClientIdentifier,
  skill_revision: SkillRevision,
  run: Schema.Struct({
    schema_version: SchemaVersion,
    run_id: RunId,
    project: Schema.String,
    repository: Schema.String,
    started_at: ExactUtc,
    completed_at: ExactUtc,
    skill_sha256: Sha256,
    policy_acknowledgement: Schema.optionalKey(Schema.Struct({
      policy_revision: PolicyRevision,
      license_sha256: Schema.NullOr(Sha256),
      inbound_terms_sha256: Schema.NullOr(Sha256),
      prize_rules_sha256: Schema.NullOr(Sha256),
      acknowledged_at: ExactUtc,
    })),
    usage: Schema.Struct({
      source: UsageSource,
      confidence: UsageConfidence,
      input_tokens: Count,
      output_tokens: Count,
      cache_creation_tokens: Count,
      cache_read_tokens: Count,
      total_tokens: Count,
      cost_micro_usd: CanonicalUint,
      session_count: Count,
    }),
    trajectory_sha256: Schema.NullOr(Sha256),
    trace_upload: Schema.optionalKey(Schema.Struct({
      authority: Schema.Literal(TRACE_AUTHORITY),
      server_run_id: ServerRunId,
      object_id: TraceObjectId,
      sha256: Sha256,
    })),
    signature_algorithm: Schema.Literal("ed25519"),
    device_public_key: DevicePublicKey,
    device_key_id: Sha256,
    device_signature: DeviceSignature,
  }),
});

export type RunMarker = typeof RunMarker.Type;
