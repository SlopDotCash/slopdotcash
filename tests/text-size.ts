import type { Locator } from "@playwright/test";

/** Enlarge one rendered subtree, preserving the changed inline declarations. */
export async function enlargeText(root: Locator): Promise<() => Promise<void>> {
  const settle = () =>
    root
      .page()
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
  const originals = await root.evaluateHandle((element) => {
    const typography = [...element.querySelectorAll<HTMLElement>("*")]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({
        element,
        hadStyle: element.hasAttribute("style"),
        inline: ["font-size", "line-height"].map((name) => ({
          name,
          value: element.style.getPropertyValue(name),
          priority: element.style.getPropertyPriority(name),
        })),
        font: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
      }));
    for (const { element, font, line } of typography) {
      element.style.fontSize = `${Number.parseFloat(font) * 2}px`;
      if (line !== "normal")
        element.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
    }
    return typography.map(({ element, hadStyle, inline }) => ({
      element,
      hadStyle,
      inline,
    }));
  });
  await settle();
  return async () => {
    await originals.evaluate((items) => {
      for (const { element, hadStyle, inline } of items) {
        for (const { name, value, priority } of inline) {
          if (value) element.style.setProperty(name, value, priority);
          else element.style.removeProperty(name);
        }
        // Setting the full style attribute would violate the Pages CSP.
        if (!hadStyle && element.style.length === 0)
          element.removeAttribute("style");
      }
    });
    await originals.dispose();
    await settle();
  };
}
