import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const validator = workflow
  .split("node - \"$pages_secrets\" <<'NODE'\n")[1]
  .split("\n          NODE")[0];

function validate(names: string[]) {
  runInNewContext(validator, {
    require: () => ({
      readFileSync: () =>
        names.map((name) => `- ${name}: Value Encrypted`).join("\n"),
    }),
    process: { argv: ["node", "-", "inventory.txt"] },
  });
}

const required = ["OPERATOR_GITHUB_IDS", "TRACE_AUTH_SECRET"];

test("production accepts the provisioned Solana mint RPC and public GitHub read token without weakening its inventory gate", () => {
  const provisioned = [
    ...required,
    "REWARD_RPC_SOLANA",
    "SLOP_GITHUB_READ_TOKEN",
    "PAYMENT_RPC_URLS",
    "GITHUB_INTAKE_APP_CLIENT_ID",
    "GITHUB_INTAKE_APP_CLIENT_SECRET",
    "GITHUB_INTAKE_APP_ID",
    "GITHUB_INTAKE_APP_PRIVATE_KEY",
    "SLOP_INTAKE_GRANT_KEY",
    "SURPLUS_API_KEY",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
  ];
  expect(() => validate(provisioned)).not.toThrow();
  expect(() => validate(required)).not.toThrow();
  expect(() => validate([...provisioned, "UNREVIEWED_SECRET"])).toThrow(
    "Pages secret inventory",
  );
  expect(() =>
    validate(provisioned.filter((name) => name !== "TRACE_AUTH_SECRET")),
  ).toThrow("Pages secret inventory");
  expect(() =>
    validate(provisioned.filter((name) => name !== "X_CLIENT_SECRET")),
  ).toThrow("X OAuth credentials must be configured together");
});
