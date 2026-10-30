import { PROJECTS } from "../../src/lib/projects.mjs";
import { projectImageApiFixture } from "../project-image-api-fixture.mjs";
import { expect, expectAccessible, test } from "./fixtures";

test.use({ video: "on" });

test("maintainers review incomplete assessments in private Inbox", async ({
  page,
  diagnostics,
}) => {
  const project = PROJECTS.find((value) => value.id === "eliza");
  if (!project) throw new Error("Missing registered fixture project");
  const api = await projectImageApiFixture(project, {
    incompleteAssessments: true,
  });
  let role = "maintainer";
  let unavailable = false;
  const actor = () =>
    role === "admin" ? "4243" : role === "other" ? "4244" : "4242";
  let paginationReads = 0;
  const at = "2026-10-30T00:00:00.000Z";
  const repository = project.repositories[0].id;
  const [owner, repo] = repository.split("/");
  await api.db.batch(
    Array.from({ length: 27 }, (_, index) => {
      const id = `inbox-fixture-${index + 1}`;
      return [
        api.db
          .prepare(
            "INSERT INTO slopbot_deliveries(delivery_id,event,received_at) VALUES(?,'pull_request',?)",
          )
          .bind(id, at),
        api.db
          .prepare(
            "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES(?,42,?,?,?,?,?)",
          )
          .bind(
            id,
            Number(project.authority.repositoryId),
            owner,
            repo,
            index + 1,
            at,
          ),
        api.db
          .prepare(
            "INSERT INTO slopbot_value_processing(delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,incomplete_since) VALUES(?,'fixture',?,'waiting','source-incomplete',?,?,?)",
          )
          .bind(id, at, "2026-10-30T01:00:00.000Z", at, at),
      ];
    }).flat(),
  );
  diagnostics.allowCanceledBackgroundReads();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      path === "/api/v1/notifications" ||
      path === "/api/v1/notifications/incomplete-assessments" ||
      path === "/api/v1/project-session"
    ) {
      if (path.endsWith("/incomplete-assessments")) paginationReads++;
      const response = await api.fetch(
        new Request(request.url(), {
          headers: {
            ...request.headers(),
            "x-fixture-role": role,
            ...(unavailable ? { "x-fixture-outage": "1" } : {}),
          },
        }),
      );
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    }
    if (path === "/api/v1/projects")
      return route.fulfill({
        json: { schemaVersion: "1", projects: [project] },
      });
    if (path === "/api/v1/security-cases")
      return route.fulfill({
        json: {
          viewer: { githubId: actor(), githubLogin: "fixture" },
          programs: [],
          cases: [],
        },
      });
    if (path === "/api/v1/security-submissions")
      return route.fulfill({
        json: { recipientGithubId: actor(), automatic: false, submissions: [] },
      });
    if (path === "/api/v1/points/me") return route.fulfill({ json: null });
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  try {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    const queue = page.getByRole("region", { name: "Incomplete assessments" });
    await expect(queue).toBeVisible();
    await expect(queue.getByRole("link")).toHaveCount(25);
    expect(paginationReads).toBe(0);
    await expect(queue.getByRole("link").first()).toHaveAttribute(
      "href",
      `https://github.com/${repository}/pull/1`,
    );
    await expectAccessible(page, { everyRule: true });
    await page.screenshot({
      path: test.info().outputPath("maintainer-queue.png"),
      fullPage: true,
    });
    await queue.getByRole("button", { name: "More", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(queue.getByRole("link")).toHaveCount(2);
    await expect(queue.getByRole("link").first()).toHaveAttribute(
      "href",
      `https://github.com/${repository}/pull/26`,
    );
    await queue.getByRole("button", { name: "Back", exact: true }).click();
    await expect(queue.getByRole("link")).toHaveCount(25);
    role = "other";
    await page.reload({ waitUntil: "networkidle" });
    await expect(queue).toHaveCount(0);
    role = "admin";
    await page.reload({ waitUntil: "networkidle" });
    await expect(queue.getByRole("link")).toHaveCount(25);
    role = "maintainer";
    unavailable = true;
    await page.reload({ waitUntil: "networkidle" });
    await expect(queue.getByRole("alert")).toContainText("could not load");
    unavailable = false;
    await queue.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(queue.getByRole("link")).toHaveCount(25);
    await api.db
      .prepare(
        "UPDATE slopbot_value_processing SET state='completed',outcome='published',incomplete_since=NULL,retry_at=NULL",
      )
      .run();
    await page.reload({ waitUntil: "networkidle" });
    await expect(queue).toHaveCount(0);
  } finally {
    await api.dispose();
  }
});
