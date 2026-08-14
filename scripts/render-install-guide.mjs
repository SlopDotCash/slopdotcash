#!/usr/bin/env node
/**
 * Renders one deterministic project-skill installer guide from bounded public
 * inputs. Bootstrap agents reconstruct this output from an immutable GitHub
 * revision before executing any installer received from slop.cash.
 */

import { createInstallCommand } from "../src/lib/install-command.ts";

const CLIENTS = new Set(["claude-code", "codex"]);
const ORIGIN_PATTERN = /^https:\/\/slop\.cash\/projects\/[a-z0-9-]+$/u;
const SKILL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function fail(message) {
  throw new TypeError(message);
}

export function renderInstallGuide({
  artifactOrigin,
  client,
  skillName,
  skillRepositoryPath,
}) {
  if (!CLIENTS.has(client)) fail("client must be codex or claude-code");
  if (!SKILL_PATTERN.test(skillName)) fail("skill name is invalid");
  if (skillRepositoryPath !== `skills/${skillName}`) {
    fail("skill source path must match its name");
  }
  if (!ORIGIN_PATTERN.test(artifactOrigin)) {
    fail("artifact origin must be a canonical slop.cash project URL");
  }
  const isClaude = client === "claude-code";
  const skillsRoot = isClaude
    ? `\${CLAUDE_CONFIG_DIR:-\${HOME}/.claude}/skills`
    : `\${HOME}/.agents/skills`;
  return `# Install ${skillName} for ${isClaude ? "Claude Code" : "Codex"}

Install or update the complete skill archive. The authenticated installer
accepts the current \`develop\` revision, a byte-identical authorized ancestor,
or an explicitly labeled same-repository release candidate. It independently
compares packaged bytes with immutable GitHub source before atomic activation.

\`\`\`bash
${createInstallCommand(artifactOrigin, skillsRoot, {
  skillName,
  skillRepositoryPath,
})}
\`\`\`

Re-run the command whenever the skill starts. It is a no-op at the current
verified revision and retains the prior version for an explicitly authorized
rollback. Inspect \`PROVENANCE.json\` and \`SKILL.md\` before first use. Never
enter a wallet seed phrase, private key, or unrelated credential.
`;
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !["--artifact-origin", "--client", "--skill", "--source"].includes(
        name,
      ) ||
      !value ||
      values.has(name)
    ) {
      fail(
        "usage: render-install-guide.mjs --artifact-origin <url> --client <codex|claude-code> --skill <name> --source <skills/name>",
      );
    }
    values.set(name, value);
  }
  if (values.size !== 4) fail("all installer guide arguments are required");
  return {
    artifactOrigin: values.get("--artifact-origin"),
    client: values.get("--client"),
    skillName: values.get("--skill"),
    skillRepositoryPath: values.get("--source"),
  };
}

if (import.meta.main) {
  try {
    process.stdout.write(
      renderInstallGuide(parseArguments(process.argv.slice(2))),
    );
  } catch (error) {
    // error-policy:J1 The CLI boundary exposes a deterministic failure.
    process.stderr.write(
      `[Slop] installer guide refused: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
