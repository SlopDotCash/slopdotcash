import {
  encodeLeaderboardParts,
  MAX_LEADERBOARD_FILE_BYTES,
} from "../../src/lib/leaderboard-transport.mjs";
import { expect, test } from "./fixtures";

for (const mode of ["complete", "corrupted", "slow", "stalled"] as const) {
  const broken = mode === "corrupted";
  const stalled = mode === "stalled";
  const profile = mode === "slow" || stalled;
  test(`${profile ? "profile" : "ranking"} ${stalled ? "times out stalled" : broken ? "refuses corrupted" : "loads complete"} multi-part snapshot${mode === "slow" ? " across individual request deadlines" : ""}`, async ({
    page,
    diagnostics,
  }) => {
    if (stalled)
      diagnostics.allow(
        /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled) GET http:\/\/127\.0\.0\.1:[0-9]+\/data\/leaderboard\/[^ ?]+\.part$/u,
      );
    await page.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      }),
    );
    const chunks = new Map<string, Uint8Array>();
    let partReads = 0;
    let rootReads = 0;
    await page.route("**/data/leaderboard/*.part", async (route) => {
      partReads++;
      // Leave this response pending. The browser's request deadline must
      // still cancel it, retry once, and expose the existing Retry action.
      if (stalled) return;
      const bytes = chunks.get(new URL(route.request().url()).pathname);
      if (!bytes) throw new Error("Unexpected snapshot part");
      // Each response meets the existing 15-second request deadline, while
      // the four-part snapshot takes more than the former 12-second total.
      if (mode === "slow")
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.fulfill({
        body: broken ? Buffer.from("changed") : Buffer.from(bytes),
        contentType: "application/octet-stream",
      });
    });
    await page.route("**/data/leaderboard.json?**", async (route) => {
      rootReads++;
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
    await page.goto(profile ? "/contributors/lalalune" : "/points");
    if (broken || stalled) {
      await expect(page.getByRole("alert")).toContainText(
        "Data could not load",
        { timeout: stalled ? 45_000 : 35_000 },
      );
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      expect(partReads).toBeGreaterThan(0);
      if (stalled) expect(partReads).toBe(2);
    } else {
      await expect
        .poll(() => partReads, { timeout: 35_000 })
        .toBeGreaterThan(1);
      await expect(
        profile ? page.locator("main.profile-page") : page.getByRole("table"),
      ).toBeVisible({
        timeout: mode === "slow" ? 35_000 : 10_000,
      });
      if (mode === "slow") {
        expect(rootReads).toBe(1);
        expect(partReads).toBe(4);
      }
    }
  });
}
