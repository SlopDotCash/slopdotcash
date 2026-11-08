import { afterAll, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type LiveReport = {
  candidateIssues: Array<{ number: number }>;
  filtered: {
    issuesWithOpenPullRequests: Array<{
      number: number;
      closingPullRequests: number[];
    }>;
  };
};
type LiveReportModule = {
  collectLiveReport(
    repo: string,
    listPages: (endpoint: string) => unknown[],
    now: Date,
  ): LiveReport;
};

const REPO = "SlopDotCash/slopdotcash";

// An installed skill keeps project.json beside scripts/; the template has none.
const skill = mkdtempSync(join(tmpdir(), "slop-live-report-"));
mkdirSync(join(skill, "scripts"));
for (const name of ["live-report.mjs", "run-receipt.mjs"]) {
  copyFileSync(
    new URL(
      `../skills/project-contributor-template/scripts/${name}`,
      import.meta.url,
    ),
    join(skill, "scripts", name),
  );
}
writeFileSync(
  join(skill, "project.json"),
  JSON.stringify({ repositoryId: REPO }),
);
afterAll(() => {
  rmSync(skill, { recursive: true, force: true });
});

// The shared skill script has no declaration file; type only what this test uses.
const { collectLiveReport }: LiveReportModule = await import(
  pathToFileURL(join(skill, "scripts", "live-report.mjs")).href
);
const NOW = new Date("2026-11-06T12:00:00Z");
const user = (login: string, id: number) => ({ login, id, type: "User" });

function issue(number: number, title: string) {
  return {
    number,
    title,
    html_url: `https://github.com/${REPO}/issues/${number}`,
    user: user("maintainer", 1),
    labels: [],
    assignees: [],
    comments: 0,
    body: "",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

function pull(number: number, title: string, body: string) {
  return {
    number,
    title,
    body,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    user: user(`contributor-${number}`, 1000 + number),
    labels: [],
    assignees: [],
    draft: false,
    requested_reviewers: [],
    requested_teams: [],
    head: { sha: "a".repeat(40) },
    created_at: "2026-11-02T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z",
  };
}

function report(pulls: unknown[]) {
  const issues = [
    issue(2010, "Security report screening cannot see duplicates"),
    issue(2011, "Unrelated open defect"),
  ];
  return collectLiveReport(
    REPO,
    (endpoint) => {
      if (endpoint.startsWith(`repos/${REPO}/issues?`)) return issues;
      if (endpoint.startsWith(`repos/${REPO}/pulls?`)) return pulls;
      return [];
    },
    NOW,
  );
}

test("an issue that an open PR names in its title is not offered as unclaimed work", () => {
  const result = report([
    pull(
      2162,
      "fix(security): pass project prior cases into intake screening (#2010)",
      "Intake screening now receives the project's recent cases.",
    ),
  ]);

  expect(result.candidateIssues.map((item) => item.number)).toEqual([2011]);
  expect(
    result.filtered.issuesWithOpenPullRequests.map((item) => [
      item.number,
      item.closingPullRequests,
    ]),
  ).toEqual([[2010, [2162]]]);
});

test("a title reference to another repository does not hold back a local issue", () => {
  const result = report([
    pull(2400, "fix: port elizaOS/eliza#2010 parser change", ""),
  ]);

  expect(result.candidateIssues.map((item) => item.number)).toEqual([
    2010, 2011,
  ]);
});
