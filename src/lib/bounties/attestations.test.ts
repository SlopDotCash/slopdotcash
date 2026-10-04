import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import { sha256Hex } from "../sha256";
import { residentWorkUnitId, verifyResidentAttestation } from "./attestations";
import {
  canonicalBountyBytes,
  parseResidentAttestationBytes,
  RESIDENT_ATTESTATION_DOMAIN,
} from "./codec";
import type { EvidenceContext, ResidentAttestationV1 } from "./contracts";

function sign(a: ResidentAttestationV1, patch: object = {}): Uint8Array {
  const { signature: _signature, ...payload } = { ...a, ...patch };
  const message = new TextEncoder().encode(
    RESIDENT_ATTESTATION_DOMAIN +
      new TextDecoder().decode(canonicalBountyBytes(payload)),
  );
  return canonicalBountyBytes({
    ...payload,
    signature: btoa(
      String.fromCharCode(
        ...ed25519.sign(message, new Uint8Array(32).fill(17)),
      ),
    ),
  });
}
function rehash<T extends object>(record: T, field: keyof T): T {
  const payload = { ...record };
  delete payload[field];
  return { ...record, [field]: sha256Hex(canonicalBountyBytes(payload)) };
}
function acceptedContext(): ReturnType<typeof scenario> {
  const f = scenario();
  f.context.now = "2026-10-03T11:01:00.000Z";
  f.nonce.acceptedAttestationDigest = sha256Hex(f.attestationBytes);
  return f;
}
function changedAcceptance(context: EvidenceContext): void {
  const old = context.acceptedLineages[0];
  const build = rehash(
    {
      ...context.buildEvidence[0],
      commit: old.acceptedCommit,
      tree: "d".repeat(40),
      artifactDigests: [
        { artifactId: "synthetic-artifact", digest: "e".repeat(64) },
      ],
      executionResultDigest: "f".repeat(64),
      observedAt: "2026-10-03T11:00:30.000Z",
    },
    "evidenceDigest",
  );
  context.buildEvidence = [...context.buildEvidence, build];
  context.acceptedLineages = [
    rehash(
      {
        ...old,
        acceptedTree: build.tree,
        relationship: "squash",
        acceptedBuildEvidenceDigest: build.evidenceDigest,
      },
      "lineageDigest",
    ),
  ];
}

describe("resident attestation admission and accepted lineage", () => {
  it("verifies original signed bytes without consuming the nonce or accepting future work", async () => {
    const f = scenario();
    const before = structuredClone({ nonce: f.nonce, context: f.context });
    const result = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(result.attestationDigest).toBe(sha256Hex(f.attestationBytes));
    expect(result.attestationBytes).toEqual(f.attestationBytes);
    expect(result.acceptance).toBeNull();
    expect(result.workUnitId).toBe(
      residentWorkUnitId("9001", "PR_synthetic_a"),
    );
    expect({ nonce: f.nonce, context: f.context }).toEqual(before);
    result.attestationBytes[0] = 0;
    expect(f.attestationBytes[0]).toBe(123);
  });

  it("refuses a nonce for another bounty even with a valid signature", async () => {
    const f = scenario();
    await expect(
      verifyResidentAttestation(
        f.attestationBytes,
        { ...f.nonce, bountyId: "different-bounty" },
        f.context,
      ),
    ).rejects.toThrow();
  });

  it.each([
    ["issuer", "another-issuer"],
    ["keyId", "another-key"],
    ["audience", "another-audience"],
    ["environment", "production"],
    ["residentId", "resident-b"],
    ["residentRevision", "2"],
    ["controllerActorId", "102"],
    ["controllerRevision", "2"],
    ["projectId", "another-project"],
    ["termsDigest", "0".repeat(64)],
    ["repositoryId", "9002"],
    ["nonceId", "another-nonce"],
    ["runId", "another-run"],
    ["attemptId", "another-attempt"],
    ["taskDefinitionDigest", "0".repeat(64)],
    ["toolPolicyRevision", "unreviewed-tools"],
  ])(
    "rejects a valid signature with a wrong %s binding",
    async (field, value) => {
      const f = scenario();
      await expect(
        verifyResidentAttestation(
          sign(parseResidentAttestationBytes(f.attestationBytes), {
            [field]: value,
          }),
          f.nonce,
          f.context,
        ),
      ).rejects.toThrow();
    },
  );

  it("rejects forged signatures including a low-order attester key", async () => {
    const f = scenario();
    const a = parseResidentAttestationBytes(f.attestationBytes);
    await expect(
      verifyResidentAttestation(
        canonicalBountyBytes({
          ...a,
          signature: btoa(String.fromCharCode(...new Uint8Array(64))),
        }),
        f.nonce,
        f.context,
      ),
    ).rejects.toThrow();
    const identity = new Uint8Array(32);
    identity[0] = 1;
    f.context.reviewedKeys = [
      { ...f.context.reviewedKeys[0], publicKey: identity },
    ];
    const forged = new Uint8Array(64);
    forged[0] = 1;
    await expect(
      verifyResidentAttestation(
        canonicalBountyBytes({
          ...a,
          signature: btoa(String.fromCharCode(...forged)),
        }),
        f.nonce,
        f.context,
      ),
    ).rejects.toThrow();
  });

  it("rejects expired fresh admission and deadlines or lifetimes widened by the signer", async () => {
    const f = scenario();
    f.context.now = f.nonce.expiresAt;
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.now = f.nonce.issuedAt;
    const expiresAt = "2026-10-04T12:00:00.000Z";
    await expect(
      verifyResidentAttestation(
        sign(parseResidentAttestationBytes(f.attestationBytes), { expiresAt }),
        { ...f.nonce, expiresAt },
        f.context,
      ),
    ).rejects.toThrow();
    f.context.now = scenario().context.now;
    const policy = rehash(
      { ...f.context.reviewedPolicies[0], maxAdmissionLifetimeMs: "60000" },
      "policyDigest",
    );
    f.context.reviewedPolicies = [policy];
    f.context.residents = f.context.residents.map((r) => ({
      ...r,
      policyDigest: policy.policyDigest,
    }));
    f.context.reviewedKeys = f.context.reviewedKeys.map((k) => ({
      ...k,
      policyDigest: policy.policyDigest,
    }));
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("rejects current key or policy revocation even during historical lineage refresh", async () => {
    const f = acceptedContext();
    f.context.reviewedKeys = [
      { ...f.context.reviewedKeys[0], revokedAt: f.context.now },
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.reviewedKeys = scenario().context.reviewedKeys;
    const policy = rehash(
      { ...f.context.reviewedPolicies[0], revokedAt: f.context.now },
      "policyDigest",
    );
    f.context.reviewedPolicies = [policy];
    f.context.residents = f.context.residents.map((r) => ({
      ...r,
      policyDigest: policy.policyDigest,
    }));
    f.context.reviewedKeys = f.context.reviewedKeys.map((k) => ({
      ...k,
      policyDigest: policy.policyDigest,
    }));
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it.each([
    "githubAppId",
    "installationId",
    "repositoryId",
    "submittedCommit",
    "submittedTree",
  ] as const)(
    "rejects independently observed conflicting %s",
    async (field) => {
      const f = scenario();
      const facts = f.context.githubSubmissions[0];
      f.context.githubSubmissions = [
        rehash(
          {
            ...facts,
            [field]: field.includes("submitted") ? "d".repeat(40) : "9999",
          },
          "evidenceDigest",
        ),
      ];
      await expect(
        verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
      ).rejects.toThrow();
    },
  );

  it("rejects changed public artifacts or unresolved exact build and publication records", async () => {
    const f = scenario();
    f.context.githubSubmissions = [
      rehash(
        {
          ...f.context.githubSubmissions[0],
          artifactDigests: [
            { artifactId: "synthetic-artifact", digest: "d".repeat(64) },
          ],
        },
        "evidenceDigest",
      ),
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.githubSubmissions = scenario().context.githubSubmissions;
    f.context.buildEvidence = [
      { ...f.context.buildEvidence[0], result: "failed" },
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.buildEvidence = scenario().context.buildEvidence;
    f.context.publicationManifests = [
      {
        ...f.context.publicationManifests[0],
        inboundTermsDigest: "d".repeat(64),
      },
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("keeps two residents distinct behind the same publisher and ignores renamed display fields", async () => {
    const f = scenario();
    const a = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    const nonce = {
      ...f.nonce,
      residentId: "resident-b",
      controllerActorId: "102",
      nonceId: "nonce-b",
      runId: "run-b",
      attemptId: "attempt-b",
    };
    const payload = parseResidentAttestationBytes(f.attestationBytes);
    const bBytes = sign(payload, {
      residentId: nonce.residentId,
      controllerActorId: nonce.controllerActorId,
      nonceId: nonce.nonceId,
      runId: nonce.runId,
      attemptId: nonce.attemptId,
    });
    f.context.residents = f.context.residents.map((r) => ({
      ...r,
      display: { ...r.display, name: "renamed", controllerLogin: "renamed" },
    }));
    const b = await verifyResidentAttestation(bBytes, nonce, f.context);
    expect([a.residentId, b.residentId]).toEqual(["resident-a", "resident-b"]);
    expect([a.controllerActorId, b.controllerActorId]).toEqual(["101", "102"]);
    expect(b.workUnitId).toBe(a.workUnitId);
  });

  it("repeats exact verification and rejects changed signed bytes under one consumed nonce", async () => {
    const f = acceptedContext();
    const first = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(
      await verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).toEqual(first);
    const changed = sign(parseResidentAttestationBytes(f.attestationBytes), {
      executionResultDigest: "d".repeat(64),
    });
    await expect(
      verifyResidentAttestation(changed, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("adds independently accepted exact lineage to a historical consumed attestation", async () => {
    const f = acceptedContext();
    const result = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(result.acceptance).toEqual(f.context.acceptedLineages[0]);
    expect(result.submittedTree).toBe(
      f.context.githubSubmissions[0].submittedTree,
    );
    expect(result.attestationDigest).toBe(f.nonce.acceptedAttestationDigest);
  });

  it("requires fresh exact build evidence when a squash changes the executed tree", async () => {
    const f = acceptedContext();
    changedAcceptance(f.context);
    const lineage = f.context.acceptedLineages[0];
    const fresh = f.context.buildEvidence[1];
    f.context.buildEvidence = [f.context.buildEvidence[0]];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.buildEvidence = [...f.context.buildEvidence, fresh];
    const result = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(result.acceptance).toEqual(lineage);
    expect(result.artifactDigests).toEqual(
      parseResidentAttestationBytes(f.attestationBytes).artifactDigests,
    );
    expect(result.workUnitId).toBe(
      residentWorkUnitId("9001", "PR_synthetic_a"),
    );
    f.context.buildEvidence = [
      f.context.buildEvidence[0],
      rehash({ ...fresh, commit: "e".repeat(40) }, "evidenceDigest"),
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("ignores foreign acceptance and rejects unauthorized or changed exact lineage", async () => {
    const f = acceptedContext();
    const original = f.context.acceptedLineages[0];
    const foreign = rehash(
      { ...original, repositoryId: "9999" },
      "lineageDigest",
    );
    f.context.acceptedLineages = [foreign];
    expect(
      (await verifyResidentAttestation(f.attestationBytes, f.nonce, f.context))
        .acceptance,
    ).toBeNull();
    f.context.acceptedLineages = [original, foreign];
    expect(
      (await verifyResidentAttestation(f.attestationBytes, f.nonce, f.context))
        .acceptance,
    ).toEqual(original);
    for (const patch of [
      { acceptanceActorId: "102" },
      { submittedTree: "d".repeat(40) },
    ]) {
      f.context.acceptedLineages = [
        rehash({ ...original, ...patch }, "lineageDigest"),
      ];
      await expect(
        verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
      ).rejects.toThrow();
    }
    f.context.acceptedLineages = [
      { ...original, workBoundaryDigest: "d".repeat(64) },
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("preserves historical controller attribution after transfer but holds a currently suspended resident", async () => {
    const f = acceptedContext();
    const original = f.context.residents[0];
    const successor = {
      ...original,
      revision: "2",
      supersedesRevision: "1",
      controllerActorId: "103",
      controllerRevision: "2",
      authorizedStewardActorId: "103",
      effectiveAt: "2026-10-03T10:00:00.000Z",
    };
    f.context.residents = [...f.context.residents, successor];
    f.context.controllers = [
      ...f.context.controllers,
      {
        ...f.context.controllers[0],
        actorId: "103",
        revision: "2",
        authorizedStewardActorId: "103",
        effectiveAt: successor.effectiveAt,
      },
    ];
    const result = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(result.controllerActorId).toBe("101");
    expect(result.residentRevision).toBe("1");
    f.context.residents = [
      ...f.context.residents.slice(0, -1),
      { ...successor, state: "suspended" },
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("retains exact old and new commit evidence on one PR through historical acceptance refresh", async () => {
    const f = scenario();
    const first = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    const submittedCommit = "d".repeat(40);
    const nonce = {
      ...f.nonce,
      nonceId: "nonce-next",
      runId: "run-next",
      attemptId: "attempt-next",
    };
    const build = rehash(
      { ...f.context.buildEvidence[0], commit: submittedCommit },
      "evidenceDigest",
    );
    const manifest = rehash(
      { ...f.context.publicationManifests[0], submittedCommit },
      "manifestDigest",
    );
    f.context.buildEvidence = [...f.context.buildEvidence, build];
    f.context.publicationManifests = [
      ...f.context.publicationManifests,
      manifest,
    ];
    f.context.githubSubmissions = [
      ...f.context.githubSubmissions,
      rehash(
        { ...f.context.githubSubmissions[0], submittedCommit },
        "evidenceDigest",
      ),
    ];
    f.context.acceptedLineages = [
      ...f.context.acceptedLineages,
      rehash(
        {
          ...f.context.acceptedLineages[0],
          submittedCommit,
          acceptedCommit: "e".repeat(40),
          acceptedBuildEvidenceDigest: build.evidenceDigest,
        },
        "lineageDigest",
      ),
    ];
    const bytes = sign(parseResidentAttestationBytes(f.attestationBytes), {
      submittedCommit,
      nonceId: nonce.nonceId,
      runId: nonce.runId,
      attemptId: nonce.attemptId,
      buildEvidenceDigest: build.evidenceDigest,
      publicationManifestDigest: manifest.manifestDigest,
    });
    const next = await verifyResidentAttestation(bytes, nonce, f.context);
    expect(next.workUnitId).toBe(first.workUnitId);
    expect(next.submittedCommit).not.toBe(first.submittedCommit);
    expect(next.attestationDigest).not.toBe(first.attestationDigest);
    const retainedOriginal = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    expect(retainedOriginal).toEqual(first);
    expect(next.submittedCommit).toBe(submittedCommit);
    f.context.now = "2026-10-03T11:01:00.000Z";
    const refreshedOriginal = await verifyResidentAttestation(
      f.attestationBytes,
      { ...f.nonce, acceptedAttestationDigest: first.attestationDigest },
      f.context,
    );
    const refreshedNext = await verifyResidentAttestation(
      bytes,
      { ...nonce, acceptedAttestationDigest: next.attestationDigest },
      f.context,
    );
    expect(refreshedOriginal.acceptance).toEqual(f.context.acceptedLineages[0]);
    expect(refreshedNext.acceptance).toEqual(f.context.acceptedLineages[1]);
    expect(refreshedOriginal.attestationDigest).toBe(first.attestationDigest);
    expect(refreshedNext.attestationDigest).toBe(next.attestationDigest);
    expect(refreshedOriginal.workUnitId).toBe(refreshedNext.workUnitId);
  });

  it("rejects conflicting retained facts and lineage for the same exact submission", async () => {
    const f = acceptedContext();
    const originalFacts = f.context.githubSubmissions[0];
    f.context.githubSubmissions = [
      originalFacts,
      rehash(
        { ...originalFacts, submittedTree: "d".repeat(40) },
        "evidenceDigest",
      ),
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
    f.context.githubSubmissions = [originalFacts];
    f.context.acceptedLineages = [
      ...f.context.acceptedLineages,
      rehash(
        { ...f.context.acceptedLineages[0], acceptedTree: "d".repeat(40) },
        "lineageDigest",
      ),
    ];
    await expect(
      verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ).rejects.toThrow();
  });

  it("rejects private prompt/raw trace fields and malformed bytes without disclosing input", async () => {
    const f = scenario();
    for (const field of ["privatePrompt", "rawTrace"]) {
      const bytes = sign(parseResidentAttestationBytes(f.attestationBytes), {
        [field]: f.privateSentinel,
      });
      await expect(
        verifyResidentAttestation(bytes, f.nonce, f.context),
      ).rejects.toThrow();
    }
    await expect(
      verifyResidentAttestation(
        new TextEncoder().encode(`{"privatePrompt":"${f.privateSentinel}"`),
        f.nonce,
        f.context,
      ),
    ).rejects.toThrow("Bounty transition rejected: invalid");
  });
});
