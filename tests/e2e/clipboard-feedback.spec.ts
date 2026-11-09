import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Keep the real routed UI and control only browser clipboard completion order.
// These cases do not assert operating-system clipboard permission or contents.
async function controlClipboard(page: Page) {
  await page.addInitScript(() => {
    const requests: {
      value: string;
      resolve: () => void;
      reject: () => void;
    }[] = [];
    Object.defineProperty(window, "copyRequests", { value: requests });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) =>
          new Promise<void>((resolve, reject) => {
            requests.push({
              value,
              resolve,
              reject: () =>
                reject(new DOMException("Denied", "NotAllowedError")),
            });
          }),
      },
    });
  });
}

async function settleCopy(page: Page, index: number, success: boolean) {
  await page.evaluate(
    async ({ index, success }) => {
      const controlled = window as Window & {
        copyRequests?: { resolve: () => void; reject: () => void }[];
      };
      const request = controlled.copyRequests?.[index];
      if (!request) throw new Error(`Missing clipboard request ${index}`);
      if (success) request.resolve();
      else request.reject();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    },
    { index, success },
  );
}

for (const outcome of ["success", "failure"] as const) {
  test(`clearance changes the displayed prompt before old copy ${outcome}`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    await controlClipboard(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/.well-known/slop/projects.json", async (route) => {
      await held;
      await route.fulfill({
        json: { schemaVersion: "1", projects: [{ project_id: "eliza" }] },
      });
    });
    try {
      await page.goto("/projects/eliza", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Checking project clearance…")).toBeVisible();
      await page
        .getByRole("button", { name: "Copy agent prompt", exact: true })
        .click();
      release();
      await expect(
        page.getByRole("status", { name: "Agent prompt" }),
      ).toContainText("elizaOS/eliza");
      await settleCopy(page, 0, outcome === "success");
      await expect(page.locator(".agent-prompt-box button")).toHaveAttribute(
        "data-copy",
        "idle",
      );
      await page
        .getByRole("button", { name: "Copy agent prompt", exact: true })
        .click();
      await settleCopy(page, 1, true);
      await expect(
        page.getByRole("button", { name: "Copied agent prompt", exact: true }),
      ).toBeVisible();
      const values = await page.evaluate(() =>
        (
          window as Window & { copyRequests?: { value: string }[] }
        ).copyRequests?.map((request) => request.value),
      );
      expect(values?.[0]).not.toContain("elizaOS/eliza");
      expect(values?.[1]).toContain("elizaOS/eliza");
    } finally {
      release();
    }
  });
}

for (const firstSucceeds of [true, false]) {
  test(`the latest copy result survives an older ${firstSucceeds ? "success" : "failure"}`, async ({
    page,
    diagnostics,
  }) => {
    diagnostics.allowPreviewApiMisses();
    await controlClipboard(page);
    await page.goto("/", { waitUntil: "networkidle" });
    const button = page.locator(".agent-prompt-box button");
    await button.click();
    await button.click();
    await settleCopy(page, 1, !firstSucceeds);
    await expect(button).toHaveAttribute(
      "data-copy",
      firstSucceeds ? "error" : "copied",
    );
    await settleCopy(page, 0, firstSucceeds);
    await expect(button).toHaveAttribute(
      "data-copy",
      firstSucceeds ? "error" : "copied",
    );
  });
}

test("copying again clears the previous success and starts a fresh feedback timer", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowPreviewApiMisses();
  await controlClipboard(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const button = page.locator(".agent-prompt-box button");
  await button.click();
  await settleCopy(page, 0, true);
  await expect(button).toHaveAttribute("data-copy", "copied");
  await button.click();
  await expect(button).toHaveAttribute("data-copy", "idle");
  await settleCopy(page, 1, true);
  await expect(button).toHaveAttribute("data-copy", "copied");
  await expect(button).toHaveAttribute("data-copy", "idle");
});
