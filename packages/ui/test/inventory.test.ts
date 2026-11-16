// What spec/ui/index.md says of the package as a whole: one primitive per control kind, stories for every component,
// and literal colors only for another party's mark.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type ControlKind, primitive } from "../gen/ui.ts";
import * as ui from "../src/index.ts";

const components = join(import.meta.dirname, "../src/components");
const sources = readdirSync(components).filter((file) => /^[A-Z]\w*\.tsx$/.test(file));
const exported = readFileSync(join(import.meta.dirname, "../src/index.ts"), "utf8").match(/(?<=\.\/components\/)\w+(?=\.tsx)/g) ?? [];
// Every kind once: the compiler refuses a kind left out or one the spec does not have.
const kinds = Object.keys({
  Action: 0, Text: 0, LongText: 0, Choice: 0, OneOf: 0, Toggle: 0, Check: 0, FileChoice: 0, Paging: 0, Reveal: 0, CopyText: 0, Confirm: 0,
} satisfies Record<ControlKind, 0>) as ControlKind[];

test("each control kind has one exported primitive, and every component file has stories", () => {
  // spec/ui/index.md, "Each control kind has one primitive, and every component has stories"
  const primitives = kinds.map(primitive);
  expect(new Set(primitives).size).toBe(kinds.length);
  expect(primitives.filter((name) => typeof (ui as Record<string, unknown>)[name] !== "function")).toEqual([]);
  expect([...exported].sort()).toEqual(sources.map((file) => file.slice(0, -4)).sort());
  expect(sources.filter((file) => !readdirSync(components).includes(file.replace(/\.tsx$/, ".meta.tsx")))).toEqual([]);
});

test("a literal color is another party's mark, with its reason on the line above", () => {
  // spec/ui/index.md, "Colors are tokens, except another party's mark"
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;
  const unexplained = sources.flatMap((file) => {
    const lines = readFileSync(join(components, file), "utf8").split("\n");
    return lines.flatMap((line, at) => literal.test(line) && !/no-literal-colors -- \S/.test(lines[at - 1] ?? "") ? [`${file}:${at + 1}`] : []);
  });
  expect(unexplained).toEqual([]);
});
