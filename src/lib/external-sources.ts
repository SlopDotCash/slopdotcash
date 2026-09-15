/**
 * Canonical rules for evaluated contributions that live outside GitHub: a
 * public post, a support answer, a tutorial, or a video. These sources never
 * carry a run receipt, never earn an evidence bonus, and only score when a
 * project has opted in and a maintainer merged the award. The rules here are
 * shared by the award validator and the public snapshot validator so a source
 * that passes review cannot later fail publication, or the reverse.
 */

import { createHash } from "node:crypto";

export const EXTERNAL_SOURCE_PLATFORMS = [
  "discord",
  "web",
  "x",
  "youtube",
] as const;

export type ExternalSourcePlatform = (typeof EXTERNAL_SOURCE_PLATFORMS)[number];

/** Archive evidence that keeps an external award auditable after deletion. */
export interface ExternalSourceEvidence {
  archiveUrl: string;
  contentSha256: string;
  capturedAt: string;
}

/** External sources have no GitHub number; the ledger stores zero. */
export const EXTERNAL_SOURCE_NUMBER = 0;

const RESERVED_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "discord.com",
  "www.discord.com",
  "discordapp.com",
  "www.discordapp.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function parseSecureUrl(value: unknown, field: string): URL {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new TypeError(`${field} is invalid`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} is not a URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    throw new TypeError(`${field} must be a plain https URL`);
  }
  return parsed;
}

/**
 * Rejects any external URL that is not the canonical public address for its
 * platform. GitHub URLs must use the ordinary GitHub source kinds instead.
 */
export function assertExternalSourceUrl(
  value: unknown,
  platform: ExternalSourcePlatform,
  field: string,
): string {
  const parsed = parseSecureUrl(value, field);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  let canonical: boolean;
  switch (platform) {
    case "x":
      canonical =
        (host === "x.com" || host === "twitter.com") &&
        /^\/[A-Za-z0-9_]{1,15}\/status\/[1-9]\d{0,24}$/u.test(path) &&
        !parsed.search;
      break;
    case "discord":
      canonical =
        host === "discord.com" &&
        /^\/channels\/[1-9]\d{0,24}\/[1-9]\d{0,24}\/[1-9]\d{0,24}$/u.test(
          path,
        ) &&
        !parsed.search;
      break;
    case "youtube":
      canonical =
        (host === "youtu.be" &&
          /^\/[A-Za-z0-9_-]{11}$/u.test(path) &&
          !parsed.search) ||
        (host === "www.youtube.com" &&
          path === "/watch" &&
          /^\?v=[A-Za-z0-9_-]{11}$/u.test(parsed.search));
      break;
    case "web":
      canonical =
        !RESERVED_HOSTS.has(host) &&
        host.includes(".") &&
        !parsed.search &&
        path.length > 1;
      break;
    default:
      canonical = false;
  }
  if (!canonical || parsed.toString() !== value) {
    throw new TypeError(`${field} is not a canonical public ${platform} URL`);
  }
  return value;
}

/** The only accepted public archive origins for external evidence. */
export function assertExternalArchiveUrl(
  value: unknown,
  sourceUrl: string,
  field: string,
): string {
  const parsed = parseSecureUrl(value, field);
  const host = parsed.hostname.toLowerCase();
  const capturedPath = decodeURIComponent(parsed.pathname);
  const wayback =
    host === "web.archive.org" &&
    /^\/web\/\d{14}(?:[a-z_]+)?\/https?:\/\//u.test(capturedPath) &&
    capturedPath.endsWith(sourceUrl.replace(/^https:\/\//u, ""));
  const archiveToday =
    host === "archive.ph" && /^\/[A-Za-z0-9]{5,}$/u.test(parsed.pathname);
  if (!(wayback || archiveToday)) {
    throw new TypeError(
      `${field} must be a web.archive.org capture of the source or an archive.ph snapshot`,
    );
  }
  return String(value);
}

/** Deterministic source id so the same URL can never be awarded twice. */
export function externalSourceId(sourceUrl: string): string {
  return `external-${createHash("sha256").update(sourceUrl).digest("hex")}`;
}

export function assertExternalSourcePlatform(
  value: unknown,
  field: string,
): ExternalSourcePlatform {
  if (
    typeof value !== "string" ||
    !(EXTERNAL_SOURCE_PLATFORMS as readonly string[]).includes(value)
  ) {
    throw new TypeError(
      `${field} must be one of: ${EXTERNAL_SOURCE_PLATFORMS.join(", ")}`,
    );
  }
  return value as ExternalSourcePlatform;
}

export function assertExternalSourceEvidence(
  value: unknown,
  sourceUrl: string,
  field: string,
): ExternalSourceEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort().join("\0");
  if (keys !== ["archiveUrl", "capturedAt", "contentSha256"].join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
  if (
    typeof candidate.contentSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(candidate.contentSha256)
  ) {
    throw new TypeError(`${field}.contentSha256 must be a lowercase sha256`);
  }
  if (
    typeof candidate.capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      candidate.capturedAt,
    ) ||
    new Date(candidate.capturedAt).toISOString() !== candidate.capturedAt
  ) {
    throw new TypeError(`${field}.capturedAt is not a UTC timestamp`);
  }
  return {
    archiveUrl: assertExternalArchiveUrl(
      candidate.archiveUrl,
      sourceUrl,
      `${field}.archiveUrl`,
    ),
    contentSha256: candidate.contentSha256,
    capturedAt: candidate.capturedAt,
  };
}
