import {
  encodeLeaderboardParts,
  MAX_LEADERBOARD_FILE_BYTES,
} from "../../src/lib/leaderboard-transport.mjs";
import { expect, test } from "./fixtures";

for (const broken of [false, true]) {
  test(`ranking ${broken ? "refuses corrupted" : "loads complete"} multi-part snapshot`, async ({
    page,
  }) => {
    await page.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      }),
    );
    const chunks = new Map<string, Uint8Array>();
    let partReads = 0;
    await page.route("**/data/leaderboard/*.part", async (route) => {
      partReads++;
      const bytes = chunks.get(new URL(route.request().url()).pathname);
      if (!bytes) throw new Error("Unexpected snapshot part");
      await route.fulfill({
        body: broken ? Buffer.from("changed") : Buffer.from(bytes),
        contentType: "application/octet-stream",
      });
    });
    await page.route("**/data/leaderboard.json?**", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.body();
      // Valid JSON whitespace expands the existing fixture without changing a
      // single record, count or score; only the deployment transport changes.
      const bytes = Buffer.concat([
        Buffer.alloc(
          MAX_LEADERBOARD_FILE_BYTES +
            1 -
            Math.min(snapshot.length, MAX_LEADERBOARD_FILE_BYTES),
          0x20,
        ),
        snapshot,
      ]);
      const encoded = encodeLeaderboardParts(bytes);
      for (const part of encoded.parts) chunks.set(part.path, part.bytes);
      await route.fulfill({
        body: Buffer.from(encoded.root),
        contentType: "application/json",
      });
    });
    await page.goto("/points");
    if (broken) {
      await expect(page.getByRole("alert")).toContainText(
        "Data could not load",
        { timeout: 35_000 },
      );
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      expect(partReads).toBeGreaterThan(0);
    } else {
      await expect
        .poll(() => partReads, { timeout: 35_000 })
        .toBeGreaterThan(1);
      await expect(page.getByRole("table")).toBeVisible();
    }
  });
}
