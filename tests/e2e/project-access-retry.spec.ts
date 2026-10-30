import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

for (const denied of [false, true]) {
  test(
    denied
      ? "a refused project settings check does not grant maintainer access"
      : "project settings can retry a temporary GitHub access failure",
    async ({ page, diagnostics }, info) => {
      const registered = PROJECTS.find((project) => project.id === "eliza");
      if (!registered) throw new Error("Missing project fixture");
      const project = {
        ...registered,
        contribution: { ...CONTRIBUTION },
        skill: {
          ...registered.skill,
          sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
          publishAtRoot: false,
        },
        reviewSkill: {
          ...registered.reviewSkill,
          sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
        },
      };
      const api = await projectImageApiFixture(project);
      let unavailable = true;
      let successfulAccessReads = 0;
      let writes = 0;
      diagnostics.allowResponse(
        denied ? 403 : 503,
        "GET",
        "/api/v1/project-setup/eliza",
      );
      diagnostics.allowCanceledBackgroundReads();
      await page.route("**/api/v1/projects", (route) =>
        route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
      );
      await page.route("**/.well-known/slop/projects.json", (route) =>
        route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
      );
      await page.route("**/api/v1/points/me", (route) =>
        route.fulfill({ json: null }),
      );
      await page.route(
        /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.pathname === "/api/v1/project-setup/eliza") {
            if (denied || unavailable) {
              await route.fulfill({
                status: denied ? 403 : 503,
                json: denied
                  ? {
                      error: "authority_required",
                      message:
                        "Current GitHub maintainer authority is required.",
                    }
                  : {
                      error: "github_unavailable",
                      message: "GitHub could not be checked. Try again.",
                    },
              });
              return;
            }
            successfulAccessReads += 1;
          }
          if (
            request.method() === "PUT" &&
            url.pathname === "/api/v1/projects/eliza"
          )
            writes += 1;
          const response = await api.fetch(
            new Request(request.url(), {
              method: request.method(),
              headers: request.headers(),
              ...(request.method() === "GET"
                ? {}
                : { body: request.postData() }),
            }),
          );
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
        },
      );
      try {
        await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
        const publish = page.getByRole("button", {
          name: "Publish changes",
          exact: true,
        });
        if (denied) {
          await expect(
            page.getByText(
              "Project settings are available only to this project's maintainers.",
            ),
          ).toBeVisible();
          await expect(publish).toHaveCount(0);
          expect(successfulAccessReads).toBe(0);
          expect(writes).toBe(0);
          return;
        }
        await page.screenshot({
          path: info.outputPath("access-unavailable.png"),
          fullPage: true,
        });
        await expect(
          page.getByText("GitHub could not be checked. Try again.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(publish).toHaveCount(0);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await expectAccessible(page);
        const retry = page.getByRole("button", {
          name: "Retry access check",
          exact: true,
        });
        await retry.click();
        await expect(retry).toBeEnabled();
        await expect(publish).toHaveCount(0);
        unavailable = false;
        await retry.focus();
        await page.keyboard.press("Enter");
        await expect(publish).toBeVisible();
        expect(successfulAccessReads).toBeGreaterThan(0);
        expect(writes).toBe(0);
        await expectAccessible(page);
        await page.screenshot({
          path: info.outputPath("access-recovered.png"),
          fullPage: true,
        });
      } finally {
        await api.dispose();
      }
    },
  );
}
