/**
 * Locks the release workflow to the exact tested SHA and the checked-in Pages
 * output contract so local convenience commands cannot become release paths.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const workflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "deploy.yml"),
  "utf8",
);
const transitionWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "project-transitions.yml"),
  "utf8",
);
const monthlyRewardsWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "monthly-rewards.yml"),
  "utf8",
);
const releaseLabelWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "release-label.yml"),
  "utf8",
);
const workflowDirectory = join(repositoryRoot, ".github", "workflows");
const privateIntakeWatch = readFileSync(
  join(workflowDirectory, "private-intake-watch.yml"),
  "utf8",
);
const privateIntakeWatchScript = readFileSync(
  join(repositoryRoot, "scripts", "check-private-intake-freshness.mjs"),
  "utf8",
);
const privateIntakeRecoveryGuide = readFileSync(
  join(repositoryRoot, "backend", "trace", "PRIVATE_INTAKE_RECOVERY.md"),
  "utf8",
);
const allWorkflows = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/u.test(name))
  .map((name) => ({
    name,
    source: readFileSync(join(workflowDirectory, name), "utf8"),
  }));
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
const pagesRedirects = readFileSync(
  join(packageRoot, "public", "_redirects"),
  "utf8",
);
const pagesRoutes = JSON.parse(
  readFileSync(join(packageRoot, "public", "_routes.json"), "utf8"),
);
const playwrightConfiguration = readFileSync(
  join(packageRoot, "playwright.config.ts"),
  "utf8",
);
const e2eRunner = readFileSync(
  join(packageRoot, "scripts", "run-e2e.mjs"),
  "utf8",
);
const evidenceRecorder = readFileSync(
  join(packageRoot, "scripts", "record-evidence.mjs"),
  "utf8",
);
const qualityJob = workflow.slice(
  workflow.indexOf("\n  quality:"),
  workflow.indexOf("\n  deploy:"),
);
const deployJob = workflow.slice(workflow.indexOf("\n  deploy:"));

describe("slop.cash deployment contract", () => {
  it("alerts before a reviewed private-intake refresh can expire", () => {
    expect(privateIntakeWatch).toContain('cron: "47 * * * *"');
    expect(privateIntakeWatch).toContain(
      "https://slop.cash/data/private-intake-attestation.json",
    );
    expect(privateIntakeWatch).toContain(
      "node scripts/check-private-intake-freshness.mjs",
    );
    expect(privateIntakeWatchScript).toContain(
      "Approve the newest trusted deployment now",
    );
    expect(privateIntakeWatch).toContain("PRIVATE_INTAKE_RECOVERY.md");
    expect(privateIntakeWatch).not.toContain("environment:");
    expect(privateIntakeWatch).not.toContain("wrangler");
  });

  it("documents fail-closed private-intake renewal and approver recovery", () => {
    expect(privateIntakeRecoveryGuide).toContain("## Normal renewal");
    expect(privateIntakeRecoveryGuide).toContain(
      "## Designated reviewer unavailable",
    );
    expect(privateIntakeRecoveryGuide).toContain(
      "## Complete renewal-cycle verification",
    );
    expect(privateIntakeRecoveryGuide).toContain(
      "Prevent administrators from bypassing required reviewers",
    );
    expect(privateIntakeRecoveryGuide).toContain(
      "If no independently authorized backup exists, wait for the designated reviewer",
    );
    expect(privateIntakeRecoveryGuide).toContain(
      "GET https://api.slop.cash/api/v1/private-request-intake",
    );
    expect(privateIntakeRecoveryGuide).toContain(
      "does not extend the freshness window",
    );
  });

  it("rewrites the nested project funding route through the Pages SPA", () => {
    const redirects = pagesRedirects.trim().split("\n");
    expect(redirects).toContain("/projects/:project/funding/ / 200");
    expect(redirects).toContain("/projects/:project/funding / 200");
    expect(redirects.indexOf("/projects/:project/funding/ / 200")).toBeLessThan(
      redirects.indexOf("/projects/:project / 200"),
    );
    expect(redirects.indexOf("/projects/:project/funding / 200")).toBeLessThan(
      redirects.indexOf("/projects/:project / 200"),
    );
  });

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
    expect(deployJob).toContain(
      "- name: Require public private-request intake",
    );
    expect(deployJob).toContain(
      "https://api.github.com/repos/SlopDotCash/slopdotcash/private-vulnerability-reporting",
    );
    expect(deployJob).toContain(
      '--header "Authorization: Bearer $GITHUB_TOKEN"',
    );
    expect(deployJob).toContain(
      "--check dist/data/private-intake-attestation.json",
    );
    expect(deployJob).toContain("value?.enabled !== true");
    expect(
      deployJob.indexOf("Require public private-request intake"),
    ).toBeLessThan(deployJob.indexOf("wrangler pages deploy \\"));
    expect(deployJob).toContain("./node_modules/.bin/wrangler pages deploy \\");
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler versions upload \\\n            --config workers/identity/wrangler.toml \\",
    );
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler versions deploy \\\n            --name slop-identity \\",
    );
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler secret list \\\n            --config workers/identity/wrangler.toml",
    );
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler pages secret list \\\n            --project-name eliza-computer",
    );
    expect(deployJob).not.toContain("PRIVATE_INTAKE_GITHUB_TOKEN");
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler d1 migrations apply slop-private \\",
    );
    expect(deployJob).toContain(
      "./node_modules/.bin/wrangler d1 execute slop-private \\",
    );
    for (const schemaObject of [
      "trace_attachment_commits",
      "trace_attachment_commit_validate",
      "trace_attachment_commits_no_delete",
      "trace_attachment_commits_no_update",
    ]) {
      expect(deployJob).toContain(schemaObject);
    }
    expect(deployJob).toContain('--tag="$GITHUB_SHA"');
    expect(deployJob).toContain('--version-id="$identity_version_id"');
    expect(deployJob).toContain("--percentage=100");
    expect(deployJob).not.toContain('--version-tag="$GITHUB_SHA@100%"');
    expect(deployJob).toContain("Worker Version ID:");
    expect(deployJob).toContain('--message="slop.cash release $GITHUB_SHA"');
    expect(deployJob).toContain("wrangler versions list \\");
    expect(deployJob).toContain("wrangler deployments status \\");
    expect(deployJob).toContain("https://identity.slop.cash/v1/oauth/start");
    expect(deployJob).toContain("https://identity.slop.cash/v1/oauth/callback");
    expect(deployJob).toContain(
      "Identity start request 13 returned HTTP $limited_status; expected 429.",
    );
    expect(deployJob).toContain(
      "identity exact rate-limit probe did not produce one authoritative bucket",
    );
    expect(deployJob).toContain("row?.request_count !== 13");
    expect(deployJob).toContain("https://api.github.com/apps/slop-identity");
    expect(deployJob).toContain(
      "The Slop Identity GitHub App is not publicly discoverable",
    );
    expect(deployJob).toContain('value?.owner?.login !== "elizaOS"');
    expect(deployJob).toContain('JSON.stringify(value?.permissions) !== "{}"');
    expect(deployJob).toContain('JSON.stringify(value?.events) !== "[]"');
    expect(deployJob).toContain("https://api.slop.cash/api/v1/runs?verify=");
    expect(deployJob).toContain("timeout-minutes: 30");
    expect(deployJob).toContain("- name: Require reviewed Pages project");
    expect(deployJob).toContain(
      "- name: Require reviewed deck Pages custom domain",
    );
    expect(deployJob).toContain(
      "/pages/projects/eliza-computer/domains/deck.slop.cash",
    );
    expect(deployJob).not.toContain("wrangler pages project create");
    expect(deployJob).not.toContain("--request POST");
    expect(deployJob).not.toContain('--data \'{"name":"deck.slop.cash"}\'');
    expect(deployJob).toContain(
      "routine release code will not create or reconfigure it",
    );
    expect(deployJob).toContain('value?.result?.status !== "active"');
    expect(deployJob).toContain(
      'require("node:dns").promises.lookup("deck.slop.cash", { all: true })',
    );
    expect(deployJob).toContain('"https://deck.slop.cash/?verify=');
    expect(deployJob).toContain("--tlsv1.3");
    expect(deployJob).toContain("cmp --silent dist/index.html");
    expect(
      deployJob.indexOf("Require reviewed deck Pages custom domain"),
    ).toBeLessThan(deployJob.indexOf("wrangler pages deploy \\"));
    expect(deployJob.indexOf("wrangler versions deploy \\")).toBeLessThan(
      deployJob.indexOf("wrangler pages deploy \\"),
    );
    expect(deployJob.indexOf("wrangler pages deploy \\")).toBeLessThan(
      deployJob.indexOf("Require public identity OAuth app"),
    );
    expect(
      deployJob.indexOf("Verify published skill and leaderboard"),
    ).toBeLessThan(
      deployJob.indexOf("Verify active private trace API boundary"),
    );
    expect(
      deployJob.indexOf("Verify active private trace API boundary"),
    ).toBeLessThan(deployJob.indexOf("Require public identity OAuth app"));
    expect(deployJob).toContain(
      "Verify authoritative private intake preflight",
    );
    expect(deployJob).toContain(
      "https://api.slop.cash/api/v1/private-request-intake?verify=",
    );
    expect(deployJob).toContain('value?.source !== "github-public-status"');
    expect(deployJob).toContain("value?.enabled !== true");
    expect(deployJob).toContain(
      "Private intake preflight did not become authoritative.",
    );
    expect(
      deployJob.indexOf("Verify active private trace API boundary"),
    ).toBeLessThan(
      deployJob.indexOf("Verify authoritative private intake preflight"),
    );
    expect(
      deployJob.indexOf("Verify authoritative private intake preflight"),
    ).toBeLessThan(deployJob.indexOf("Require public identity OAuth app"));
    expect(deployJob).toContain(
      "Active private trace API did not reach its fail-closed unauthenticated boundary.",
    );
    expect(deployJob).toContain('--dump-header "$headers"');
    expect(deployJob).toContain(
      'contract !== "private-trace-v1-opaque-hmac-v1"',
    );
    expect(
      deployJob.match(/https:\/\/api\.slop\.cash\/api\/v1\/runs\?verify=/gu),
    ).toHaveLength(1);
    expect(deployJob).not.toContain("wrangler deploy \\");
    expect(deployJob).toContain("has no zone-level Workers Routes permission");
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
    ).toHaveLength(3);
    expect(
      deployJob.match(
        /git -C "\$GITHUB_WORKSPACE" diff --quiet "\$GITHUB_SHA" "\$live_develop"/g,
      ),
    ).toHaveLength(3);
    expect(deployJob).toContain(
      "changed a slop.cash release input immediately before deployment",
    );
    expect(
      deployJob.match(/diff --quiet "\$GITHUB_SHA" "\$live_develop" -- \./g),
    ).toHaveLength(3);
    expect(deployJob).toContain(
      "https://github.com/SlopDotCash/slopdotcash.git",
    );
    expect(deployJob).not.toContain(
      "https://api.github.com/repos/elizaOS/slopdotcash",
    );
    expect(deployJob).not.toContain(
      "https://github.com/elizaOS/slopdotcash.git",
    );
    expect(wranglerConfiguration).toContain(
      'pages_build_output_dir = "./dist"',
    );
    expect(packageManifest.devDependencies.wrangler).toBe("4.123.0");
    expect(packageManifest.scripts.build).toContain(
      "node scripts/dist-manifest.mjs create dist",
    );
    expect(qualityJob).toContain("include-hidden-files: true");
    expect(deployJob).toContain(
      "- name: Verify downloaded Pages bundle\n        run: node scripts/dist-manifest.mjs verify-local dist",
    );
    expect(deployJob.indexOf("Verify downloaded Pages bundle")).toBeLessThan(
      deployJob.indexOf("Require scoped Cloudflare credentials"),
    );
    expect(playwrightConfiguration).toContain("workers: 1");
    expect(packageManifest.scripts["test:e2e"]).toBe(
      "node scripts/run-e2e.mjs",
    );
    expect(playwrightConfiguration).toContain(
      'process.env.SLOP_E2E_PREBUILT === "1"',
    );
    expect(playwrightConfiguration).toContain(
      'process.env.SLOP_E2E_SERVER ?? "pages"',
    );
    expect(playwrightConfiguration).toContain("vite preview");
    expect(playwrightConfiguration).toContain("wrangler pages dev dist");
    for (const project of [
      "wide-desktop-chromium",
      "desktop-chromium",
      "tablet-chromium",
      "narrow-mobile-chromium",
    ]) {
      expect(playwrightConfiguration).toContain(`name: "${project}"`);
    }
    expect(e2eRunner).toContain('SLOP_E2E_SERVER: "preview"');
    expect(e2eRunner).toContain('SLOP_E2E_SERVER: "pages"');
    expect(e2eRunner.match(/SLOP_E2E_FORCE_FRESH_SERVER: "1"/gu)).toHaveLength(
      2,
    );
    expect(e2eRunner).toContain("childEnvironment()");
    expect(e2eRunner).not.toContain("...process.env");
    expect(evidenceRecorder.match(/env: childEnvironment\(\)/gu)).toHaveLength(
      2,
    );
    expect(evidenceRecorder).not.toContain("env: process.env");
    expect(e2eRunner).toContain('"--grep-invert", artifactContract');
    expect(e2eRunner).toContain('"--grep",\n    artifactContract');
    expect(qualityJob).toContain("run: bun run test:e2e");
    expect(qualityJob).toContain(
      "timeout --signal=TERM 10m ./node_modules/.bin/playwright install --with-deps chromium",
    );
    expect(qualityJob).toContain("for attempt in 1 2; do");
    expect(qualityJob).toContain(
      "Playwright Chromium installation failed twice.",
    );
    expect(qualityJob).not.toContain("bunx playwright install");
    expect(qualityJob).toContain("bun test ./skill-tests");
    expect(qualityJob).not.toContain("bun test skill-tests/*.test.ts");
    expect(qualityJob).toContain("run: bun run cycles:check");
    expect(qualityJob).toContain(
      "- name: Validate finalized Solana evidence on trusted revisions",
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

  it("keeps pull-request data checks live without exposing repository tokens", () => {
    expect(qualityJob).toContain(
      "- name: Generate live contribution data\n        # Pull-request code is untrusted",
    );
    expect(qualityJob).toContain(
      "if: github.event_name != 'pull_request'\n        env:\n          GH_TOKEN:",
    );
    expect(qualityJob).toContain(
      "- name: Load deployed public ledger for pull-request checks",
    );
    expect(qualityJob).toContain("if: github.event_name == 'pull_request'");
    expect(qualityJob).toContain("--max-filesize 26214400");
    expect(qualityJob).toContain("https://slop.cash/data/leaderboard.json");
    expect(qualityJob).toContain(
      "- name: Validate finalized Solana evidence on trusted revisions\n        if: github.event_name != 'pull_request'",
    );
  });

  it("runs monthly rewards from the immutable trusted event SHA", () => {
    expect(monthlyRewardsWorkflow).toContain(
      "if: github.ref == 'refs/heads/develop'",
    );
    expect(monthlyRewardsWorkflow).toContain(`ref: ${"$"}{{ github.sha }}`);
    expect(monthlyRewardsWorkflow).toContain(
      'if [ "$GITHUB_REF" != "refs/heads/develop" ]; then',
    );
    expect(monthlyRewardsWorkflow).toContain(
      'if [ "$checked_out_sha" != "$GITHUB_SHA" ]; then',
    );
    expect(monthlyRewardsWorkflow).not.toContain("ref: develop");
    expect(monthlyRewardsWorkflow).toContain(
      `bun run leaderboard:generate -- --cutoff "${"$"}{{ steps.cycle.outputs.cutoff }}"`,
    );
  });

  it("preserves an immutable-sha transition gate on trusted develop pushes", () => {
    const transitionGate = qualityJob.indexOf(
      'node scripts/check-project-transitions.mjs "$PROJECT_POLICY_BASE_SHA" "$PROJECT_POLICY_HEAD_SHA"',
    );
    const registryGate = qualityJob.indexOf("bun run projects:check");
    expect(qualityJob).toContain(
      `PROJECT_POLICY_BASE_SHA: ${"$"}{{ github.event.before }}`,
    );
    expect(qualityJob).toContain(
      `PROJECT_POLICY_HEAD_SHA: ${"$"}{{ github.sha }}`,
    );
    expect(qualityJob).toContain(
      `if [ "${"$"}{{ github.event_name }}" = "push" ]; then`,
    );
    expect(transitionGate).toBeGreaterThan(-1);
    expect(registryGate).toBeGreaterThan(transitionGate);
  });

  it("executes the PR transition gate only from the immutable trusted base", () => {
    expect(transitionWorkflow).toContain("pull_request_target:");
    expect(transitionWorkflow).toContain("permissions:\n  contents: read");
    expect(transitionWorkflow).toContain(
      `ref: ${"$"}{{ github.event.pull_request.base.sha }}`,
    );
    expect(transitionWorkflow).toContain("persist-credentials: false");
    expect(transitionWorkflow).toContain(
      'test "$(git rev-parse HEAD)" = "$PROJECT_POLICY_BASE_SHA"',
    );
    expect(transitionWorkflow).toContain(
      '"+refs/pull/$PROJECT_POLICY_PR_NUMBER/head:refs/remotes/origin/slop-transition-head"',
    );
    expect(transitionWorkflow).toContain(
      'test "$fetched_head" = "$PROJECT_POLICY_HEAD_SHA"',
    );
    expect(transitionWorkflow).toContain(
      '"$PROJECT_POLICY_BASE_SHA" "$PROJECT_POLICY_HEAD_SHA"',
    );
    expect(transitionWorkflow).not.toContain("secrets.");
    expect(transitionWorkflow).not.toContain("bun install");
    expect(transitionWorkflow).not.toContain(
      `ref: ${"$"}{{ github.event.pull_request.head.sha }}`,
    );
  });

  it("invalidates release approval on every candidate head change without executing candidate code", () => {
    expect(releaseLabelWorkflow).toContain("pull_request_target:");
    expect(releaseLabelWorkflow).toContain("types: [synchronize]");
    expect(releaseLabelWorkflow).toContain(
      "permissions:\n  contents: read\n  pull-requests: write",
    );
    expect(releaseLabelWorkflow).toContain(
      'target_label="slop-release-candidate"',
    );
    expect(releaseLabelWorkflow).toContain('"$EVENT_ACTION" != "synchronize"');
    expect(releaseLabelWorkflow).toContain("--method DELETE");
    expect(releaseLabelWorkflow).not.toContain("actions/checkout");
    expect(releaseLabelWorkflow).not.toContain(
      "github.event.pull_request.head",
    );
    expect(releaseLabelWorkflow).not.toContain("secrets.");
  });

  it("pins every third-party workflow action to an immutable commit", () => {
    let actionCount = 0;
    for (const { name, source } of allWorkflows) {
      for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gmu)) {
        actionCount += 1;
        expect(match[1], `${name} contains an unpinned action`).toMatch(
          /^[^@]+@[0-9a-f]{40}$/u,
        );
      }
    }
    expect(actionCount).toBeGreaterThan(0);
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
    expect(verificationStep).toContain(
      "for manifest_attempt in $(seq 1 72); do",
    );
    expect(verificationStep).toContain(
      '"$GITHUB_SHA-$GITHUB_RUN_ATTEMPT-$manifest_attempt"',
    );
    expect(verificationStep.match(/verify_download \//g)).toHaveLength(1);
    expect(verificationStep).toContain('while [ "$attempt" -le 3 ]');
    expect(verificationStep).toContain("https://slop.cash \\");
  });

  it("bounds every trusted external response before buffering it", () => {
    const curlCommands = workflow.match(/^\s*(?:if )?curl /gmu) ?? [];
    const responseBounds = workflow.match(/^\s*--max-filesize /gmu) ?? [];
    expect(curlCommands).toHaveLength(15);
    expect(responseBounds).toHaveLength(curlCommands.length);
    expect(workflow).toContain('--max-filesize "$(wc -c < dist/index.html)"');
    expect(workflow).toContain('--max-filesize "$expected_bytes"');
  });

  it("serves HTTPS policy and immutable hashed assets", () => {
    expect(pagesHeaders).toContain(
      "Strict-Transport-Security: max-age=31536000; includeSubDomains",
    );
    expect(pagesHeaders).toContain("style-src 'self';");
    expect(pagesHeaders).toContain(
      "img-src 'self' data: https://avatars.githubusercontent.com;",
    );
    expect(pagesHeaders).not.toContain("deck.eliza.app");
    expect(pagesHeaders).not.toContain("'unsafe-inline'");
    expect(pagesHeaders).toContain("/assets/*");
    expect(pagesHeaders).toContain(
      "Cache-Control: public, max-age=31536000, immutable",
    );
    expect(pagesRoutes.include).toContain("/api/v1/*");
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
    expect(wranglerConfiguration).toContain(
      "[env.preview]\nd1_databases = []\nr2_buckets = []\nservices = []\n\n[env.preview.vars]",
    );
    const previewConfiguration = wranglerConfiguration.slice(
      wranglerConfiguration.indexOf("[env.preview.vars]"),
    );
    expect(previewConfiguration).not.toContain('binding = "SLOP_DB"');
    expect(previewConfiguration).not.toContain('binding = "PRIVATE_TRACES"');
    expect(previewConfiguration).not.toContain('binding = "SLOP_IDENTITY"');

    expect(identityWranglerConfiguration).toContain('name = "slop-identity"');
    expect(identityWranglerConfiguration).toContain("workers_dev = false");
    expect(identityWranglerConfiguration).toContain(
      '{ pattern = "identity.slop.cash", custom_domain = true }',
    );
    expect(identityWranglerConfiguration).toContain('binding = "IDENTITY_DB"');
    expect(identityWranglerConfiguration).toContain(
      'database_id = "1b453124-2709-45af-8389-151a8105c461"',
    );
    expect(identityWranglerConfiguration).toContain(
      'name = "IDENTITY_START_LIMITER"',
    );
    expect(identityWranglerConfiguration).toContain('namespace_id = "81001"');
    expect(identityWranglerConfiguration).toContain("limit = 60");
    expect(identityWranglerConfiguration).toContain(
      'name = "IDENTITY_POLL_LIMITER"',
    );
    expect(identityWranglerConfiguration).toContain('namespace_id = "81002"');
    expect(identityWranglerConfiguration).toContain("limit = 600");
    expect(identityWranglerConfiguration.match(/period = 60/gu)).toHaveLength(
      2,
    );
    expect(deployJob).toContain("'identity_rate_limits'");
    expect(deployJob).toContain('"table:identity_rate_limits"');
    expect(identityWranglerConfiguration).toContain("invocation_logs = false");
    expect(identityWranglerConfiguration).not.toContain(
      "invocation_logs = true",
    );
    expect(identityDeploymentGuide).toContain("- Account permissions: none.");
    expect(identityDeploymentGuide).toContain(
      "A single atomic D1 statement\nenforces the exact per-client fixed window",
    );
    expect(
      identityDeploymentGuide.match(
        /randomBytes\(32\)\.toString\("base64url"\)/gu,
      ),
    ).toHaveLength(2);
  });
});
