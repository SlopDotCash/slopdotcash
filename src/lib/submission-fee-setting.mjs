/**
 * A project's submission fee setting (operator decision, 18 November 2026;
 * PRD section 5, "Submission fee"). In the project record:
 * `slopbot.submissionFee = { "enabled": true, "amountMinor": "2000000" }`.
 * Absent means off. `amountMinor` is the stablecoin amount in six-decimal
 * base units; when it is left out the platform default applies.
 *
 * While the setting is on and the platform switch is live, Slopbot asks an
 * outside contributor for a refundable deposit before it reviews a pull
 * request (`workers/slopbot/submission-fee.ts`). A change applies to pull
 * requests first asked after it.
 *
 * This file imports nothing: the project schema loads it, and the release
 * tooling loads the schema from a copy of `src/lib` without installed
 * packages. The limits below therefore repeat the three amounts of
 * `submission-fee.mjs` (which needs a hashing package);
 * `submission-fee-setting.test.ts` fails if the two ever differ.
 */

/** The setting's amounts in six-decimal base units: 2.00, 1.00 and 10.00. */
export const SUBMISSION_FEE_SETTING_LIMITS = Object.freeze({
  defaultMinor: "2000000",
  minMinor: "1000000",
  maxMinor: "10000000",
});
const SUBMISSION_FEE_DEFAULT_MINOR = SUBMISSION_FEE_SETTING_LIMITS.defaultMinor;
const SUBMISSION_FEE_MIN_MINOR = SUBMISSION_FEE_SETTING_LIMITS.minMinor;
const SUBMISSION_FEE_MAX_MINOR = SUBMISSION_FEE_SETTING_LIMITS.maxMinor;

/** The stablecoins the fee is paid in all use six decimals. */
export const SUBMISSION_FEE_DECIMALS = 6;

/** One plain sentence for the owner's settings page and the project form. */
export const SUBMISSION_FEE_HINT =
  "Slopbot reviews an outside contributor's pull request once a refundable fee is deposited. A merge sends the fee back, and so does 14 days without a maintainer decision. A pull request closed without a merge keeps it, unless it answers a slop-wanted issue and you do not add slop-keep-fee. Contributors can pay in SLOP at half the price instead.";

const MINOR = /^[1-9][0-9]{0,15}$/u;

function inRange(minor) {
  const value = BigInt(minor);
  return (
    value >= BigInt(SUBMISSION_FEE_MIN_MINOR) &&
    value <= BigInt(SUBMISSION_FEE_MAX_MINOR)
  );
}

/** Six-decimal base units as a short decimal: "2000000" is "2", "2500000" is "2.5". */
export function submissionFeeAmountText(minor) {
  const value = BigInt(minor);
  const unit = 10n ** BigInt(SUBMISSION_FEE_DECIMALS);
  const whole = value / unit;
  const fraction = (value % unit)
    .toString()
    .padStart(SUBMISSION_FEE_DECIMALS, "0")
    .replace(/0+$/u, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/** Validates `project.slopbot.submissionFee`. */
export function assertSubmissionFeeSetting(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "enabled" && keys !== "amountMinor,enabled")
    throw new TypeError(`${field} has unexpected or missing fields`);
  if (typeof value.enabled !== "boolean")
    throw new TypeError(`${field}.enabled must be a boolean`);
  if (value.amountMinor === undefined) return;
  if (
    typeof value.amountMinor !== "string" ||
    !MINOR.test(value.amountMinor) ||
    !inRange(value.amountMinor)
  )
    throw new TypeError(
      `${field}.amountMinor must be a base-unit amount from ${SUBMISSION_FEE_MIN_MINOR} to ${SUBMISSION_FEE_MAX_MINOR}`,
    );
}

/**
 * The fee a project asks, or null when its setting is off or unusable. A
 * stored amount outside the current range reads as off, never as another
 * amount.
 */
export function submissionFeeSetting(project) {
  const setting = project?.slopbot?.submissionFee;
  if (setting?.enabled !== true) return null;
  const amountMinor = setting.amountMinor ?? SUBMISSION_FEE_DEFAULT_MINOR;
  if (
    typeof amountMinor !== "string" ||
    !MINOR.test(amountMinor) ||
    !inRange(amountMinor)
  )
    return null;
  return { amountMinor };
}

/**
 * The owner's typed amount as base units: a decimal with at most two places
 * inside the allowed range. Empty means the platform default.
 */
export function submissionFeeAmountDraft(text) {
  const typed = String(text).trim().replace(/^\$/u, "").trim();
  if (typed === "")
    return { amountMinor: SUBMISSION_FEE_DEFAULT_MINOR, error: undefined };
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/u.exec(typed);
  const minor = match
    ? (
        BigInt(match[1]) * 10n ** BigInt(SUBMISSION_FEE_DECIMALS) +
        BigInt((match[2] ?? "").padEnd(SUBMISSION_FEE_DECIMALS, "0"))
      ).toString()
    : null;
  return minor !== null && MINOR.test(minor) && inRange(minor)
    ? { amountMinor: minor, error: undefined }
    : {
        amountMinor: undefined,
        error: `Enter an amount from ${submissionFeeAmountText(SUBMISSION_FEE_MIN_MINOR)} to ${submissionFeeAmountText(SUBMISSION_FEE_MAX_MINOR)}, with at most two decimal places.`,
      };
}
