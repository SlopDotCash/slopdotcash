/**
 * Regression: compareActors must pin collation to English so i/I login
 * pairs keep a host-independent order. project-view uses this as the final
 * leader tie-break for frozen payment intent indices.
 * Distinct from #2135/#2143/#2151 (other modules).
 */
import { expect, spyOn, test } from "bun:test";
import { compareActors } from "../src/lib/github-actor";

const left = { id: "MDQ6VXNlcjEwMA==", login: "Ivan" };
const right = { id: "MDQ6VXNlcjEwMQ==", login: "ivan" };

function withTurkishLocale(run: () => void) {
  const original = String.prototype.localeCompare;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    run();
  } finally {
    locale.mockRestore();
  }
}

test("compareActors pins collation to English in source", async () => {
  const src = await Bun.file("src/lib/github-actor.ts").text();
  expect(src).toContain('localeCompare(rightLogin, "en")');
  expect(src).toContain('localeCompare(right.login, "en")');
  expect(src).toContain('localeCompare(right.id, "en")');
});

test("compareActors order matches English under a Turkish default locale", () => {
  const en = Math.sign(compareActors(left, right));
  expect(en).not.toBe(0);
  withTurkishLocale(() => {
    expect(Math.sign(compareActors(left, right))).toBe(en);
  });
});

test("project-view leader sort still ties through compareActors", async () => {
  const src = await Bun.file("src/lib/project-view.ts").text();
  expect(src).toContain('import { compareActors } from "./github-actor"');
  expect(src).toContain("compareActors(left.actor, right.actor)");
  expect(src).toMatch(/frozen payment intent IDs use its index/i);
});
