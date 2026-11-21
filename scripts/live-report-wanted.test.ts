import { expect, test } from "bun:test";
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

type Item = { number: number };
type Report = {
  candidateIssues: Item[];
  wantedIssues: Item[];
  filtered: { issuesWithOpenPullRequests: Item[] };
};
type LiveReport = {
  collectLiveReport(
    repo: string,
    listPages: (endpoint: string) => unknown[],
    now: Date,
  ): Report;
  renderMarkdown(report: Report): string;
};

const repo = "Example/repo";

function issue(number: number, labels: string[]) {
  return {
    number,
    title: `Defect ${number}`,
    html_url: `https://github.com/${repo}/issues/${number}`,
    user: { login: "ada", id: 1000 + number, type: "User" },
    labels: labels.map((name) => ({ name })),
    assignees: [],
    comments: 0,
  };
}

test("issues labelled slop-wanted come first, but never one an open PR already closes", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-wanted-"));
  try {
    const scripts = join(root, "scripts");
    mkdirSync(scripts);
    for (const name of ["live-report.mjs", "run-receipt.mjs"])
      copyFileSync(
        resolve("skills/project-contributor-template/scripts", name),
        join(scripts, name),
      );
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({ repositoryId: repo }),
    );
    const module = (await import(
      pathToFileURL(join(scripts, "live-report.mjs")).href
    )) as LiveReport;
    const pages = new Map<string, unknown[]>([
      [
        `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,
        [
          issue(3, ["bug-confirmed"]),
          issue(5, ["Slop-Wanted"]),
          issue(8, ["slop-wanted", "help wanted"]),
        ],
      ],
      [
        `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`,
        [
          {
            number: 20,
            title: "Fix 8",
            html_url: `https://github.com/${repo}/pull/20`,
            body: "Closes #8",
            user: { login: "dependabot[bot]", id: 2020, type: "Bot" },
            labels: [],
          },
        ],
      ],
    ]);
    const report = module.collectLiveReport(
      repo,
      (endpoint) => {
        const page = pages.get(endpoint);
        if (!page) throw new Error(`unexpected GitHub read: ${endpoint}`);
        return page;
      },
      new Date("2026-11-20T00:00:00.000Z"),
    );
    expect(report.wantedIssues.map((item) => item.number)).toEqual([5]);
    expect(report.candidateIssues.map((item) => item.number)).toEqual([3, 5]);
    expect(
      report.filtered.issuesWithOpenPullRequests.map((item) => item.number),
    ).toEqual([8]);
    const markdown = module.renderMarkdown({
      ...report,
      audits: { issueComments: [], pullRequests: [] },
    } as never);
    const wanted = markdown.indexOf("## Priority 0");
    const other = markdown.indexOf("## Priority 1");
    expect(wanted).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(wanted);
    // #5 appears under Priority 0 only; #3 under Priority 1.
    expect(markdown.slice(wanted, other)).toContain("[#5]");
    expect(markdown.slice(wanted, other)).not.toContain("[#3]");
    expect(markdown.slice(other)).toContain("[#3]");
    expect(
      markdown.slice(other, markdown.indexOf("## Priority 2")),
    ).not.toContain("[#5]");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
