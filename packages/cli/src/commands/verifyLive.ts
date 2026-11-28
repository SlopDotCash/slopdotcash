import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DeploymentReceipt, EndpointCheck } from "vibestack/alchemy";
import { defineCommand } from "../runner.ts";

interface VerifyLiveSummary {
  readonly stage: string;
  readonly siteUrl: string;
  readonly identityUrl?: string;
  readonly manifestSha256?: string;
  readonly siteReceipt: DeploymentReceipt;
  readonly identityReceipt?: DeploymentReceipt;
}

function defaultOriginsForStage(stage: string): { readonly siteUrl?: string; readonly identityUrl?: string } {
  if (stage === "production" || stage === "prod") {
    return { siteUrl: "https://slop.cash", identityUrl: "https://identity.slop.cash" };
  }
  if (stage === "staging") {
    return { siteUrl: "https://staging.slop.cash", identityUrl: "https://identity-staging.slop.cash" };
  }
  return {};
}

function normalizeOrigin(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export const verifyLiveCommand = defineCommand({
  name: "verify-live",
  summary: "Verify live Slop site and identity endpoints and optional release manifest integrity",
  usage: "pnpm cli verify-live [--url <origin>] [--identity-url <origin>] [--stage <name>] [--manifest <path>] [--json]",
  flags: {
    url: {
      kind: "string",
      short: "u",
      description: "Site origin to probe (defaults to stage origin for staging/production)",
    },
    "identity-url": {
      kind: "string",
      description: "Identity worker origin to probe (defaults to stage identity origin)",
    },
    stage: {
      kind: "string",
      short: "s",
      description: "Target stage (staging, production, or dev)",
    },
    manifest: {
      kind: "string",
      short: "m",
      description: "Optional path to release-manifest.json to hash and attach to the receipt",
    },
  },
  run: async ({ flags }, ctx) => {
    const { resolveStage, verifyDeploymentEndpoints } = await import("vibestack/alchemy");
    const target = resolveStage({ stage: flags.stage, cwd: ctx.rootDir });
    const defaults = defaultOriginsForStage(target.kind === "production" ? "production" : target.kind === "staging" ? "staging" : target.stage);

    const rawSiteUrl = flags.url ?? defaults.siteUrl;
    if (!rawSiteUrl) {
      return {
        ok: false,
        message: "Pass --url <origin> (or --stage staging|production) to verify live endpoints.",
        exitCode: 2,
      };
    }

    const siteUrl = normalizeOrigin(rawSiteUrl);
    if (!siteUrl) {
      return { ok: false, message: `Invalid site URL "${rawSiteUrl}".`, exitCode: 2 };
    }

    const rawIdentityUrl = flags["identity-url"] ?? (flags.url ? undefined : defaults.identityUrl);
    const identityUrl = rawIdentityUrl ? normalizeOrigin(rawIdentityUrl) : undefined;
    if (rawIdentityUrl && !identityUrl) {
      return { ok: false, message: `Invalid identity URL "${rawIdentityUrl}".`, exitCode: 2 };
    }

    let manifestSha256: string | undefined;
    if (flags.manifest) {
      const resolvedManifest = path.resolve(ctx.cwd, flags.manifest);
      if (!fs.existsSync(resolvedManifest)) {
        return { ok: false, message: `Manifest file not found: ${resolvedManifest}`, exitCode: 1 };
      }
      manifestSha256 = createHash("sha256").update(fs.readFileSync(resolvedManifest)).digest("hex");
    }

    const siteChecks: readonly EndpointCheck[] = [
      { path: "/", expectedStatus: 200 },
      { path: "/SKILL.md", expectedStatus: 200 },
      { path: "/.well-known/agent-skills/index.json", expectedStatus: 200 },
    ];

    const siteReceipt = await verifyDeploymentEndpoints(siteUrl, siteChecks, {
      throwOnFailure: false,
      ...(manifestSha256 ? { assetHash: manifestSha256 } : {}),
    });

    let identityReceipt: DeploymentReceipt | undefined;
    if (identityUrl) {
      identityReceipt = await verifyDeploymentEndpoints(
        identityUrl,
        [{ path: "/api/v1/identity/health", expectedStatus: [200, 404] }],
        { throwOnFailure: false },
      );
    }

    const ok = siteReceipt.ok && (identityReceipt === undefined || identityReceipt.ok);
    const data: VerifyLiveSummary = {
      stage: target.stage,
      siteUrl,
      ...(identityUrl ? { identityUrl } : {}),
      ...(manifestSha256 ? { manifestSha256 } : {}),
      siteReceipt,
      ...(identityReceipt ? { identityReceipt } : {}),
    };

    if (!ok) {
      return {
        ok: false,
        message: `Live verification failed for ${siteUrl}${identityUrl ? ` / ${identityUrl}` : ""}.`,
        exitCode: 1,
        data,
      };
    }

    const probeCount = siteReceipt.probes.length + (identityReceipt?.probes.length ?? 0);
    return {
      ok: true,
      data,
      lines: [
        `verified ${siteUrl}${identityUrl ? ` and ${identityUrl}` : ""} (${String(probeCount)} probe(s) ok)`,
      ],
    };
  },
});
