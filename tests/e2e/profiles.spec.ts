import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  type CensusRequest,
  collectProfileIssues,
} from "../../scripts/profile-issue-census";
import {
  assertProfiles,
  type ProfileIndex,
  type ProfileIssue,
  type ProfileIssueHistory,
  type ProfileRecord,
  profileIssueOutcomes,
} from "../../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../../src/lib/repositories.mjs";

test("profiles preserve legacy coverage and expose recorded issue history", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const failures: string[] = [];
  page.on("response", (r) => {
    if (
      new URL(r.url()).origin === new URL(page.url()).origin &&
      r.status() >= 400
    )
      failures.push(r.url());
  });
  const now = new Date().toISOString();
  await page.route("**/data/profiles.json", (r) =>
    r.fulfill({
      json: {
        schemaVersion: "1",
        startedAt: now,
        generatedAt: now,
        repositories: TARGET_REPOSITORIES.map((v, i) => ({
          repository: v.id,
          count: i === 0 ? 5 : 0,
          excluded: 0,
        })),
        people: [
          {
            id: "U_profile_only",
            login: "profile-only-contributor",
            avatarUrl: "https://avatars.githubusercontent.com/u/1234567",
            repositories: [
              {
                repository: TARGET_REPOSITORIES[0].id,
                merged: 0,
                open: 3,
                closed: 2,
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/points");
  const directory = page.getByRole("region", { name: "People", exact: true });
  await directory.getByLabel("GitHub username").fill("profile-only");
  await directory
    .getByRole("link", { name: "profile-only-contributor", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "profile-only-contributor",
      exact: true,
    }),
  ).toBeVisible();
  const profile = page.getByRole("region", { name: "Contributor profile" });
  await expect(profile.locator(".profile-totals").first()).toContainText(
    "3PRs open",
  );
  await expect(profile.locator(".profile-totals").first()).toContainText(
    "2PRs closed without merging",
  );
  await expect(
    page
      .getByText("Points · recorded history", { exact: true })
      .locator("..")
      .locator("strong"),
  ).toHaveText("0");
  await expect(
    profile.getByRole("link", { name: "GitHub · @profile-only-contributor" }),
  ).toHaveAttribute("href", "https://github.com/profile-only-contributor");
  await profile.getByText("Issue outcomes", { exact: true }).click();
  await expect(
    profile.getByText("Issue history is unavailable in this census."),
  ).toBeVisible();
  await expect(profile.getByLabel("Period (UTC)")).toHaveCount(0);
  const penalty = profile.locator("summary", { hasText: /^Penalty history$/ });
  await penalty.focus();
  await page.keyboard.press("Enter");
  await expect(
    profile.getByText(
      "No penalty policy version is approved or active. No penalties are recorded.",
    ),
  ).toBeVisible();
  await expect(
    profile.getByRole("link", { name: "Penalty policy" }),
  ).toHaveAttribute(
    "href",
    /\/docs\/slop-product-requirements\.md#closure-penalties-and-outcome-ratios$/,
  );
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("individual-profile.png"),
    fullPage: true,
  });
  // Match the repository's 200% text-enlargement fixture without reducing
  // a 320px viewport below the supported reflow width through CSS zoom.
  await page.evaluate(() => {
    const typography = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el instanceof HTMLElement)
      .map((el) => ({
        el,
        font: getComputedStyle(el).fontSize,
        line: getComputedStyle(el).lineHeight,
      }));
    for (const { el, font, line } of typography) {
      el.style.fontSize = `${Number.parseFloat(font) * 2}px`;
      if (line !== "normal")
        el.style.lineHeight = `${Number.parseFloat(line) * 2}px`;
    }
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("individual-profile-zoom.png"),
    fullPage: true,
  });
  await page.unroute("**/data/profiles.json");
  const response = await page.request.get("/data/profiles.json");
  expect(response.ok()).toBe(true);
  const census = await response.json();
  assertProfiles(census);
  expect(census.schemaVersion).toBe("2");
  const reopened = census.issues?.items.find(
    (issue) =>
      issue.authorId !== null &&
      issue.events.some((event) => event.kind === "reopened"),
  );
  if (!reopened)
    throw Error("The reviewed census must include a reopened issue");
  const actor = census.people.find((person) => person.id === reopened.authorId);
  if (!actor) throw Error("The issue author must have a profile");
  const lastReopen = [...reopened.events]
    .reverse()
    .find((event) => event.kind === "reopened");
  if (!lastReopen) throw Error("The issue must retain its reopen event");
  const repository = TARGET_REPOSITORIES.find(
    (item) => item.id === reopened.repository,
  );
  if (!repository) throw Error("The issue repository must be registered");
  await page.goto(`/contributors/${actor.login}`);
  await page.getByText("Issue outcomes", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Repository", exact: true })
    .selectOption(reopened.repository);
  await page
    .getByRole("combobox", { name: "Period (UTC)", exact: true })
    .selectOption(new Date(lastReopen.occurredAt).toISOString().slice(0, 7));
  const issueDetails = page.locator("details").filter({
    has: page.locator(":scope > summary", { hasText: /^Issue outcomes$/ }),
  });
  await issueDetails.locator("summary", { hasText: /^Issue history/ }).click();
  const reopenedRecord = issueDetails
    .locator("li")
    .filter({
      has: page.locator(
        `a[href="https://github.com/${repository.owner}/${repository.name}/issues/${reopened.number}"]`,
      ),
    })
    .filter({ hasText: "Reopened" });
  await expect(reopenedRecord.first()).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("issue-outcomes.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("issue census records a hidden transition as incomplete history", async () => {
  const author = "U_issue_author";
  const repository = TARGET_REPOSITORIES[0];
  const createdAt = "2026-09-01T00:00:00.000Z";
  const closedAt = "2026-09-02T00:00:00.000Z";
  const avatarUrl = "https://avatars.githubusercontent.com/u/7654321";
  const page = <T>(nodes: T[]) => ({
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes,
  });
  const source = (id: string, number: number, closedEvents: string[]) => ({
    id,
    number,
    createdAt,
    state: "CLOSED",
    stateReason: "COMPLETED",
    author: {
      __typename: "User",
      id: author,
      login: "issue-author",
      avatarUrl,
    },
    timelineItems: page(
      closedEvents.map((eventId) => ({
        __typename: "ClosedEvent",
        id: eventId,
        createdAt: closedAt,
        stateReason: "COMPLETED",
        duplicateOf: null,
      })),
    ),
  });
  // GitHub hides the closing event of an account that is no longer
  // available, while the issue itself still reports CLOSED/COMPLETED.
  const request: CensusRequest = async <T>(
    _query: string,
    variables: Record<string, string | null>,
  ) =>
    ({
      repository: {
        id:
          TARGET_REPOSITORIES.find((item) => item.name === variables.name)
            ?.expectedNodeId ?? `R_${variables.name}`,
        issues:
          variables.name === repository.name
            ? page([
                source("I_visible", 1, ["CE_visible"]),
                source("I_hidden", 2, []),
              ])
            : page([]),
      },
    }) as T;
  const census = (
    issues: ProfileIssueHistory | undefined,
    people: ProfileRecord[],
  ): ProfileIndex => ({
    schemaVersion: "2",
    startedAt: createdAt,
    generatedAt: new Date().toISOString(),
    repositories: TARGET_REPOSITORIES.map((item) => ({
      repository: item.id,
      count: 0,
      excluded: 0,
    })),
    people,
    issues,
  });
  // The previous census saw the closing event before it was hidden, and was
  // published before records carried the incomplete-history field.
  const priorClosed = {
    id: "CE_hidden",
    kind: "closed" as const,
    occurredAt: closedAt,
    reason: "COMPLETED",
    relatedIssueId: null,
  };
  const previous = census(
    {
      firstObservedAt: createdAt,
      repositories: TARGET_REPOSITORIES.map((item) => ({
        repository: item.id,
        count: item.id === repository.id ? 1 : 0,
      })),
      items: [
        {
          id: "I_hidden",
          repository: repository.id,
          number: 2,
          authorId: author,
          createdAt,
          observedAt: closedAt,
          state: "CLOSED",
          reason: "COMPLETED",
          unavailableSince: null,
          correctedAt: null,
          events: [priorClosed],
        },
      ],
    },
    [{ id: author, login: "issue-author", avatarUrl, repositories: [] }],
  );
  assertProfiles(previous);
  const collect = async (prior: ProfileIndex) => {
    const people = new Map<string, ProfileRecord>();
    const issues = await collectProfileIssues(
      request,
      people,
      prior,
      createdAt,
    );
    const index = census(issues, [...people.values()]);
    assertProfiles(index);
    return index;
  };

  const first = await collect(previous);
  const items = first.issues?.items ?? [];
  const hidden = items.find((issue) => issue.id === "I_hidden");
  const visible = items.find((issue) => issue.id === "I_visible");
  if (!hidden || !visible) throw Error("Both issues must be collected");
  expect(visible.historyIncompleteSince).toBeNull();
  // Nothing is invented: the record keeps only what GitHub shows today,
  // flags the gap, and notes that a previously observed event disappeared.
  expect(hidden.events).toEqual([]);
  expect(hidden.historyIncompleteSince).toBe(hidden.observedAt);
  expect(hidden.correctedAt).toBe(hidden.observedAt);
  expect(profileIssueOutcomes(items, author)).toMatchObject({
    open: 0,
    completed: 1,
    incomplete: 1,
    corrected: 1,
  });

  // The gap keeps the time it was first observed across later censuses.
  const second = await collect(first);
  expect(
    second.issues?.items.find((issue) => issue.id === "I_hidden")
      ?.historyIncompleteSince,
  ).toBe(hidden.historyIncompleteSince);

  // An unflagged gap and a flag on a complete history both stay invalid.
  const withHidden = (change: Partial<ProfileIssue>) =>
    census(
      {
        ...(first.issues as ProfileIssueHistory),
        items: items.map((issue) =>
          issue.id === "I_hidden" ? { ...issue, ...change } : issue,
        ),
      },
      first.people,
    );
  expect(() =>
    assertProfiles(withHidden({ historyIncompleteSince: null })),
  ).toThrow("Issue history does not reconcile with its current state");
  expect(() =>
    assertProfiles(
      withHidden({
        events: [{ ...priorClosed, occurredAt: hidden.observedAt }],
      }),
    ),
  ).toThrow("Issue history is flagged incomplete but reconciles");
  expect(() =>
    assertProfiles(withHidden({ historyIncompleteSince: "not a time" })),
  ).toThrow("Invalid issue history record");
});
