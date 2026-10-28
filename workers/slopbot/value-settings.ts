/** Owner decision, 25 October 2026: ongoing API assessment starts in November.
 * September and October use the subscription assessment/import path only.
 * Selecting alerts-only is still explicit; this date never enables a call.
 */
export const VALUE_API_START_AT = "2026-11-01T00:00:00.000Z";

/** The subscription intake covers only work accepted before the API start.
 * It matches the API consumer: a closed pull's merge time, else close time,
 * against the same configured start. Later work belongs to the API route, so a
 * subscription record cannot score it.
 */
export function historicalSubscriptionSource(
  pull: { state: string; merged_at: string | null; closed_at: string | null },
  start: number,
) {
  if (pull.state !== "closed") return false;
  const occurred = Date.parse(pull.merged_at ?? pull.closed_at ?? "");
  return Number.isFinite(occurred) && occurred < start;
}

/** The consumer's configured start, or the fixed start when it refuses all
 * inference. A delayed API start never leaves work owned by neither route.
 */
export const subscriptionCutoff = (env: ValueSettingsEnv) =>
  valueSettings(env)?.start ?? Date.parse(VALUE_API_START_AT);

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
