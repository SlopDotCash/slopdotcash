import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  validateIdentitySchedules,
  verifyIdentitySchedules,
} from "./verify-identity-schedules.mjs";

const cron = "17 * * * *";
const valid = { success: true, result: [{ cron }] };
const options = {
  configuration: { name: "slop-identity", triggers: { crons: [cron] } },
  accountId: "a".repeat(32),
  token: "test-only-secret",
};

describe("identity cleanup schedule readback", () => {
  it("restores only an empty schedule and independently reads it back", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => valid });
    await verifyIdentitySchedules({
      ...options,
      fetchImpl,
      restoreMissing: true,
    });
    expect(fetchImpl.mock.calls.map((call) => call[1].method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      body: JSON.stringify([{ cron }]),
      redirect: "error",
    });
  });
  it("never modifies a valid existing schedule", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => valid });
    await verifyIdentitySchedules({
      ...options,
      fetchImpl,
      restoreMissing: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { success: false, result: [] },
    { success: true, result: [{ cron: "0 * * * *" }] },
  ])(
    "never overwrites nonempty drift or an unsuccessful read %#",
    async (body) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => body });
      await expect(
        verifyIdentitySchedules({
          ...options,
          fetchImpl,
          restoreMissing: true,
        }),
      ).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects failed restoration without leaking response details", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: [] }),
      })
      .mockRejectedValueOnce(new Error(options.token));
    await expect(
      verifyIdentitySchedules({ ...options, fetchImpl, restoreMissing: true }),
    ).rejects.toThrow(/^Identity cleanup schedule restoration failed$/u);
  });
  it("rejects a still-missing schedule after a successful write without retrying writes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: [] }),
    });
    await expect(
      verifyIdentitySchedules({ ...options, fetchImpl, restoreMissing: true }),
    ).rejects.toThrow("differs");
    expect(fetchImpl.mock.calls.map((call) => call[1].method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
  });
  it("accepts the exact canonical schedule with API metadata", () => {
    expect(() =>
      validateIdentitySchedules(
        { ...valid, result: [{ cron, created_on: "ignored" }] },
        [cron],
      ),
    ).not.toThrow();
  });
  it.each([
    null,
    { success: false, result: [{ cron }] },
    { success: true, result: [] },
    { success: true, result: [{ cron: "18 * * * *" }] },
    { success: true, result: [{ cron }, { cron }] },
    { success: true, result: [null] },
    { success: true, result: { schedules: [{ cron }] } },
  ])(
    "rejects missing, changed, extra, or malformed schedules %#",
    (response) => {
      expect(() => validateIdentitySchedules(response, [cron])).toThrow();
    },
  );
  it.each([undefined, [], [""], [cron, cron]])(
    "rejects invalid canonical configuration %#",
    (expected) => {
      expect(() => validateIdentitySchedules(valid, expected)).toThrow();
    },
  );
  it("uses only a bounded non-redirecting GET against the configured Worker", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => valid });
    await verifyIdentitySchedules({ ...options, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/workers/scripts/slop-identity/schedules`,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: { Authorization: `Bearer ${options.token}` },
      }),
    );
  });
  it("does not echo sensitive fetch errors", async () => {
    await expect(
      verifyIdentitySchedules({
        ...options,
        fetchImpl: async () => {
          throw new Error(options.token);
        },
      }),
    ).rejects.toThrow(/^Identity schedule readback request failed$/u);
  });
  it("does not parse or echo unsuccessful API responses", async () => {
    const json = vi.fn();
    await expect(
      verifyIdentitySchedules({
        ...options,
        fetchImpl: async () => ({ ok: false, json }),
      }),
    ).rejects.toThrow("not successful");
    expect(json).not.toHaveBeenCalled();
  });
  it("sanitizes JSON errors", async () => {
    await expect(
      verifyIdentitySchedules({
        ...options,
        fetchImpl: async () => ({
          ok: true,
          json: async () => {
            throw new Error(options.token);
          },
        }),
      }),
    ).rejects.toThrow(/^Identity schedule readback was not valid JSON$/u);
  });
  it.each([
    { accountId: "../other" },
    { token: "" },
    { configuration: { name: "../other", triggers: { crons: [cron] } } },
    { configuration: { name: "slop-identity", triggers: { crons: [] } } },
  ])(
    "rejects invalid inputs without sending credentials %#",
    async (override) => {
      const fetchImpl = vi.fn();
      await expect(
        verifyIdentitySchedules({ ...options, ...override, fetchImpl }),
      ).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("checks before deployment mutation and again after identity activation", () => {
    const workflow = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../.github/workflows/deploy.yml",
      ),
      "utf8",
    );
    const command = "bun scripts/verify-identity-schedules.mjs";
    expect(workflow.split(command)).toHaveLength(3);
    expect(workflow.indexOf(command)).toBeLessThan(
      workflow.indexOf("./node_modules/.bin/wrangler d1 migrations apply"),
    );
    expect(workflow.lastIndexOf(command)).toBeGreaterThan(
      workflow.indexOf("./node_modules/.bin/wrangler versions deploy"),
    );
  });
});
