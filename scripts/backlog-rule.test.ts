import { expect, test } from "bun:test";
import {
  applyCatchUpChange,
  BACKLOG_RULE_FROM,
  BACKLOG_WAITING_LIMIT,
  backlogFigures,
  backlogNotice,
  backlogOutOfRotation,
  backlogState,
  backlogStatusLine,
  catchUpOfferedEnd,
  catchUpStartAllowed,
  dormancyNear,
} from "../src/lib/backlog-rule.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { findProject } from "../src/lib/projects.mjs";

const DAY = 86_400_000;
const NOW = new Date("2026-12-10T12:00:00.000Z");
const BEFORE = new Date("2026-11-23T12:00:00.000Z");
const ago = (days: number, from = NOW) =>
  new Date(from.getTime() - days * DAY).toISOString();

function project(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof assertProjectDefinition> {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({
    ...original,
    status: "active",
    listingTier: "community",
    ...overrides,
  });
}

function row(
  waitingOutside: number,
  lastMergedAt: string | null,
  observedAt = ago(0.1),
) {
  return { waitingOutside, lastMergedAt, observedAt };
}

test("the limit takes a project out at 50 waiting and not at 49", () => {
  const p = project();
  expect(backlogOutOfRotation(p, [row(49, ago(1))], NOW)).toBe(false);
  expect(backlogOutOfRotation(p, [row(50, ago(1))], NOW)).toBe(true);
  // Waiting is summed over the project's repositories.
  expect(backlogOutOfRotation(p, [row(25, ago(1)), row(25, ago(1))], NOW)).toBe(
    true,
  );
  expect(backlogState(p, [row(50, ago(1))], NOW).reason).toBe("backlog");
  expect(BACKLOG_WAITING_LIMIT).toBe(50);
});

test("dormancy needs 14 days without a merge while work waits", () => {
  const p = project();
  expect(backlogOutOfRotation(p, [row(1, ago(13.9))], NOW)).toBe(false);
  expect(backlogOutOfRotation(p, [row(1, ago(14))], NOW)).toBe(true);
  expect(backlogState(p, [row(1, ago(14))], NOW).reason).toBe("dormant");
  // No merge found at all with work waiting is dormant.
  expect(backlogOutOfRotation(p, [row(1, null)], NOW)).toBe(true);
  // A quiet project with nothing waiting is never dormant.
  expect(backlogOutOfRotation(p, [row(0, ago(90))], NOW)).toBe(false);
  expect(backlogOutOfRotation(p, [row(0, null)], NOW)).toBe(false);
  // One merge in any repository clears it.
  expect(backlogOutOfRotation(p, [row(3, ago(30)), row(0, ago(2))], NOW)).toBe(
    false,
  );
});

test("rows older than three days, or none at all, decide nothing", () => {
  const p = project();
  expect(backlogFigures(undefined, NOW)).toBeNull();
  expect(backlogFigures([], NOW)).toBeNull();
  expect(backlogOutOfRotation(p, [row(80, null, ago(3.01))], NOW)).toBe(false);
  expect(backlogOutOfRotation(p, [row(80, null, ago(2.99))], NOW)).toBe(true);
  // A stale row adds nothing to a fresh one.
  expect(
    backlogFigures([row(40, ago(1)), row(40, ago(1), ago(5))], NOW),
  ).toEqual({ waiting: 40, lastMergedAt: ago(1) });
  // A row whose waiting count was never read is left out.
  expect(
    backlogFigures([{ observedAt: ago(0.1), waitingOutside: null }], NOW),
  ).toBeNull();
});

test("only active, listed monthly-pool projects are judged", () => {
  const rows = [row(90, null)];
  expect(backlogOutOfRotation(project({ status: "paused" }), rows, NOW)).toBe(
    false,
  );
  // The schema keeps a retired project paused; the rule never judges one.
  expect(
    backlogOutOfRotation({ ...project(), listingTier: "retired" }, rows, NOW),
  ).toBe(false);
  const external = project();
  const exempt = {
    ...external,
    reward: { ...external.reward, kind: "external-prize" },
  } as unknown as typeof external;
  expect(backlogOutOfRotation(exempt, rows, NOW)).toBe(false);
  expect(backlogStatusLine(backlogState(exempt, rows, NOW))).toBeNull();
  // Security-only programs are not judged: bounty-only, or beside a zero
  // monthly amount. A program beside a funded pool is judged.
  const base = project();
  const program = (rewardMode: string, monthlyCapMinor: string) =>
    ({
      ...base,
      reward: { ...base.reward, monthlyCapMinor },
      securityBounty: { rewardMode },
    }) as unknown as typeof base;
  expect(backlogOutOfRotation(program("bounty-only", "5"), rows, NOW)).toBe(
    false,
  );
  expect(backlogOutOfRotation(program("separate", "0"), rows, NOW)).toBe(false);
  expect(backlogOutOfRotation(program("separate", "5"), rows, NOW)).toBe(true);
});

test("nothing leaves rotation before 1 December 2026", () => {
  const p = project();
  const before = new Date(Date.parse(BACKLOG_RULE_FROM) - 1);
  const state = backlogState(
    p,
    [row(60, ago(1, before), before.toISOString())],
    before,
  );
  expect(state.wouldBeOut).toBe(true);
  expect(state.outOfRotation).toBe(false);
  expect(backlogNotice(state)).toBeNull();
  const at = new Date(BACKLOG_RULE_FROM);
  expect(
    backlogOutOfRotation(p, [row(60, ago(1, at), at.toISOString())], at),
  ).toBe(true);
});

test("a running catch-up pause keeps the project listed and says so", () => {
  const p = project({
    slopbot: {
      automaticClosure: false,
      catchUpUntil: "2026-12-20T00:00:00.000Z",
      catchUpHistory: [{ startedAt: "2026-12-06T00:00:00.000Z" }],
    },
  });
  const state = backlogState(p, [row(70, ago(20))], NOW);
  expect(state.outOfRotation).toBe(false);
  expect(backlogNotice(state)).toBe(
    "The maintainers are catching up on reviews until 20 December 2026.",
  );
  // After its end the rule applies again.
  const later = new Date("2026-12-20T00:00:00.000Z");
  expect(
    backlogOutOfRotation(
      p,
      [row(70, ago(1, later), later.toISOString())],
      later,
    ),
  ).toBe(true);
});

test("the project page says why, in one or two sentences", () => {
  const p = project();
  expect(backlogNotice(backlogState(p, [row(51, ago(1))], NOW))).toBe(
    "This project is out of rotation: 51 outside pull requests have waited a week or more for a maintainer. Accepted work still records points.",
  );
  expect(backlogNotice(backlogState(p, [row(2, ago(20))], NOW))).toBe(
    "This project is out of rotation: no pull request has been merged in 14 days while outside pull requests wait. It returns once a maintainer merges.",
  );
  expect(backlogNotice(backlogState(p, [row(2, ago(2))], NOW))).toBeNull();
});

test("the owner is warned from 10 days without a merge", () => {
  const p = project();
  expect(dormancyNear(backlogState(p, [row(2, ago(9.9))], NOW))).toBe(false);
  expect(dormancyNear(backlogState(p, [row(2, ago(10))], NOW))).toBe(true);
  expect(dormancyNear(backlogState(p, [row(2, ago(14))], NOW))).toBe(false);
  expect(dormancyNear(backlogState(p, [row(0, ago(12))], NOW))).toBe(false);
  expect(dormancyNear(backlogState(p, [row(55, ago(12))], NOW))).toBe(false);
});

test("the manage page line states the figures and the effect", () => {
  const p = project();
  expect(backlogStatusLine(backlogState(p, [row(3, ago(2))], NOW))).toBe(
    "Review backlog: 3 outside pull requests waiting a week or more, last merge 2 days ago. The project stays listed.",
  );
  expect(
    backlogStatusLine(
      backlogState(p, [row(1, null, ago(0.1, BEFORE))], BEFORE),
    ),
  ).toBe(
    "Review backlog: 1 outside pull request waiting a week or more, no merge found. From 1 December 2026 this takes the project off the home page, /sponsors and agent discovery.",
  );
  expect(backlogStatusLine(backlogState(p, [row(60, ago(1))], NOW))).toBe(
    "Review backlog: 60 outside pull requests waiting a week or more, last merge 1 day ago. Out of rotation: left off the home page, /sponsors and agent discovery.",
  );
  expect(backlogStatusLine(backlogState(p, [], NOW))).toBe(
    "Review backlog: not read in the last 3 days, so the project stays listed.",
  );
});

test("a new pause ends within 14 days and starts once per UTC month", () => {
  const until = "2026-12-20T00:00:00.000Z";
  const started = applyCatchUpChange({}, { catchUpUntil: until }, NOW);
  expect(started).toEqual({
    catchUpUntil: until,
    catchUpHistory: [{ startedAt: NOW.toISOString() }],
  });
  // Past now plus 14 days, or not after now, is refused.
  for (const end of [
    new Date(NOW.getTime() + 14 * DAY + 1).toISOString(),
    NOW.toISOString(),
  ])
    expect(() => applyCatchUpChange({}, { catchUpUntil: end }, NOW)).toThrow(
      "within 14 days",
    );
  // Ended early, it cannot start again in the same month.
  const ended = { catchUpHistory: started?.catchUpHistory };
  expect(() =>
    applyCatchUpChange(
      ended,
      { ...ended, catchUpUntil: "2026-12-22T00:00:00.000Z" },
      new Date("2026-12-12T00:00:00.000Z"),
    ),
  ).toThrow("once per calendar month");
  expect(catchUpStartAllowed({ slopbot: ended }, NOW)).toBe(false);
  // A new month allows a new start.
  const january = new Date("2027-01-02T00:00:00.000Z");
  expect(catchUpStartAllowed({ slopbot: ended }, january)).toBe(true);
  expect(
    applyCatchUpChange(
      ended,
      { ...ended, catchUpUntil: "2027-01-10T00:00:00.000Z" },
      january,
    )?.catchUpHistory,
  ).toEqual([
    { startedAt: NOW.toISOString() },
    { startedAt: january.toISOString() },
  ]);
});

test("ending early is always allowed; a running pause cannot outlast 14 days from its start", () => {
  const running = {
    catchUpUntil: "2026-12-20T00:00:00.000Z",
    catchUpHistory: [{ startedAt: "2026-12-06T00:00:00.000Z" }],
  };
  expect(
    applyCatchUpChange(
      running,
      { catchUpHistory: running.catchUpHistory },
      NOW,
    ),
  ).toEqual({ catchUpHistory: running.catchUpHistory });
  // Moving the end within 14 days of the start keeps the history.
  expect(
    applyCatchUpChange(
      running,
      { ...running, catchUpUntil: "2026-12-15T00:00:00.000Z" },
      NOW,
    ),
  ).toEqual({ ...running, catchUpUntil: "2026-12-15T00:00:00.000Z" });
  expect(() =>
    applyCatchUpChange(
      running,
      { ...running, catchUpUntil: "2026-12-20T00:00:00.001Z" },
      NOW,
    ),
  ).toThrow("at most 14 days from its start");
});

test("the owner cannot change the history", () => {
  const running = {
    catchUpUntil: "2026-12-20T00:00:00.000Z",
    catchUpHistory: [{ startedAt: "2026-12-06T00:00:00.000Z" }],
  };
  expect(() =>
    applyCatchUpChange(running, { catchUpUntil: running.catchUpUntil }, NOW),
  ).toThrow("history cannot change");
  expect(() =>
    applyCatchUpChange({}, { catchUpHistory: running.catchUpHistory }, NOW),
  ).toThrow("history cannot change");
});

test("the schema accepts the settings and refuses malformed ones", () => {
  expect(() =>
    project({
      slopbot: {
        automaticClosure: false,
        catchUpUntil: "2026-12-20T00:00:00.000Z",
        catchUpHistory: [{ startedAt: "2026-12-06T00:00:00.000Z" }],
      },
    }),
  ).not.toThrow();
  expect(() =>
    project({
      slopbot: { automaticClosure: false, catchUpUntil: "2026-12-20" },
    }),
  ).toThrow("catchUpUntil");
  expect(() =>
    project({
      slopbot: {
        automaticClosure: false,
        catchUpHistory: [
          { startedAt: "2026-12-06T00:00:00.000Z" },
          { startedAt: "2026-11-06T00:00:00.000Z" },
        ],
      },
    }),
  ).toThrow("order");
});

test("the offered end is never past 14 days from now", () => {
  for (const at of [
    "2026-12-10T00:00:00.000Z",
    "2026-12-10T12:34:56.789Z",
    "2026-12-31T23:59:59.999Z",
  ]) {
    const now = new Date(at);
    const end = Date.parse(catchUpOfferedEnd(now));
    expect(end).toBeGreaterThan(now.getTime());
    expect(end).toBeLessThanOrEqual(now.getTime() + 14 * DAY);
  }
});
