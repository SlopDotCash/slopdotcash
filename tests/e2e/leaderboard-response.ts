import type { APIRequestContext, APIResponse } from "@playwright/test";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../../src/lib/leaderboard";
import { readLeaderboardBytes } from "../../src/lib/leaderboard-transport.mjs";

export async function readLeaderboardResponse(
  response: APIResponse,
  request: APIRequestContext,
): Promise<LeaderboardSnapshot> {
  const bytes = await readLeaderboardBytes(
    await response.body(),
    async (path) => {
      const part = await request.get(path, { maxRetries: 1 });
      if (!part.ok())
        throw new Error(`Leaderboard part returned ${part.status()}`);
      return part.body();
    },
  );
  const snapshot: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assertLeaderboardSnapshot(snapshot);
  return snapshot;
}
