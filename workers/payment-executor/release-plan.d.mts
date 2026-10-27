import type { PaymentStackConfig, PaymentStackInput } from "./configure.mjs";
export interface MainnetReleaseEntry {
  network: string;
  config: PaymentStackConfig & { triggers: { crons: string[] } };
  pinCount: number;
  secrets: string[];
  bindings: { binding: string; service: string; entrypoint: string }[];
}
export declare function mainnetReleasePlan(
  input: Pick<
    PaymentStackInput,
    "registry" | "registryDatabase" | "monthlySchedule"
  > & { execution?: Record<string, boolean> },
): MainnetReleaseEntry[];
