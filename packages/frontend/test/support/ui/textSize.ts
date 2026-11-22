// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
import type { Locator } from "playwright";

export async function enlargeText(root: Locator): Promise<() => Promise<void>> {
  const settle = () => root.page().evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const originals = await root.evaluateHandle((element) => {
    const typography = [...element.querySelectorAll<HTMLElement>("*")]
      .filter((each) => each instanceof HTMLElement)
      .map((each) => ({
        element: each,
        hadStyle: each.hasAttribute("style"),
        inline: ["font-size", "line-height"].map((name) => ({ name, value: each.style.getPropertyValue(name), priority: each.style.getPropertyPriority(name) })),
        font: getComputedStyle(each).fontSize,
        line: getComputedStyle(each).lineHeight,
      }));
    for (const { element: each, font, line } of typography) {
      each.style.fontSize = `${Number.parseFloat(font) * 2}px`;
      if (line !== "normal") each.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
    }
    return typography.map(({ element: each, hadStyle, inline }) => ({ element: each, hadStyle, inline }));
  });
  await settle();
  return async () => {
    await originals.evaluate((items) => {
      for (const { element, hadStyle, inline } of items) {
        for (const { name, value, priority } of inline) {
          if (value) element.style.setProperty(name, value, priority);
          else element.style.removeProperty(name);
        }
        if (!hadStyle && element.style.length === 0) element.removeAttribute("style");
      }
    });
    await originals.dispose();
    await settle();
  };
}
