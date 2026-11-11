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

type ClosingReport = {
  candidateIssues: { number: number }[];
  filtered: {
    issuesWithOpenPullRequests: {
      number: number;
      closingPullRequests: number[];
    }[];
  };
};

type LiveReport = {
  closingIssueNumbers(body: string, repo: string): number[];
  collectLiveReport(
    repo: string,
    listPages: (endpoint: string) => unknown[],
    now: Date,
  ): ClosingReport;
};

const repo = "Example/repo";

function account(login: string, id: number, type = "User") {
  return { login, id, type };
}

function issue(number: number) {
  return {
    number,
    title: `Defect ${number}`,
    html_url: `https://github.com/${repo}/issues/${number}`,
    user: account("ada", 1000 + number),
    labels: [{ name: "bug-confirmed" }],
    assignees: [],
    comments: 0,
  };
}

function pull(number: number, body: string) {
  return {
    number,
    title: `Fix ${number}`,
    html_url: `https://github.com/${repo}/pull/${number}`,
    body,
    user: account("dependabot[bot]", 2000 + number, "Bot"),
    labels: [],
  };
}

test("an open pull request that uses GitHub's colon or URL closing keyword is not free work", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-closing-"));
  try {
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
    const reportModule = (await import(
      pathToFileURL(join(scripts, "live-report.mjs")).href
    )) as LiveReport;

    expect(reportModule.closingIssueNumbers("Closes #11", repo)).toEqual([11]);
    expect(reportModule.closingIssueNumbers("Closes: #10", repo)).toEqual([10]);
    expect(
      reportModule.closingIssueNumbers("Fixes: Example/repo#13", repo),
    ).toEqual([13]);
    expect(
      reportModule.closingIssueNumbers("Fixes: other/repo#12", repo),
    ).toEqual([]);
    expect(
      reportModule.closingIssueNumbers(
        "Closes https://github.com/Example/repo/issues/14",
        repo,
      ),
    ).toEqual([14]);
    expect(
      reportModule.closingIssueNumbers(
        "Fixes: https://github.com/Example/repo/issues/15",
        repo,
      ),
    ).toEqual([15]);
    expect(
      reportModule.closingIssueNumbers(
        "Fixes: https://github.com/other/repo/issues/16",
        repo,
      ),
    ).toEqual([]);

    const pages = new Map<string, unknown[]>([
      [
        `repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`,
        [issue(10), issue(11), issue(12), issue(14)],
      ],
      [
        `repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`,
        [
          pull(20, "Closes: #10"),
          pull(21, "Closes #11"),
          pull(22, "Fixes: other/repo#12"),
          pull(23, `Closes https://github.com/${repo}/issues/14`),
        ],
      ],
    ]);
    const report = reportModule.collectLiveReport(
      repo,
      (endpoint) => {
        const page = pages.get(endpoint);
        if (!page) throw new Error(`unexpected GitHub read: ${endpoint}`);
        return page;
      },
      new Date("2026-11-10T00:00:00.000Z"),
    );

    expect(report.candidateIssues.map((item) => item.number)).toEqual([12]);
    expect(report.filtered.issuesWithOpenPullRequests).toEqual([
      expect.objectContaining({
        number: 10,
        closingPullRequests: [20],
      }),
      expect.objectContaining({
        number: 11,
        closingPullRequests: [21],
      }),
      expect.objectContaining({
        number: 14,
        closingPullRequests: [23],
      }),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
