/** Agent setup always offers a prompt; only a cleared project gets its own. */
import { expect, test } from "./fixtures";

test("project agent setup falls back to the general prompt until cleared", async ({
  page,
  context,
  diagnostics,
}, info) => {
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
  state = "blocked";
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText("This project revision is not cleared"),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Agent prompt" }),
  ).not.toContainText("elizaOS/eliza");
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
