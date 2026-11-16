/** @throws {RangeError} */
export function isoFromMillis(millis: number): string {
  return new Date(millis).toISOString();
}

/** @throws {never} */
export function millisFromIso(iso: string): number {
  return Date.parse(iso);
}
