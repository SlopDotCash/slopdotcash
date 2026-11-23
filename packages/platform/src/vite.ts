// spec/operations/release.md, "Every required check binds the same source and built artifact"
import { builtinModules } from "node:module";
import vibelang from "vibelang-vite";
import type { EnvironmentOptions, UserConfig } from "vite";

export interface Deployables {
  readonly workers?: Readonly<Record<string, string>>;
  readonly programs?: Readonly<Record<string, string>>;
  readonly nodeCompat?: ReadonlyArray<string>;
  readonly outDir?: string;
  readonly emptyOutDir?: boolean;
  readonly minify?: boolean;
}

interface Target {
  readonly input: string;
  readonly file: string;
  readonly conditions: ReadonlyArray<string>;
  readonly external: ReadonlyArray<string | RegExp>;
}

const workerConditions = ["workerd", "worker", "import", "default"];
const nodeConditions = ["node", "import", "default"];
const workerExternal = [/^cloudflare:/];
const nodeCompatExternal = [/^cloudflare:/, /^node:/];
const nodeExternal = [/^node:/, /^miniflare(?:\/|$)/u, /^wrangler(?:\/|$)/u, ...builtinModules];

function single(entry: string): UserConfig {
  return {
    plugins: [vibelang()],
    resolve: { conditions: workerConditions },
    ssr: { noExternal: true, target: "webworker", resolve: { conditions: workerConditions, externalConditions: ["workerd", "worker"] } },
    build: {
      ssr: entry,
      outDir: "dist",
      emptyOutDir: true,
      target: "es2024",
      minify: false,
      sourcemap: true,
      rolldownOptions: { external: workerExternal, output: { entryFileNames: "worker.js", format: "es" } },
    },
  };
}

function environment(target: Target, outDir: string, emptyOutDir: boolean, minify: boolean): EnvironmentOptions {
  return {
    consumer: "server",
    resolve: { conditions: [...target.conditions], externalConditions: [...target.conditions], noExternal: true },
    build: {
      outDir,
      emptyOutDir,
      target: "es2024",
      minify,
      sourcemap: false,
      copyPublicDir: false,
      rolldownOptions: { input: target.input, external: [...target.external], output: { entryFileNames: target.file, format: "es", codeSplitting: false } },
    },
  };
}

/** @throws {never} */
export function workerBuild(entry: string | Deployables): UserConfig {
  if (typeof entry === "string") return single(entry);
  const { workers = {}, programs = {}, nodeCompat = [], outDir = "dist", emptyOutDir = true, minify = false } = entry;
  const targets: ReadonlyArray<readonly [string, Target]> = [
    ...Object.entries(workers).map(([name, input]) => [`worker_${name}`, { input, file: `${name}.js`, conditions: workerConditions, external: nodeCompat.includes(name) ? nodeCompatExternal : workerExternal }] as const),
    ...Object.entries(programs).map(([name, input]) => [`program_${name}`, { input, file: `programs/${name}.js`, conditions: nodeConditions, external: nodeExternal }] as const),
  ];
  const environments = Object.fromEntries(targets.map(([name, target], index) => [name, environment(target, outDir, emptyOutDir && index === 0, minify)]));
  return {
    plugins: [vibelang()],
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
