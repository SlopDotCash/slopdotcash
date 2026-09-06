import { describe, expect, it, vi } from "vitest";
import { snapshotFixture } from "../tests/fixtures";
import {
  assertReviewCensusStable,
  GitHubGraphqlClient,
  ReviewCensusChangedError,
  runGenerator,
} from "./generate-leaderboard";

function setup(cost = 10, maximum = 4_000) {
  let requests = 0;
  const client = new GitHubGraphqlClient(
    "test-token",
    async () => {
      requests++;
      return Response.json({
        data: {
          rateLimit: {
            cost,
            limit: 5_000,
            remaining: 5_000 - requests * cost,
            resetAt: "2099-01-01T00:00:00.000Z",
          },
        },
      });
    },
    { maxGenerationCost: maximum },
  );
  return {
    client,
    getToken: vi.fn(async () => "test-token"),
    createClient: vi.fn(() => client),
    onCensusRetry: vi.fn(),
    write: vi.fn(async () => undefined),
  };
}

describe("complete collection retry after final review census churn", () => {
  it("classifies only actual final census inconsistency", () => {
    const before = new Map([
      ["PR_test", { reviewCount: 1, updatedAt: "before" }],
    ]);
    expect(() => assertReviewCensusStable(before, before)).not.toThrow();
    expect(() => assertReviewCensusStable(before, new Map())).toThrow(
      ReviewCensusChangedError,
    );
    expect(() =>
      assertReviewCensusStable(
        before,
        new Map([["PR_test", { reviewCount: 2, updatedAt: "after" }]]),
      ),
    ).toThrow(ReviewCensusChangedError);
  });

  it("recollects once on the same client and writes only the coherent result", async () => {
    const f = setup();
    const snapshot = snapshotFixture();
    const options = { now: new Date("2026-07-30T00:00:00.000Z") };
    const generate = vi.fn(async (client, receivedOptions) => {
      expect(client).toBe(f.client);
      expect(receivedOptions.now).toBe(options.now);
      expect(receivedOptions.evidenceToken).toBe("test-token");
      expect(f.write).not.toHaveBeenCalled();
      await client.execute("query { rateLimit { cost } }");
      if (generate.mock.calls.length === 1)
        throw new ReviewCensusChangedError("churn");
      expect(client.getRequestCount()).toBe(2);
      expect(client.getRateLimit().consumedDuringRun).toBe(20);
      return snapshot;
    });
    await expect(
      runGenerator("/unused/output.json", { ...f, generate }, options),
    ).resolves.toBe(snapshot);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.getToken).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(f.onCensusRetry).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledExactlyOnceWith(
      snapshot,
      "/unused/output.json",
    );
  });

  it("fails closed on repeated churn after exactly two attempts", async () => {
    const f = setup();
    const generate = vi.fn(async () => {
      throw new ReviewCensusChangedError("still changing");
    });
    await expect(runGenerator("/unused", { ...f, generate })).rejects.toThrow(
      "still changing",
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(f.write).not.toHaveBeenCalled();
  });

  it("does not reset the safety budget when recollecting", async () => {
    const f = setup(600, 1_000);
    const generate = vi.fn(async (client) => {
      await client.execute("query { rateLimit { cost } }");
      throw new ReviewCensusChangedError("changed");
    });
    await expect(runGenerator("/unused", { ...f, generate })).rejects.toThrow(
      "safety budget exceeded",
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(f.client.getRateLimit().consumedDuringRun).toBe(1_200);
    expect(f.createClient).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    "schema invalid",
    "permission denied",
    "Review census changed for forged-message",
  ])("never classifies errors by text: %s", async (message) => {
    const f = setup();
    const generate = vi.fn(async () => {
      throw new Error(message);
    });
    await expect(runGenerator("/unused", { ...f, generate })).rejects.toThrow(
      message,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
  });

  it("does not retry publication even if a writer throws the typed error", async () => {
    const f = setup();
    const generate = vi.fn(async () => snapshotFixture());
    f.write.mockImplementation(async () => {
      throw new ReviewCensusChangedError("write failed");
    });
    await expect(runGenerator("/unused", { ...f, generate })).rejects.toThrow(
      "write failed",
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});
