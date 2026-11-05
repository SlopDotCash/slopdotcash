import { expect, expectAccessible, test } from "./fixtures";

test.use({
  video: "on",
  contextOptions: { reducedMotion: "no-preference" },
});

test("a secondary action stays readable as it becomes enabled", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const container = document.createElement("section");
    container.dataset.testid = "secondary-button-transition";
    container.style.cssText = "padding:24px;background:var(--raised)";
    const button = document.createElement("button");
    button.className = "button secondary-button";
    button.textContent = "Authorize private GitHub delivery";
    button.disabled = true;
    container.append(button);
    document.body.prepend(container);
  });
  const button = page
    .getByTestId("secondary-button-transition")
    .getByRole("button");
  await expect(button).toBeDisabled();
  await button.evaluate(async (element) => {
    getComputedStyle(element).color;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await button.evaluate((element: HTMLButtonElement) => {
    // Force the disabled style, then inspect the first enabled frame that
    // the private-forwarding workflow's accessibility check observed in CI.
    getComputedStyle(element).color;
    element.disabled = false;
    getComputedStyle(element).color;
    for (const animation of element.getAnimations()) {
      if (
        "transitionProperty" in animation &&
        ["color", "background-color"].includes(
          String(animation.transitionProperty),
        )
      ) {
        animation.pause();
        animation.currentTime = 1;
      }
    }
  });
  await expect(button).toBeEnabled();
  await page.screenshot({
    path: test.info().outputPath("secondary-enabled.png"),
  });
  await expectAccessible(page, {
    include: '[data-testid="secondary-button-transition"]',
  });
});
