import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { childEnvironment } from "./child-environment.mjs";

test("an empty production attester installs privately and refuses every signing route", () => {
  const result = spawnSync(
    "node",
    ["workers/payment-executor/bootstrap-workflow.mjs"],
    {
      encoding: "utf8",
      env: childEnvironment(),
      timeout: 60_000,
    },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 240_000);
