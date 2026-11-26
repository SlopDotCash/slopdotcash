/**
 * The personal read-only key for private security reads (operator decision,
 * 25 November 2026; PRD section 8). Shared by the API and the Settings page.
 */

export const SECURITY_READ_KEY_API = "/api/v1/security-read-key";

/** A key is this prefix and 43 URL-safe characters (32 random bytes). */
export const SECURITY_READ_KEY_PREFIX = "slop_sr_";
export const SECURITY_READ_KEY_PATTERN = /^slop_sr_[A-Za-z0-9_-]{43}$/u;

/** The reads a key may make; every other route ignores it. */
export const SECURITY_READ_KEY_ROUTES = [
  "security-cases",
  "security-submissions",
] as const;

export type SecurityReadKeyStatus = {
  /** Null when the account has no key in use. */
  key: { createdAt: string; lastUsedAt: string | null } | null;
};

/** The create answer: the only time the key itself is returned. */
export type SecurityReadKeyCreated = SecurityReadKeyStatus & {
  secret: string;
};

export const SECURITY_READ_KEY_NOTICE =
  "The key reads what your account can read in the Inbox: private reports, cases and their analysis. It cannot decide, pay or change anything. Keep it secret. Creating a new key or revoking stops the old one at once.";
