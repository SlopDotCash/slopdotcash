import { afterAll, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = "Example/repo";
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function loadLiveReport() {
  const root = mkdtempSync(join(tmpdir(), "slop-live-report-actor-"));
  tempDirs.push(root);
  const scripts = join(root, "scripts");
  mkdirSync(scripts);
  for (const name of ["live-report.mjs", "run-receipt.mjs"]) {
    copyFileSync(
      resolve("skills/project-contributor-template/scripts", name),
      join(scripts, name),
    );
  }
  writeFileSync(
    join(root, "project.json"),
    JSON.stringify({ repositoryId: repo }),
  );
  const moduleUrl = pathToFileURL(join(scripts, "live-report.mjs")).href;
  const reportModule = await import(moduleUrl);
  return { root, reportModule };
}

// Exact shapes GitHub returns for the Copilot app account:
// pull request author as Bot, and the User-shaped alias in assignees/comments.
const copilotUserShapedAlias = {
  login: "Copilot",
  id: 198644474,
  node_id: "BOT_kgDOC9w8XQ",
  type: "User",
};
const pullRequestAuthorBot = {
  login: "copilot-swe-agent",
  id: "BOT_kgDOC9w8XQ",
  type: "Bot",
};
const humanUser = {
  login: "human-contributor",
  id: 12345678,
  node_id: "U_kgDOABC123",
  type: "User",
};
const dependabotUserShaped = {
  login: "dependabot[bot]",
  id: 49699333,
  type: "User",
};

test("an app account served in User shape (BOT_ node ID) is recognized as a bot", async () => {
  const { reportModule } = await loadLiveReport();

  expect(reportModule.isBotAccount(copilotUserShapedAlias)).toBe(true);
  expect(reportModule.isKnownHumanAccount(copilotUserShapedAlias)).toBe(false);

  expect(reportModule.isBotAccount(pullRequestAuthorBot)).toBe(true);
  expect(reportModule.isKnownHumanAccount(pullRequestAuthorBot)).toBe(false);

  expect(reportModule.isBotAccount(dependabotUserShaped)).toBe(true);
  expect(reportModule.isKnownHumanAccount(dependabotUserShaped)).toBe(false);

  expect(reportModule.isBotAccount(humanUser)).toBe(false);
  expect(reportModule.isKnownHumanAccount(humanUser)).toBe(true);
});

test("an issue assigned only to Copilot is not held as claimed by a human", async () => {
  const { reportModule } = await loadLiveReport();

  const pages = new Map<string, unknown[]>([
    [
      `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,
      [
        {
          number: 10,
          title: "Fix potential memory leak",
          html_url: `https://github.com/${repo}/issues/10`,
          user: humanUser,
          labels: [{ name: "bug-confirmed" }],
          assignees: [copilotUserShapedAlias],
          comments: 0,
        },
      ],
    ],
    [
      `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`,
      [],
    ],
  ]);

  const report = reportModule.collectLiveReport(
    repo,
    (endpoint: string) => pages.get(endpoint) ?? [],
    new Date("2026-11-12T12:00:00Z"),
  );

  // Copilot is a bot and should be excluded from human assignees; the issue remains an unclaimed candidate
  expect(
    report.candidateIssues.map((item: { number: number }) => item.number),
  ).toEqual([10]);
  expect(report.filtered.claimedIssues).toEqual([]);
});

test("an issue authored by an app account in User shape is classified as a bot issue", async () => {
  const { reportModule } = await loadLiveReport();

  const pages = new Map<string, unknown[]>([
    [
      `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,
      [
        {
          number: 11,
          title: "Automated scan finding",
          html_url: `https://github.com/${repo}/issues/11`,
          user: copilotUserShapedAlias,
          labels: [{ name: "bug-confirmed" }],
          assignees: [],
          comments: 0,
        },
      ],
    ],
    [
      `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`,
      [],
    ],
  ]);

  const report = reportModule.collectLiveReport(
    repo,
    (endpoint: string) => pages.get(endpoint) ?? [],
    new Date("2026-11-12T12:00:00Z"),
  );

  expect(report.candidateIssues).toEqual([]);
  expect(
    report.filtered.botIssues.map((item: { number: number }) => item.number),
  ).toEqual([11]);
});
