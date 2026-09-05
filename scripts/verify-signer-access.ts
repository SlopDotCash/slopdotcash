/** Read-only signer attestations. This module never authorizes a payment. */
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { SquadsV4VaultInstrument } from "../src/lib/funding-instruments.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";

export interface SignerAccessReport {
  kind: "slop-signer-access";
  schemaVersion: "1";
  projectId: string;
  manifestRevision: string;
  cycleId: string;
  instrumentId: string;
  actorId: string;
  role: "funder" | "steward";
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

export function squadsAccessInstrumentId(
  instrument: SquadsV4VaultInstrument,
): string {
  return `squads-v4-vault:solana:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`;
}

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
    (report.role !== "funder" && report.role !== "steward") ||
    typeof report.member !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(report.member) ||
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
    if (
      expiresAt <= reportedAt ||
      expiresAt - reportedAt > DAY_MS ||
      typeof report.memberSignature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/u.test(report.memberSignature) ||
      Buffer.from(report.memberSignature, "base64").toString("base64") !==
        report.memberSignature
    )
      throw new TypeError(
        "Capability requires a canonical Ed25519 signature and at most 24-hour validity",
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
    (instrument): instrument is SquadsV4VaultInstrument =>
      instrument.kind === "squads-v4-vault" &&
      squadsAccessInstrumentId(instrument) === report.instrumentId,
  );
  const instrument = matches[0];
  if (
    matches.length !== 1 ||
    !instrument.monthlyCommitment ||
    !instrument.stewardGithub ||
    instrument.monthlyCommitment.cycleId !== report.cycleId ||
    instrument.funderActorId === instrument.stewardGithub.actorId ||
    timestamp(report.reportedAt) < timestamp(instrument.effectiveAt)
  )
    throw new TypeError(
      "Report requires the exact reviewed monthly Squads instrument",
    );
  const actorId =
    report.role === "funder"
      ? instrument.funderActorId
      : instrument.stewardGithub.actorId;
  const member =
    report.role === "funder"
      ? instrument.funderMember
      : instrument.stewardMember;
  if (report.actorId !== actorId || report.member !== member)
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
    String(signer.databaseId) !== actorId ||
    (report.role === "steward" &&
      signer.id !== instrument.stewardGithub.nodeId) ||
    typeof commit.message !== "string" ||
    commit.message.replace(/\n$/u, "") !== signerAccessCommitMessage(report)
  )
    throw new TypeError(
      "GitHub signature does not bind the exact signer report",
    );
  if (
    report.capability === "can-sign" &&
    !ed25519.verify(
      Uint8Array.from(Buffer.from(report.memberSignature ?? "", "base64")),
      new TextEncoder().encode(signerCapabilityMessage(report)),
      memberPublicKey(member),
      { zip215: false },
    )
  )
    throw new TypeError("Member capability signature is invalid");
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
      "origin/develop",
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
