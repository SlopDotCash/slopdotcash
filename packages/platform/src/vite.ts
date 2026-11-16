import vibelang from "vibelang-vite";
import type { UserConfig } from "vite";

const conditions = ["workerd", "worker", "import", "default"];

export function workerBuild(entry: string): UserConfig {
  return {
    plugins: [vibelang()],
    resolve: { conditions },
    ssr: { noExternal: true, target: "webworker", resolve: { conditions, externalConditions: ["workerd", "worker"] } },
    build: {
      ssr: entry,
      outDir: "dist",
      emptyOutDir: true,
      target: "es2024",
      minify: false,
      sourcemap: true,
      rolldownOptions: { output: { entryFileNames: "worker.js", format: "es" } },
    },
  };
}
