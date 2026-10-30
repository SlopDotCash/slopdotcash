/** Generate the real protected-release profiles without provider credentials. */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function prepare(target: string, settings: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "slop-email-release-"));
  const result = spawnSync(
    process.execPath,
    ["scripts/release-notify.mjs", "prepare", target, dir],
    {
      env: {
        ...process.env,
        SLOP_NOTIFY_MAIL_PILOTS: "",
        SLOP_NOTIFY_GENERAL_EMAIL: "",
        SLOP_NOTIFY_EMAIL_SENDING_READY: "",
        ...settings,
      },
      encoding: "utf8",
    },
  );
  const read = (name: string) =>
    JSON.parse(readFileSync(join(dir, name), "utf8"));
  return {
    result,
    read,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test.each(["staging", "production"])(
  "general email profile keeps %s isolation, explicit readiness, and exact secret inventory",
  (target) => {
    const run = prepare(target, {
      SLOP_NOTIFY_GENERAL_EMAIL: "enabled",
      SLOP_NOTIFY_EMAIL_SENDING_READY: "verified",
    });
    try {
      expect(run.result.status).toBe(0);
      const config = run.read("wrangler.json");
      const profile = run.read("profile.json");
      expect(config.vars.NOTIFY_GENERAL_EMAIL_ENABLED).toBe("true");
      expect(config.vars.NOTIFY_INBOX_URL).toBe(
        target === "staging"
          ? "https://staging.slop.cash/inbox"
          : "https://slop.cash/inbox",
      );
      expect(config.d1_databases).toHaveLength(1);
      expect(config.services).toHaveLength(1);
      expect(config.services[0].binding).toBe("SLOPBOT");
      expect(config.triggers.crons).toEqual(["*/5 * * * *"]);
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
      expect(profile.expectedSecrets).toEqual([
        "ADMIN_EMAILS",
        "NOTIFY_UNSUBSCRIBE_KEY",
      ]);
      expect(profile.emailSendingReadiness).toBe("operator-verified");
    } finally {
      run.close();
    }
  },
);

test("general email cannot be selected by a boolean-like typo or missing native sender readiness", () => {
  for (const settings of [
    { SLOP_NOTIFY_GENERAL_EMAIL: "true" },
    { SLOP_NOTIFY_GENERAL_EMAIL: "enabled" },
  ]) {
    const run = prepare("staging", settings);
    try {
      expect(run.result.status).not.toBe(0);
    } finally {
      run.close();
    }
  }
});

test("legacy admin-only and pilot release profiles remain explicit", () => {
  for (const pilot of ["", "security,activity"]) {
    const run = prepare("staging", { SLOP_NOTIFY_MAIL_PILOTS: pilot });
    try {
      expect(run.result.status).toBe(0);
      const config = run.read("wrangler.json");
      const profile = run.read("profile.json");
      expect(config.vars.NOTIFY_GENERAL_EMAIL_ENABLED).toBe("false");
      expect(config.d1_databases).toHaveLength(pilot ? 1 : 0);
      expect(profile.expectedSecrets).toEqual(
        pilot
          ? ["ACTIVITY_MAIL_PILOT", "ADMIN_EMAILS", "SECURITY_MAIL_PILOT"]
          : ["ADMIN_EMAILS"],
      );
    } finally {
      run.close();
    }
  }
});

test("paused general email retains only the database needed to honor existing unsubscribe links", () => {
  const run = prepare("staging", { SLOP_NOTIFY_GENERAL_EMAIL: "paused" });
  try {
    expect(run.result.status).toBe(0);
    const config = run.read("wrangler.json");
    expect(config.vars.NOTIFY_GENERAL_EMAIL_ENABLED).toBe("false");
    expect(config.d1_databases).toHaveLength(1);
    expect(config.services).toHaveLength(0);
    expect(config.triggers.crons).toEqual([]);
    expect(run.read("profile.json").expectedSecrets).toEqual(["ADMIN_EMAILS"]);
  } finally {
    run.close();
  }
});
