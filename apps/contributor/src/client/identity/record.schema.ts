// spec/contributor/workflow.md, "Submission requires exact attribution and a fresh pre-submission read"
import { Result, Schema } from "effect";
import { ExactUtc, Sha1, Sha256 } from "../receipts/formats.schema.ts";

const renamed = <const Legacy extends string, const Slop extends string>(legacy: Legacy, slop: Slop) =>
  Schema.Struct({ legacy: Schema.Literal(legacy), slop: Schema.Literal(slop) });

export const Identifiers = Schema.Struct({
  contributionMarker: Schema.Struct({
    legacy: Schema.Tuple([
      Schema.Literal("eliza-computer-attribution:v1"),
      Schema.Literal("elizaos-contribution-attribution:v1"),
      Schema.Literal("elizaos-contribution-attribution:v2"),
    ]),
    slop: Schema.Literal("slop-contribution-attribution:v1"),
  }),
  installerAuthorization: renamed(".gitarmy-authorization.json@elizaOS/army", ".slop-authorization.json@SlopDotCash/slopdotcash"),
  localRunState: renamed("gitarmy", "slop"),
  releaseLabel: renamed("gitarmy-release-candidate", "slop-release-candidate"),
  reviewFence: renamed("gitarmy-review", "slop-review"),
  scoreRule: renamed("gitarmy-v1", "slop-score-v1"),
  sourceRepository: renamed("elizaOS/army", "SlopDotCash/slopdotcash"),
  walletMarker: renamed("gitarmy-wallet:v1", "slop-wallet:v1"),
});

export const IdentityRecord = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  identityVersion: Schema.Literal("slop-identity-v1"),
  activatedAt: ExactUtc,
  activationCode: Schema.Struct({ commit: Sha1, tree: Sha1 }),
  legacySnapshot: Schema.Struct({
    url: Schema.Literal("https://slop.cash/data/leaderboard.json"),
    sha256: Sha256,
    deploymentCommit: Sha1,
    ruleVersion: Schema.Literal("gitarmy-v1"),
    generatedAt: ExactUtc,
    sourceUpdatedAt: ExactUtc,
    sourceCutoff: ExactUtc,
  }),
  finalAcceptedLegacyReleaseLabelEvent: Schema.Null,
  identifiers: Identifiers,
  paymentMode: Schema.Literal("disabled"),
});

export type IdentityRecord = typeof IdentityRecord.Type;

export const IDENTITY_RECORD: IdentityRecord = {
  schemaVersion: "1",
  identityVersion: "slop-identity-v1",
  activatedAt: "2026-08-14T05:28:19.000Z",
  activationCode: {
    commit: "d999dbd26b4ab743c8015f6be635e554eac66bcb",
    tree: "dfdb014cd93b2497a84537c1e9dbc6d74d8cd7ba",
  },
  legacySnapshot: {
    url: "https://slop.cash/data/leaderboard.json",
    sha256: "d473a9c6942568224af439397ed1f66dbb1d20bbe7d159fcfe1d0bd2f7b50097",
    deploymentCommit: "9040169c8355166375297ed18a8823bd8bf030c2",
    ruleVersion: "gitarmy-v1",
    generatedAt: "2026-08-13T23:05:05.385Z",
    sourceUpdatedAt: "2026-08-13T23:04:28.000Z",
    sourceCutoff: "2026-08-13T23:02:26.000Z",
  },
  finalAcceptedLegacyReleaseLabelEvent: null,
  identifiers: {
    contributionMarker: {
      legacy: ["eliza-computer-attribution:v1", "elizaos-contribution-attribution:v1", "elizaos-contribution-attribution:v2"],
      slop: "slop-contribution-attribution:v1",
    },
    installerAuthorization: {
      legacy: ".gitarmy-authorization.json@elizaOS/army",
      slop: ".slop-authorization.json@SlopDotCash/slopdotcash",
    },
    localRunState: { legacy: "gitarmy", slop: "slop" },
    releaseLabel: { legacy: "gitarmy-release-candidate", slop: "slop-release-candidate" },
    reviewFence: { legacy: "gitarmy-review", slop: "slop-review" },
    scoreRule: { legacy: "gitarmy-v1", slop: "slop-score-v1" },
    sourceRepository: { legacy: "elizaOS/army", slop: "SlopDotCash/slopdotcash" },
    walletMarker: { legacy: "gitarmy-wallet:v1", slop: "slop-wallet:v1" },
  },
  paymentMode: "disabled",
};

export const SIGNED_ATTRIBUTION_MARKER = IDENTITY_RECORD.identifiers.contributionMarker.slop;

const decodeRecord = Schema.decodeUnknownResult(IdentityRecord, { onExcessProperty: "error" });

export type IdentityCheck = { readonly kind: "valid"; readonly record: IdentityRecord } | { readonly kind: "invalid"; readonly reason: string };

/** @throws {never} */
export function validateIdentityRecord(value: unknown): IdentityCheck {
  const decoded = decodeRecord(value);
  if (Result.isFailure(decoded)) return { kind: "invalid", reason: decoded.failure.message };
  const identifiers = (value as { readonly identifiers: unknown }).identifiers;
  if (JSON.stringify(identifiers) !== JSON.stringify(IDENTITY_RECORD.identifiers)) {
    return { kind: "invalid", reason: "identifiers does not match slop-identity-v1" };
  }
  return { kind: "valid", record: decoded.success };
}

/** @throws {never} */
export function identityRecordText(): string {
  return `${JSON.stringify(IDENTITY_RECORD, null, 2)}\n`;
}
