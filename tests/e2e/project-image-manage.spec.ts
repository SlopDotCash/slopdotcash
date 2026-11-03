import type { Page } from "@playwright/test";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { expect, expectAccessible, test } from "./fixtures";

async function ownerFixture(page: Page, stale = false) {
  const registered = PROJECTS.find((entry) => entry.id === "eliza");
  if (!registered) throw new Error("Eliza fixture missing");
  const project = { ...registered, contribution: CONTRIBUTION };
  const submissions: { manifest: { image?: string; headline: string } }[] = [];
  const revision = stale ? 2 : 1;
  const setup = {
    projectId: "eliza",
    name: project.name,
    slug: project.slug,
    revision,
    status: "paused",
    state: "waiting",
    nextAction: {
      kind: "wait_for_scan",
      message: "The security scan is queued. Nothing is needed from you.",
      href: null,
    },
    checks: {
      authority: {
        state: "verified",
        message: "@example has maintain access to elizaOS/eliza.",
      },
      installation: {
        state: "installed",
        message: "Slopbot is installed on elizaOS/eliza.",
      },
      scan: {
        state: "queued",
        message: "The security scan is queued. Nothing is needed from you.",
      },
    },
    funding: { mode: "none" },
    activatedRevision: null,
    checkedAt: "2026-10-23T00:00:00.000Z",
  };
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
    }),
  );
  await page.route("**/data/fixture-project-registry.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: PROJECTS.map((p) => (p.id === project.id ? project : p)),
      },
    }),
  );
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({
      json: {
        session: { githubId: "4242", githubLogin: "example", admin: false },
      },
    }),
  );
  await page.route(/\/api\/v1\/project-setup\/eliza(?:\/check)?$/, (route) =>
    route.fulfill({ json: { setup } }),
  );
  await page.route("**/api/v1/projects/eliza*", (route) => {
    if (route.request().method() !== "PUT")
      return route.fulfill({ json: { revision, project } });
    const submitted = route.request().postDataJSON();
    submissions.push(submitted);
    return route.fulfill({
      json: {
        project: {
          id: "eliza",
          revision: revision + 1,
          status: "paused",
          manifest: { ...project, ...submitted.manifest },
        },
        changes: {
          presentation: ["image", "headline"],
          executable: [],
          financial: [],
        },
        setup,
      },
    });
  });
  if (stale)
    await page.addInitScript(() =>
      localStorage.setItem(
        "slop:project-update:v2:eliza",
        JSON.stringify({
          headline: "Retained stale image draft",
          baseRevision: 1,
        }),
      ),
    );
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Manage project", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Short description")).toHaveValue(
    stale ? "Retained stale image draft" : project.headline,
  );
  return { project, submissions };
}

async function holdImage(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#1368dc";
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png");
  });
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    let release = () => {};
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseManageImage: release });
    window.createImageBitmap = async (source: ImageBitmapSource) => {
      const bitmap = await decode(source);
      await completion;
      return bitmap;
    };
  });
  await page
    .getByLabel("Project image (optional)", { exact: true })
    .setInputFiles({
      name: "manage.png",
      mimeType: "image/png",
      buffer: Buffer.from(png.split(",")[1], "base64"),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "Preparing image" }),
  ).toBeVisible();
}

async function releaseImage(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { releaseManageImage: () => void }
    ).releaseManageImage(),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Preparing image" }),
  ).toHaveCount(0);
}

test("manage image preparation blocks publish until the selected image is ready", async ({
  page,
}) => {
  const { submissions } = await ownerFixture(page);
  await page
    .getByLabel("Short description")
    .fill("Publish the selected project image");
  await holdImage(page);
  const publish = page.getByRole("button", {
    name: "Publish changes",
    exact: true,
  });
  await page.screenshot({
    path: test.info().outputPath("manage-image-preparing.png"),
    fullPage: true,
  });
  await expect(publish).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await releaseImage(page);
  const preview = page.getByAltText("Project avatar preview");
  await expect(preview).toHaveAttribute(
    "src",
    /^data:image\/(?:webp|jpeg);base64,/u,
  );
  const selected = await preview.getAttribute("src");
  await expect(publish).toBeEnabled();
  await expectAccessible(page);
  await publish.focus();
  await publish.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision 2." }),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].manifest.image).toBe(selected);
  expect(submissions[0].manifest.headline).toBe(
    "Publish the selected project image",
  );
  await page.screenshot({
    path: test.info().outputPath("manage-image-published.png"),
    fullPage: true,
  });
});

test("manage image preparation keeps stale draft actions blocked until completion", async ({
  page,
}) => {
  const { project, submissions } = await ownerFixture(page, true);
  const useDraft = page.getByRole("button", {
    name: "Use this draft",
    exact: true,
  });
  const discard = page.getByRole("button", {
    name: "Discard draft",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await holdImage(page);
  await page.screenshot({
    path: test.info().outputPath("manage-stale-image-preparing.png"),
    fullPage: true,
  });
  await expect(useDraft).toBeDisabled();
  await expect(discard).toBeDisabled();
  await releaseImage(page);
  await expect(discard).toBeEnabled();
  await expect(useDraft).toBeEnabled();
  await discard.focus();
  await discard.press("Enter");
  await expect(page.getByLabel("Short description")).toHaveValue(
    project.headline,
  );
  await expect(page.getByAltText("Project avatar preview")).toHaveCount(
    project.image ? 1 : 0,
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("slop:project-update:v2:eliza")),
    )
    .toBeNull();
  expect(submissions).toHaveLength(0);
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("manage-stale-image-discarded.png"),
    fullPage: true,
  });
});
