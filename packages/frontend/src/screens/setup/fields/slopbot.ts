// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
export const slopbotInstallUrl = "https://github.com/apps/slopdotcash/installations/new";

/** @throws {never} */
export function slopbotInstallScopeNote(repository: string): string {
  return `On GitHub's install screen choose "Only select repositories" and pick ${repository}. Slopbot gets no access to your other private repositories.`;
}
