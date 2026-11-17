import { join } from "node:path";
import { buildSite } from "../build.ts";
import { startSite } from "../site.ts";

const built = await buildSite(join(import.meta.dirname, "../../../.cache/spike-explore"));
const { mf } = startSite(built, 0);
const url = await mf.ready;
process.stdout.write(`serving the built page at http://localhost:${url.port}/\n`);
