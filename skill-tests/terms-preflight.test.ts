import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
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
    proof: {
      policyRevision: "policy-2",
      verifiedAt: "2026-08-16T12:00:00.000Z",
    },
  },
  terms: {
    revision: "policy-2",
    receiptPolicy: {
      state: "active",
      activatedAt: "2026-08-16T12:00:00.000Z",
    },
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
    await expect(preflight("eliza")).resolves.toMatchObject({
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
    await expect(preflight("eliza")).rejects.toThrow(/paused/u);

    const unknown = structuredClone(policy);
    unknown.terms.inbound.mode = "unknown";
    globalThis.fetch = responses(new Response(JSON.stringify(unknown)));
    await expect(preflight("eliza")).rejects.toThrow(/unknown/u);

    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response("changed bytes"),
    );
    await expect(preflight("eliza")).rejects.toThrow(/drifted/u);
  });

  it("permits file authorities only through the explicit programmatic test option", async () => {
    await expect(
      preflight("eliza", { testAuthority: "https://example.com" }),
    ).rejects.toThrow(/file URL/u);
    await expect(
      preflight("eliza", { authority: "file:///tmp/" }),
    ).rejects.toThrow(/unexpected/u);

    const script = fileURLToPath(
      new URL(
        "../skills/contribute-to-eliza/scripts/terms-preflight.mjs",
        import.meta.url,
      ),
    );
    const direct = spawnSync(
      process.execPath,
      [script, "--project", "eliza", "--authority", "file:///tmp/"],
      { encoding: "utf8" },
    );
    expect(direct.status).toBe(1);
    expect(direct.stderr).toMatch(/authority overrides are forbidden/u);
  });
});
