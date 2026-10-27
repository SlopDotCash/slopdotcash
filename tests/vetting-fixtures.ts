/**
 * Harmless secure-VM vetting results for the API tests and the registry
 * browser lane: one clean baseline, one incomplete run with a quarantined
 * native module and a telemetry gap, and one confirmed-malicious run that
 * read canary secrets. Tests sign them with a throwaway Ed25519 key the way
 * the external vetting service must.
 */

import { createHash } from "node:crypto";
import { vettingSignedMessage } from "../backend/vetting/handler";
import { TELEMETRY_CHANNELS } from "../backend/vetting/result";
import type { QueuedScan } from "../workers/vetting/bounded-scan";

export const VETTING_TRACE_BODY = "Harmless synthetic private vetting trace.\n";
export const VETTING_TRACE_SHA = createHash("sha256")
  .update(VETTING_TRACE_BODY)
  .digest("hex");

export const VETTING_EVIDENCE_OBJECTS = [
  { body: VETTING_TRACE_BODY, kind: "trace", contentType: "text/plain" },
  {
    body: '{"schemaVersion":"fixture-review-input","source":"harmless"}',
    kind: "manifest",
    contentType: "application/json",
  },
  {
    body: "Harmless artifact bytes.",
    kind: "artifact",
    contentType: "application/octet-stream",
  },
  {
    body: "Harmless quarantined artifact bytes.",
    kind: "artifact",
    contentType: "application/octet-stream",
  },
  {
    body: "Harmless parent archive bytes.",
    kind: "artifact",
    contentType: "application/octet-stream",
  },
  {
    body: "Harmless fixture dependency lock.",
    kind: "artifact",
    contentType: "text/plain",
  },
].map((item) => ({
  ...item,
  sha256: createHash("sha256").update(item.body).digest("hex"),
  sizeBytes: Buffer.byteLength(item.body),
  label: `Harmless ${item.kind} fixture`,
}));
const digest = (character: string) => character.repeat(64);

export function vettingResult(
  target: QueuedScan,
  disposition: "clean" | "incomplete" | "malicious",
) {
  const complete = Object.fromEntries(
    TELEMETRY_CHANNELS.map((channel) => [channel, "complete"]),
  );
  const review = (reviewer: "astra" | "opus") => ({
    reviewer,
    provider: reviewer === "astra" ? "astra-security" : "anthropic",
    model: reviewer === "astra" ? "astra-2026-09" : "claude-opus-5-5",
    promptPolicyRevision: "vet-prompt-1",
    inputManifestSha256: VETTING_EVIDENCE_OBJECTS[1].sha256,
    runId: `${reviewer}-run-${target.revision}`,
    status: "completed",
    verdict:
      disposition === "malicious" ? "malicious-suspected" : "no-findings",
    findingCount: disposition === "malicious" ? 1 : 0,
  });
  return {
    schemaVersion: "slop-vetting-result-v1",
    assessmentId: target.assessmentId,
    projectId: target.projectId,
    revision: target.revision,
    manifestSha256: target.manifestSha256,
    disposition,
    policyVersion: "vet-policy-1",
    assessed: {
      repository: target.repository,
      commitSha: target.commitSha,
      templateSha256: target.templateSha256,
      inputManifestSha256: VETTING_EVIDENCE_OBJECTS[1].sha256,
      dependencyLocks: [
        { path: "bun.lock", sha256: VETTING_EVIDENCE_OBJECTS[5].sha256 },
      ],
    },
    environment: {
      vmProvider: "fixture-microvm",
      isolation: "microvm",
      imageSha256: digest("e"),
      collectorId: "fixture-collector",
      runId: `vm-run-${target.revision}`,
      startedAt: "2026-10-18T11:00:00.000Z",
      completedAt: "2026-10-18T11:30:00.000Z",
    },
    telemetry: {
      coverage:
        disposition === "incomplete"
          ? { ...complete, http: "partial" }
          : complete,
      visibilityGaps:
        disposition === "incomplete"
          ? ["A pinned TLS client hid HTTP bodies"]
          : [],
      tamperDetected: false,
      canaryAccessAttempts: disposition === "malicious" ? 2 : 0,
      egress: "default-deny",
    },
    traceSha256: VETTING_TRACE_SHA,
    modelReviews: [review("astra"), review("opus")],
    artifacts:
      disposition === "clean"
        ? [
            {
              sha256: VETTING_EVIDENCE_OBJECTS[2].sha256,
              parentSha256: null,
              origin: "registry.npmjs.org/esbuild",
              path: "node_modules/esbuild/bin/esbuild",
              type: "binary",
              state: "released",
              analysis: "static-clean",
              requestedExecution: true,
            },
          ]
        : [
            {
              sha256: VETTING_EVIDENCE_OBJECTS[3].sha256,
              parentSha256: VETTING_EVIDENCE_OBJECTS[4].sha256,
              origin: "postinstall download",
              path: "vendor/addon.node",
              type: "native-module",
              state: disposition === "malicious" ? "blocked" : "quarantined",
              analysis: disposition === "malicious" ? "malicious" : "pending",
              requestedExecution: true,
            },
          ],
    findings:
      disposition === "malicious"
        ? [
            {
              severity: "critical",
              category: "credential-exfiltration",
              summary:
                "A postinstall child process read the canary wallet file",
              evidence: "trace event 4182",
            },
          ]
        : [],
    confirmation:
      disposition === "malicious"
        ? {
            basis: "reproducible-behavior",
            rule: "standing-rule-credential-theft",
            evidence: ["trace event 4182", "proxy log 77"],
          }
        : null,
  };
}

export async function vettingKeyPair() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return {
    privateKey: pair.privateKey,
    publicKey: btoa(String.fromCharCode(...raw)),
    raw,
  };
}

async function hex(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The headers the vetting service sends with a signed request. */
export async function signedVettingHeaders(
  privateKey: CryptoKey,
  publicKeyRaw: Uint8Array,
  method: string,
  pathAndQuery: string,
  body: string | Uint8Array,
  at = new Date(),
): Promise<Record<string, string>> {
  const timestamp = at.toISOString();
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      vettingSignedMessage(
        method,
        pathAndQuery,
        timestamp,
        await hex(
          typeof body === "string" ? new TextEncoder().encode(body) : body,
        ),
      ) as Uint8Array<ArrayBuffer>,
    ),
  );
  return {
    "x-slop-vetting-key": await hex(publicKeyRaw),
    "x-slop-vetting-timestamp": timestamp,
    "x-slop-vetting-signature": btoa(String.fromCharCode(...signature)),
  };
}

/**
 * A harmless bounded malicious-code scan result (`slop-vetting-result-v2`).
 * The private report is the retained trace fixture, the inventory is the
 * retained review-input fixture and the dependency lock is retained too, so
 * `retain(assessmentId, runId)` makes a clean result admissible.
 */
export function vettingScanResult(
  target: QueuedScan,
  disposition: "clean" | "incomplete" | "malicious",
  options: {
    runId?: string;
    reusedAssessmentId?: string | null;
    /** Escalates the primary review so a specialist must clear it. */
    ambiguous?: boolean;
    specialist?: boolean;
  } = {},
) {
  const inventory = VETTING_EVIDENCE_OBJECTS[1].sha256;
  const complete = (items: number) => ({ state: "complete", items });
  const review = (role: "primary" | "specialist") => ({
    provider: role === "primary" ? "anthropic" : "openai",
    model: role === "primary" ? "claude-opus-5-5" : "gpt-5.5",
    promptPolicyRevision: "slop-scan-review-1",
    inputManifestSha256: inventory,
    runId: `${role}-scan-${target.revision}`,
    status: "completed",
    verdict:
      disposition === "malicious"
        ? "malicious-suspected"
        : role === "primary" && options.ambiguous
          ? "findings"
          : "no-findings",
    risk:
      disposition === "malicious"
        ? "high"
        : role === "primary" && options.ambiguous
          ? "ambiguous"
          : "low",
    findingCount:
      disposition === "malicious" || (role === "primary" && options.ambiguous)
        ? 1
        : 0,
  });
  return {
    schemaVersion: "slop-vetting-result-v2",
    assessmentId: target.assessmentId,
    projectId: target.projectId,
    revision: target.revision,
    manifestSha256: target.manifestSha256,
    disposition,
    policyVersion: "scan-policy-1",
    assessed: {
      repository: target.repository,
      commitSha: target.commitSha,
      templateSha256: target.templateSha256,
      inputManifestSha256: inventory,
      dependencyLocks: [
        { path: "bun.lock", sha256: VETTING_EVIDENCE_OBJECTS[5].sha256 },
      ],
    },
    scan: {
      runId: options.runId ?? `scan-run-${target.revision}`,
      startedAt: "2026-10-18T11:00:00.000Z",
      completedAt: "2026-10-18T11:05:00.000Z",
      reportSha256: VETTING_TRACE_SHA,
    },
    coverage: {
      source: complete(42),
      manifests: complete(2),
      dependencies: complete(1),
      installScripts: complete(1),
      downloads:
        disposition === "incomplete"
          ? { state: "partial", items: 1 }
          : complete(0),
      agentInstructions: complete(1),
    },
    checks: {
      "wallet-drainer": "passed",
      "credential-theft":
        disposition === "malicious" || options.ambiguous ? "flagged" : "passed",
      "secret-exfiltration": "passed",
      "unsafe-execution": "passed",
      "prompt-injection": "passed",
    },
    visibilityGaps:
      disposition === "incomplete"
        ? ["A postinstall download was not retrievable"]
        : [],
    execution: null,
    reusedAssessmentId: options.reusedAssessmentId ?? null,
    primaryReview: review("primary"),
    specialistReview:
      options.specialist || disposition === "malicious"
        ? review("specialist")
        : null,
    artifacts: [],
    findings:
      disposition === "malicious"
        ? [
            {
              severity: "critical",
              category: "credential-theft",
              summary: "A postinstall script reads the browser wallet store",
              evidence: "scripts/postinstall.js:12",
            },
          ]
        : options.ambiguous
          ? [
              {
                severity: "medium",
                category: "credential-theft",
                summary: "A script reads ~/.npmrc to choose a registry",
                evidence: "scripts/registry.js:4",
              },
            ]
          : [],
    confirmation:
      disposition === "malicious"
        ? {
            basis: "verified-source-evidence",
            rule: "standing-rule-credential-theft",
            evidence: ["scripts/postinstall.js:12"],
          }
        : null,
  };
}
