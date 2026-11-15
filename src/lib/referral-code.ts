/**
 * Custom referral codes (PRD section 11, "Referral program"): the syntax and
 * the API answer shared by the Account page and `backend/referrals/codes.ts`.
 */

/** Three to 32 letters, digits, hyphens or underscores; no separator at either end. */
export const REFERRAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,30}[A-Za-z0-9]$/u;

export const REFERRAL_CODE_API = "/api/v1/referrals/code";
export const REFERRAL_LINK_PREFIX = "/referral/";

export const REFERRAL_CODE_RULE =
  "Use 3 to 32 letters, digits, hyphens or underscores, starting and ending with a letter or digit.";

export function validReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE.test(value);
}

/** Codes are unique without regard to case. */
export function referralCodeKey(code: string): string {
  return code.toLowerCase();
}

export function referralLink(origin: string, code: string): string {
  return `${origin}${REFERRAL_LINK_PREFIX}${code}`;
}

export type ReferralCodeAccount = { code: string | null };

export function referralCodeAccount(value: unknown): ReferralCodeAccount {
  const code =
    typeof value === "object" && value !== null
      ? (value as { code?: unknown }).code
      : undefined;
  if (code !== null && !validReferralCode(code))
    throw new Error("Your referral code could not be read. Retry.");
  return { code };
}
