import { workerBuild } from "@repo/platform/vite";
import { defineConfig } from "vite";

// The fee converter Worker (release service FeeConverter, `dist/feeConverter.js`) has no entry yet: no live
// ConversionChain or VaultDeployments exists in this package, so the release refuses its publication for the missing
// bundle rather than build one.
export default defineConfig(workerBuild({ programs: { main: "src/programs/main.vibe" } }));
