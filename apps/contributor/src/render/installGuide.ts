// spec/contributor/publication.md, "The bootstrap's renderer contract names files that exist byte-identical at the build commit"; spec/contributor/skillAuthority.md, "Only the exact GitHub API authority receives the optional credential"
import { productionAuthority, createInstallCommand } from "./installerProgram.ts";

export const installClients = ["codex", "claude-code", "cursor", "hermes", "manual"] as const;

export type InstallClient = (typeof installClients)[number];

interface ClientConfig {
  readonly skillsRoot: string;
  readonly clientName: string;
}

const clientConfig = {
  "claude-code": { skillsRoot: `\${CLAUDE_CONFIG_DIR:-\${HOME}/.claude}/skills`, clientName: "Claude Code" },
  codex: { skillsRoot: `\${HOME}/.agents/skills`, clientName: "Codex" },
  cursor: { skillsRoot: `\${HOME}/.cursor/skills`, clientName: "Cursor" },
  hermes: { skillsRoot: `\${HERMES_HOME:-\${HOME}/.hermes}/skills`, clientName: "Hermes Agent" },
  manual: { skillsRoot: `\${HOME}/.agents/skills`, clientName: "any agent" },
} as const satisfies Record<InstallClient, ClientConfig>;

export interface GuideRequest {
  readonly artifactOrigin: string;
  readonly client: string;
  readonly skillName: string;
  readonly skillRepositoryPath: string;
}

export type InstallGuide = { readonly kind: "guide"; readonly text: string } | { readonly kind: "refused"; readonly message: string };

const originPattern = /^https:\/\/slop\.cash\/projects\/[a-z0-9-]+$/u;
const skillPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const templateSourcePattern = /^skills\/project-(contributor|reviewer)-template$/u;

/** @throws {never} */
export function isInstallClient(value: string): value is InstallClient {
  return installClients.some((client) => client === value);
}

/** @throws {never} */
export function renderInstallGuide({ artifactOrigin, client, skillName, skillRepositoryPath }: GuideRequest): InstallGuide {
  if (!isInstallClient(client)) return { kind: "refused", message: "client must be codex, claude-code, cursor, hermes, or manual" };
  if (!skillPattern.test(skillName)) return { kind: "refused", message: "skill name is invalid" };
  if (skillRepositoryPath !== `skills/${skillName}` && !templateSourcePattern.test(skillRepositoryPath))
    return { kind: "refused", message: "skill source path must match its name" };
  if (!originPattern.test(artifactOrigin)) return { kind: "refused", message: "artifact origin must be a canonical slop.cash project URL" };
  const { skillsRoot, clientName } = clientConfig[client];
  const command = createInstallCommand({ artifactOrigin, skillsRoot, skillName, skillRepositoryPath, authority: productionAuthority });
  if (command.kind === "refused") return command;
  return {
    kind: "guide",
    text: `# Install ${skillName} for ${clientName}

Install or update the complete skill archive. The authenticated installer
accepts any committed template revision from the canonical repository.
The installer independently compares packaged bytes with immutable GitHub source before atomic activation.
Installed skills with offline support verify local provenance and file hashes
without a live GitHub or registry authorization call. Existing installs need
one verified update; historical templates retain their original behavior.
Project clearance still gates installation, updates and explicit rollback.
Ordinary updates cannot decrease the approved project revision.
Verification uses GitHub's anonymous API budget, which is shared by every
process behind your public IP. Export \`GH_TOKEN\` or \`GITHUB_TOKEN\` to use
your own authenticated budget instead; the token is sent only to
\`api.github.com\` and is never stored.

\`\`\`bash
${command.text}
\`\`\`

Run the command again when you want to update. It is a no-op at the current
verified revision and retains the prior version for an explicit rollback.
Inspect \`PROVENANCE.json\` and \`SKILL.md\` before first use. Never enter a wallet seed phrase, private key, or unrelated credential.
`,
  };
}
