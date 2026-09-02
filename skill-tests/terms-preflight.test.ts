import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
const originalCacheHome = process.env.XDG_CACHE_HOME;
let cacheHome = "";
beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "terms-preflight-cache-"));
  process.env.XDG_CACHE_HOME = cacheHome;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = originalCacheHome;
  }
  rmSync(cacheHome, { recursive: true, force: true });
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

  it("reuses rehashed commit-pinned bytes while refetching live policy", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://slop.cash/projects/eliza/terms.json") {
        return new Response(JSON.stringify(policy));
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response(license);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    await preflight("eliza");
    await preflight("eliza");

    expect(
      requested.filter((url) => url.endsWith("/projects/eliza/terms.json")),
    ).toHaveLength(2);
    expect(
      requested.filter((url) => url.includes("raw.githubusercontent.com")),
    ).toHaveLength(1);
  });

  it("does not reuse cached bytes for a changed source and digest", async () => {
    const changed = Buffer.from("replacement immutable license bytes\n");
    const changedPolicy = structuredClone(policy);
    changedPolicy.terms.repositoryLicense.url = `https://github.com/elizaOS/eliza/blob/${"b".repeat(40)}/LICENSE`;
    changedPolicy.terms.repositoryLicense.fileSha256 = createHash("sha256")
      .update(changed)
      .digest("hex");
    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response(license),
      new Response(JSON.stringify(changedPolicy)),
      new Response(changed),
    );

    await preflight("eliza");
    await expect(preflight("eliza")).resolves.toMatchObject({
      licenseSha256: changedPolicy.terms.repositoryLicense.fileSha256,
    });
  });

  it("refetches and repairs a corrupted immutable-document cache entry", async () => {
    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response(license),
    );
    await preflight("eliza");
    const cacheRoot = join(cacheHome, "slop", "policy-documents-v1");
    const [entry] = readdirSync(cacheRoot);
    expect(entry).toMatch(/^[0-9a-f]{64}\.bin$/u);
    writeFileSync(join(cacheRoot, entry), "corrupted cache bytes");
    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response(license),
    );

    await expect(preflight("eliza")).resolves.toMatchObject({
      licenseSha256,
    });
  });

  it("bounds the persistent immutable-document cache", async () => {
    const cacheRoot = join(cacheHome, "slop", "policy-documents-v1");
    mkdirSync(cacheRoot, { recursive: true });
    for (let index = 0; index < 33; index += 1) {
      writeFileSync(
        join(cacheRoot, `${index.toString(16).padStart(64, "0")}.bin`),
        "x",
      );
    }
    globalThis.fetch = responses(
      new Response(JSON.stringify(policy)),
      new Response(license),
    );

    await preflight("eliza");

    expect(
      readdirSync(cacheRoot).filter((name) =>
        /^[0-9a-f]{64}\.bin$/u.test(name),
      ),
    ).toHaveLength(32);
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
