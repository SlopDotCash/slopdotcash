//@ backend dafny
// spec/points/window.md, "A window spans exactly 35 days and never moves back"; spec/points/window.md, "Each permanent ID is recorded once with the reason it counts or not"
import { windowDays } from "../../gen/points__window.ts";

export const dayMs = 86400000;

export function upperDay(nowMs: number): number {
  //@ requires nowMs >= 0
  //@ ensures (\result - 1) * 86400000 < nowMs && nowMs <= \result * 86400000
  return Math.floor((nowMs + dayMs - 1) / dayMs);
}

export function dayOf(upper: number, toMs: number, millis: number): number {
  //@ ensures millis === toMs ==> \result === upper
  //@ ensures millis === toMs - windowDays * 86400000 ==> \result === upper - windowDays
  //@ ensures millis >= toMs <==> \result >= upper
  //@ ensures millis >= toMs - windowDays * 86400000 <==> \result >= upper - windowDays
  return upper + Math.floor((millis - toMs) / dayMs);
}

export function mergedDay(at: number, atMs: number, mergedAtMs: number): number {
  //@ ensures at > 0 ==> \result > 0
  //@ ensures at >= \result <==> atMs >= mergedAtMs
  return atMs < mergedAtMs ? at + 1 : at;
}
