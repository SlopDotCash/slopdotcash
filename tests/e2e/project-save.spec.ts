import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessible, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ json: { schemaVersion: "1", projects: [] } }),
  );
});

test.use({ video: "on" });
test("a browser without WebP encoding can upload and persist its project image", async ({
  page,
}, info) => {
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
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
  });
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      // Standards-required fallback: real PNG bytes when WebP has no encoder.
      return encode.call(
        this,
        type === "image/webp" ? "image/png" : type,
        quality,
      );
    };
  });
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      const response = await api.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          ...(request.method() === "GET" ? {} : { body: request.postData() }),
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
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas");
      context.fillStyle = "#f65b22";
      context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL("image/png");
    });
    await page
      .getByLabel("Project image (optional)", { exact: true })
      .setInputFiles({
        name: "project.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      });
    const preview = page.getByRole("img", {
      name: "Project avatar preview",
      exact: true,
    });
    await expect(preview).toBeVisible();
    const uploaded = await preview.getAttribute("src");
    expect(uploaded).toMatch(/^data:image\/jpeg;base64,/u);
    if (!uploaded) throw new Error("Missing encoded image");
    expect(uploaded.length).toBeLessThanOrEqual(16_384);
    await page
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    await expect
      .poll(async () => (await api.stored()).project.image)
      .toBe(uploaded);
    const stored = await api.stored();
    const jpeg = Buffer.from(uploaded.split(",")[1], "base64");
    // A valid JPEG comment makes the actual browser image exceed the cap.
    const oversized = `data:image/jpeg;base64,${Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([0xff, 0xfe, 0x40, 0x02]),
      Buffer.alloc(16_384, 0x61),
      jpeg.subarray(2),
    ]).toString("base64")}`;
    for (const image of [
      uploaded.replace("image/jpeg", "image/webp"),
      oversized,
    ]) {
      const origin = new URL(page.url()).origin;
      const refused = await api.fetch(
        new Request(`${origin}/api/v1/projects/eliza`, {
          method: "PUT",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: stored.revision,
            manifest: { ...stored.project, image },
          }),
        }),
      );
      expect(refused.status).toBe(422);
    }
    expect((await api.stored()).revision).toBe(stored.revision);
    await page.reload({ waitUntil: "networkidle" });
    await expect(preview).toHaveAttribute("src", uploaded ?? "");
    expect(
      await preview.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    ).toBe(128);
  } finally {
    try {
      if (!page.isClosed()) {
        await page
          .getByLabel("Project image (optional)", { exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("project-image.png"),
          fullPage: true,
        });
      }
    } finally {
      await api.dispose();
    }
  }
});
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
    nextAction: {
      kind: "none",
      message: "Project is ready.",
      href: "/projects/eliza",
    },
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
  await page.route(/\/api\/v1\/project-setup\/eliza(?:\/check)?$/, (route) =>
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
