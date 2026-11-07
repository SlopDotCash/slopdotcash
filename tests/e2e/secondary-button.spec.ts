import { expect, expectAccessible, test } from "./fixtures";

test.use({
  video: "on",
  contextOptions: { reducedMotion: "no-preference" },
});

for (const zoom of [1, 2]) {
  test(`a secondary action stays readable as it becomes enabled at ${zoom * 100}% zoom`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    await page.goto("/projects/eliza", { waitUntil: "networkidle" });
    await page.evaluate(async (zoom) => {
      await document.fonts.ready;
      document.body.style.zoom = String(zoom);
      const container = document.createElement("section");
      container.dataset.testid = "secondary-button-transition";
      container.style.cssText = "padding:24px;background:var(--raised)";
      const button = document.createElement("button");
      button.className = "button secondary-button";
      button.textContent = "Authorize private GitHub delivery";
      button.disabled = true;
      button.addEventListener("click", () => {
        button.dataset.clicked = "true";
      });
      container.append(button);
      document.body.prepend(container);
    }, zoom);
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
    // The app retains a 320 CSS-pixel minimum; a zoomed mobile view may pan.
    if (zoom === 1) await expect(button).toBeInViewport({ ratio: 1 });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("data-clicked", "true");
    await page.screenshot({
      path: test.info().outputPath("secondary-enabled.png"),
    });
    await expectAccessible(page, {
      include: '[data-testid="secondary-button-transition"]',
    });
  });
}
