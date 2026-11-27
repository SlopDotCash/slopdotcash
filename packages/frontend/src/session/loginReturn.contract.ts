// spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import type { ParsedNext } from "../../gen/frontend__composition.ts";
import { vectors } from "../kernels/vectors.ts";
import { parseNext } from "./loginReturn.ts";

const origin = "https://slop.cash";
const foreign: ParsedNext = { tag: "ForeignOrMalformed" };
const path = (value: string): ParsedNext => ({ tag: "SameOriginPath", path: value });

export const onlySameOriginPathsSurviveTheLoginReturn = vectors<string, ParsedNext>([
  ["", foreign],
  ["?next=", foreign],
  ["?next=%2Finbox", path("/inbox")],
  ["?next=earnings", path("/earnings")],
  ["?next=%2Fprojects%2Fslop%2Fmanage%3Ftab%3Done%23wallets", path("/projects/slop/manage?tab=one#wallets")],
  ["?next=%2Faccount%23notifications", path("/account#notifications")],
  ["?next=%2Flogin%2F", foreign],
  ["?next=%2Flogin%2F%2F", foreign],
  ["?next=%2Flogin%2F%3Fnext%3D%252Finbox", foreign],
  ["?next=%2Flogin", foreign],
  ["?next=%2Flogin%3Fnext%3D%252Finbox", foreign],
  ["?next=%2F%2Fevil.test", foreign],
  ["?next=%2F%5Cevil.test", foreign],
  ["?next=%2F.%2F%2Fevil.test", foreign],
  ["?next=%2Fa%2F..%2F%2Fevil.test", foreign],
  ["?next=https%3A%2F%2Fevil.test%2Finbox", foreign],
  ["?next=inbox", foreign],
  ["?next=javascript%3Aalert(1)", foreign],
], (search) => parseNext(search, origin));
