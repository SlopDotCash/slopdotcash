/**
 * Locks the release workflow to the exact tested SHA and the checked-in Pages
 * output contract so local convenience commands cannot become release paths.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const workflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "deploy.yml"),
  "utf8",
);
const packageManifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const wranglerConfiguration = readFileSync(
  join(packageRoot, "wrangler.toml"),
  "utf8",
);
const identityWranglerConfiguration = readFileSync(
  join(packageRoot, "workers", "identity", "wrangler.toml"),
  "utf8",
);
const identityDeploymentGuide = readFileSync(
  join(packageRoot, "workers", "identity", "README.md"),
  "utf8",
);
const pagesHeaders = readFileSync(
  join(packageRoot, "public", "_headers"),
  "utf8",
);
const qualityJob = workflow.slice(
  workflow.indexOf("\n  quality:"),
  workflow.indexOf("\n  deploy:"),
);
const deployJob = workflow.slice(workflow.indexOf("\n  deploy:"));

describe("slop.cash deployment contract", () => {
  it("deploys only the exact tested SHA through wrangler.toml", () => {
    expect(qualityJob).toContain(`ref: ${"$"}{{ github.sha }}`);
    expect(qualityJob).toContain("does not match the event SHA $GITHUB_SHA");
    expect(deployJob).toContain(`ref: ${"$"}{{ github.sha }}`);
    expect(deployJob).toContain('checked_out_sha="$(git rev-parse HEAD)"');
    expect(deployJob).toContain(
      "bun install --frozen-lockfile --ignore-scripts",
    );
    expect(deployJob).toContain(
      "uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(deployJob).toContain(`node-version: ${"$"}{{ env.NODE_VERSION }}`);
    expect(deployJob).toContain("./node_modules/.bin/wrangler pages deploy \\");
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler deploy \\\n            --config workers/identity/wrangler.toml \\",
    );
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler secret list \\\n            --config workers/identity/wrangler.toml",
    );
    expect(deployJob).toContain("https://identity.slop.cash/v1/oauth/start");
    expect(deployJob).toContain("https://identity.slop.cash/v1/oauth/callback");
    expect(deployJob.indexOf("wrangler deploy \\")).toBeLessThan(
      deployJob.indexOf("wrangler pages deploy \\"),
    );
    expect(deployJob).not.toContain("working-directory:");
    expect(deployJob).not.toContain("bunx wrangler");
    expect(deployJob).not.toContain("pages deploy dist");
    expect(deployJob).toContain('--commit-hash="$GITHUB_SHA"');
    expect(deployJob).toContain("--commit-dirty=false");
    expect(deployJob).toContain("select-pages-deployment.mjs");
    expect(deployJob).toContain("new, successful, clean production deployment");
    expect(
      deployJob.match(
        /git -C "\$GITHUB_WORKSPACE" ls-remote --exit-code --refs/g,
      ),
    ).toHaveLength(2);
    expect(
      deployJob.match(
        /git -C "\$GITHUB_WORKSPACE" diff --quiet "\$GITHUB_SHA" "\$live_develop"/g,
      ),
    ).toHaveLength(2);
    expect(deployJob).toContain(
      "changed a slop.cash release input immediately before deployment",
    );
    expect(
      deployJob.match(/diff --quiet "\$GITHUB_SHA" "\$live_develop" -- \./g),
    ).toHaveLength(2);
    expect(deployJob).toContain("https://github.com/elizaOS/slopdotcash.git");
    expect(wranglerConfiguration).toContain(
      'pages_build_output_dir = "./dist"',
    );
    expect(packageManifest.devDependencies.wrangler).toBe("4.120.0");
    expect(packageManifest.scripts.build).toContain(
      "node scripts/dist-manifest.mjs create dist",
    );
  });

  it("keeps every release path restricted to develop", () => {
    expect(workflow).toContain(
      `cancel-in-progress: ${"$"}{{ github.event_name == 'pull_request' }}`,
    );
    expect(workflow).toContain(
      `group: slop-${"$"}{{ github.event.pull_request.number || github.run_id }}`,
    );
    expect(deployJob).toContain(
      "github.event_name == 'push' && github.ref == 'refs/heads/develop'",
    );
    expect(deployJob).toContain(
      "github.event_name == 'schedule' && github.ref == 'refs/heads/develop'",
    );
    expect(deployJob).not.toContain("github.event_name == 'pull_request'");
    expect(deployJob).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/develop'",
    );
    expect(deployJob).toContain(
      'if [ "$GITHUB_REF" != "refs/heads/develop" ]; then',
    );
    expect(deployJob).toContain("group: slop-production");
    expect(deployJob).toContain("cancel-in-progress: true");
    expect(deployJob).toContain("name: eliza-army-production");
  });

  it("has no candidate-controlled production release path", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("release_mode");
    expect(workflow).not.toContain("production-candidate");
    expect(workflow).not.toContain("candidate_pr");
    expect(workflow).not.toContain("Candidate PR");
    expect(deployJob).not.toContain("pulls/$CANDIDATE_PR");
  });

  it("keeps production deploy authority out of package scripts", () => {
    expect(packageManifest.scripts.deploy).toBeUndefined();
    expect(packageManifest.scripts["test:e2e:record:production"]).toBe(
      "node scripts/record-evidence.mjs --production",
    );
  });

  it("cache-busts every post-deploy byte comparison", () => {
    const verificationStep = workflow.slice(
      workflow.indexOf("- name: Verify published skill and leaderboard"),
    );
    expect(verificationStep).toContain('--header "Cache-Control: no-cache"');
    expect(verificationStep).toContain('--header "Pragma: no-cache"');
    expect(verificationStep).toContain(
      "?verify=$GITHUB_SHA-$GITHUB_RUN_ATTEMPT-$attempt",
    );
    expect(verificationStep).toContain("--connect-timeout 10");
    expect(verificationStep).toContain("--max-time 30");
    expect(verificationStep).toContain(
      "verify_download / dist/index.html index.html",
    );
    expect(verificationStep).not.toContain(
      "verify_download /index.html dist/index.html",
    );
    expect(verificationStep).toContain(
      `"https://slop.cash${"$"}{remote_path}?verify=`,
    );
    expect(verificationStep).toContain("node scripts/dist-manifest.mjs verify");
    expect(verificationStep.match(/verify_download \//g)).toHaveLength(1);
    expect(verificationStep).toContain('while [ "$attempt" -le 3 ]');
    expect(verificationStep).toContain("https://slop.cash \\");
    expect(verificationStep).toContain('"$GITHUB_SHA-$GITHUB_RUN_ATTEMPT"');
  });

  it("serves HTTPS policy and immutable hashed assets", () => {
    expect(pagesHeaders).toContain(
      "Strict-Transport-Security: max-age=31536000; includeSubDomains",
    );
    expect(pagesHeaders).toContain("style-src 'self';");
    expect(pagesHeaders).not.toContain("'unsafe-inline'");
    expect(pagesHeaders).toContain("/assets/*");
    expect(pagesHeaders).toContain(
      "Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it("binds the private trace and identity runtime through reviewed configuration", () => {
    expect(wranglerConfiguration).toContain('binding = "SLOP_DB"');
    expect(wranglerConfiguration).toContain('database_name = "slop-private"');
    expect(wranglerConfiguration).toContain(
      'database_id = "1b453124-2709-45af-8389-151a8105c461"',
    );
    expect(wranglerConfiguration).toContain('binding = "PRIVATE_TRACES"');
    expect(wranglerConfiguration).toContain(
      'bucket_name = "slop-private-traces"',
    );
    expect(wranglerConfiguration).toContain('binding = "SLOP_IDENTITY"');
    expect(wranglerConfiguration).toContain('service = "slop-identity"');
    expect(wranglerConfiguration).not.toContain("[env.preview");

    expect(identityWranglerConfiguration).toContain('name = "slop-identity"');
    expect(identityWranglerConfiguration).toContain("workers_dev = false");
    expect(identityWranglerConfiguration).toContain(
      '{ pattern = "identity.slop.cash", custom_domain = true }',
    );
    expect(identityWranglerConfiguration).toContain('binding = "IDENTITY_DB"');
    expect(identityWranglerConfiguration).toContain(
      'database_id = "1b453124-2709-45af-8389-151a8105c461"',
    );
    expect(identityDeploymentGuide).toContain("- Account permissions: none.");
    expect(
      identityDeploymentGuide.match(
        /randomBytes\(32\)\.toString\("base64url"\)/gu,
      ),
    ).toHaveLength(2);
  });
});
