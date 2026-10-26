import { expect, test } from "./fixtures";

test("hero types, deletes and cycles all original campaign phrases without moving the layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  const text = heading.locator(".hero-typewriter");
  await expect(text).toHaveText("SHIPPING OPEN SOURCE.");
  await page.evaluate(() => document.fonts.ready);
  const before = await heading.boundingBox();
  // Each step is longer than the hero's longest pause, so it fires the one
  // pending timer; the next timer starts only after React renders the step.
  const advanceUntil = async (reached: (value: string) => boolean) => {
    for (let step = 0; step < 200; step += 1) {
      if (reached((await text.textContent()) ?? "")) return;
      await page.clock.runFor(2_500);
    }
    throw new Error("The hero typewriter stopped advancing");
  };
  for (const next of [
    "SECURING THE WEB.",
    "HACKING THE PLANET.",
    "BUILDING AGI.",
    "SHIPPING OPEN SOURCE.",
  ]) {
    await advanceUntil((value) => value === "");
    await advanceUntil(
      (value) =>
        value.length > 0 &&
        value.length < next.length &&
        next.startsWith(value),
    );
    await advanceUntil((value) => value === next);
    await expect(text).toHaveText(next);
    await expect(heading).toHaveAccessibleName(
      "MAKE MONEY SHIPPING OPEN SOURCE.",
    );
    expect((await heading.boundingBox())?.height).toBe(before?.height);
  }
});

test("reduced motion keeps the hero static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-24T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T00:00:01Z"));
  await page.goto("/");
  const text = page.locator(".hero-typewriter");
  await expect(text).toHaveText("SHIPPING OPEN SOURCE.");
  await page.clock.runFor(30_000);
  await expect(text).toHaveText("SHIPPING OPEN SOURCE.");
  await expect(
    page.locator(".hero-typewriter > .hero-typewriter-caret"),
  ).toBeHidden();
});
