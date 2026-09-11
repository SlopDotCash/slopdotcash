/** Regression for approval starvation: validate the actual job graph and shells. */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function workflow(path) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import yaml,json,sys; print(json.dumps(yaml.safe_load(sys.stdin)))",
      ],
      { input: readFileSync(path, "utf8"), encoding: "utf8" },
    ),
  );
}

describe("independent release and intake paths", () => {
  it("waits for code approval outside the publication lock, while refreshes can publish", () => {
    const { jobs } = workflow(".github/workflows/deploy.yml");
    expect(jobs.approve.environment).toBe("eliza-army-production");
    expect(jobs.approve.concurrency).toBeUndefined();
    expect(jobs.deploy.needs).toContain("approve");
    expect(jobs.deploy.if).toContain(
      "needs.approve.result == 'success' || github.event_name == 'schedule'",
    );
    expect(jobs.deploy.concurrency.group).toBe("slop-production");
    expect(jobs.deploy.environment.name).toBe("slop-data-refresh");
    const publication = jobs.deploy.steps.find(
      (step) => step.id === "pages-deploy",
    ).run;
    expect(
      publication.lastIndexOf("node scripts/released-source.mjs --check"),
    ).toBeLessThan(publication.indexOf("wrangler pages deploy"));
    expect(publication).toContain('--commit-hash="$RELEASE_SHA"');
    const { jobs: health } = workflow(
      ".github/workflows/private-intake-watch.yml",
    );
    expect(health.renew.needs).toBeUndefined();
    expect(health.renew.concurrency.group).not.toBe(
      jobs.deploy.concurrency.group,
    );
  });
  it("renews the legacy format only while refreshing an older approved source", () => {
    const { jobs } = workflow(".github/workflows/deploy.yml");
    const command = jobs.quality.steps.find((step) =>
      step.run?.includes("bun run leaderboard:generate"),
    ).run;
    const root = mkdtempSync(join(tmpdir(), "slop-legacy-refresh-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/prepare-private-intake-attestation.ts"),
        "",
      );
      writeFileSync(
        join(root, "bun"),
        '#!/bin/sh\nprintf \'%s:%s\\n\' "$GITHUB_SHA" "$*" >> "$TRACE"\n',
        { mode: 0o700 },
      );
      const trace = join(root, "trace");
      const env = {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        TRACE: trace,
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_SHA: "new-head",
        RELEASE_SHA: "approved-source",
      };
      execFileSync("bash", ["-eu", "-c", command], { cwd: root, env });
      expect(readFileSync(trace, "utf8")).toContain(
        "approved-source:scripts/prepare-private-intake-attestation.ts",
      );
      rmSync(join(root, "scripts/prepare-private-intake-attestation.ts"));
      rmSync(trace);
      execFileSync("bash", ["-eu", "-c", command], { cwd: root, env });
      expect(readFileSync(trace, "utf8").trim()).toBe(
        "new-head:run leaderboard:generate",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("parses every release shell after GitHub expression substitution", () => {
    for (const path of [
      ".github/workflows/deploy.yml",
      ".github/workflows/private-intake-watch.yml",
    ]) {
      for (const job of Object.values(workflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.run) continue;
          const result = spawnSync("bash", ["-n"], {
            input: step.run.replace(/\$\{\{.*?\}\}/gu, "fixture"),
            encoding: "utf8",
          });
          expect(result.status, `${path}: ${step.name}: ${result.stderr}`).toBe(
            0,
          );
        }
      }
    }
  });
});
