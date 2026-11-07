import { PROJECTS } from "../../src/lib/projects.mjs";
import { expect, test } from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test("delist confirmation keeps keyboard focus inside the flow", async ({
  page,
}) => {
  const project = PROJECTS.find((entry) => entry.id === "asi");
  if (!project) throw new Error("Missing fixture project");
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "operator", admin: true },
      },
    }),
  );
  await page.route("**/api/v1/admin/vetting?**", (route) =>
    route.fulfill({
      json: {
        service: { state: "available", queueRegistrationAvailable: true },
        projects: [
          {
            id: project.id,
            name: project.name,
            status: project.status,
            revision: 1,
            clearance: { state: "cleared", assessment: null },
          },
        ],
        assessments: [],
      },
    }),
  );
  const record = () => ({
    id: project.id,
    status: project.status,
    revision: 1,
    manifest: project,
    manifestSha256: "a".repeat(64),
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    sourceApplicationId: null,
    enforcement: {
      state: "clear",
      appeal: "none",
      projectAppeal: "none",
      since: null,
      restrictedBy: [],
      nextSequence: 1,
      revisionPending: false,
      moderation: "unconfigured",
      decisionRequired: false,
      bannedMaintainers: [],
      records: [],
    },
  });
  await page.route("**/api/v1/admin/projects", (route) =>
    route.fulfill({ json: { projects: [record()] } }),
  );
  await page.goto(`/admin?project=${project.id}`, {
    waitUntil: "networkidle",
  });
  const delist = page.getByRole("button", { name: "Delist", exact: true });
  await expect(delist).toBeVisible();
  // A keyboard-only admin Tabs to Delist and activates it with Enter; the
  // confirmation replaces the button, so focus must move to the prompt
  // instead of falling to the top of the document.
  await delist.focus();
  await page.keyboard.press("Enter");
  const prompt = page.getByText("Hide this project everywhere?");
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeFocused();
  // Cancelling from the keyboard must land back on the Delist button that
  // opened the confirmation, not at the top of the page.
  const keep = page.getByRole("button", { name: "Keep listed", exact: true });
  await keep.focus();
  await page.keyboard.press("Enter");
  await expect(prompt).toHaveCount(0);
  await expect(delist).toBeFocused();
});
