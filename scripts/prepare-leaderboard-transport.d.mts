export function prepareLeaderboardTransport(path: string): Promise<{
  logicalBytes: number;
  rootBytes: number;
  parts: number;
}>;
