import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { childEnvironment } from "./child-environment.mjs";

test("local tool children cannot re-enable update probes or metrics or inherit credentials", () => {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      'console.log(JSON.stringify({banner:process.env.WRANGLER_HIDE_BANNER,metrics:process.env.WRANGLER_SEND_METRICS,credential:"CLOUDFLARE_API_TOKEN" in process.env}))',
    ],
    {
      env: childEnvironment(
        {
          PATH: process.env.PATH,
          CLOUDFLARE_API_TOKEN: "test-not-a-credential",
        },
        { WRANGLER_HIDE_BANNER: "false", WRANGLER_SEND_METRICS: "true" },
      ),
      encoding: "utf8",
    },
  );
  expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    banner: "true",
    metrics: "false",
    credential: false,
  });
});
