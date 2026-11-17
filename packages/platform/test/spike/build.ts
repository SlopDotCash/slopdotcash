import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import vibelang from "vibelang-vite";
import { type EnvironmentOptions, type UserConfig, build, createBuilder } from "vite";

export interface Deployables {
  readonly outDir: string;
  readonly workers: Readonly<Record<string, string>>;
  readonly programs?: Readonly<Record<string, string>>;
  readonly minify?: boolean;
}

const workerConditions = ["workerd", "worker", "import", "default"];
const nodeConditions = ["node", "import", "default"];

function environment(entry: string, file: string, outDir: string, conditions: ReadonlyArray<string>, minify: boolean, external: ReadonlyArray<string | RegExp>): EnvironmentOptions {
  return {
    consumer: "server",
    resolve: { conditions: [...conditions], externalConditions: [...conditions], noExternal: true },
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2024",
      minify,
      sourcemap: false,
      copyPublicDir: false,
      rolldownOptions: { input: entry, external: [...external], output: { entryFileNames: file, format: "es", codeSplitting: false } },
    },
  };
}

export function deployables({ outDir, workers, programs = {}, minify = false }: Deployables): UserConfig {
  const environments = {
    ...Object.fromEntries(Object.entries(workers).map(([name, entry]) => [`worker_${name}`, environment(entry, `${name}.js`, outDir, workerConditions, minify, [/^cloudflare:/])])),
    ...Object.fromEntries(Object.entries(programs).map(([name, entry]) => [`program_${name}`, environment(entry, `programs/${name}.js`, outDir, nodeConditions, minify, [/^node:/, ...builtinModules])])),
  };
  return {
    plugins: [vibelang()],
    logLevel: "error",
    environments,
    builder: {
      buildApp: async (builder) => {
        for (const name of Object.keys(environments)) {
          const target = builder.environments[name];
          if (target !== undefined) await builder.build(target);
        }
      },
    },
  };
}

export async function buildDeployables(root: string, options: Deployables): Promise<string> {
  const builder = await createBuilder({ root, configFile: false, ...deployables(options) });
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

export async function buildSite(outDir: string, minify = false): Promise<SiteFiles> {
  const assets = join(outDir, "site");
  await build({ root: join(spike, "explore"), configFile: false, logLevel: "error", build: { outDir: assets, emptyOutDir: true } });
  const deployed = await buildDeployables(spike, {
    outDir: join(outDir, "deployables"),
    workers: { _worker: "worker/pages.vibe", service: "worker/service.vibe" },
    programs: { main: "program/main.vibe" },
    minify,
  });
  return { pages: join(deployed, "_worker.js"), service: join(deployed, "service.js"), program: join(deployed, "programs/main.js"), assets };
}
