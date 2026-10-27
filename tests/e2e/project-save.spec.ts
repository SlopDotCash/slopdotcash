import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { expect, expectAccessible, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
});

test.use({ video: "on" });
test("retains edits typed while a project revision is being published", async ({
  page,
}) => {
  const registered = PROJECTS.find((entry) => entry.id === "eliza");
  if (!registered) throw new Error("Eliza is missing");
  let current = { ...registered, contribution: { ...CONTRIBUTION } };
  let revision = 1;
  const writes: { expectedRevision: number; manifest: typeof current }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setup = {
    projectId: "eliza",
    name: current.name,
    slug: current.slug,
    revision,
    status: "active",
    state: "ready",
    nextAction: null,
    checks: {
      authority: { state: "verified", message: "Maintainer verified." },
      installation: { state: "installed", message: "Slopbot installed." },
      scan: { state: "cleared", exempt: true, message: "Existing project." },
    },
    funding: { mode: "none" },
    activatedRevision: 1,
    checkedAt: "2026-10-26T00:00:00.000Z",
  };
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  await page.route("**/api/v1/project-setup/eliza/check", (route) =>
    route.fulfill({ json: { setup } }),
  );
  await page.route("**/api/v1/projects/eliza*", async (route) => {
    if (route.request().method() === "PUT") {
      const write = route.request().postDataJSON();
      writes.push(write);
      if (writes.length === 1) await held;
      current = write.manifest;
      revision += 1;
      await route.fulfill({
        json: {
          project: {
            id: "eliza",
            revision,
            status: "active",
            manifest: current,
          },
          changes: {
            presentation: ["headline"],
            executable: [],
            financial: [],
          },
          setup: { ...setup, revision, activatedRevision: revision },
        },
      });
    } else await route.fulfill({ json: { revision, project: current } });
  });
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const description = page.getByLabel("Short description");
  await expect(description).toHaveValue(current.headline);
  await description.fill("First description submitted for review");
  await page
    .getByLabel("Revision note")
    .fill("Preserve edits made while saving.");
  const started = page.waitForRequest((request) => request.method() === "PUT");
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await started;
  await description.fill("Second description typed while the save is pending");
  await page.screenshot({
    path: test.info().outputPath("edits-during-save.png"),
    fullPage: true,
  });
  release();
  await expect(page.getByText("Published revision 2.")).toBeVisible();
  await expect(description).toHaveValue(
    "Second description typed while the save is pending",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(description).toHaveValue(
    "Second description typed while the save is pending",
  );
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await expect(page.getByText("Published revision 3.")).toBeVisible();
  expect(
    writes.map((write) => [write.expectedRevision, write.manifest.headline]),
  ).toEqual([
    [1, "First description submitted for review"],
    [2, "Second description typed while the save is pending"],
  ]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(description).toHaveValue(
    "Second description typed while the save is pending",
  );
  await expectAccessible(page);
});
