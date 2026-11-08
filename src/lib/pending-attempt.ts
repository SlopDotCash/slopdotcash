/** Optional on legacy records; new wallet requests receive a fresh identity. */
export type PendingAttempt = { attemptId?: string };

export function validPendingAttemptId(value: unknown) {
  return (
    value === undefined ||
    (typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ))
  );
}

function matchesPendingAttempt(raw: string | null, expected: PendingAttempt) {
  if (raw === null) return false;
  const current = JSON.parse(raw) as PendingAttempt | null;
  return (
    !!current &&
    (expected.attemptId !== undefined
      ? current.attemptId === expected.attemptId
      : current.attemptId === undefined &&
        JSON.stringify(current) === JSON.stringify(expected))
  );
}

function matchesPendingRecord(raw: string | null, expected: PendingAttempt) {
  return (
    raw !== null &&
    JSON.stringify(JSON.parse(raw)) === JSON.stringify(expected)
  );
}

/** A new prompt cannot overwrite an unexpected request in this tab. */
export function createPendingAttempt(key: string, value: PendingAttempt) {
  if (sessionStorage.getItem(key) !== null) return false;
  sessionStorage.setItem(key, JSON.stringify(value));
  return true;
}

/** A departed wallet result may update its own retained request, never a retry. */
export function updatePendingAttempt(
  key: string,
  expected: PendingAttempt,
  value: PendingAttempt,
) {
  if (!matchesPendingAttempt(sessionStorage.getItem(key), expected))
    return false;
  sessionStorage.setItem(key, JSON.stringify(value));
  return true;
}

/** A verification reply cannot replace newer evidence in the same attempt. */
export function updatePendingRecord(
  key: string,
  expected: PendingAttempt,
  value: PendingAttempt,
) {
  if (!matchesPendingRecord(sessionStorage.getItem(key), expected))
    return false;
  sessionStorage.setItem(key, JSON.stringify(value));
  return true;
}

/** Compare and remove without an await: a late result cannot clear a retry. */
export function clearPendingAttempt(key: string, expected: PendingAttempt) {
  if (!matchesPendingRecord(sessionStorage.getItem(key), expected))
    return false;
  sessionStorage.removeItem(key);
  return true;
}
