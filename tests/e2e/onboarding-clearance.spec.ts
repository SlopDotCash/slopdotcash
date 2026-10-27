/** Agent setup always offers a prompt; only a cleared project gets its own. */
import type { LeaderboardSnapshot } from "../../src/lib/leaderboard-types";
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
  // Open work is listed only for a project cleared for agents.
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

test("a cleared project lists only the published open-work candidates", async ({
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
  const snapshot = (await (
    await page.request.get("/data/leaderboard.json")
  ).json()) as LeaderboardSnapshot;
  const published = (projectId: string) => {
    const repositories = new Set(
      snapshot.repositories
        .filter((repository) => repository.projectId === projectId)
        .map((repository) => repository.id),
    );
    const items = [
      ...snapshot.workQueue.issues,
      ...snapshot.workQueue.pullRequests,
    ].filter((item) => repositories.has(item.repository));
    return {
      candidates: items.filter((item) => item.selection.status === "candidate"),
      excluded: items.filter((item) => item.selection.status === "excluded"),
    };
  };
  const work = page.getByRole("region", { name: "Open work" });

  // The fixture snapshot has both decisions for this project.
  const eliza = published("eliza");
  expect(eliza.candidates.length).toBeGreaterThan(5);
  expect(eliza.excluded.length).toBeGreaterThan(0);
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const links = work.getByRole("listitem").getByRole("link");
  await expect(links).toHaveCount(5);
  const shown = await links.evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href")),
  );
  expect(shown).toEqual(eliza.candidates.slice(0, 5).map((item) => item.url));
  for (const item of eliza.excluded) expect(shown).not.toContain(item.url);
  await expect(links.first()).toContainText(
    `Pull request to review · ${eliza.candidates[0].repository}#${eliza.candidates[0].number}`,
  );
  await expect(work).toContainText(`5 of ${eliza.candidates.length} shown.`);
  // The frozen fixture snapshot is older than eight hours.
  await expect(work).toContainText("May be outdated.");
  await expect(
    work.getByRole("link", { name: "All issues on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/elizaOS/eliza/issues");
  await expectAccessible(page, { include: "#start" });
  // Keyboard order goes from the prompt's copy control to the first item.
  await page.getByRole("button", { name: "Copy agent prompt" }).focus();
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.screenshot({
    path: info.outputPath("project-open-work.png"),
    fullPage: true,
  });
  // 200% zoom keeps the list inside the viewport; 320 px is the mobile limit.
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
    await work.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("project-open-work-zoom.png"),
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
  }

  // Every open item of this project is excluded: the list is empty, and a
  // fresh snapshot carries no outdated notice.
  const asi = published("asi");
  expect(asi.candidates).toEqual([]);
  expect(asi.excluded.length).toBeGreaterThan(0);
  await page.clock.setFixedTime(
    new Date(Date.parse(snapshot.generatedAt) + 60 * 60 * 1000),
  );
  await page.goto("/projects/asi", { waitUntil: "networkidle" });
  await expect(work).toContainText(
    "No open issue or pull request is ready for new work now.",
  );
  await expect(work.getByRole("listitem")).toHaveCount(0);
  await expect(work).not.toContainText("May be outdated.");
  await page.screenshot({
    path: info.outputPath("project-open-work-empty.png"),
    fullPage: true,
  });
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
  const homeSnapshot = page
    .waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/data/leaderboard.json"),
    )
    .then((response) => response.finished());
  await page
    .getByRole("main")
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  expect(await homeSnapshot).toBeNull();
  const elizaSnapshot = page
    .waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/data/leaderboard.json"),
    )
    .then((response) => response.finished());
  await page.locator('a.project-card[href="/projects/eliza"]').click();
  expect(await elizaSnapshot).toBeNull();
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).toContainText("elizaOS/eliza");
  await expect(page.getByRole("region", { name: "Open work" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  // Observe every committed mutation, including prompt nodes removed before
  // the next browser assertion. An end-state check misses the stale render.
  await page.evaluate(() => {
    type Observation = {
      prompt: boolean;
      work: boolean;
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
        work: document.querySelector("#open-work-heading") !== null,
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
    work: boolean;
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
          work: boolean;
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
    observations.filter(
      ({ prompt, work, changedPrompt }) => prompt || work || changedPrompt,
    ),
    "an uncleared project must never render its own prompt or open work",
  ).toEqual([]);
});
