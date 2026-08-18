import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("allows disclosed unknowns and legacy paused status but stops on byte drift", async () => {
    const unknown = structuredClone(policy);
    unknown.authority = { state: "unverified", proof: null };
    unknown.terms.receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
    };
    unknown.terms.repositoryLicense = {
      state: "unknown",
      url: null,
      fileSha256: null,
    };
    unknown.terms.inbound.mode = "unknown";
    globalThis.fetch = responses(new Response(JSON.stringify(unknown)));
    await expect(preflight("eliza")).resolves.toMatchObject({
      policyRevision: "policy-2",
      licenseSha256: null,
      inboundTermsSha256: null,
    });

    const paused = structuredClone(unknown);
    paused.status = "paused";
    globalThis.fetch = responses(new Response(JSON.stringify(paused)));
    await expect(preflight("eliza")).resolves.toMatchObject({
      policyRevision: "policy-2",
      licenseSha256: null,
      inboundTermsSha256: null,
    });

    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response("changed bytes"),
    );
    await expect(preflight("eliza")).rejects.toThrow(/drifted/u);
  });

  it("rejects untrusted terms authorities and oversized responses", async () => {
    const untrusted = structuredClone(policy);
    untrusted.terms.repositoryLicense.url = "https://127.0.0.1/LICENSE";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(untrusted));
    }) as typeof fetch;
    await expect(preflight("eliza")).rejects.toThrow(
      /authority is not allowed/u,
    );
    expect(calls).toBe(1);

    globalThis.fetch = responses(
      new Response("{}", {
        headers: { "content-length": String(1024 * 1024 + 1) },
      }),
    );
    await expect(preflight("eliza")).rejects.toThrow(/byte limit/u);

    let cancelled = false;
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(600 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = responses(new Response(oversizedStream));
    await expect(preflight("eliza")).rejects.toThrow(/byte limit/u);
    expect(cancelled).toBe(true);
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

  it("detects direct invocation through a symlinked script path", () => {
    const script = fileURLToPath(
      new URL(
        "../skills/contribute-to-eliza/scripts/terms-preflight.mjs",
        import.meta.url,
      ),
    );
    const linkRoot = mkdtempSync(join(tmpdir(), "terms-preflight-link-"));
    const link = join(linkRoot, "terms-preflight.mjs");
    try {
      symlinkSync(script, link);
      // Spawn node explicitly: node resolves the entry module to its realpath,
      // so import.meta.url and a symlinked argv[1] diverge — the case that made
      // the old comparison silently classify a direct CLI run as an import.
      // (bun preserves the symlinked path, so bun cannot reproduce the bug.)
      const viaSymlink = spawnSync(
        "node",
        [link, "--project", "eliza", "--authority", "file:///tmp/"],
        { encoding: "utf8" },
      );
      expect(viaSymlink.status).toBe(1);
      expect(viaSymlink.stderr).toMatch(/authority overrides are forbidden/u);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
    }
  });
});
