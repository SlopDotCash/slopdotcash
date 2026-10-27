import type { Locator } from "@playwright/test";

/** Enlarge one rendered subtree, preserving exact inline styles for restoration. */
export async function enlargeText(root: Locator): Promise<() => Promise<void>> {
  const originals = await root.evaluateHandle((element) => {
    const typography = [...element.querySelectorAll<HTMLElement>("*")]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({
        element,
        style: element.getAttribute("style"),
        font: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
      }));
    for (const { element, font, line } of typography) {
      element.style.fontSize = `${Number.parseFloat(font) * 2}px`;
      if (line !== "normal")
        element.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
    }
    return typography.map(({ element, style }) => ({ element, style }));
  });
  return async () => {
    await originals.evaluate((items) => {
      for (const { element, style } of items) {
        if (style === null) element.removeAttribute("style");
        else element.setAttribute("style", style);
      }
    });
    await originals.dispose();
  };
}
