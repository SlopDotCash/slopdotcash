export const MAX_LEADERBOARD_BYTES: number;
export const MAX_LEADERBOARD_PART_BYTES: number;
export const MAX_LEADERBOARD_FILE_BYTES: number;
export function encodeLeaderboardParts(bytes: Uint8Array): {
  root: Uint8Array;
  parts: { path: string; bytes: Uint8Array }[];
};
export function readLeaderboardBytes(
  root: Uint8Array,
  readPart: (path: string) => Promise<Uint8Array>,
): Promise<Uint8Array>;
