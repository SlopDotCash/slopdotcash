/** The browser must not accept edits that a pending private delivery will discard. */
import { expect, expectAccessible, test } from "./fixtures";

for (const failFirst of [false, true]) {
  test(
    failFirst
      ? "a failed private delivery keeps its fields and can be edited and resent"
      : "a pending private delivery cannot accept text that it will not send",
    async ({ page, diagnostics }, info) => {
      // The real Inbox uses explicit session and submission response fixtures.
      // No private report or GitHub request leaves this test.
      diagnostics.allowPreviewApiMisses();
      const id = "ss_pending_delivery";
      const report = {
        summary: "Synthetic private delivery",
        description: "Synthetic evidence and safe reproduction steps.",
      };
      // An automatic GitHub delivery draft has no Slop intake receipt.
      let submission = {
        id,
        projectId: "fixture-project",
        repository: "example/fixture-project",
        origin: "slop",
        state: "draft",
        revision: 1,
        attempt: 0,
        advisory: null,
        githubCreatedAt: null,
        failureCode: null,
        caseId: null,
        retryAllowed: false,
        reconcileAfter: null,
        intake: null,
      };
      const requests: { expectedRevision: number; report: unknown }[] = [];
      let release: (() => void) | undefined;
      await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname.slice(
          "/api/v1/".length,
        );
        if (path === "project-session")
          return route.fulfill({
            json: {
              session: { githubId: "42", githubLogin: "fixture-reporter" },
            },
          });
        if (path === "projects")
          return route.fulfill({
            json: { schemaVersion: "1", projects: [] },
          });
        if (path === "notifications")
          return route.fulfill({
            json: {
              recipientGithubId: "42",
              notifications: [],
              unread: 0,
            },
          });
        if (path === "security-cases")
          return route.fulfill({
            json: {
              viewer: { githubId: "42", githubLogin: "fixture-reporter" },
              cases: [],
              programs: [],
            },
          });
        if (path === "security-submissions")
          return route.fulfill({
            json: {
              recipientGithubId: "42",
              automatic: true,
              submissions: [submission],
            },
          });
        if (
          path === `security-submissions/${id}/send` &&
          route.request().method() === "POST"
        ) {
          requests.push(route.request().postDataJSON());
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (failFirst && requests.length === 1)
            return route.fulfill({
              status: 503,
              json: {
                error: "fixture_unavailable",
                message: "The report could not be sent. Retry.",
              },
            });
          submission = {
            ...submission,
            state: "submitted",
            revision: 2,
            attempt: 1,
          };
          return route.fulfill({ status: 202, json: { submission } });
        }
        throw new Error(`Unexpected delivery fixture request: ${path}`);
      });
      if (failFirst)
        diagnostics.allowResponse(
          503,
          "POST",
          `/api/v1/security-submissions/${id}/send`,
        );
      try {
        await page.goto(`/inbox?submission=${id}`, {
          waitUntil: "networkidle",
        });
        const card = page.locator(`[aria-labelledby="submission-${id}"]`);
        const form = card.locator("form");
        const summary = form.getByRole("textbox", {
          name: "Summary",
          exact: true,
        });
        const description = form.locator("textarea");
        const fields = form.locator("input, textarea, select");
        const enabledFields = () =>
          fields.evaluateAll(
            (elements) =>
              elements.filter(
                (element) =>
                  !(element as HTMLInputElement | HTMLTextAreaElement).disabled,
              ).length,
          );
        await summary.fill(report.summary);
        await description.fill(report.description);
        const submit = form.getByRole("button", {
          name: "Submit privately",
          exact: true,
        });
        await submit.click();
        await expect.poll(() => requests.length).toBe(1);
        await expect(
          card.getByRole("button", { name: "Submit privately", exact: true }),
        ).toBeDisabled();
        await expect(summary).toBeDisabled();
        await expect(description).toBeDisabled();
        await expect.poll(enabledFields).toBe(0);
        // Text typed after Submit must not become an unsent draft.
        await description.click({ force: true });
        await page.keyboard.type(" Typed while sending.");
        await expect(description).toHaveValue(report.description);
        expect(requests[0]).toEqual({ expectedRevision: 1, report });
        await expectAccessible(page);
        await page.screenshot({
          path: info.outputPath("pending-locked.png"),
          fullPage: true,
        });
        release?.();
        if (failFirst) {
          await expect(card.getByRole("alert")).toContainText(
            "The report could not be sent. Retry.",
          );
          await expect(summary).toBeEnabled();
          await expect(description).toBeEnabled();
          await expect(summary).toHaveValue(report.summary);
          await expect(description).toHaveValue(report.description);
          await expectAccessible(page);
          await page.screenshot({
            path: info.outputPath("failed-draft-kept.png"),
            fullPage: true,
          });
          report.description += " More evidence added after the failure.";
          await description.fill(report.description);
          await submit.click();
          await expect.poll(() => requests.length).toBe(2);
          await expect(description).toBeDisabled();
          expect(requests[1]).toEqual({ expectedRevision: 1, report });
          release?.();
        }
        await expect(form).toHaveCount(0);
        await expect(card).toContainText("Check again");
        expect(
          await page.evaluate(
            (key) => sessionStorage.getItem(key),
            `slop-intake-draft:${id}`,
          ),
        ).toBeNull();
        await expectAccessible(page);
        await page.screenshot({
          path: info.outputPath("sent-report.png"),
          fullPage: true,
        });
      } finally {
        release?.();
      }
    },
  );
}
