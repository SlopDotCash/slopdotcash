/**
 * Canonical rules for evaluated contributions that live outside GitHub: a
 * public post, a support answer, a tutorial, or a video. These sources never
 * carry a run receipt, never earn an evidence bonus, and only score when a
 * project has opted in and a maintainer merged the award. The rules here are
 * shared by the award validator and the public snapshot validator so a source
 * that passes review cannot later fail publication, or the reverse.
 *
 * The unit that is paid for is a piece of work, not a URL string. Each
 * platform therefore has exactly one accepted URL form, every accepted URL
 * maps to a work key that ignores presentation details (the handle in an X
 * URL, the short or long YouTube form), and awards are also deduplicated on
 * the archived content hash so a mirror host that is not listed here still
 * cannot earn the same work twice.
 */

import { sha256Hex } from "./sha256";

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

/** The one accepted URL shape per platform, quoted in rejection messages. */
export const EXTERNAL_SOURCE_CANONICAL_FORMS: Record<
  ExternalSourcePlatform,
  string
> = {
  x: "https://x.com/<handle>/status/<id>",
  discord: "https://discord.com/channels/<guild>/<channel>/<message>",
  youtube: "https://www.youtube.com/watch?v=<video id>",
  web: "https://<host>/<path> on a host that is not GitHub, X, Discord, YouTube or a mirror of them",
};

/**
 * Hosts, with every subdomain, that the `web` kind refuses. GitHub-hosted
 * work must use the ordinary GitHub source kinds, and the platforms with a
 * dedicated kind must use it so their canonical form applies. Known
 * front-end mirrors are listed so the same post cannot re-enter as `web`;
 * the list cannot be exhaustive, which is why content hashes are also
 * deduplicated.
 */
const RESERVED_HOST_SUFFIXES = [
  "github.com",
  "githubusercontent.com",
  "github.io",
  "githubassets.com",
  "x.com",
  "twitter.com",
  "twimg.com",
  "t.co",
  "fxtwitter.com",
  "fixupx.com",
  "vxtwitter.com",
  "fixvx.com",
  "twittpr.com",
  "nitter.net",
  "nitter.cz",
  "nitter.privacydev.net",
  "nitter.poast.org",
  "xcancel.com",
  "twstalker.com",
  "threadreaderapp.com",
  "discord.com",
  "discordapp.com",
  "discord.gg",
  "discord.new",
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "yewtu.be",
  "invidious.io",
  "piped.video",
] as const;

export function isReservedExternalHost(host: string): boolean {
  const lower = host.toLowerCase();
  return RESERVED_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`),
  );
}

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

const X_STATUS_PATH = /^\/[A-Za-z0-9_]{1,15}\/status\/([1-9]\d{0,24})$/u;
const DISCORD_MESSAGE_PATH =
  /^\/channels\/([1-9]\d{0,24})\/([1-9]\d{0,24})\/([1-9]\d{0,24})$/u;
const YOUTUBE_WATCH_SEARCH = /^\?v=([A-Za-z0-9_-]{11})$/u;

/**
 * Resolves a parsed URL to its platform work key, or null when the URL is not
 * the canonical public address for that platform. The key names the piece of
 * work rather than the string: an X status id, a Discord message id, a
 * YouTube video id, or the exact web address.
 */
function resolveWorkKey(
  parsed: URL,
  platform: ExternalSourcePlatform,
): string | null {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  switch (platform) {
    case "x": {
      const match = host === "x.com" ? X_STATUS_PATH.exec(path) : null;
      return match && !parsed.search ? `x\0status\0${match[1]}` : null;
    }
    case "discord": {
      const match =
        host === "discord.com" ? DISCORD_MESSAGE_PATH.exec(path) : null;
      return match && !parsed.search
        ? `discord\0message\0${match[1]}/${match[2]}/${match[3]}`
        : null;
    }
    case "youtube": {
      const match =
        host === "www.youtube.com" && path === "/watch"
          ? YOUTUBE_WATCH_SEARCH.exec(parsed.search)
          : null;
      return match ? `youtube\0video\0${match[1]}` : null;
    }
    case "web":
      return !isReservedExternalHost(host) &&
        host.includes(".") &&
        path.length > 1
        ? `web\0${parsed.toString()}`
        : null;
    default:
      return null;
  }
}

/**
 * Rejects any external URL that is not the one canonical public address for
 * its platform. The rejection names the accepted form so a maintainer can
 * rewrite a share link, short link, mobile link or mirror link by hand; the
 * validator never rewrites it silently, because the stored URL is what the
 * archive evidence and the source id are bound to.
 */
export function assertExternalSourceUrl(
  value: unknown,
  platform: ExternalSourcePlatform,
  field: string,
): string {
  const parsed = parseSecureUrl(value, field);
  if (
    resolveWorkKey(parsed, platform) === null ||
    parsed.toString() !== value
  ) {
    throw new TypeError(
      `${field} is not a canonical public ${platform} URL; use ${EXTERNAL_SOURCE_CANONICAL_FORMS[platform]}`,
    );
  }
  return value;
}

/**
 * The piece of work an accepted URL points at, independent of how the URL
 * was written. Two awards with the same work key credit the same work and
 * must be rejected together, even though their source ids differ.
 */
export function externalWorkKey(
  sourceUrl: string,
  platform: ExternalSourcePlatform,
): string {
  const key = resolveWorkKey(parseSecureUrl(sourceUrl, "sourceUrl"), platform);
  if (key === null) {
    throw new TypeError(`sourceUrl is not a canonical public ${platform} URL`);
  }
  return key;
}

/**
 * The only accepted public archive origins for external evidence. A Wayback
 * capture is bound to the exact source URL. An archive.ph snapshot id is
 * opaque and carries no target, so it cannot be bound here; reviewers must
 * open it and confirm it shows the source before merging.
 */
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
  return `external-${sha256Hex(sourceUrl)}`;
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
