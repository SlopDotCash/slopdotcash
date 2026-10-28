/**
 * The shared browser test. Every spec imports `test` and `expect` from here.
 *
 * An automatic fixture watches every page of every browser context a test
 * opens. It records console errors, page errors, first-party request failures
 * and first-party 4xx/5xx responses, attaches them to the test, and fails the
 * test unless each one matches a failure the test caused on purpose and
 * declared with `diagnostics.allow(...)`. A request that the page or a
 * navigation cancels is a failure too, unless the test allows it. A request
 * that already failed with a 4xx/5xx response counts once, as that response,
 * even when the browser later cancels its unread body.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
  type Request,
} from "@playwright/test";
import type { CycleIndex } from "../../src/lib/cycle-index";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

export { expect };

const { site: SITE } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

export type Diagnostics = {
  /** Accepts recorded failures that match a pattern; each line is checked. */
  allow(...patterns: RegExp[]): void;
  /**
   * Accepts one first-party response that the test causes on purpose and the
   * browser's console report of it: one status, one method and one path.
   * Returns the response pattern, so the test can `count` the responses.
   */
  allowResponse(status: number, method: string, path: string): RegExp;
  /**
   * Accepts the static preview server's 404 for API and discovery reads,
   * which it cannot answer, also where a spec serves the build under the
   * deployed site origin. It does nothing on Pages Functions, where the
   * registry lane checks those reads with D1.
   */
  allowPreviewApiMisses(): void;
  /**
   * Accepts the cancellation of the app's shared background reads: the
   * session, inbox, email preference, vault, points and payment reads. Their
   * panels cancel them when a step leaves or reloads them, or when the local
   * server passes the request deadline. Every other cancellation counts.
   */
  allowCanceledBackgroundReads(): void;
  /** How many recorded failures so far match the pattern. */
  count(pattern: RegExp): number;
};

/** A first-party request that the page or the browser canceled. */
export const CANCELED = /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled) /u;

/** Follow the owner entry point and open its retained Security settings. */
export async function openProjectSecuritySettings(page: Page) {
  const label = "Manage security program and private bounty funds";
  const link = page.getByRole("link", { name: label, exact: true });
  if (new URL(page.url()).pathname.endsWith("/manage")) {
    await expect(link).toBeVisible();
    await link.click();
  }
  await expect(page).toHaveURL(
    /\/projects\/[^/]+\/security(?:\?[^#]*)?#security-settings$/u,
  );
  const settings = page.locator("details#security-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator("summary").click();
  await expect(settings).toHaveAttribute("open", "");
}

/** Match historical cycles to a test's deliberately scoped runtime registry. */
export async function serveProjectCycleIndex(
  page: Page,
  projectIds: readonly string[],
): Promise<void> {
  const cycleIndex = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/cycles/index.json"), "utf8"),
  ) as CycleIndex;
  await page.route("**/data/cycles/index.json?**", (route) =>
    route.fulfill({
      json: {
        ...cycleIndex,
        cycles: cycleIndex.cycles.filter((cycle) =>
          projectIds.includes(cycle.projectId),
        ),
      },
    }),
  );
}

/** Escapes a literal for a RegExp source. */
export const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    // Depending on `page` sets this fixture up after the page and tears it
    // down first, so closing the page cannot add failures after the test.
    async ({ baseURL, browser, context, page: _page }, use, testInfo) => {
      const origin = new URL(baseURL ?? "http://127.0.0.1:4466").origin;
      const firstParty = (url: string) => new URL(url).origin === origin;
      const failures: string[] = [];
      const allowed: RegExp[] = [];
      const failedResponses = new WeakSet<Request>();
      const watch = (watched: BrowserContext) => {
        watched.on("console", (message) => {
          if (message.type() === "error")
            failures.push(
              `console ${message.text()} at ${message.location().url}`,
            );
        });
        watched.on("weberror", (error) =>
          failures.push(`page error ${error.error().message}`),
        );
        watched.on("requestfailed", (request) => {
          if (firstParty(request.url()) && !failedResponses.has(request))
            failures.push(
              `${request.failure()?.errorText ?? "failed"} ${request.method()} ${request.url()}`,
            );
        });
        watched.on("response", (response) => {
          if (firstParty(response.url()) && response.status() >= 400) {
            failedResponses.add(response.request());
            failures.push(
              `${response.status()} ${response.request().method()} ${response.url()}`,
            );
          }
        });
      };
      watch(context);
      browser.on("context", watch);
      // Specs that serve the built bundle on the product origin have no
      // payments backend there. Money received is then a complete empty
      // aggregate unless a spec routes its own records (page routes win).
      await context.route(`${SITE}/api/v1/payments/received`, (route) =>
        route.fulfill({
          json: {
            schemaVersion: "1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            contributors: [],
            totals: {
              usdMicro: "0",
              directMicro: "0",
              vaultUsdMicro: "0",
              directTransfers: 0,
              vaultPayments: 0,
              contributors: 0,
            },
          },
        }),
      );
      await use({
        allow: (...patterns) => allowed.push(...patterns),
        allowResponse: (status, method, path) => {
          const url = escapeRegExp(`${origin}${path}`);
          const response = new RegExp(`^${status} ${method} ${url}$`, "u");
          allowed.push(
            response,
            new RegExp(
              `^console Failed to load resource: the server responded with a status of ${status} \\(.+\\) at ${url}$`,
              "u",
            ),
          );
          return response;
        },
        allowPreviewApiMisses: () => {
          if (
            testInfo.config.metadata.server !== "preview" ||
            new URL(origin).hostname !== "127.0.0.1"
          )
            return;
          const api = (from: string) =>
            `${escapeRegExp(from)}/(?:api|\\.well-known/slop)/`;
          allowed.push(
            new RegExp(`^404 GET ${api(origin)}`, "u"),
            new RegExp(
              `^console Failed to load resource: the server responded with a status of 404 \\(Not Found\\) at (?:${api(origin)}|${api(SITE)})`,
              "u",
            ),
          );
        },
        allowCanceledBackgroundReads: () =>
          allowed.push(
            new RegExp(
              `^(?:net::ERR_ABORTED|NS_BINDING_ABORTED) GET ${escapeRegExp(origin)}/api/v1/(?:project-session|notifications(?:/email)?|project-vaults/[^ /?]+|points/[^ ?]+|payments/[^ ?]+)(?:\\?[^ ]*)?$`,
              "u",
            ),
          ),
        count: (pattern) =>
          failures.filter((failure) => pattern.test(failure)).length,
      });
      browser.off("context", watch);
      const unexpected = failures.filter(
        (failure) => !allowed.some((pattern) => pattern.test(failure)),
      );
      await testInfo.attach("browser-diagnostics", {
        body: JSON.stringify({
          sourceRevision: testInfo.config.metadata.sourceRevision,
          failures,
          unexpected,
        }),
        contentType: "application/json",
      });
      expect(
        unexpected,
        "browser console, page, request, and response failures",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Asserts no WCAG 2.0 and 2.1 level A and AA violation on the page. With
 * `everyRule`, axe also runs its best-practice rules.
 */
export async function expectAccessible(
  page: Page,
  {
    include,
    everyRule = false,
  }: { include?: string; everyRule?: boolean } = {},
) {
  const builder = new AxeBuilder({ page });
  if (!everyRule)
    builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder.include(include);
  expect((await builder.analyze()).violations).toEqual([]);
}

/**
 * The browser project's short name. Specs that share one registry D1 add it
 * to fixture ids, so the desktop and mobile runs never touch the same rows.
 */
export function projectSuffix() {
  return test.info().project.name.replace(/^chromium-/u, "");
}
