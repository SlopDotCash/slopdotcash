/**
 * The shared browser test. Every spec imports `test` and `expect` from here.
 *
 * An automatic fixture watches every page of every browser context a test
 * opens. It records console errors, page errors, first-party request failures
 * and first-party 4xx/5xx responses, attaches them to the test, and fails the
 * test unless each one matches a failure the test caused on purpose and
 * declared with `diagnostics.allow(...)`. A request the page or a navigation
 * cancels is not a failure.
 */
import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

export { expect };

const { site: SITE } = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);

export type Diagnostics = {
  /** Accepts recorded failures that match a pattern; each line is checked. */
  allow(...patterns: RegExp[]): void;
};

const CANCELED = new Set([
  "net::ERR_ABORTED",
  "NS_BINDING_ABORTED",
  "cancelled",
]);

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
      // The static preview server has no API, so its 404 for an API path is a
      // missing test service, also where a spec serves the build under the
      // deployed site origin. The registry lane checks the API on Pages
      // Functions with D1.
      if (
        testInfo.config.metadata.server === "preview" &&
        new URL(origin).hostname === "127.0.0.1"
      ) {
        const api = (from: string) =>
          `${escapeRegExp(from)}/(?:api|\\.well-known/slop)/`;
        allowed.push(
          new RegExp(`^404 GET ${api(origin)}`, "u"),
          new RegExp(
            `^console Failed to load resource: the server responded with a status of 404 \\(Not Found\\) at (?:${api(origin)}|${api(SITE)})`,
            "u",
          ),
        );
      }
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
          const reason = request.failure()?.errorText ?? "failed";
          if (firstParty(request.url()) && !CANCELED.has(reason))
            failures.push(`${reason} ${request.method()} ${request.url()}`);
        });
        watched.on("response", (response) => {
          if (firstParty(response.url()) && response.status() >= 400)
            failures.push(
              `${response.status()} ${response.request().method()} ${response.url()}`,
            );
        });
      };
      watch(context);
      browser.on("context", watch);
      await use({ allow: (...patterns) => allowed.push(...patterns) });
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

/** Asserts no WCAG 2.0 and 2.1 level A and AA violation on the page. */
export async function expectAccessible(
  page: Page,
  { include }: { include?: string } = {},
) {
  const builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
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
