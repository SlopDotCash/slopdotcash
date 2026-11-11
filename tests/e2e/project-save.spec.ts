import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { CONTRIBUTION } from "../project-application-manifest";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessible, test } from "./fixtures";
import {
  holdProjectSessionUntilUnmount,
  leaveEditorWithHeldSession,
  readProjectDraft,
  releaseHeldEditorSession,
} from "./project-draft-fixture";

test("committed project editor unmount retires publication before dispatch", async ({
  page,
}) => {
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
  let writes = 0;
  await page.route(
    /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
    async (route) => {
      const request = route.request();
      if (request.method() === "PUT") writes += 1;
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
    await page
      .getByLabel("Short description", { exact: true })
      .fill("A draft that must remain unpublished after leaving its editor");
    const savedDraft = await readProjectDraft(
      page,
      "slop:project-update:v2:eliza",
    );
    const before = await api.stored();
    await holdProjectSessionUntilUnmount(page, "#field-headline");
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, "", "/how-it-works");
      window.history.pushState({}, "", "/projects/eliza/manage");
    });
    await page
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    await leaveEditorWithHeldSession(page);
    await expect(page.locator("#field-headline")).toHaveCount(0);
    expect(writes).toBe(0);
    expect(await api.stored()).toEqual(before);
    expect(
      await readProjectDraft(page, "slop:project-update:v2:eliza"),
    ).toEqual(savedDraft);
  } finally {
    await releaseHeldEditorSession(page);
    await api.dispose();
  }
});

test("an image decoded after a headline publication uses the new draft revision", async ({
  page,
}, info) => {
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    image: undefined,
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
    const decode = window.createImageBitmap.bind(window);
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const control = { release: () => release(), returned: false, closed: 0 };
    Object.assign(window, { lateProjectImage: control });
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      await pending;
      const bitmap = await decode(...args);
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => {
        control.closed++;
        close();
      };
      control.returned = true;
      return bitmap;
    }) as typeof createImageBitmap;
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
  type ImageWindow = Window & {
    lateProjectImage: { release(): void; returned: boolean; closed: number };
  };
  try {
    await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas");
      context.fillStyle = "#f65b22";
      context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png");
    });
    await page
      .getByLabel("Project image (optional)", { exact: true })
      .setInputFiles({
        name: "late-avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      });
    await expect(
      page.getByText("Preparing image…", { exact: true }),
    ).toBeVisible();
    const headline = "A saved headline before the image finishes decoding";
    await page.getByLabel("Short description", { exact: true }).fill(headline);
    await page
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision 2." }),
    ).toBeVisible();
    const first = await api.stored();
    expect(first.revision).toBe(2);
    expect(first.project.headline).toBe(headline);
    expect(first.project.image).toBeUndefined();
    await page.evaluate(() =>
      (window as unknown as ImageWindow).lateProjectImage.release(),
    );
    const preview = page.getByRole("img", {
      name: "Project avatar preview",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(
      page.getByText("Preparing image…", { exact: true }),
    ).toHaveCount(0);
    const image = await preview.getAttribute("src");
    expect(image).toMatch(/^data:image\/(?:webp|jpeg);base64,/u);
    expect(
      await page.evaluate(
        () => (window as unknown as ImageWindow).lateProjectImage.closed,
      ),
    ).toBe(1);
    expect(
      await readProjectDraft(page, "slop:project-update:v2:eliza"),
    ).toMatchObject({ baseRevision: 2, image });
    await expect(
      page.getByRole("button", { name: "Use this draft", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision 3." }),
    ).toBeVisible();
    const second = await api.stored();
    expect(second.revision).toBe(3);
    expect(second.project.headline).toBe(headline);
    expect(second.project.image).toBe(image);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("image-after-headline-save.png"),
      fullPage: true,
    });
  } finally {
    if (!page.isClosed())
      await page.evaluate(() =>
        (window as unknown as ImageWindow).lateProjectImage?.release(),
      );
    await api.dispose();
  }
});

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
    route.fulfill({ json: { viewer: { githubId: "4242" }, setup } }),
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

for (const boundary of ["departure", "actor-change"] as const) {
  test(`an accepted project revision cannot clear a newer draft after ${boundary}`, async ({
    page,
    diagnostics,
  }, info) => {
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
    const api = await projectImageApiFixture(project, {
      incompleteAssessments: true,
    });
    let otherActor = false;
    let accepted = false;
    let otherRevisionReads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    diagnostics.allowCanceledBackgroundReads();
    await page.route("**/api/v1/projects", (route) =>
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
    );
    await page.route("**/api/v1/points/me", (route) =>
      route.fulfill({ json: null }),
    );
    await page.route(
      /\/api\/v1\/(?:projects\/eliza(?:\?.*)?|project-setup\/eliza(?:\/check)?|project-session)$/u,
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const response = await api.fetch(
          new Request(request.url(), {
            method: request.method(),
            headers: {
              ...request.headers(),
              ...(otherActor ? { "x-fixture-role": "other" } : {}),
            },
            ...(request.method() === "GET" ? {} : { body: request.postData() }),
          }),
        );
        if (request.method() === "PUT") {
          expect(request.headers()["x-slop-expected-github-id"]).toBe("4242");
          expect(response.status).toBe(200);
          accepted = true;
          await held;
        } else if (otherActor && url.pathname === "/api/v1/projects/eliza") {
          otherRevisionReads += 1;
        }
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      },
    );
    try {
      await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
      const description = page.getByLabel("Short description", { exact: true });
      await description.fill("Submitted revision before the view changed");
      await expect
        .poll(
          async () =>
            (await readProjectDraft(page, "slop:project-update:v2:eliza"))
              ?.headline,
        )
        .toBe("Submitted revision before the view changed");
      await page
        .getByRole("button", { name: "Publish changes", exact: true })
        .click();
      await expect.poll(() => accepted).toBe(true);
      expect((await api.stored()).revision).toBe(2);

      if (boundary === "departure") {
        await page
          .getByRole("link", { name: "Slop home", exact: true })
          .click();
        await expect(description).toHaveCount(0);
        await page.goBack();
      } else {
        // The real fixture changes both its session response and the actor
        // consumed by subsequent project requests. It grants both actors
        // repository access; this tests lifetime, not access denial.
        otherActor = true;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => otherRevisionReads).toBeGreaterThan(0);
      }
      await expect(description).toBeVisible();
      await description.fill("Newer local draft must survive the old response");
      await expect
        .poll(
          async () =>
            (await readProjectDraft(page, "slop:project-update:v2:eliza"))
              ?.headline,
        )
        .toBe("Newer local draft must survive the old response");
      release();
      await page.waitForLoadState("networkidle");
      await expect(description).toHaveValue(
        "Newer local draft must survive the old response",
      );
      expect(
        (await readProjectDraft(page, "slop:project-update:v2:eliza"))
          ?.headline,
      ).toBe("Newer local draft must survive the old response");
      await expect(
        page.getByText("Published revision 2.", { exact: true }),
      ).toHaveCount(0);
      const stored = await api.stored();
      expect(stored.revision).toBe(2);
      expect(stored.project.headline).toBe(
        "Submitted revision before the view changed",
      );
      await page.screenshot({
        path: info.outputPath(`project-publication-${boundary}.png`),
        fullPage: true,
      });
    } finally {
      release();
      await api.dispose();
    }
  });
}

test("discarding an old project draft cancels its pending image decode", async ({
  page,
}, info) => {
  const registered = PROJECTS.find((project) => project.id === "eliza");
  if (!registered) throw new Error("Missing project fixture");
  const api = await projectImageApiFixture({
    ...registered,
    image: undefined,
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
    localStorage.setItem(
      "slop:project-update:v2:eliza",
      JSON.stringify({
        baseRevision: 0,
        headline: "An old draft that the owner will discard",
      }),
    );
    const decode = window.createImageBitmap.bind(window);
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = window as unknown as {
      releaseImage: () => void;
      imageDecodeFinished: boolean;
    };
    state.releaseImage = release;
    state.imageDecodeFinished = false;
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      await wait;
      const result = await decode(...args);
      state.imageDecodeFinished = true;
      return result;
    }) as typeof createImageBitmap;
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
    await expect(
      page.getByRole("button", { name: "Discard draft", exact: true }),
    ).toBeVisible();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      return canvas.toDataURL("image/png");
    });
    await page
      .getByLabel("Project image (optional)", { exact: true })
      .setInputFiles({
        name: "discarded.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      });
    await expect(
      page.getByText("Preparing image…", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Discard draft", exact: true })
      .click();
    await expect(page.getByLabel("Short description")).toHaveValue(
      registered.headline,
    );
    await page.evaluate(() =>
      (window as unknown as { releaseImage: () => void }).releaseImage(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { imageDecodeFinished: boolean })
              .imageDecodeFinished,
        ),
      )
      .toBe(true);
    await expect(
      page.getByText("Preparing image…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "Project avatar preview", exact: true }),
    ).toHaveCount(0);
    expect(
      await readProjectDraft(page, "slop:project-update:v2:eliza"),
    ).toBeNull();
  } finally {
    if (!page.isClosed())
      await page.screenshot({
        path: info.outputPath("discarded-image-decode.png"),
        fullPage: true,
      });
    await api.dispose();
  }
});
