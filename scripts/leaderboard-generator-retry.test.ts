import { expect, test } from "bun:test";
import {
  ReviewCensusChangedError,
  runGenerator,
  SourceNodeUnavailableError,
} from "./generate-leaderboard";

test.each([
  new ReviewCensusChangedError("changed"),
  new SourceNodeUnavailableError([]),
])(
  "reports the classified error that caused a complete recollection",
  async (error) => {
    const retries: Error[] = [];
    let attempts = 0;

    await runGenerator("unused.json", {
      getToken: async () => "fixture-token",
      createClient: () => ({}) as never,
      generate: async () => {
        attempts += 1;
        if (attempts === 1) throw error;
        return {} as never;
      },
      write: async () => {},
      onCensusRetry: (cause) => retries.push(cause),
    });

    expect(retries).toEqual([error]);
    expect(attempts).toBe(2);
  },
);
