/** The browser must not accept edits that a pending correction will discard. */
import { enlargeText } from "../text-size";
import { expect, expectAccessible, test } from "./fixtures";

for (const failFirst of [false, true]) {
  test(
    failFirst
      ? "a failed private correction keeps its fields and can be edited and retried"
      : "a pending private correction cannot accept text that its response would discard",
    async ({ page, diagnostics }, info) => {
      // The real Inbox and editor use explicit session, storage and screening
      // response fixtures. No private report or provider request leaves this test.
      diagnostics.allowPreviewApiMisses();
      const id = "ss_pending_correction";
      const original = {
        summary: "Synthetic report correction",
        description:
          "Original synthetic report evidence for this local fixture.",
        severity: "high",
      };
      const correction = {
        ...original,
        description:
          "Corrected synthetic evidence with safe reproduction steps.",
        cweIds: ["CWE-284"],
      };
      let stored: typeof original & { cweIds?: string[] } = original;
      let submission = {
        id,
        projectId: "fixture-project",
        repository: "example/fixture-project",
        origin: "slop",
        state: "draft",
        revision: 2,
        attempt: 0,
        advisory: null,
        githubCreatedAt: null,
        failureCode: null,
        caseId: null,
        retryAllowed: false,
        reconcileAfter: null,
        intake: {
          state: "needs-information",
          receivedAt: "2026-10-27T12:00:00.000Z",
          revision: 2,
          reason: "Add safe reproduction steps.",
          reviewedAt: null,
          canReview: false,
          canForward: false,
          canRetryScreening: false,
          canAuthorize: false,
          canRevise: true,
        },
      };
      const requests: { expectedRevision: number; report: typeof stored }[] =
        [];
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
              automatic: false,
              submissions: [submission],
            },
          });
        if (path === `security-submissions/${id}`)
          return route.fulfill({ json: { submission, report: stored } });
        if (
          path === `security-submissions/${id}/report` &&
          route.request().method() === "POST"
        ) {
          const body = route.request().postDataJSON();
          requests.push(body);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (failFirst && requests.length === 1)
            return route.fulfill({
              status: 503,
              json: {
                error: "fixture_unavailable",
                message: "The correction could not be saved. Retry.",
              },
            });
          stored = body.report;
          submission = {
            ...submission,
            revision: 3,
            intake: {
              ...submission.intake,
              revision: 3,
              state: "queued",
              reason: "",
              canRevise: false,
            },
          };
          return route.fulfill({ json: { submission } });
        }
        throw new Error(`Unexpected correction fixture request: ${path}`);
      });
      if (failFirst)
        diagnostics.allowResponse(
          503,
          "POST",
          `/api/v1/security-submissions/${id}/report`,
        );
      try {
        await page.goto(`/inbox?submission=${id}`, {
          waitUntil: "networkidle",
        });
        const card = page.locator(`[aria-labelledby="submission-${id}"]`);
        await card.getByText("Read private report", { exact: true }).click();
        await expect(card.locator("pre.security-report-text")).toHaveText(
          original.description,
        );
        await card
          .getByText("Add evidence or correct report", { exact: true })
          .click();
        const form = card.locator("form");
        const summary = form.getByRole("textbox", {
          name: "Summary",
          exact: true,
        });
        const description = form.locator("textarea");
        const severity = form.getByRole("combobox");
        const cvss = form.getByPlaceholder(
          "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        );
        const cwe = form.getByPlaceholder("CWE-284");
        await description.fill(correction.description);
        await cwe.fill("CWE-284");
        const restoreText = await enlargeText(page.locator("main"));
        await expectAccessible(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath("editor-text200.png"),
          fullPage: true,
        });
        await restoreText();
        const save = form.getByRole("button", {
          name: "Save and screen again",
          exact: true,
        });
        await cwe.focus();
        await page.keyboard.press("Tab");
        await expect(save).toBeFocused();
        await page.keyboard.press("Enter");
        await expect.poll(() => requests.length).toBe(1);
        for (const field of [summary, description, severity, cvss, cwe])
          await expect(field).toBeDisabled();
        await expect(
          form.getByRole("button", { name: "Saving…", exact: true }),
        ).toBeDisabled();
        // Keyboard input after Save must not become an unsent correction.
        await page.keyboard.type("Additional steps typed while saving.");
        await expect(description).toHaveValue(correction.description);
        expect(requests[0]).toEqual({
          expectedRevision: 2,
          report: correction,
        });
        await expectAccessible(page);
        await page.screenshot({
          path: info.outputPath("pending-locked.png"),
          fullPage: true,
        });
        release?.();
        if (failFirst) {
          await expect(form.getByRole("alert")).toContainText(
            "The correction could not be saved. Retry.",
          );
          for (const field of [summary, description, severity, cvss, cwe])
            await expect(field).toBeEnabled();
          await expect(description).toHaveValue(correction.description);
          await expect(summary).toHaveValue(correction.summary);
          await expect(severity).toHaveValue("high");
          await expect(cwe).toHaveValue("CWE-284");
          await expectAccessible(page);
          await page.screenshot({
            path: info.outputPath("failed-draft-kept.png"),
            fullPage: true,
          });
          correction.description +=
            " More evidence added after the failed save.";
          await description.fill(correction.description);
          // Retain the existing severity/CVSS exclusion after the form unlocks.
          await cvss.fill("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
          await expect(severity).toBeDisabled();
          await cvss.fill("");
          await expect(severity).toBeEnabled();
          await cwe.focus();
          await page.keyboard.press("Tab");
          await expect(save).toBeFocused();
          await page.keyboard.press("Enter");
          await expect.poll(() => requests.length).toBe(2);
          await expect(description).toBeDisabled();
          release?.();
        }
        await expect(card.locator("pre.security-report-text")).toHaveText(
          correction.description,
        );
        await expect(form).toHaveCount(0);
        await expect(card).toContainText("Waiting for screening.");
        expect(requests.at(-1)).toEqual({
          expectedRevision: 2,
          report: correction,
        });
        expect(stored).toEqual(correction);
        await expectAccessible(page);
        await page.screenshot({
          path: info.outputPath("saved-correction.png"),
          fullPage: true,
        });
      } finally {
        release?.();
      }
    },
  );
}
