import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { notifySlopbotAppeal } from "../../backend/notifications/events";
import { pointRevisionId } from "../../src/lib/points";
import { expect, expectAccessible, test } from "./fixtures";

test("a manual Points award reaches private Inbox review and an independent moderator @registry", async ({
  page,
  browser,
  diagnostics,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  const moderatorToken = process.env.SLOP_E2E_MODERATOR_TOKEN;
  if (!persist || !moderatorToken)
    throw new Error("Missing local registry fixture");
  const q = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
  const sql = (command: string) =>
    execFileSync(
      "node",
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        "slop-private",
        "--local",
        "--persist-to",
        persist,
        "--command",
        command,
      ],
      { stdio: "pipe" },
    );
  const suffix = createHash("sha256")
    .update(test.info().project.name)
    .digest("hex")
    .slice(0, 6);
  const githubId = String(910000000 + Number.parseInt(suffix, 16));
  const actorId = Buffer.from(`04:User${githubId}`).toString("base64");
  const session = createHash("sha256").update(`points-${suffix}`).digest("hex");
  const now = new Date().toISOString();
  const record = {
    previous: null,
    recordedAt: now,
    sourceDigest: "a".repeat(64),
    sourceRule: "legacy-reviewed-award",
    award: {
      key: `manual:${suffix}`,
      actor: { id: actorId, login: `points-${suffix}` },
      projectId: "slopdotcash",
      category: "evaluated-contribution" as const,
      amount: 90,
      occurredAt: now,
      sourceId: `manual-${suffix}`,
      sourceUrl: "https://example.com/accepted-work",
      workUnitId: `manual-${suffix}`,
      provisional: false,
    },
  };
  const revision = { ...record, id: pointRevisionId(record) };
  sql(`INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(${q(actorId)},${q(githubId)},${q(`points-${suffix}`)},${q(now)},1);
    INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(${q(createHash("sha256").update(session).digest("hex"))},${q(actorId)},'2099-01-01T00:00:00.000Z');
    INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(${q(revision.id)},${q(record.award.key)},NULL,${q(now)},${q(JSON.stringify(revision))});`);
  await page.goto("/how-it-works", { waitUntil: "load" });
  await expect(
    page.getByRole("heading", { name: "How Slop works", exact: true }),
  ).toBeVisible();
  // A visible heading does not finish deferred fonts before navigation.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((value) => {
    // biome-ignore lint/suspicious/noDocumentCookie: Seed only this isolated local session with the real cookie path.
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, session);
  await page.goto("/inbox?points", { waitUntil: "load" });
  await expect(
    page.getByRole("heading", { name: "Review Points" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("The accepted manual work was assigned to the wrong month.");
  await expectAccessible(page, { everyRule: true });
  await page.screenshot({
    path: test.info().outputPath("points-review-form.png"),
    fullPage: true,
  });
  let releaseIntake!: () => void;
  let intakeStarted!: () => void;
  const intakeWaiting = new Promise<void>((resolve) => {
    intakeStarted = resolve;
  });
  const intakeRelease = new Promise<void>((resolve) => {
    releaseIntake = resolve;
  });
  await page.route("**/api/v1/points/disputes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    intakeStarted();
    await intakeRelease;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await intakeWaiting;
  try {
    await expect(page.getByLabel("Reason", { exact: true })).toBeDisabled();
    await page.keyboard.type(" late edit");
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
      "The accepted manual work was assigned to the wrong month.",
    );
  } finally {
    releaseIntake();
  }
  await expect(page).toHaveURL(/pointsDispute=points-dispute/u);
  // The local Slopbot fixture has no model route. Its unavailable response
  // must retain the private receipt and offer recovery, never fake a draft.
  await expect(page.getByText("Slopbot review", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry Slopbot review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The accepted manual work was assigned to the wrong month."),
  ).toBeVisible();
  const key = new URL(page.url()).searchParams.get("pointsDispute");
  expect(key).toMatch(/^points-dispute:[a-f0-9]{64}$/u);
  if (!key) throw new Error("Points receipt is missing");
  await page.screenshot({
    path: test.info().outputPath("points-private-receipt.png"),
    fullPage: true,
  });
  const completedRequests = new WeakSet<object>();
  page.on("requestfinished", (request) => completedRequests.add(request));
  const readAcknowledgement = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/read",
  );
  await page.getByRole("button", { name: /^Mark as read:/u }).click();
  await expect(page.locator(".inbox-item .inbox-state")).toHaveText("Read");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".inbox-item .inbox-state")).toHaveText("Read");
  const readRequest = (await readAcknowledgement).request();
  expect(readRequest.failure()).toBeNull();
  expect(completedRequests.has(readRequest)).toBe(true);
  // The browser test covers the actual API/D1/Inbox transition; separate real
  // provider evidence qualifies the model. This fixture sets only its draft.
  const notice = notifySlopbotAppeal(
    {
      prepare: (query) => ({
        bind: (...values) =>
          query.replace(/\?(\d+)/gu, (_, n) => q(values[Number(n) - 1])),
      }),
    },
    key,
    "900000004",
    now,
    "points_disputes",
  );
  sql(
    `UPDATE points_disputes SET draft='uphold',draft_confidence=0.7,drafted_at=${q(now)},escalated_at=${q(now)},escalation='Original work needs review' WHERE appeal_key=${q(key)}; ${notice};`,
  );
  const outsiderToken = process.env.SLOP_E2E_OWNER_TOKEN;
  if (!outsiderToken) throw new Error("Missing unrelated fixture session");
  const deniedContext = await browser.newContext({
    viewport: test.info().project.use.viewport,
  });
  const deniedPage = await deniedContext.newPage();
  const privatePath = `/api/v1/points/disputes/${encodeURIComponent(key)}`;
  diagnostics.allowResponse(404, "GET", privatePath);
  try {
    await deniedPage.goto(new URL("/how-it-works", page.url()).href, {
      waitUntil: "load",
    });
    await expect(
      deniedPage.getByRole("heading", { name: "How Slop works", exact: true }),
    ).toBeVisible();
    await deniedPage.evaluate(() => document.fonts.ready);
    await deniedPage.evaluate((value) => {
      // biome-ignore lint/suspicious/noDocumentCookie: Seed only this isolated local session with the real cookie path.
      document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
    }, outsiderToken);
    await deniedPage.goto(
      new URL(`/inbox?pointsDispute=${encodeURIComponent(key)}`, page.url())
        .href,
      { waitUntil: "load" },
    );
    await expect(deniedPage.getByRole("alert")).toContainText(
      "Points dispute not found.",
    );
    await expect(
      deniedPage.getByText(
        "The accepted manual work was assigned to the wrong month.",
      ),
    ).toHaveCount(0);
  } finally {
    await deniedContext.close();
  }
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    ...(process.env.SLOP_E2E_VIDEO === "1"
      ? { recordVideo: { dir: test.info().outputPath("walkthrough-videos") } }
      : {}),
  });
  const moderator = await context.newPage();
  try {
    await moderator.goto(new URL("/how-it-works", page.url()).href, {
      waitUntil: "load",
    });
    await expect(
      moderator.getByRole("heading", { name: "How Slop works", exact: true }),
    ).toBeVisible();
    await moderator.evaluate(() => document.fonts.ready);
    await moderator.evaluate((value) => {
      // biome-ignore lint/suspicious/noDocumentCookie: Seed only this isolated local session with the real cookie path.
      document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
    }, moderatorToken);
    await moderator.goto("/inbox", { waitUntil: "networkidle" });
    await moderator
      .locator(`a[href="/inbox?pointsDispute=${encodeURIComponent(key)}"]`)
      .click();
    await expect(
      moderator.getByText("Slopbot: Review the award"),
    ).toBeVisible();
    await moderator
      .getByLabel("Decision reason")
      .fill(
        "The retained source needs a date correction. Preserve the award until it is appended.",
      );
    await expectAccessible(moderator, { everyRule: true });
    await moderator.screenshot({
      path: test.info().outputPath("points-decision-form.png"),
      fullPage: true,
    });
    let releaseDecision!: () => void;
    let decisionStarted!: () => void;
    const decisionWaiting = new Promise<void>((resolve) => {
      decisionStarted = resolve;
    });
    const decisionRelease = new Promise<void>((resolve) => {
      releaseDecision = resolve;
    });
    await moderator.route("**/api/v1/points/disputes/*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      decisionStarted();
      await decisionRelease;
      await route.fulfill({ response });
    });
    await moderator
      .getByRole("button", { name: "Uphold dispute", exact: true })
      .click();
    await decisionWaiting;
    try {
      await expect(moderator.getByLabel("Decision reason")).toBeDisabled();
      await moderator.keyboard.type(" late edit");
      await expect(moderator.getByLabel("Decision reason")).toHaveValue(
        "The retained source needs a date correction. Preserve the award until it is appended.",
      );
    } finally {
      releaseDecision();
    }
    await expect(
      moderator.getByText("Dispute upheld", { exact: true }),
    ).toBeVisible();
    await moderator.screenshot({
      path: test.info().outputPath("points-moderator-decision.png"),
      fullPage: true,
    });
    await page.reload({ waitUntil: "load" });
    await expect(page.locator(".inbox-unread")).toHaveCount(1);
    await expect(page.locator(".inbox-unread")).toContainText(
      "The Points dispute was resolved.",
    );
    await expect(
      page.getByText("Dispute upheld", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("90 points", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Uphold dispute", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("superseded Points Retry opens the current record @registry", async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowCanceledBackgroundReads();
  diagnostics.allowResponse(409, "POST", "/api/v1/points/disputes");
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  if (!persist) throw new Error("Missing local registry fixture");
  const q = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
  const sql = (command: string) =>
    JSON.parse(
      execFileSync(
        "node",
        [
          "node_modules/wrangler/bin/wrangler.js",
          "d1",
          "execute",
          "slop-private",
          "--local",
          "--persist-to",
          persist,
          "--command",
          command,
          "--json",
        ],
        { stdio: "pipe" },
      ).toString("utf8"),
    );
  const suffix = createHash("sha256")
    .update(`points-retry-${test.info().project.name}`)
    .digest("hex")
    .slice(0, 6);
  const githubId = String(920000000 + Number.parseInt(suffix, 16));
  const actorId = Buffer.from(`04:User${githubId}`).toString("base64");
  const session = createHash("sha256").update(`retry-${suffix}`).digest("hex");
  const now = new Date().toISOString();
  const record = {
    previous: null,
    recordedAt: now,
    sourceDigest: "a".repeat(64),
    sourceRule: "legacy-reviewed-award",
    award: {
      key: `manual:retry-${suffix}`,
      actor: { id: actorId, login: `points-retry-${suffix}` },
      projectId: "slopdotcash",
      category: "evaluated-contribution" as const,
      amount: 90,
      occurredAt: now,
      sourceId: `manual-retry-${suffix}`,
      sourceUrl: "https://example.com/accepted-work",
      workUnitId: `manual-retry-${suffix}`,
      provisional: false,
    },
  };
  const revision = { ...record, id: pointRevisionId(record) };
  sql(`INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(${q(actorId)},${q(githubId)},${q(record.award.actor.login)},${q(now)},1);
    INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(${q(createHash("sha256").update(session).digest("hex"))},${q(actorId)},'2099-01-01T00:00:00.000Z');
    INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(${q(revision.id)},${q(record.award.key)},NULL,${q(now)},${q(JSON.stringify(revision))});`);
  const unrelatedRecordedAt = new Date(Date.parse(now) - 1000).toISOString();
  const unrelatedRecord = {
    ...record,
    recordedAt: unrelatedRecordedAt,
    award: {
      ...record.award,
      occurredAt: unrelatedRecordedAt,
      key: `manual:retry-${suffix}-unrelated`,
      sourceId: `manual-retry-${suffix}-unrelated`,
      workUnitId: `manual-retry-${suffix}-unrelated`,
      amount: 60,
    },
  };
  const unrelatedRevision = {
    ...unrelatedRecord,
    id: pointRevisionId(unrelatedRecord),
  };
  sql(
    `INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(${q(unrelatedRevision.id)},${q(unrelatedRecord.award.key)},NULL,${q(unrelatedRecord.recordedAt)},${q(JSON.stringify(unrelatedRevision))});`,
  );
  // Put A on the older page. Its correction B will be newer than that cursor.
  for (let index = 0; index < 25; index++) {
    const other = {
      ...record,
      award: {
        ...record.award,
        key: `manual:retry-${suffix}-newer-${index}`,
        sourceId: `manual-retry-${suffix}-newer-${index}`,
        workUnitId: `manual-retry-${suffix}-newer-${index}`,
        amount: 10,
      },
    };
    const row = { ...other, id: pointRevisionId(other) };
    sql(
      `INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(${q(row.id)},${q(other.award.key)},NULL,${q(now)},${q(JSON.stringify(row))});`,
    );
  }
  await page.goto("/how-it-works", { waitUntil: "load" });
  await expect(
    page.getByRole("heading", { name: "How Slop works", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((value) => {
    // biome-ignore lint/suspicious/noDocumentCookie: Seed only the isolated local session.
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, session);
  await page.goto("/inbox?points", { waitUntil: "load" });
  const review = page.getByRole("region", {
    name: "Points review",
    exact: true,
  });
  await review
    .getByRole("button", { name: "Older records", exact: true })
    .click();
  await expect(review.getByText("90 points", { exact: true })).toBeVisible();
  await review
    .getByRole("listitem")
    .filter({
      has: page.getByText("90 points", { exact: true }),
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(review.getByText("90 points", { exact: true })).toBeVisible();
  await review
    .getByLabel("Reason", { exact: true })
    .fill("The accepted work was credited to the wrong month.");
  const changed = {
    ...record,
    previous: revision.id,
    recordedAt: new Date(Date.parse(now) + 1000).toISOString(),
    award: { ...record.award, amount: 30 },
  };
  const successor = { ...changed, id: pointRevisionId(changed) };
  sql(
    `INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(${q(successor.id)},${q(record.award.key)},${q(revision.id)},${q(changed.recordedAt)},${q(JSON.stringify(successor))});`,
  );
  const refused = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/points/disputes",
  );
  await review
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  const response = await refused;
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toBe("superseded");
  expect(
    sql(
      `SELECT COUNT(*) AS n FROM points_disputes WHERE revision_id=${q(revision.id)}`,
    )[0].results,
  ).toEqual([{ n: 0 }]);
  await expect(review.getByRole("alert")).toContainText("newer revision");
  await page.screenshot({
    path: test.info().outputPath("superseded-before-retry.png"),
    fullPage: true,
  });
  // Leaving the rejected form must retire its error before another award opens.
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await expect(review.getByRole("alert")).toHaveCount(0);
  await review
    .getByRole("listitem")
    .filter({ has: page.getByText("60 points", { exact: true }) })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const unrelatedDraft = "Keep this explanation for the other award.";
  await review.getByLabel("Reason", { exact: true }).fill(unrelatedDraft);
  await expect(review.getByRole("alert")).toHaveCount(0);
  await expect(
    review.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue(
    unrelatedDraft,
  );
  await page.screenshot({
    path: test.info().outputPath("unrelated-points-draft.png"),
    fullPage: true,
  });
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await review
    .getByRole("listitem")
    .filter({ has: page.getByText("90 points", { exact: true }) })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await review
    .getByLabel("Reason", { exact: true })
    .fill("The accepted work was credited to the wrong month.");
  const refusedAgain = page.waitForResponse(
    (next) =>
      next.request().method() === "POST" &&
      new URL(next.url()).pathname === "/api/v1/points/disputes",
  );
  await review
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  const repeatedResponse = await refusedAgain;
  expect(repeatedResponse.status()).toBe(409);
  expect((await repeatedResponse.json()).error).toBe("superseded");
  await expect(review.getByRole("alert")).toContainText("newer revision");
  const retry = review.getByRole("button", { name: "Retry", exact: true });
  for (let tabs = 0; tabs < 50; tabs++) {
    if (await retry.evaluate((button) => button === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(retry).toBeFocused();
  const freshList = page.waitForResponse(
    (next) =>
      next.request().method() === "GET" &&
      new URL(next.url()).pathname === "/api/v1/points/disputes",
  );
  await page.keyboard.press("Enter");
  const refreshed = await freshList;
  const refreshedAwards = (await refreshed.json()).awards as {
    revisionId: string;
  }[];
  expect(refreshedAwards.map((item) => item.revisionId)).toContain(
    successor.id,
  );
  await expect(review.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await expect(review.getByText("30 points", { exact: true })).toBeVisible();
  await review
    .getByRole("listitem")
    .filter({
      has: page.getByText("30 points", { exact: true }),
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(review.getByText("30 points", { exact: true })).toBeVisible();
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue("");
  // A temporary refusal must not retire a still-current form or its draft.
  const draft = "Keep this explanation while the service is unavailable.";
  await review.getByLabel("Reason", { exact: true }).fill(draft);
  diagnostics.allowResponse(503, "POST", "/api/v1/points/disputes");
  await page.route(
    "**/api/v1/points/disputes",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "unavailable",
          message: "Points review temporarily unavailable.",
        }),
      }),
    { times: 1 },
  );
  await review
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  const currentList = page.waitForResponse(
    (next) =>
      next.request().method() === "GET" &&
      new URL(next.url()).pathname === "/api/v1/points/disputes",
  );
  await review.getByRole("button", { name: "Retry", exact: true }).click();
  expect((await (await currentList).json()).awards[0].revisionId).toBe(
    successor.id,
  );
  await expect(review.getByLabel("Reason", { exact: true })).toHaveValue(draft);
  await expect(review.getByText("30 points", { exact: true })).toBeVisible();
  await expectAccessible(page, { everyRule: true });
  await page.screenshot({
    path: test.info().outputPath("current-points-review.png"),
    fullPage: true,
  });
});
