/** Read-only signer attestations. This module never authorizes a payment. */
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { fundingInstrumentId } from "../src/lib/allocation-funding-basis.mjs";
import type {
  SablierLockupV4Instrument,
  SquadsProjectVaultInstrument,
  SquadsV4VaultInstrument,
} from "../src/lib/funding-instruments.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import {
  isBaseStreamSignerInstrument,
  requiredSignerRoles,
  type SignerRole,
} from "../src/lib/signer-capability";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";

export interface SignerAccessReport {
  kind: "slop-signer-access";
  schemaVersion: "1";
  projectId: string;
  manifestRevision: string;
  cycleId: string;
  instrumentId: string;
  actorId: string;
  /** funder/steward on the 2-of-2; creator/independent on a project vault;
   * recipient on a Base Sablier stream (RFC #472). */
  role: SignerRole;
  member: string;
  capability: "can-sign" | "lost-access";
  reportedAt: string;
  expiresAt: string | null;
  reason: string;
  memberSignature: string | null;
  sourceRepository: string;
  sourceCommit: string;
}

const SHA = /^[a-f0-9]{40}$/u;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DAY_MS = 24 * 60 * 60 * 1000;
const KEYS = [
  "kind",
  "schemaVersion",
  "projectId",
  "manifestRevision",
  "cycleId",
  "instrumentId",
  "actorId",
  "role",
  "member",
  "capability",
  "reportedAt",
  "expiresAt",
  "reason",
  "memberSignature",
  "sourceRepository",
  "sourceCommit",
]
  .sort()
  .join(",");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Signer evidence must be an object");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Signer evidence requires canonical UTC timestamps");
  return Date.parse(value);
}

type SquadsInstrument = SquadsV4VaultInstrument | SquadsProjectVaultInstrument;
type SignerInstrument = SquadsInstrument | SablierLockupV4Instrument;
const ROLES: readonly string[] = [
  "funder",
  "steward",
  "creator",
  "independent",
  "recipient",
];

export function assertSignerAccessReport(value: unknown): SignerAccessReport {
  const report = object(value);
  if (
    Object.keys(report).sort().join(",") !== KEYS ||
    report.kind !== "slop-signer-access" ||
    report.schemaVersion !== "1" ||
    typeof report.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(report.projectId) ||
    typeof report.manifestRevision !== "string" ||
    !SHA.test(report.manifestRevision) ||
    typeof report.sourceCommit !== "string" ||
    !SHA.test(report.sourceCommit) ||
    typeof report.sourceRepository !== "string" ||
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(
      report.sourceRepository,
    ) ||
    typeof report.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(report.cycleId) ||
    typeof report.instrumentId !== "string" ||
    report.instrumentId.length > 200 ||
    typeof report.actorId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(report.actorId) ||
    typeof report.role !== "string" ||
    !ROLES.includes(report.role) ||
    typeof report.member !== "string" ||
    !(isBaseStreamSignerInstrument(report.instrumentId)
      ? /^0x[0-9a-f]{40}$/u.test(report.member)
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(report.member)) ||
    (report.capability !== "can-sign" && report.capability !== "lost-access") ||
    typeof report.reason !== "string" ||
    report.reason.trim() !== report.reason ||
    report.reason.length < 1 ||
    report.reason.length > 500 ||
    [...report.reason].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new TypeError("Invalid signer access report");
  const reportedAt = timestamp(report.reportedAt);
  if (report.capability === "lost-access") {
    if (report.expiresAt !== null || report.memberSignature !== null)
      throw new TypeError(
        "Loss reports require neither the lost key nor an expiry",
      );
  } else {
    const expiresAt = timestamp(report.expiresAt);
    // A Base recipient signs with EIP-191 personal_sign: 65 lowercase hex
    // bytes r || s || v. A Solana member signs with canonical Ed25519 base64.
    const canonicalSignature = isBaseStreamSignerInstrument(
      report.instrumentId as string,
    )
      ? typeof report.memberSignature === "string" &&
        /^0x[0-9a-f]{128}(?:1b|1c)$/u.test(report.memberSignature)
      : typeof report.memberSignature === "string" &&
        /^[A-Za-z0-9+/]{86}==$/u.test(report.memberSignature) &&
        Buffer.from(report.memberSignature, "base64").toString("base64") ===
          report.memberSignature;
    if (
      expiresAt <= reportedAt ||
      expiresAt - reportedAt > DAY_MS ||
      !canonicalSignature
    )
      throw new TypeError(
        "Capability requires a canonical member signature and at most 24-hour validity",
      );
  }
  return { ...report } as unknown as SignerAccessReport;
}

/** Domain-separated message; not a transaction and not payment authorization. */
export function signerCapabilityMessage(report: SignerAccessReport): string {
  const {
    memberSignature: _signature,
    sourceCommit: _commit,
    ...claims
  } = report;
  return `Slop signer capability only; no payment authorization.\n${canonicalFundingDecisionBytes(claims)}`;
}
export function signerAccessCommitMessage(report: SignerAccessReport): string {
  const { sourceCommit: _commit, ...claims } = report;
  return `slop-signer-access:v1\n${canonicalFundingDecisionBytes(claims)}`.trimEnd();
}

function memberPublicKey(member: string) {
  let number = 0n;
  for (const character of member) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new TypeError("Invalid member public key");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  const leading = member.match(/^1*/u)?.[0].length ?? 0;
  const raw = Buffer.concat([Buffer.alloc(leading), Buffer.from(bytes)]);
  if (raw.length !== 32) throw new TypeError("Member key must be 32 bytes");
  return Uint8Array.from(raw);
}

/**
 * Recovers the signer of an EIP-191 personal_sign signature over `message`.
 * High-s signatures are refused, so each message has one canonical signature.
 */
export function eip191SignerAddress(
  message: string,
  signature: string,
): string {
  if (!/^0x[0-9a-f]{128}(?:1b|1c)$/u.test(signature))
    throw new TypeError("EIP-191 signature is not canonical");
  const bytes = Uint8Array.from(Buffer.from(signature.slice(2), "hex"));
  const body = new TextEncoder().encode(message);
  const digest = keccak_256(
    new Uint8Array([
      ...new TextEncoder().encode(
        `\x19Ethereum Signed Message:\n${body.length}`,
      ),
      ...body,
    ]),
  );
  const parsed = secp256k1.Signature.fromBytes(
    bytes.slice(0, 64),
    "compact",
  ).addRecoveryBit(bytes[64] - 27);
  if (parsed.hasHighS())
    throw new TypeError("EIP-191 signature must use low s");
  const publicKey = parsed.recoverPublicKey(digest).toBytes(false);
  return `0x${Buffer.from(keccak_256(publicKey.slice(1)).slice(12)).toString("hex")}`;
}

export async function readSignerCommit(
  repository: string,
  commit: string,
): Promise<unknown> {
  const [owner, name] = repository.split("/");
  const output = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$name:String!,$oid:String!){repository(owner:$owner,name:$name){isPrivate object(expression:$oid){... on Commit{oid message signature{isValid state signer{id databaseId}}}}}}",
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `oid=${commit}`,
    ],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 },
  );
  const envelope = JSON.parse(output);
  if (envelope.errors || envelope.data?.repository?.isPrivate !== false)
    throw new TypeError("Public GitHub signer lookup failed");
  return envelope.data?.repository?.object;
}

/**
 * Which GitHub actor and which member key each role speaks for. On the 2-of-2
 * every role is one reviewed key. On a project vault (RFC #500) the
 * independent signer is one reviewed key with a reviewed GitHub identity, and
 * the creator seat is the vault PDA of the creator's own multisig, which
 * cannot sign: a creator loss report names the seat, while a creator
 * capability report is signed by a key the creator controls inside that
 * multisig, so `member` is that key and readiness checks it against the
 * creator multisig on chain. Slop's vote-only key never attests.
 */
function signerAuthority(
  instrument: SignerInstrument,
  report: SignerAccessReport,
): {
  actorId: string;
  nodeId: string | null;
  member: string | null;
  forbiddenMember: string | null;
} | null {
  // RFC #472: the reviewed recipient actor speaks for the stream recipient.
  if (instrument.kind === "sablier-lockup-v4")
    return report.role === "recipient" && instrument.recipientGithub
      ? {
          actorId: instrument.recipientGithub.actorId,
          nodeId: instrument.recipientGithub.nodeId,
          member: instrument.recipient,
          forbiddenMember: null,
        }
      : null;
  if (instrument.kind === "squads-v4-vault") {
    if (
      !instrument.stewardGithub ||
      instrument.funderActorId === instrument.stewardGithub.actorId
    )
      return null;
    if (report.role === "funder")
      return {
        actorId: instrument.funderActorId,
        nodeId: null,
        member: instrument.funderMember,
        forbiddenMember: null,
      };
    if (report.role === "steward")
      return {
        actorId: instrument.stewardGithub.actorId,
        nodeId: instrument.stewardGithub.nodeId,
        member: instrument.stewardMember,
        forbiddenMember: null,
      };
    return null;
  }
  if (instrument.independentGithub.actorId === instrument.creatorActorId)
    return null;
  if (report.role === "independent")
    return {
      actorId: instrument.independentGithub.actorId,
      nodeId: instrument.independentGithub.nodeId,
      member: instrument.independentMember,
      forbiddenMember: null,
    };
  if (report.role === "creator")
    return report.capability === "lost-access"
      ? {
          actorId: instrument.creatorActorId,
          nodeId: null,
          member: instrument.creatorMember,
          forbiddenMember: null,
        }
      : {
          actorId: instrument.creatorActorId,
          nodeId: null,
          member: null,
          forbiddenMember: instrument.creatorMember,
        };
  return null;
}

/** Caller supplies a reviewed immutable manifest, never a proposed head manifest. */
export async function verifySignerAccess(input: {
  report: unknown;
  project: ProjectDefinition;
  manifestRevision: string;
  now: string;
  readCommit?: typeof readSignerCommit;
}): Promise<SignerAccessReport> {
  const report = assertSignerAccessReport(input.report);
  const now = timestamp(input.now);
  if (
    report.projectId !== input.project.id ||
    report.manifestRevision !== input.manifestRevision ||
    timestamp(report.reportedAt) > now
  )
    throw new TypeError(
      "Signer report does not bind the reviewed manifest or time",
    );
  const matches = (input.project.funding.commitments ?? []).filter(
    (instrument): instrument is SignerInstrument =>
      (instrument.kind === "squads-v4-vault" ||
        instrument.kind === "squads-project-vault" ||
        (instrument.kind === "sablier-lockup-v4" &&
          instrument.network === "base")) &&
      fundingInstrumentId(instrument) === report.instrumentId,
  );
  const instrument = matches[0];
  if (
    matches.length !== 1 ||
    !instrument.monthlyCommitment ||
    instrument.monthlyCommitment.cycleId !== report.cycleId ||
    timestamp(report.reportedAt) < timestamp(instrument.effectiveAt) ||
    !requiredSignerRoles(report.instrumentId).includes(report.role)
  )
    throw new TypeError(
      "Report requires the exact reviewed monthly instrument",
    );
  const authority = signerAuthority(instrument, report);
  if (!authority)
    throw new TypeError(
      "Report requires the exact reviewed monthly instrument",
    );
  if (
    report.actorId !== authority.actorId ||
    (authority.member !== null && report.member !== authority.member) ||
    (authority.member === null && report.member === authority.forbiddenMember)
  )
    throw new TypeError(
      "Signer identity or member key differs from reviewed authority",
    );
  const commit = object(
    await (input.readCommit ?? readSignerCommit)(
      report.sourceRepository,
      report.sourceCommit,
    ),
  );
  const signature = object(commit.signature);
  const signer = object(signature.signer);
  if (
    commit.oid !== report.sourceCommit ||
    signature.isValid !== true ||
    signature.state !== "VALID" ||
    String(signer.databaseId) !== authority.actorId ||
    (authority.nodeId !== null && signer.id !== authority.nodeId) ||
    typeof commit.message !== "string" ||
    commit.message.replace(/\n$/u, "") !== signerAccessCommitMessage(report)
  )
    throw new TypeError(
      "GitHub signature does not bind the exact signer report",
    );
  if (report.capability === "can-sign") {
    const valid =
      instrument.kind === "sablier-lockup-v4"
        ? eip191SignerAddress(
            signerCapabilityMessage(report),
            report.memberSignature ?? "",
          ) === report.member
        : ed25519.verify(
            Uint8Array.from(
              Buffer.from(report.memberSignature ?? "", "base64"),
            ),
            new TextEncoder().encode(signerCapabilityMessage(report)),
            memberPublicKey(report.member),
            { zip215: false },
          );
    if (!valid) throw new TypeError("Member capability signature is invalid");
  }
  return report;
}

if (import.meta.main) {
  const [revision, path, ...extra] = process.argv.slice(2);
  if (!revision || !SHA.test(revision) || !path || extra.length)
    throw new TypeError(
      "Usage: verify-signer-access.ts <reviewed-manifest-sha> <report.json>",
    );
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > 16 * 1024
  )
    throw new TypeError("Report must be a bounded regular file");
  const bytes = await readFile(path);
  const report = assertSignerAccessReport(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  if (!bytes.equals(Buffer.from(canonicalFundingDecisionBytes(report))))
    throw new TypeError("Report must be canonical JSON with no duplicate keys");
  execFileSync(
    "git",
    [
      "--no-replace-objects",
      "merge-base",
      "--is-ancestor",
      revision,
      "origin/main",
    ],
    { stdio: "ignore" },
  );
  const manifestPath = `projects/${report.projectId}/project.json`;
  const mode = execFileSync(
    "git",
    ["--no-replace-objects", "ls-tree", revision, "--", manifestPath],
    { encoding: "utf8" },
  );
  if (!mode.startsWith("100644 blob "))
    throw new TypeError("Manifest must be a regular reviewed file");
  const project = assertProjectDefinition(
    JSON.parse(
      execFileSync(
        "git",
        ["--no-replace-objects", "show", `${revision}:${manifestPath}`],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      ),
    ),
  );
  await verifySignerAccess({
    report,
    project,
    manifestRevision: revision,
    now: new Date().toISOString(),
  });
  process.stdout.write(
    `${JSON.stringify({ verifiedSignerReport: true, sourceCommit: report.sourceCommit, capability: report.capability, paymentAuthorized: false })}\n`,
  );
}
