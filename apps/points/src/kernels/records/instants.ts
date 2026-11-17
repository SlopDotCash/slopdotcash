//@ backend dafny
// spec/points/periods.md, "An instant is a UTC month and day, and a period is the month of occurrence"
import { periodOf } from "../../../gen/points__periods.ts";

const lastMonth = 119999;

function leap(year: number): boolean {
  //@ requires year >= 0
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  //@ requires year >= 0 && 1 <= month && month <= 12
  //@ ensures 28 <= \result && \result <= 31
  if (month === 2) return leap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** @throws {never} */
export function instantAt(year: number, month: number, day: number): number {
  //@ requires 0 <= year && 1 <= month && month <= 12 && 1 <= day && day <= 31
  //@ ensures \result >= 0
  //@ ensures periodOf(\result) === year * 12 + month - 1
  return (year * 12 + month - 1) * 100 + day - 1;
}

/** @throws {never} */
export function isInstant(at: number): boolean {
  return at >= 0 && periodOf(at) <= lastMonth && at % 100 < daysInMonth(Math.floor(periodOf(at) / 12), periodOf(at) % 12 + 1);
}

function digitAt(text: string, at: number): number {
  //@ requires 0 <= at && at < text.length
  //@ ensures -1 <= \result && \result <= 9
  const code = text.charCodeAt(at);
  return 48 <= code && code <= 57 ? code - 48 : -1;
}

function numberAt(text: string, at: number, width: number): number {
  //@ requires 0 <= at && 0 <= width && at + width <= text.length
  //@ ensures \result >= -1
  let value = 0;
  let valid = true;
  let i = 0;
  while (i < width) {
    //@ invariant 0 <= i && i <= width
    //@ invariant value >= 0
    //@ decreases width - i
    const digit = digitAt(text, at + i);
    valid = valid && digit >= 0;
    value = digit >= 0 ? value * 10 + digit : value;
    i = i + 1;
  }
  return valid ? value : -1;
}

function separated(text: string): boolean {
  //@ requires text.length === 24
  return text.charCodeAt(4) === 45 && text.charCodeAt(7) === 45 && text.charCodeAt(10) === 84
    && text.charCodeAt(13) === 58 && text.charCodeAt(16) === 58 && text.charCodeAt(19) === 46 && text.charCodeAt(23) === 90;
}

function clockValid(text: string): boolean {
  //@ requires text.length === 24
  const hour = numberAt(text, 11, 2);
  const minute = numberAt(text, 14, 2);
  const second = numberAt(text, 17, 2);
  return 0 <= hour && hour <= 23 && 0 <= minute && minute <= 59 && 0 <= second && second <= 59 && numberAt(text, 20, 3) >= 0;
}

/** @throws {never} */
export function instantOf(text: string): number | null {
  //@ ensures \result === null || \result >= 0
  if (text.length !== 24 || !separated(text) || !clockValid(text)) return null;
  const year = numberAt(text, 0, 4);
  const month = numberAt(text, 5, 2);
  const day = numberAt(text, 8, 2);
  if (year < 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return instantAt(year, month, day);
}

function padded(value: number, width: number): string {
  //@ requires value >= 0 && width >= 0
  let text = "";
  let rest = value;
  let left = width;
  while (left > 0 || rest > 0) {
    //@ invariant rest >= 0 && left >= 0
    //@ decreases rest + left
    const digit = rest % 10;
    text = "0123456789".slice(digit, digit + 1) + text;
    rest = Math.floor(rest / 10);
    left = left > 0 ? left - 1 : 0;
  }
  return text;
}

/** @throws {never} */
export function dayStartOf(at: number): string {
  //@ requires isInstant(at)
  const month = periodOf(at);
  return padded(Math.floor(month / 12), 4) + "-" + padded(month % 12 + 1, 2) + "-" + padded(at % 100 + 1, 2) + "T00:00:00.000Z";
}
