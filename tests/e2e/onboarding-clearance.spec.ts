/** Agent setup always offers a prompt; only a cleared project gets its own. */
import { expect, expectAccessible, test } from "./fixtures";

test("project agent setup falls back to the general prompt until cleared", async ({
  page,
  context,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  // The unavailable clearance list below.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) at |503 GET )http:\/\/[^ ]+\/\.well-known\/slop\/projects\.json$/u,
  );
  let state: "unavailable" | "blocked" | "cleared" = "unavailable";
  await page.route("**/.well-known/slop/projects.json", (route) =>
    state === "unavailable"
      ? route.fulfill({ status: 503, body: "" })
      : route.fulfill({
          json: {
            schemaVersion: "1",
            projects: state === "blocked" ? [] : [{ project_id: "eliza" }],
          },
        }),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  await expect(
    page.getByText("Project clearance could not be checked."),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("/SKILL.md");
  await expect(page.getByText("inbound terms")).toHaveCount(0);
  // Public project pages keep work selection in the agent workflow.
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
  state = "blocked";
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText("This project is not cleared for agents."),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).not.toContainText("elizaOS/eliza");
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
  state = "cleared";
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("elizaOS/eliza");
  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  await expect(page.getByRole("button", { name: /Copied/u })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "elizaOS/eliza",
  );
  await page.screenshot({
    path: info.outputPath("project-agent-setup.png"),
    fullPage: true,
  });
});

test("a cleared project keeps a plain agent setup without an open-work list", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: [{ project_id: "eliza" }, { project_id: "asi" }],
      },
    }),
  );
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const setup = page.locator("#start");
  await expect(
    setup.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("elizaOS/eliza");
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
  await expect(setup).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(setup).toHaveCSS("border-top-width", "0px");
  await expectAccessible(page, { include: "#start" });
  // Agent links remain next in keyboard order after Copy.
  await setup.getByRole("button", { name: "Copy agent prompt" }).focus();
  await page.keyboard.press("Tab");
  await expect(setup.locator(".agent-open-in a").first()).toBeFocused();
  await page.screenshot({
    path: info.outputPath("project-agent-setup-plain.png"),
    fullPage: true,
  });
  // 200% zoom keeps setup inside the viewport; 320 px is the mobile limit.
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await setup.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("project-agent-setup-zoom.png"),
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }

  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  await expect(
    setup.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("SlopDotCash/asi");
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
});

test("home agent setup stays usable when discovery is unavailable", async ({
  page,
  context,
}) => {
  await page.route("**/.well-known/slop/projects.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/SKILL.md",
  );
  await expect(
    page.getByRole("heading", { name: "Agent setup unavailable" }),
  ).toHaveCount(0);
});

test("history navigation never carries another project's clearance into agent setup", async ({
  page,
  diagnostics,
}, info) => {
  diagnostics.allowPreviewApiMisses();
  // Leaving a route cancels its in-flight shared snapshot read.
  diagnostics.allow(
    /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED) GET http:\/\/[^ ]+\/data\/(?:leaderboard\.json|cycles\/index\.json)\?[^ ]+$/u,
  );
  let holdClearance = false;
  let releaseClearance = () => {};
  const pendingClearance = new Promise<void>((resolve) => {
    releaseClearance = resolve;
  });
  await page.route("**/.well-known/slop/projects.json", async (route) => {
    if (holdClearance) await pendingClearance;
    await route.fulfill({
      json: { schemaVersion: "1", projects: [{ project_id: "eliza" }] },
    });
  });
  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  await expect(
    page.getByText("This project is not cleared for agents.", { exact: false }),
  ).toBeVisible();
  // Finish home snapshot reads before the deliberate clearance/history race.
  // holdClearance is still false while the home page settles.
  const [summary] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/data/points-summary.json",
    ),
    page
      .getByRole("banner")
      .getByRole("link", { name: "Slop home", exact: true })
      .click(),
  ]);
  expect(await summary.finished()).toBeNull();
  await page.locator('a.project-card[href="/projects/eliza"]').click();
  await expect(page).toHaveURL(/\/projects\/eliza$/u);
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("elizaOS/eliza");
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  // Observe every committed mutation, including prompt nodes removed before
  // the next browser assertion. An end-state check misses the stale render.
  await page.evaluate(() => {
    type Observation = {
      prompt: boolean;
      changedPrompt: boolean;
    };
    const observed = window as Window & {
      clearanceObservations?: Observation[];
      clearanceObserver?: MutationObserver;
    };
    observed.clearanceObservations = [];
    observed.clearanceObserver = new MutationObserver((records) => {
      if (location.pathname !== "/projects/asi") return;
      const changed = records.flatMap((record) => {
        const element =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        if (element?.closest('[aria-label="Agent prompt"]'))
          return [
            record.oldValue ?? "",
            ...Array.from(record.addedNodes, (node) => node.textContent ?? ""),
            ...Array.from(
              record.removedNodes,
              (node) => node.textContent ?? "",
            ),
          ];
        return [];
      });
      observed.clearanceObservations?.push({
        prompt: Boolean(
          document
            .querySelector('[aria-label="Agent prompt"]')
            ?.textContent?.includes("SlopDotCash/asi"),
        ),
        changedPrompt: changed.some((text) => text.includes("SlopDotCash/asi")),
      });
    });
    observed.clearanceObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
  });
  holdClearance = true;
  let observations: {
    prompt: boolean;
    changedPrompt: boolean;
  }[] = [];
  try {
    await page.evaluate(() => history.go(-2));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ASI");
    await expect(page.getByText("Checking project clearance…")).toBeVisible();
    await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("status", { name: "Agent prompt" }),
    ).not.toContainText("SlopDotCash/asi");
    observations = await page.evaluate(() => {
      const observed = window as Window & {
        clearanceObservations?: {
          prompt: boolean;
          changedPrompt: boolean;
        }[];
        clearanceObserver?: MutationObserver;
      };
      observed.clearanceObserver?.disconnect();
      return observed.clearanceObservations ?? [];
    });
    await info.attach("pending-project-clearance-mutations", {
      body: JSON.stringify(observations),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("clearance-pending.png") });
  } finally {
    releaseClearance();
  }
  await expect(
    page.getByText("This project is not cleared for agents.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Open work" })).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).not.toContainText("SlopDotCash/asi");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: info.outputPath("clearance-blocked.png") });
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentTimeOrigin,
  );
  expect(observations.length).toBeGreaterThan(0);
  expect(
    observations.filter(({ prompt, changedPrompt }) => prompt || changedPrompt),
    "an uncleared project must never render its own prompt",
  ).toEqual([]);
});
