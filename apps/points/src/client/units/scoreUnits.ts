//@ backend dafny
// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"

export const POINTS_PER_THIRD = 10;
export const MAX_POINTS = 9007199254740991;

function digitText(digit: number): string {
  //@ requires 0 <= digit && digit <= 9
  return "0123456789".slice(digit, digit + 1);
}

function decimal(value: number): string {
  //@ requires value >= 0
  let rest = value;
  let text = "";
  while (rest >= 10) {
    //@ invariant rest >= 0
    //@ decreases rest
    text = digitText(rest % 10) + text;
    rest = Math.floor(rest / 10);
  }
  return digitText(rest) + text;
}

/** @throws {never} */
export function thirdsText(points: number): string {
  //@ requires 0 <= points
  const tenth = points % POINTS_PER_THIRD;
  const whole = decimal(Math.floor(points / POINTS_PER_THIRD));
  return tenth === 0 ? whole : whole + "." + digitText(tenth);
}

function digitOf(code: number): number {
  //@ ensures -1 <= \result && \result <= 9
  return 48 <= code && code <= 57 ? code - 48 : -1;
}

function wholeOf(text: string): number {
  //@ ensures \result >= -1
  if (text.length === 0 || text.length > 16 || (text.length > 1 && text.charCodeAt(0) === 48)) return -1;
  let value = 0;
  let valid = true;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant value >= 0
    //@ decreases text.length - i
    const digit = digitOf(text.charCodeAt(i));
    valid = valid && digit >= 0;
    value = digit >= 0 ? value * 10 + digit : value;
    i = i + 1;
  }
  return valid ? value : -1;
}

/** @throws {never} */
export function pointsOfThirdsText(text: string): number | null {
  //@ ensures \result === null || (0 <= \result && \result <= MAX_POINTS)
  const length = text.length;
  const fractional = length >= 3 && text.charCodeAt(length - 2) === 46;
  const tenth = fractional ? digitOf(text.charCodeAt(length - 1)) : 0;
  const whole = wholeOf(fractional ? text.slice(0, length - 2) : text);
  if (whole < 0 || tenth < 0 || (fractional && tenth === 0)) return null;
  const points = whole * POINTS_PER_THIRD + tenth;
  return points <= MAX_POINTS ? points : null;
}
