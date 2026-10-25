import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { validateBudget } from "./budget";
import { type KeeperConfiguration, runKeeper } from "./keeper";
import { keeperSigners } from "./signer";
import { openKeeperStore } from "./store";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    journal: { type: "string" },
    execute: { type: "boolean", default: false },
  },
  strict: true,
});
if (!values.config || !values.journal)
  throw new Error(
    "Use --config <operator.json> --journal <persistent.sqlite>; omit --execute for read-only chain checks",
  );
const config = JSON.parse(
  readFileSync(values.config, "utf8"),
) as KeeperConfiguration;
validateBudget(config.gas);
const family = ESCROW_NETWORKS[config.network]?.family;
if (!family) throw new Error("Choose a reviewed network");
const store = openKeeperStore(values.journal);
try {
  const result = await runKeeper(
    config,
    {
      store,
      ...(values.execute
        ? keeperSigners(config, (name) => process.env[name])
        : {}),
    },
    values.execute,
  );
  console.log(
    JSON.stringify(
      {
        mode: values.execute ? "execute" : "dry-run",
        network: config.network,
        results: result,
      },
      null,
      2,
    ),
  );
  if (
    result.some(
      (item) =>
        item.state === "unavailable" ||
        item.state === "publication-unavailable" ||
        item.error,
    )
  )
    process.exitCode = 1;
} finally {
  store.close();
}
