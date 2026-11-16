import { expect, test } from "bun:test";

const { normalizeTlaFolds } = (await import(
  new URL("./quint-tla-normalization.mjs", import.meta.url).href
)) as { normalizeTlaFolds(source: string): string };

test("fold normalization preserves literals that previously changed a verdict", () => {
  const source = `x == "ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA"`;
  expect(normalizeTlaFolds(source)).toBe(source);
});

test("quoted escapes do not turn literal contents into fold code", () => {
  const source = String.raw`x == "escaped \" ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA ) \\"
y == ApaFoldSet(LET F(a, b) == a + b IN __QUINT_LAMBDA0, 0, {1})`;
  expect(normalizeTlaFolds(source)).toBe(
    String.raw`x == "escaped \" ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA ) \\"
y == LET F(a, b) == a + b IN  ApaFoldSet(__QUINT_LAMBDA0, 0, {1})`,
  );
});

test("line and nested block comments retain fold-shaped text", () => {
  const source = String.raw`\* ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA
(* outer (* ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA *) tail *)
x == ApaFoldSet(LET F(a, b) == a + b IN __QUINT_LAMBDA0, 0, {1})`;
  expect(normalizeTlaFolds(source)).toBe(
    String.raw`\* ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA
(* outer (* ApaFoldSet( LET v == 0 IN __QUINT_LAMBDA *) tail *)
x == LET F(a, b) == a + b IN  ApaFoldSet(__QUINT_LAMBDA0, 0, {1})`,
  );
});

test("genuine fold code retains the upstream rewrite", () => {
  expect(
    normalizeTlaFolds(
      "ApaFoldSet(LET __QUINT_LAMBDA0(a, b) == a + b IN __QUINT_LAMBDA0, 0, {1, 2})",
    ),
  ).toBe(
    "LET __QUINT_LAMBDA0(a, b) == a + b IN  ApaFoldSet(__QUINT_LAMBDA0, 0, {1, 2})",
  );
});

test("nested LET binds the fold to the outer IN, not the lambda in a definition", () => {
  const source =
    "ApaFoldSeqLeft(LET F(a, b) == LET __QUINT_LAMBDA1(x) == x IN __QUINT_LAMBDA1(a) IN __QUINT_LAMBDA0, 0, <<1>>)";
  expect(normalizeTlaFolds(source)).toBe(
    "LET F(a, b) == LET __QUINT_LAMBDA1(x) == x IN __QUINT_LAMBDA1(a) IN  ApaFoldSeqLeft(__QUINT_LAMBDA0, 0, <<1>>)",
  );
});

test("a non-lambda outer IN is unchanged even when a nested IN has a lambda", () => {
  const source =
    "ApaFoldSet(LET F == LET G == 1 IN __QUINT_LAMBDA0 IN F, 0, {1})";
  expect(normalizeTlaFolds(source)).toBe(source);
});

test("keywords in comments and literals do not close the active LET", () => {
  const source = `ApaFoldSet(LET __QUINT_LAMBDA0(a, b) == "IN __QUINT_LAMBDA9" (* IN __QUINT_LAMBDA8 *) IN __QUINT_LAMBDA0, "", {"x"})`;
  expect(normalizeTlaFolds(source)).toBe(
    `LET __QUINT_LAMBDA0(a, b) == "IN __QUINT_LAMBDA9" (* IN __QUINT_LAMBDA8 *) IN  ApaFoldSet(__QUINT_LAMBDA0, "", {"x"})`,
  );
});

test("comments between fold tokens remain intact when code moves", () => {
  const source = `ApaFoldSet((* keep (* nested *) comment *) LET F(a, b) == a + b IN __QUINT_LAMBDA0, 0, {1})`;
  expect(normalizeTlaFolds(source)).toBe(
    `LET F(a, b) == a + b IN  ApaFoldSet((* keep (* nested *) comment *) __QUINT_LAMBDA0, 0, {1})`,
  );
});

test("all nested folds normalize once and the result is idempotent", () => {
  const source =
    "ApaFoldSet(LET __QUINT_LAMBDA0(a, b) == ApaFoldSeqLeft(LET __QUINT_LAMBDA1(c, d) == c + d IN __QUINT_LAMBDA1, a, <<b>>) IN __QUINT_LAMBDA0, 0, {1})";
  const expected =
    "LET __QUINT_LAMBDA0(a, b) == LET __QUINT_LAMBDA1(c, d) == c + d IN  ApaFoldSeqLeft(__QUINT_LAMBDA1, a, <<b>>) IN  ApaFoldSet(__QUINT_LAMBDA0, 0, {1})";
  expect(normalizeTlaFolds(source)).toBe(expected);
  expect(normalizeTlaFolds(expected)).toBe(expected);
});

test("an incomplete fold cannot consume another definition's IN", () => {
  const source =
    "ApaFoldSet(LET F == 0)\nOther == LET X == 1 IN __QUINT_LAMBDA1";
  expect(normalizeTlaFolds(source)).toBe(source);
});
