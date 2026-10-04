import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import {
  canonicalBountyBytes,
  parseCanonicalBountyBytes,
  parseResidentAttestationBytes,
  residentAttestationSigningBytes,
} from "./codec";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("canonical resident bounty evidence", () => {
  it("signs recursively sorted compact UTF-8 bytes without a trailing newline", () => {
    expect(
      new TextDecoder().decode(
        canonicalBountyBytes({ z: [{ b: "é", a: "1" }], a: "2" }),
      ),
    ).toBe('{"a":"2","z":[{"a":"1","b":"é"}]}');
    expect(
      parseCanonicalBountyBytes(canonicalBountyBytes({ "2": "b", "10": "a" })),
    ).toEqual({ "2": "b", "10": "a" });
  });

  it.each([
    '{"a":1,"a":2}',
    '{"nested":{"a":1,"a":2}}',
    '{ "a":1}',
    '{"z":1,"a":2}',
    '{"a":1}\n',
    '{"a":1e0}',
  ])(
    "rejects ambiguous or noncanonical bytes before signature checking: %s",
    (text) => {
      expect(() => parseCanonicalBountyBytes(bytes(text))).toThrow();
    },
  );

  it("rejects malformed UTF-8 and values JSON would silently erase or rewrite", () => {
    expect(() => parseCanonicalBountyBytes(new Uint8Array([0xff]))).toThrow();
    for (const value of [
      undefined,
      { amount: undefined },
      NaN,
      -0,
      new Date(),
      "\ud800",
    ]) {
      expect(() => canonicalBountyBytes(value)).toThrow();
    }
  });

  it("rejects unknown signed fields, duplicate keys and oversized envelopes before verification", () => {
    const f = scenario();
    const envelope = parseCanonicalBountyBytes(f.attestationBytes) as Record<
      string,
      unknown
    >;
    expect(() =>
      parseResidentAttestationBytes(
        canonicalBountyBytes({ ...envelope, approved: true }),
      ),
    ).toThrow();
    const text = new TextDecoder()
      .decode(f.attestationBytes)
      .replace('"audience":', '"audience":"forged","audience":');
    expect(() => parseResidentAttestationBytes(bytes(text))).toThrow();
    expect(() =>
      parseResidentAttestationBytes(
        canonicalBountyBytes({ ...envelope, runId: "x".repeat(16 * 1024) }),
      ),
    ).toThrow();
  });

  it("binds the real synthetic signature to the pinned domain and every unsigned envelope field", () => {
    const f = scenario();
    const attestation = parseResidentAttestationBytes(f.attestationBytes);
    const key = f.context.reviewedKeys[0];
    const signature = Uint8Array.from(atob(attestation.signature), (c) =>
      c.charCodeAt(0),
    );
    const signed = residentAttestationSigningBytes(attestation);
    expect(
      new TextDecoder()
        .decode(signed)
        .startsWith("Slop resident bounty attestation v1\n{"),
    ).toBe(true);
    expect(
      ed25519.verify(signature, signed, key.publicKey, { zip215: false }),
    ).toBe(true);
    expect(
      ed25519.verify(
        signature,
        residentAttestationSigningBytes({
          ...attestation,
          runId: "another-run",
        }),
        key.publicKey,
        { zip215: false },
      ),
    ).toBe(false);
  });
});
