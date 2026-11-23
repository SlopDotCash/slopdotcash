import { PUBLISHED_DATA_DEADLINE_MS } from "../../src/lib/browser-json";
import {
  encodeLeaderboardParts,
  MAX_LEADERBOARD_FILE_BYTES,
} from "../../src/lib/leaderboard-transport.mjs";
import { expect, test } from "./fixtures";

const STALLED_REQUEST_DEADLINE_MS = 3_000;
const SLOW_REQUEST_DEADLINE_MS = 6_000;
const SLOW_PART_DELAY_MS = 2_000;

for (const mode of ["complete", "corrupted", "slow", "stalled"] as const) {
  const broken = mode === "corrupted";
  const stalled = mode === "stalled";
  // /points no longer reads the snapshot; the profile page does in every mode.
  test(`profile ${stalled ? "times out stalled" : broken ? "refuses corrupted" : "loads complete"} multi-part snapshot${mode === "slow" ? " across individual request deadlines" : ""}`, async ({
    page,
    diagnostics,
  }) => {
    if (stalled)
      diagnostics.allow(
        /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled) GET http:\/\/127\.0\.0\.1:[0-9]+\/data\/leaderboard\/[^ ?]+\.part$/u,
      );
    // The refused snapshot fails the page before its archive index settles;
    // the page then cancels that background read.
    if (broken)
      diagnostics.allow(
        /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled) GET http:\/\/127\.0\.0\.1:[0-9]+\/data\/cycles\/index\.json\?[^ ]*$/u,
      );
    if (stalled || mode === "slow")
      await page.addInitScript(
        ([deadline, scaled]) => {
          const timeout = AbortSignal.timeout.bind(AbortSignal);
          const any = AbortSignal.any.bind(AbortSignal);
          const browser: Window = window;
          const fetchRequest = browser.fetch.bind(browser);
          const publishedDeadlines = new WeakSet<AbortSignal>();

          // Keep the native timeout and caller cancellation. Only shorten an
          // existing published-data deadline for the snapshot transport.
          AbortSignal.timeout = (ms) => {
            const signal = timeout(ms);
            if (ms === deadline) publishedDeadlines.add(signal);
            return signal;
          };
          AbortSignal.any = (signals) => {
            const combined = any(signals);
            if (signals.some((signal) => publishedDeadlines.has(signal)))
              publishedDeadlines.add(combined);
            return combined;
          };
          browser.fetch = (input, init) => {
            const signal = init?.signal;
            if (
              typeof input === "string" &&
              /^\/data\/leaderboard(?:\.json\?|\/[^/]+\.part$)/u.test(input) &&
              signal &&
              publishedDeadlines.has(signal)
            )
              return fetchRequest(input, {
                ...init,
                signal: any([signal, timeout(scaled)]),
              });
            return fetchRequest(input, init);
          };
        },
        [
          PUBLISHED_DATA_DEADLINE_MS,
          stalled ? STALLED_REQUEST_DEADLINE_MS : SLOW_REQUEST_DEADLINE_MS,
        ] as const,
      );
    await page.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      }),
    );
    await page.route("**/api/v1/wallet-claims/actors/*/current", (route) =>
      route.fulfill({ json: null }),
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
      // Each response meets the scaled per-request deadline. The four
      // sequential responses take longer than that deadline in total.
      if (mode === "slow")
        await new Promise((resolve) => setTimeout(resolve, SLOW_PART_DELAY_MS));
      await route.fulfill({
        body: broken ? Buffer.from("changed") : Buffer.from(bytes),
        contentType: "text/plain; charset=utf-8",
      });
    });
    // Encode before navigation so fixture work is not charged to the
    // browser's (scaled) request deadline.
    const served = await page.request.get("/data/leaderboard.json");
    expect(served.status()).toBe(200);
    const snapshot = await served.body();
    // Valid JSON whitespace expands the existing fixture without changing a
    // single record, count or score; only the deployment transport changes.
    const encoded = encodeLeaderboardParts(
      Buffer.concat([
        Buffer.alloc(
          MAX_LEADERBOARD_FILE_BYTES +
            1 -
            Math.min(snapshot.length, MAX_LEADERBOARD_FILE_BYTES),
          0x20,
        ),
        snapshot,
      ]),
    );
    for (const part of encoded.parts) chunks.set(part.path, part.bytes);
    await page.route("**/data/leaderboard.json?**", async (route) => {
      rootReads++;
      await route.fulfill({
        body: Buffer.from(encoded.root),
        contentType: "application/json",
      });
    });
    await page.goto("/contributors/lalalune");
    if (broken || stalled) {
      await expect(page.getByRole("alert")).toContainText(
        "Data could not load",
        { timeout: 15_000 },
      );
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toBeVisible();
      expect(partReads).toBeGreaterThan(0);
      if (stalled) expect(partReads).toBe(2);
    } else {
      await expect
        .poll(() => partReads, { timeout: 15_000 })
        .toBeGreaterThan(1);
      await expect(page.locator("main.profile-page")).toBeVisible({
        timeout: mode === "slow" ? 20_000 : 10_000,
      });
      if (mode === "slow") {
        expect(rootReads).toBe(1);
        expect(partReads).toBe(4);
      }
    }
  });
}
