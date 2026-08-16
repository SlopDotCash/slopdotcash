import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { preflight } from "../skills/contribute-to-eliza/scripts/terms-preflight.mjs";

const license = Buffer.from("immutable license bytes\n");
const licenseSha256 = createHash("sha256").update(license).digest("hex");
const policy = {
  schemaVersion: "1",
  projectId: "eliza",
  status: "active",
  steward: {},
  authority: {
    state: "verified",
    proof: { policyRevision: "policy-2" },
  },
  terms: {
    revision: "policy-2",
    repositoryLicense: {
      state: "verified",
      url: `https://github.com/elizaOS/eliza/blob/${"a".repeat(40)}/LICENSE`,
      fileSha256: licenseSha256,
    },
    inbound: {
      mode: "license",
      termsUrl: null,
      fileSha256: null,
    },
    externalPrize: null,
  },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function responses(...values: Response[]): typeof fetch {
  return (async () => {
    const value = values.shift();
    if (!value) throw new Error("unexpected fetch");
    return value;
  }) as typeof fetch;
}

describe("project terms preflight", () => {
  it("verifies immutable bytes and returns the bounded acknowledgement", async () => {
    globalThis.fetch = responses(
      new Response(JSON.stringify(policy), { status: 200 }),
      new Response(license, { status: 200 }),
    );
    await expect(
      preflight("eliza", "https://slop.cash"),
    ).resolves.toMatchObject({
      policyRevision: "policy-2",
      licenseSha256,
      inboundTermsSha256: null,
      prizeRulesSha256: null,
    });
  });

  it("stops on missing authority, unknown terms, and byte drift", async () => {
    const paused = structuredClone(policy);
    paused.status = "paused";
    paused.authority.state = "unverified";
    globalThis.fetch = responses(new Response(JSON.stringify(paused)));
    await expect(preflight("eliza", "https://slop.cash")).rejects.toThrow(
      /paused/u,
    );

    const unknown = structuredClone(policy);
    unknown.terms.inbound.mode = "unknown";
    globalThis.fetch = responses(new Response(JSON.stringify(unknown)));
    await expect(preflight("eliza", "https://slop.cash")).rejects.toThrow(
      /unknown/u,
    );

    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response("changed bytes"),
    );
    await expect(preflight("eliza", "https://slop.cash")).rejects.toThrow(
      /drifted/u,
    );
  });
});
