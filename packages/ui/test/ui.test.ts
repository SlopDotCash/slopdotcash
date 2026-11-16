// The design tokens against the design system's roles and contrast requirements, in both themes.
import tokens from "@repo/design-system/tokens.json" with { type: "json" };
import { contrast, parseTokens } from "vibestack/design/tokens";
import { expect, test } from "vitest";
import { requiredContrast, roles, token } from "../gen/designSystem.ts";

const { color } = parseTokens(tokens);
const themes = ["light", "dark"] as const;
const shade = (theme: (typeof themes)[number], name: string) => (color[theme] as Record<string, string>)[name];

test("each role is one token in both themes", () => {
  // spec/designSystem/index.md, "Each role is one token in both themes"
  const named = roles.map(token).sort();
  expect(themes.map((theme) => Object.keys(color[theme]).sort())).toEqual([named, named]);
});

test("every required pair meets its least contrast in both themes", () => {
  // spec/designSystem/index.md, "Text meets 4.5:1 and boundaries 3:1 on the surfaces they sit on"
  const below = themes.flatMap((theme) =>
    requiredContrast
      .map(({ text, surface, least }) => ({ theme, text, surface, least, ratio: contrast(shade(theme, token(text)), shade(theme, token(surface))) }))
      .filter(({ ratio, least }) => ratio * 10 < least),
  );
  expect(below).toEqual([]);
});
