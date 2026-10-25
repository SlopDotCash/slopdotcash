/** Owner decision, 25 October 2026: ongoing API assessment starts in November.
 * September and October use the subscription assessment/import path only.
 * Selecting alerts-only is still explicit; this date never enables a call.
 */
export const VALUE_API_START_AT = "2026-11-01T00:00:00.000Z";

export type ValueSettingsEnv = {
  SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD?: string;
  SLOPBOT_VALUE_ATTEMPT_RESERVE_MICRO_USD?: string;
  SLOPBOT_VALUE_START_AT?: string;
};

const amount = (value: string) =>
  /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;

/** Shared by the consumer and release validation. Null never admits inference. */
export function valueSettings(env: ValueSettingsEnv) {
  const mode = env.SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD ?? "";
  const reserve = env.SLOPBOT_VALUE_ATTEMPT_RESERVE_MICRO_USD ?? "";
  const alertsOnly = mode === "alerts-only";
  const monthly = alertsOnly ? null : amount(mode);
  const maximum = alertsOnly ? null : amount(reserve);
  const startText =
    env.SLOPBOT_VALUE_START_AT || (alertsOnly ? VALUE_API_START_AT : "");
  const start = Date.parse(startText);
  if (
    (!alertsOnly && (monthly === null || maximum === null)) ||
    (reserve !== "" && amount(reserve) === null) ||
    (monthly !== null && maximum !== null && maximum > monthly) ||
    !Number.isFinite(start) ||
    new Date(start).toISOString() !== startText ||
    start < Date.parse(VALUE_API_START_AT)
  )
    return null;
  return { monthly, maximum, start };
}
