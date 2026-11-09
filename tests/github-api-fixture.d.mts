export const E2E_PUBLIC_GITHUB_TOKEN: string;
export const E2E_OWNER: { githubId: string; login: string };
export const E2E_ORGANIZATION: { githubId: string; login: string };
export const E2E_REWARD_TOKEN: Readonly<{
  address: string;
  symbol: string;
  decimals: number;
}>;
export const E2E_SECURITY_ACCOUNTS: Readonly<Record<string, string>>;
export const E2E_MAINTAINER_ACCOUNTS: Readonly<Record<string, string>>;
export function fixtureRepository(fullName: string): {
  id: number;
  node_id: string;
  full_name: string;
  owner: { login: string; type: string; id: number; node_id: string };
  default_branch: string;
  [key: string]: unknown;
};
export function fixtureBranchHead(fullName: string, branch: string): string;
export function startGitHubApiFixture(
  port: number,
): Promise<import("node:http").Server>;
