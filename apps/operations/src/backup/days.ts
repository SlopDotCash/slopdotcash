// spec/operations/backup.md, "One cycle copies an ordered verified prefix and completes one manifest"
const dayMillis = 86_400_000;
const shape = /^(\d{4})-(\d{2})-(\d{2})$/u;

function padded(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** @throws {never} */
export function dayOfMillis(millis: number): number {
  return Math.floor(millis / dayMillis);
}

/** @throws {never} */
export function dayText(day: number): string {
  const date = new Date(day * dayMillis);
  return `${padded(date.getUTCFullYear(), 4)}-${padded(date.getUTCMonth() + 1, 2)}-${padded(date.getUTCDate(), 2)}`;
}

/** @throws {never} */
export function dayNumber(text: string): number | undefined {
  const parts = shape.exec(text);
  if (parts === null) return undefined;
  const millis = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const day = millis / dayMillis;
  return Number.isSafeInteger(day) && day > 0 && dayText(day) === text ? day : undefined;
}

/** @throws {never} */
export function dayOfIso(iso: string): number | undefined {
  const millis = Date.parse(iso);
  return Number.isFinite(millis) && millis > 0 ? dayOfMillis(millis) : undefined;
}
