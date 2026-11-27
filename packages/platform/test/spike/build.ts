import { join, resolve } from "node:path";
import { build, createBuilder } from "vite";
import { type Deployables, workerBuild } from "../../src/vite.ts";

export async function buildDeployables(root: string, options: Deployables & { readonly outDir: string }): Promise<string> {
  const builder = await createBuilder({ root, configFile: false, logLevel: "error", ...workerBuild({ ...options, emptyOutDir: false }) });
  await builder.buildApp();
  return resolve(root, options.outDir);
}

const spike = import.meta.dirname;

export interface SiteFiles {
  readonly pages: string;
  readonly service: string;
  readonly program: string;
  readonly assets: string;
}

export async function buildSite(outDir: string): Promise<SiteFiles> {
  const assets = join(outDir, "site");
  await build({ root: join(spike, "explore"), configFile: false, logLevel: "error", build: { outDir: assets, emptyOutDir: true } });
  const deployed = await buildDeployables(spike, {
    outDir: join(outDir, "deployables"),
    workers: { _worker: "worker/pages.vibe", service: "worker/service.vibe" },
    programs: { main: "program/main.vibe" },
  });
  return { pages: join(deployed, "_worker.js"), service: join(deployed, "service.js"), program: join(deployed, "programs/main.js"), assets };
}
